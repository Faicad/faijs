/**
 * lineage-resolve.ts — 回走推进器（1.10 前置②，计划 §4.5）。
 *
 * 「产物上的 roleTable 只是缓存」的重算引擎：缓存 miss 时沿血缘 DAG
 * 从身份原点 `(origin, role)` 走到目标 part，产出该 role 在目标 part 上的
 * 面 hash 集合——与 `slot.roleTable.get(origin)?.get(role)` 语义等价。
 *
 * ## 推进载体：序号（ordinal），不是 hash
 *
 * hash 是内存指针哈希，跨 Shape 实例必变（copy 一个新 handle，hash 全换），
 * **不能**作为跨节点推进的载体。跨节点稳定的是两样东西：
 * - role（因果坐标，本机制的存在理由）；
 * - 面枚举序号（`slot.faceEvolution` 记录的正是 ordinal→ordinal[] 的演化，
 *   1.10 前置①已把每个 brep op 的演化挂到血缘节点）。
 *
 * 推进三步：
 * 1. **锚定**：root 语句的输出 part 上，role → hash 集合（读 root 的现存
 *    roleTable——它现在是缓存，读它是合法的），再换算成 root 上的序号集合；
 * 2. **逐节点推进**：沿 DAG 每个节点用其 `evolution`（ordinal 键）把序号集合
 *    映射到输出序号（`evo.get(o) ?? [o]`——"未变"的两种上报形态都容纳）；
 * 3. **落地**：目标 part 上把最终序号集合换算回 hash 集合。
 *
 * 任一步数据缺失 → 返回结构化失败原因（不静默返回空集——空集会被上层当成
 * "面被删除"，那是另一个语义）。
 */

import type { PartName, StmtId } from '../../identity'
import type { LineageGraph } from './lineage'
import { parseRoleName, formatRoleName } from './role-name'

/** 回走所需的外部读口（由调用方注入：runtime 持有 kernel 与 slots）。 */
export interface LineageResolveDeps {
  /** part 的 BREP 句柄（回走链上的中间产物经 solidCache 存活）。 */
  brepOf: (part: PartName) => unknown | undefined
  /** 句柄的全部面 hash（枚举序 = ordinal 1 起，与 faceEvolution 同序）。 */
  faceHashes: (handle: unknown) => readonly number[]
  /** 读某 part 的 roleTable 缓存（root 锚定用；返回 origin→role→hash[]）。 */
  roleTableOf: (part: PartName) => ReadonlyMap<string, ReadonlyMap<string, readonly number[]>> | undefined
}

/** 回走失败原因（结构化，不静默）。 */
export type LineageResolveFailure =
  | { readonly reason: 'no-lineage-node'; readonly stmt: string }
  | { readonly reason: 'no-root-part'; readonly stmt: string }
  | { readonly reason: 'no-handle'; readonly part: string }
  | { readonly reason: 'no-role-table'; readonly part: string }
  | { readonly reason: 'role-not-in-table'; readonly origin: string; readonly role: string }
  | { readonly reason: 'hash-not-found'; readonly part: string; readonly count: number }
  | { readonly reason: 'no-evolution'; readonly stmt: string; readonly op: string }

/** 回走成功：role 在目标 part 上的面 hash 集合。 */
export interface LineageResolveSuccess {
  readonly hashes: readonly number[]
}

/**
 * 沿血缘 DAG 回走：`(origin, role)` → 目标 part 上的 hash 集合。
 *
 * @param graph - the lineage graph (registered per execution).
 * @param origin - the origin statement id of the identity.
 * @param roleLine - the role in wire format (as stored in TopoRef).
 * @param targetPart - the part whose snapshot we resolve against.
 * @param deps - external readers (handles / hashes / role-table cache).
 * @returns success with the hash set, or a structured failure.
 */
