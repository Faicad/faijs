/**
 * api/pmi/registry — PMI 标注的单一真源（跨 op 存活，不随几何变更搬运）
 *
 * ## 为什么不是 `Shape.pmi` 字段
 *
 * `Shape` 是执行期的活对象：每个几何 op 都会用 `fromBrep` / `solid()` **新建**一个
 * 产物 Shape。若把 PMI 存在字段上，产物天然不带——于是"标注之后不能建模"，
 * 或者每个 op 都要记得手工搬运一次。两者都错：
 *
 * - 前者违背工艺现实（先钻孔、后倒角、再攻丝是常规顺序，`fai_drill(tapped)`
 *   本身就是"建模即标注"）；
 * - 后者是逐 op 的隐式契约，漏一个就是静默丢失，且"搬过去"还要处理去重、顺序、
 *   变换——全是几何无关的杂活。
 *
 * ## 本模块的模型
 *
 * PMI 归属于**产出语句**（`StmtId`），与 Shape 实例无关。一旦写入就一直存在，
 * 几何怎么变都不动它。查询时沿「父语句」链回溯聚合：
 *
 * ```
 * let a = cad.box(40, 40, 20)     // s1   → a
 * a.addDatum({ … })               // 记在 s1 名下
 * let c = cad.fillet(a, …, 2)     // s2   ← 父语句 s1
 * c.addGdt({ … })                 // 记在 s2 名下
 * cad.projectView(c)              // 聚合 = [gdt] + [datum]，两条都在
 * ```
 *
 * ## 为什么按语句 id 而不是零件名
 *
 * `part0 = cad.translate(part0, …)` 是 faijs 的合法惯用法（重赋值）。`LineageNode`
 * 的 `inputs` 存的是 **`PartName`**，重赋值后 `stmtOf('part0')` 指向**新**语句——
 * 沿 `inputs` 反查会走回自己，聚合链在那里断掉（实测：`box → addDatum → fai_drill
 * → fillet(重赋值)` 之后，`part0` 上的 datum 抽不出来）。
 *
 * 所以父链在**登记之前**快照成 `StmtId`（`pmiParents`，由 `defineOp.wrapped` 填），
 * 那一刻 `partOwner` 还没被本条语句覆盖，`stmtOf(input)` 拿到的正是上一条语句。
 * 这条链一旦落地就与 PartName 无关，重赋值不再影响它。
 *
 * ## 为什么引用不会失效
 *
 * `TopoRef.origin` 是 **`StmtId`**（产生那个面的语句，全局唯一、与变量重命名解耦），
 * 不是"当前 Shape 的第 k 个面"。`api/topo-resolve.ts` 的 `resolveViaLineage` 本来就
 * 是"沿血缘从 origin 语句回走到当前 part 重算 hash"。所以 `translate` / `union` /
 * `fillet` 之后引用仍然指得回同一个面——这条链路是 naming 系统的设计目标，不是
 * PMI 的额外需求。
 *
 * 真正会解析失败的只有一种：那个面被 op **删掉**了（`subtract` 吃掉、`chamfer` 削平）。
 * 此时 `resolveTopoRef` 返回 `deleted`，渲染层计入 `stale` 并跳过——**数据不动**，
 * 用户仍能在 `getPmi()` 里看到它。丢数据等于丢诊断信息。
 *
 * ## 裸世界坐标：读时施加累积变换
 *
 * `PmiNote.anchor` / `PmiThreadHole.axis` 不在 `TopoRef` 体系里（mesh 链没有
 * 拓扑身份，也必须能定位孔口），它们是**裸世界坐标**。`translate` 之后这两处
 * 仍是旧坐标——修法不是改写数据，而是让变换类 op 登记一个矩阵
 * （`registerPmiTransform`），聚合时沿父链把矩阵乘上去（`api/pmi/affine.ts`）。
 *
 * 数据因此一个字节都不动：`getPmi()` 看到的是"在当前语句坐标系下的坐标"，
 * 原始标注仍是当初写下的那一份。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-design.md §4
 */

import type { PartName } from '../../identity'
import type { StmtId } from '../../identity'
import { nameOf } from '../../runtime-state'
import { runtimeLineage } from '../../topology/naming/lineage'
import type { PmiItem, PmiSet } from './types'
import {
  composeAffine,
  isIdentityAffine,
  PMI_AFFINE_IDENTITY,
  remapPmiItem,
  type PmiAffine,
} from './affine'

/** 语句 id → 该语句名下写下的标注（不含继承）。 */
const byStmt = new Map<StmtId, PmiItem[]>()

/**
 * 没有产出语句的零件（外部构造的 Shape、op 内部裸件）→ 标注。
 *
 * 正常脚本路径不会走到这里（每个 part 都有产出语句）；留着是为了让「纯数据
 * Shape 自带标注」这条兼容路径不至于丢东西。
 */
