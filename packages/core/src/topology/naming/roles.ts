/**
 * roles.ts — RoleTable 的生命周期纯逻辑（§3.2/§3.3/§3.4 移植 + 改造）
 *
 * - `assignRoles`：链根建表。语义优先（box/cylinder/cone/sphere 按法向/曲面类型
 *   给稳定名）、位置兜底（`${opType}:face_${i}`，保证每面必有 role）。
 * - `propagateRoles`：沿一次 hash 演化推进表（移植 brepjs updateRoles/nextHashes：
 *   deleted 丢弃、modified 全部后继替换、未变保留；generated 刻意不消费）。
 * - `mergeRoleTables`：布尔合流——A/B 两个来源的表各自传播后合并，缝面以本次
 *   语句 LHS 为新 origin 给位置名（§3.4）。
 * - `roleOfOrdinal`：序号 → role 反查（§3.7 生成 ExecutionResult.naming 用）。
 */

import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import type { HashEvolution } from '../../brep/face-evolution'
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- PartName retained for future 血统 API
import type { PartName, StmtId } from '../../identity'
import type { RoleTable } from './types'
import { semantic, formatRoleName, type RoleName } from './role-name'
import { captureFaceHint } from './geom-hint'

/** 主轴判定阈值：abs(component) > 0.9 视为轴对齐。 */
export const AXIS_THRESHOLD = 0.9

/** Re-export：hash 键演化（decodeHashEvolution 产出，见 brep/face-evolution.ts §2.4）。 */
export type { HashEvolution }

// ── 语义命名器（§3.2：faijs 单位/轴向契约，mm、+Z 向上）──
//
// Phase 1.7/1.12（计划 §4.2）：命名器输出 **RoleName 结构值**（不再是 'box:top'
// 这类混入 op 前缀的扁平串）。前缀删除的依据：origin 已改 StmtId 权威表达来源，
// role 只是「那条语句内的局部名」——'box:top' 里的 'box:' 是把 origin 信息塞进
// role 的历史残留（违反 R1 的精神）。序列化线格式由 formatRoleName 统一给出
// （semantic → 'top' / 'lateral' / 'surface'）。

/**
 * box 面：按外法向主轴给语义名。
 *
 * @param n - the outward normal of the face (unit length expected).
 * @returns the cardinal role (semantic 'top' etc.), or undefined when no axis dominates.
 */
export function boxRoleFromNormal(n: readonly [number, number, number]): RoleName | undefined {
  if (n[2] > AXIS_THRESHOLD) return semantic('top')
  if (n[2] < -AXIS_THRESHOLD) return semantic('bottom')
  if (n[1] > AXIS_THRESHOLD) return semantic('back')
  if (n[1] < -AXIS_THRESHOLD) return semantic('front')
  if (n[0] > AXIS_THRESHOLD) return semantic('right')
  if (n[0] < -AXIS_THRESHOLD) return semantic('left')
  return undefined
}

/** Z 轴端盖名：'+Z → top'、'-Z → bottom'（仅平面）。 */
function axialCapName(surfaceType: string, z: number): RoleName | undefined {
  if (surfaceType !== 'plane') return undefined
  if (z > AXIS_THRESHOLD) return semantic('top')
  if (z < -AXIS_THRESHOLD) return semantic('bottom')
  return undefined
}

/** cylinder（Z 轴）：端盖 + 侧立面。 */
function cylinderRole(surfaceType: string, z: number): RoleName | undefined {
  return surfaceType === 'cylinder' ? semantic('lateral') : axialCapName(surfaceType, z)
}

/** cone（Z 轴）：端盖 + 侧立面。 */
function coneRole(surfaceType: string, z: number): RoleName | undefined {
  return surfaceType === 'cone' ? semantic('lateral') : axialCapName(surfaceType, z)
}

/** sphere：单球面。 */
function sphereRole(surfaceType: string): RoleName | undefined {
  return surfaceType === 'sphere' ? semantic('surface') : undefined
}

/**
 * 每基本体的语义命名器，按 opType 键控。
 *
 * Phase 1.12：输出从扁平串改为 **RoleName**（§4.2 R4：role 是结构化、封闭可枚举的
 * 联合，扁平串只是它的线格式）。词汇表（封闭）：box → top/bottom/front/back/left/right；
 * cylinder/cone → lateral/top/bottom；sphere → surface。
 */
const ROLE_ASSIGNERS: Record<string, (surfaceType: string, normal: readonly [number, number, number]) => RoleName | undefined> = {
  box: (_surfaceType, normal) => boxRoleFromNormal(normal),
  cylinder: (surfaceType, normal) => cylinderRole(surfaceType, normal[2]),
  cone: (surfaceType, normal) => coneRole(surfaceType, normal[2]),
  sphere: (surfaceType, _normal) => sphereRole(surfaceType),
}