export function resolveViaLineage(
  graph: LineageGraph,
  origin: StmtId,
  roleLine: string,
  targetPart: PartName,
  deps: LineageResolveDeps,
): LineageResolveSuccess | LineageResolveFailure {
  const role = parseRoleName(roleLine)
  if (!role) return { reason: 'role-not-in-table', origin, role: roleLine }

  // ── 链收集：origin 节点 →（经消费者边）→ 产出 targetPart 的节点 ──
  // 行走方向是「origin → 谁消费了我的输出 → 谁又消费了它的输出」：
  // 中间 part 的产出方是 origin 自己（stmtOf 指回原点），不能用产出方找下一步。
  const chain: { stmt: StmtId; part: PartName; evolution?: Map<number, number[]> }[] = []
  {
    const start = graph.node(origin)
    if (!start) return { reason: 'no-lineage-node', stmt: String(origin) }
    const rootPart = start.outputs[0]
    if (!rootPart) return { reason: 'no-root-part', stmt: String(origin) }
    const startEvo = start.evolution && !('modified' in start.evolution) ? (start.evolution as Map<number, number[]>) : undefined
    chain.push({ stmt: origin, part: rootPart, evolution: startEvo })
    let currentPart: PartName = rootPart
    while (!chain[chain.length - 1]!.part || true) {
      if (currentPart === targetPart) break
      const consumer = graph.nodeConsuming(currentPart)
      if (!consumer) return { reason: 'no-lineage-node', stmt: String(currentPart) }
      const evo = consumer.evolution && !('modified' in consumer.evolution) ? (consumer.evolution as Map<number, number[]>) : undefined
      // 承载 part：消费者的输出里选一个（单输出链取第一个；多输出如 split 取含
      // targetPart 的那个，否则取第一个——多输出分支的精确选择由调用方语义决定）。
      const carry = consumer.outputs.includes(targetPart) ? targetPart : consumer.outputs[0]!
      chain.push({ stmt: consumer.stmt, part: carry, evolution: evo })
      currentPart = carry
    }
  }

  // ── 锚定：root part 上 role → hash → ordinal ──
  const root = chain[0]!
  const rootHandle = deps.brepOf(root.part)
  if (rootHandle === undefined) return { reason: 'no-handle', part: root.part }
  const rootTable = deps.roleTableOf(root.part)
  if (!rootTable) return { reason: 'no-role-table', part: root.part }
  // root 的 roleTable 键形：origin（StmtId 串）→ role 线格式 → hashes。
  const rootHashes = rootTable.get(String(origin))?.get(roleLine)
  if (rootHashes === undefined || rootHashes.length === 0) {
    return { reason: 'role-not-in-table', origin, role: roleLine }
  }
  const rootAll = deps.faceHashes(rootHandle)
  let ordinals: number[] = []
  for (const h of rootHashes) {
    const idx = rootAll.indexOf(h)
    if (idx < 0) return { reason: 'hash-not-found', part: root.part, count: rootHashes.length }
    ordinals.push(idx + 1) // ordinal 1 起
  }

  // ── 逐节点推进（ordinal 键演化；链上首节点是原点，其演化作用于其输入，
  //     因此推进从链的第二个节点开始）──
  for (let i = 1; i < chain.length; i++) {
    const node = chain[i]!
    if (!node.evolution) {
      // identity 类 op（copy/place/transform）登记时 slot 里有 identityEvolution；
      // 演化缺失说明该节点未按 1.10 前置①挂接 —— 显式失败，不默认恒等。
      const g = graph.node(node.stmt)
      return { reason: 'no-evolution', stmt: node.stmt, op: g?.op ?? '?' }
    }
    ordinals = ordinals.flatMap((o) => node.evolution!.get(o) ?? [o])
  }

  // ── 落地：目标 part 上 ordinal → hash ──
  const last = chain[chain.length - 1]!
  const targetHandle = deps.brepOf(last.part)
  if (targetHandle === undefined) return { reason: 'no-handle', part: last.part }
  const targetAll = deps.faceHashes(targetHandle)
  const hashes: number[] = []
  for (const o of ordinals) {
    const h = targetAll[o - 1]
    if (h === undefined) return { reason: 'hash-not-found', part: last.part, count: ordinals.length }
    hashes.push(h)
  }
  return { hashes }
}

// formatRoleName 在 API 面保留导出（role 线格式与 TopoRef 序列化的唯一权威），
// 本模块仅经 parseRoleName 校验线格式合法性。
export { formatRoleName }