const byUnowned = new Map<PartName, PmiItem[]>()

/**
 * 语句 id → 它的**父语句**（执行登记前快照）。
 *
 * 不用 `LineageNode.inputs`（`PartName`）反查的原因见文件头「为什么按语句 id」。
 */
const pmiParents = new Map<StmtId, StmtId[]>()

/** 被显式 `clearPmi()` 过的语句：聚合到这层**停止向上回溯**。 */
const cutAt = new Set<StmtId>()

/**
 * 语句 id → 该语句施加在输入上的仿射变换（只有变换类 op 登记）。
 *
 * `T` 的语义是 `p_产物 = T · p_输入`。聚合沿父链上行时维护累积矩阵
 * `M ← M ∘ T_当前`：祖先名下的标注用 `M` 重映射，当前语句名下的用恒等。
 */
const pmiTransforms = new Map<StmtId, PmiAffine>()

/**
 * 往 map 的数组值里追加（不存在则建数组）。
 *
 * @param map - the target map.
 * @param key - the map key.
 * @param item - the item to append.
 */
function push<K>(map: Map<K, PmiItem[]>, key: K, item: PmiItem): void {
  const list = map.get(key)
  if (list === undefined) map.set(key, [item])
  else list.push(item)
}

/**
 * 记录一条标注到零件名下（落到它当前所属的产出语句上）。
 *
 * @param part - the part name the annotation belongs to.
 * @param item - the PMI item (already carries `kind`).
 */
export function addPmiItem(part: PartName, item: PmiItem): void {
  const stmt = runtimeLineage.stmtOf(part)
  if (stmt === undefined) {
    push(byUnowned, part, item)
    return
  }
  push(byStmt, stmt, item)
  // 重新标注意味着这块零件重新开始计数：之前 clear 砍断的上游链条要接回来，
  // 否则"clearPmi() 再补两条新标注"会看不到上游那些仍然有效的标注。
  cutAt.delete(stmt)
}

/**
 * 快照一条语句的父语句（`defineOp.wrapped` 在**登记血缘之前**调用）。
 *
 * 必须在 `runtimeLineage.register` 之前——register 会把 `partOwner` 覆盖成本条
 * 语句，之后 `stmtOf(input)` 就指向自己了（重赋值场景下输入名 == 输出名）。
 *
 * @param stmt - the statement being registered.
 * @param inputs - its geometry inputs (live Shape handles).
 */
export function registerPmiParents(stmt: StmtId, inputs: readonly object[]): void {
  const parents: StmtId[] = []
  for (const input of inputs) {
    const name = nameOf(input)
    if (name === undefined) continue
    const parent = runtimeLineage.stmtOf(name)
    if (parent !== undefined) parents.push(parent)
  }
  if (parents.length > 0) pmiParents.set(stmt, parents)
}

/**
 * 清空某零件名下的标注，并切断上游继承。
 *
 * @param part - the part name to clear.
 */
export function clearPmiOfPart(part: PartName): void {
  const stmt = runtimeLineage.stmtOf(part)
  if (stmt === undefined) {
    byUnowned.delete(part)
    return
  }
  byStmt.delete(stmt)
  cutAt.add(stmt)
}

/**
 * 该零件**自身**产出、不含继承的标注（按写入顺序）。
 *
 * @param part - the part name to read.
 * @returns the part's own annotation list (empty when none).
 */
export function ownPmiOf(part: PartName): readonly PmiItem[] {
  const stmt = runtimeLineage.stmtOf(part)
  return stmt === undefined ? (byUnowned.get(part) ?? []) : (byStmt.get(stmt) ?? [])
}

/**
 * 登记一条语句的坐标变换（`defineOp.wrapped` 在 impl 成功返回后调用）。
 *
 * 只有 `pmiRemap` 声明了矩阵的 op 会走到这里（`translate` / `rotate_euler` /
 * `scale` / `scale3d`）。恒等矩阵不登记——省掉一次 `Map` 写入，也让"坐标系没动"
 * 的语句和"压根没登记"的语句完全等价。
 *
 * @param stmt - the statement that performed the transform.
 * @param affine - its affine matrix, or undefined when the op does not transform.
 */
export function registerPmiTransform(stmt: StmtId, affine: PmiAffine | undefined): void {
  if (affine === undefined || isIdentityAffine(affine)) return
  pmiTransforms.set(stmt, affine)
}

/**
 * 聚合某零件的全部标注：自身 + 沿父语句链回溯的所有上游。
 *
 * 上游的裸世界坐标会按链上累积的变换重映射（`api/pmi/affine.ts`）；数据本身不改。
 *
 * @param part - the part name to aggregate.
 * @returns the flattened annotation list.
 */