/**
 * 给链根 shape 建 role 子表（单 origin；§3.2）。
 *
 * 语义命名优先；**位置兜底已删**（Phase 1.7，计划 §4.2 R3：`${opType}:face_${i}`
 * 里的 index 是 OCCT 枚举序号，OCCT 不承诺面序稳定，改参即漂——真正抗重放的
 * 只有语义 role）。无语义名的面**不进表**：缺身份是显式状态（naming 行 role=null），
 * 不是可伪造的名字。R1（局部唯一）由构造保证：同语句内一个 role 只指一个面。
 *
 * assign 时只保留 hash + hint，不保留面句柄
 * （避免 wasm 句柄生命周期泄漏——读完几何量即弃）。
 *
 * @param kernel - the OCCT kernel.
 * @param shape - the chain-root solid (primitive / load STEP 产物).
 * @param opType - the chain-root operation type ('box'/'cylinder'/...)。
 * @returns role → hash 子表（role 为 RoleName 线格式串；仅语义命中的面）。
 */
export function assignRoles(
  kernel: BrepEngineApi,
  shape: BrepHandle,
  opType: string,
): Map<string, number[]> {
  const roles = new Map<string, number[]>()
  const assigner = ROLE_ASSIGNERS[opType]
  const faceHandles = kernel.getSubShapes(shape, 'face')
  try {
    const hashes = kernel.subShapeHashes(shape, 'face', 2147483647)
    for (let i = 0; i < faceHandles.length; i++) {
      const hint = captureFaceHint(kernel, faceHandles[i])
      const normal = hint.normal ?? [0, 0, 1]
      const surfaceType = hint.surfaceType ?? ''
      const semanticRole = assigner?.(surfaceType, normal)
      // R1：同名不重复认领（对称面法向并列时首个胜出——判定必须唯一胜出，G6）。
      if (semanticRole === undefined || roles.has(formatRoleName(semanticRole))) continue
      roles.set(formatRoleName(semanticRole), [hashes[i]])
    }
    return roles
  } finally {
    // getSubShapes 返回的每个子形都是独立 arena 句柄——读完几何量即释放，
    // 否则每次链根建表泄漏 faceCount 个存活句柄（arena 无界增长）。
    for (const h of faceHandles) {
      try { kernel.release(h) } catch { /* 已释放 */ }
    }
  }
}

/**
 * 把一个 role 的 hash 列表推进一个演化步（移植 brepjs nextHashes）：
 * deleted 丢弃、modified 全部后继替换（1→多保留全部分片）、未变保留。
 *
 * @param hashes - the role's current face hashes.
 * @param evolution - the hash-keyed evolution record.
 * @returns the successor hashes.
 */
export function nextHashes(hashes: readonly number[], evolution: HashEvolution): number[] {
  const successors: number[] = []
  for (const hash of hashes) {
    if (evolution.deleted.has(hash)) continue
    const modified = evolution.modified.get(hash)
    const targets = modified !== undefined && modified.length > 0 ? modified : [hash]
    for (const h of targets) if (!successors.includes(h)) successors.push(h)
  }
  return successors
}

/**
 * 沿一次 hash 演化推进某个 origin 的 role 表（移植 brepjs updateRoles）。
 *
 * generated 刻意不消费（§1.3 事实：occt 系 generated hash 指向中间形、实测 0 存活）；
 * 生成面由 DerivedFaceTopoRef 以 lineage 命名。
 *
 * @param roles - the input role table (may be the single-origin map or full table).
 * @param origin - the origin whose roles to advance.
 * @param evolution - the hash-keyed evolution record for this op.
 * @returns a NEW RoleTable with the origin's roles advanced (immutable style).
 */
export function propagateRoles(
  roles: RoleTable,
  origin: StmtId,
  evolution: HashEvolution,
): RoleTable {
  const originRoles = roles.get(origin)
  if (!originRoles) return roles
  const updated = new Map<string, number[]>()
  for (const [role, hashes] of originRoles) {
    const successors = nextHashes(hashes, evolution)
    if (successors.length > 0) updated.set(role, successors)
  }
  const result = new Map<StmtId, ReadonlyMap<string, readonly number[]>>()
  for (const [key, value] of roles) {
    result.set(key, key === origin ? updated : value)
  }
  return result
}

/**
 * 沿一次 hash 演化推进 RoleTable 的**所有** origin（单父 op 用，§3.3）。
 *
 * 变换/倒角等单输入 op 只产生一份演化，作用在输入表的所有 origin 上
 * （布尔合流后的表含多个 origin，刚体变换下面 1:1 保留全部）。
 *
 * @param roles - the input role table (possibly multi-origin after a merge).
 * @param evolution - the hash-keyed evolution record for this op.
 * @returns a NEW RoleTable with every origin's roles advanced.
 */