export function collectPmiOf(part: PartName): readonly PmiItem[] {
  const stmt = runtimeLineage.stmtOf(part)
  if (stmt === undefined) return byUnowned.get(part) ?? []
  return walkStmt(stmt, PMI_AFFINE_IDENTITY, new Set<StmtId>(), new Set<PmiItem>())
}

/**
 * 语句链回溯（`stack` 防环、`seen` 按条目对象去重）。
 *
 * **祖先在前、本条语句的在后**：聚合结果按标注发生的时间排列。写反了的话
 * `box → 钻第一孔 → 钻第二孔` 会得到 [第二孔, 第一孔]，与用户的操作顺序相反。
 *
 * `acc` 是"从本条语句的坐标系看向祖先坐标系"的累积矩阵：本层标注用 `acc` 就是
 * 对的（本层条目就写在本层坐标系里），往父层走时再乘上本层的 `T`。
 *
 * @param stmt - the statement whose annotations to collect.
 * @param acc - cumulative transform from this statement's frame to the reading part's.
 * @param stack - the current path (cycle guard).
 * @param seen - already-collected items (identity de-dupe).
 * @returns the collected items in chronological order (ancestors first).
 */
function walkStmt(
  stmt: StmtId,
  acc: PmiAffine,
  stack: Set<StmtId>,
  seen: Set<PmiItem>,
): PmiItem[] {
  if (stack.has(stmt)) return []
  stack.add(stmt)
  const out: PmiItem[] = []
  // clearPmi() 过：不再向上继承，只算本条语句写的。
  if (!cutAt.has(stmt)) {
    const here = pmiTransforms.get(stmt)
    const up = here === undefined ? acc : composeAffine(acc, here)
    for (const parent of pmiParents.get(stmt) ?? []) out.push(...walkStmt(parent, up, stack, seen))
  }
  const remap = isIdentityAffine(acc)
  for (const item of byStmt.get(stmt) ?? []) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(remap ? item : remapPmiItem(item, acc))
  }
  stack.delete(stmt)
  return out
}

/**
 * 读一个 Shape 上的完整 PMI 集合（渲染 / 导出 / `ExecutionResult` 的统一入口）。
 *
 * 优先走注册表聚合；拿不到 `PartName`（op 内部临时造的件、或调用方自己拼的裸
 * Shape）或注册表里没有记录时，退回读 `shape.pmi` 字段——保留"纯数据 Shape 自带
 * 标注"这条兼容路径，让不经过脚本执行构造的 Shape 也能被标注与导出。
 *
 * @param shape - the shape (or compound member) to read annotations from.
 * @returns the aggregated PMI set, or undefined when the shape carries none.
 */
export function pmiOf(shape: object | undefined): PmiSet | undefined {
  if (!shape) return undefined
  const part = nameOf(shape)
  if (part !== undefined) {
    const items = collectPmiOf(part)
    if (items.length > 0) return { items }
  }
  const local = (shape as { pmi?: PmiSet }).pmi
  return local !== undefined && local.items.length > 0 ? local : undefined
}

/**
 * 语句内暂存的标注（op 实现写的、但挂在了**没有零件名**的中间产物的那部分）。
 *
 * 为什么需要：`fai_drill` 这类 op 在 impl 内部 `appendPmiItem(drilled.shape, …)`，
 * 而 `drilled.shape` 由 `fromBrep` 新建、此刻还没被 executor 命名（`nameOf` 返回
 * undefined）。注册表按语句 id 索引，收不到它——但这条标注必须属于**这条语句的产物**。
 *
 * 所以无名 Shape 上写的标注先进这里，由 `defineOp.wrapped` 在语句出口
 * （`isOuter`）调 `flushPendingPmi(产物名)` 归位。内层嵌套调用不 flush（`isOuter`
 * 为 false），它们写下的标注最终都归到最外层产物上——这正是「一条语句产出的标注
 * 属于它的产物」。
 */
const pending: PmiItem[] = []

/**
 * 暂存一条"无名 Shape 上的标注"，等语句出口归位。
 *
 * @param item - the PMI item written onto a not-yet-named product.
 */
export function addPendingPmiItem(item: PmiItem): void {
  pending.push(item)
}

/**
 * 把暂存的标注归到指定零件的名下（语句出口调用）。
 *
 * @param part - the statement's product part name.
 */
export function flushPendingPmi(part: PartName): void {
  if (pending.length === 0) return
  for (const item of pending) addPmiItem(part, item)
  pending.length = 0
}

/**
 * 清空整个注册表（每次执行开始时调用，与 `runtimeLineage.clear()` 同步）。
 */
export function resetPmiRegistry(): void {
  byStmt.clear()
  byUnowned.clear()
  pmiParents.clear()
  pmiTransforms.clear()
  cutAt.clear()
  pending.length = 0
}