export function propagateAllOrigins(
  roles: RoleTable,
  evolution: HashEvolution,
): RoleTable {
  let result: RoleTable = roles
  for (const origin of roles.keys()) {
    result = propagateRoles(result, origin, evolution)
  }
  return result
}

/**
 * 布尔合流：合并两个来源的 role 表（§3.4，faijs 对 brepjs 的必要扩展）。
 *
 * 对 A、B 两张 hash 演化分别传播各自的表后合并；布尔新生成的缝面/刃面
 * 以本次布尔**语句的 StmtId** 为新 origin（Phase 1.6：不再用 LHS 变量名）。
 * 缝面**不再给位置名**（Phase 1.7：位置兜底已删）——登记空子表占位，
 * 面身份待 Phase 3 的 kernel/byAdjacency 词汇补齐；naming 行将显式 role=null。
 *
 * @param targetTable - the target part's role table.
 * @param targetEvo - the target-side hash evolution (A 的 inHash 去向).
 * @param toolTable - the tool part's role table.
 * @param toolEvo - the tool-side hash evolution (B 的 inHash 去向).
 * @param outStmt - the boolean statement's StmtId (new origin for seam faces).
 * @param seamCount - how many seam/generated faces to register (0 表示不登记).
 * @returns the merged RoleTable.
 */
export function mergeRoleTables(
  targetTable: RoleTable,
  targetEvo: HashEvolution,
  toolTable: RoleTable,
  toolEvo: HashEvolution,
  outStmt: StmtId,
  seamCount: number,
): RoleTable {
  const result = new Map<StmtId, ReadonlyMap<string, readonly number[]>>()
  for (const [origin, roles] of targetTable) {
    const advanced = new Map<string, number[]>()
    for (const [role, hashes] of roles) {
      const successors = nextHashes(hashes, targetEvo)
      if (successors.length > 0) advanced.set(role, successors)
    }
    result.set(origin, advanced)
  }
  for (const [origin, roles] of toolTable) {
    if (result.has(origin)) {
      // 同一 origin 出现在两侧（理论上罕见：同一变量两次输入）——按 tool 侧演化推进后合并。
      const existing = result.get(origin)!
      const advanced = new Map<string, number[]>()
      for (const [role, hashes] of roles) {
        const successors = nextHashes(hashes, toolEvo)
        if (successors.length > 0) advanced.set(role, successors)
      }
      const merged = new Map<string, number[]>(existing as Map<string, number[]>)
      for (const [role, hs] of advanced) {
        const prev = merged.get(role)
        merged.set(role, prev ? [...new Set([...prev, ...hs])] : hs)
      }
      result.set(origin, merged)
    } else {
      const advanced = new Map<string, number[]>()
      for (const [role, hashes] of roles) {
        const successors = nextHashes(hashes, toolEvo)
        if (successors.length > 0) advanced.set(role, successors)
      }
      result.set(origin, advanced)
    }
  }
  if (seamCount > 0) {
    // Phase 1.7：缝面不再给位置兜底名。登记空子表占位（origin=本次语句 StmtId），
    // 身份待 Phase 3 kernel/byAdjacency 词汇补齐；naming 行将显式 role=null（G6）。
    result.set(outStmt, new Map())
  }
  return result
}

/**
 * 序号 → role 反查（§3.7 生成 ExecutionResult.naming 用）。
 *
 * 反查需要「序号 → hash」对照：subShapeHashes(shape,'face',B) 的数组下标 i 对应
 * 序号 i+1（§1.1 事实：getSubShapes ↔ subShapeHashes 同走 TopExp::MapShapes、
 * 逐位同序）。调用方传入该对照数组 + 该 origin 的 role 表，返回第 ordinal 个面
 * 的 role 名；不在表中 → undefined。
 *
 * @param roles - the role table for a single origin (role → hash list).
 * @param ordinalToHash - subShapeHashes(shape,'face') 数组：下标 i ↔ 序号 i+1 的 hash。
 * @param ordinal - the face ordinal (1-based).
 * @returns the role name, or undefined when the ordinal isn't tracked.
 */
export function roleOfOrdinal(
  roles: ReadonlyMap<string, readonly number[]>,
  ordinalToHash: readonly number[],
  ordinal: number,
): string | undefined {
  const hash = ordinalToHash[ordinal - 1]
  if (hash === undefined) return undefined
  for (const [role, hashes] of roles) {
    if (hashes.includes(hash)) return role
  }
  return undefined
}
