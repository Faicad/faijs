/**
 * api/pmi/methods — Shape PMI instance methods (non-op, member-call form)
 *
 * 定位（与 api/appearance.ts / api/meta.ts 同款方法模式）：
 * - PMI 标注设置**不是 op**（不进 defineOp/api-namespace/args-schema），是 Shape
 *   实例方法（`part0.addDimension(...)`，复用 `asm1.solve()` 的成员调用语句形态）。
 * - `pmi` 字段（PmiSet）引擎无关、JSON 可序列化，随 Shape 走 mesh/brep 双链路；
 *   编辑器/查看器只读字段，不依赖方法。
 * - 方法不序列化（JSON 丢弃函数）；`pmi` 字段随产物跨打印。
 * - 本文件零依赖（唯一 import 是 type-only 的 Shape 与 PmiItem 类型）。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-design.md §3.1
 */

import type { Shape } from '../../mesh/types'
import { nameOf } from '../../runtime-state'
import type {
  PmiDimension,
  PmiGdt,
  PmiDatum,
  PmiSurfaceFinish,
  PmiNote,
  PmiTechNote,
  PmiThreadHole,
  PmiItem,
  PmiSet,
} from './types'
import { dimension, gdt, datum, surfaceFinish, note, techNote, threadHole } from './types'
import { addPendingPmiItem, addPmiItem, clearPmiOfPart, pmiOf } from './registry'

/**
 * Shape PMI method signatures (mounted at runtime by attachPmiMethods).
 *
 * **调用时机没有约束**：标注随时可加，加完之后继续建模也不会丢。
 *
 * ```
 * let part0 = cad.box(40, 40, 20)
 * part0.addDatum({ identifier: 'A', … })              // 标注
 * part0 = cad.fillet(part0, refs, 2)                  // 继续建模，标注还在（refs 为任意边引用集合）
 * const svg = cad.projectView(part0, 'front')         // datum 仍会渲染出来
 * ```
 *
 * 实现上标注归**零件名**所有（`api/pmi/registry.ts`），不挂在 Shape 实例上；
 * 几何 op 产出新 Shape 时既不需要搬运也不会丢，查询时沿血缘图聚合。引用不会失效
 * 的原因：`TopoRef.origin` 是语句级因果坐标，跨 op 稳定。
 *
 * 注意 `fai_drill` 的 `tapped` / `screw` 是「建模即标注」，会在钻孔的同一语句里
 * 自动产出 `PmiThreadHole`——这正是"标注不必在最后"的现实依据。
 */
export interface ShapePmiMethods {
  /**
   * Add a dimensional tolerance annotation.
   * @param dim - The dimension annotation (without `kind`).
   * @returns this (chainable).
   * @example
   * part0.addDimension({
   *   dimType: 'diameter',
   *   targets: [cad.faceBySelector(part0, '>Z')],
   *   upperTolerance: 0.021,
   *   lowerTolerance: 0,
   * })
   */
  addDimension(dim: Omit<PmiDimension, 'kind'>): this

  /**
   * Add a GD&T annotation (feature control frame).
   * @param gdt - The GD&T annotation (without `kind`).
   * @returns this (chainable).
   */
  addGdt(gdt: Omit<PmiGdt, 'kind'>): this

  /**
   * Add a datum annotation.
   * @param datum - The datum annotation (without `kind`).
   * @returns this (chainable).
   */
  addDatum(datum: Omit<PmiDatum, 'kind'>): this

  /**
   * Add a surface finish annotation.
   * @param finish - The surface finish annotation (without `kind`).
   * @returns this (chainable).
   */
  addSurfaceFinish(finish: Omit<PmiSurfaceFinish, 'kind'>): this

  /**
   * Add a text note.
   * @param note - The note annotation (without `kind`).
   * @returns this (chainable).
   */
  addNote(note: Omit<PmiNote, 'kind'>): this

  /**
   * Add a part-level technical-requirement block (numbered clauses).
   *
   * Unlike `addNote`, a tech note has no `target`: it belongs to the whole part
   * and is drawn once in the sheet's global note block.
   * @param n - the tech-note fields (without `kind`).
   * @returns this (chainable).
   */
  addTechNote(n: Omit<PmiTechNote, 'kind'>): this

  /**
   * Add a thread-hole annotation (pilot hole geometry + post-machining tapping).
   *
   * 一个条目同时承载两类信息：`pilot`（原始几何）与 `thread`（后加工攻丝），
   * 显示时一并呈现（`cad.formatThreadHole`）。
   *
   * 说明：`fai_drill` 的 `holeType:'tapped'` / `'screw'` 会自动产出本类型，
   * 手工调用只用于非 `fai_drill` 路径（如导入的几何、手画的孔）补标。
   * @param th - The thread-hole annotation (without `kind`).
   * @returns this (chainable).
   * @example
   * part0.addThreadHole({
   *   thread: { standard: 'metric', nominalDiameter: 6, pitch: 1, toleranceClass: '6H', depth: 14, specLabel: 'M6' },
   *   pilot: { diameter: 5, depth: 16 },
   *   axis: { origin: [10, 10, 30], direction: [0, 0, -1] },
   *   process: 'tapped',
   * })
   */
  addThreadHole(th: Omit<PmiThreadHole, 'kind'>): this

  /**
   * Get all PMI annotations on this shape.
   * @returns a read-only copy of the PMI set.
   */
  getPmi(): PmiSet

  /**
   * Clear all PMI annotations.
   * @returns this (chainable).
   */
  clearPmi(): this
}

// ── Shape 方法挂载 ──

/**
 * Mount PMI methods onto a Shape instance (idempotent: skips if already mounted).
 *
 * All shape constructors (solid/curve → fromBrep/fromMeshSolid/fromBrepCurve)
 * call this function, ensuring mesh/brep dual-chain products can use
 * `part0.addDimension(...)`.
 *
 * Methods are **not serialized** (JSON drops functions); the `pmi` field
 * travels with the product across serialization, and the editor/viewer
 * reads the field without needing the methods.
 *
 * @param shape - the product Shape instance (solid/curve product).
 * @returns the shape with PMI methods mounted (same instance, type-narrowed).
 */
export function attachPmiMethods(shape: Shape): Shape & ShapePmiMethods {
  const s = shape as Shape & ShapePmiMethods
  if (typeof s.addDimension === 'function') return s

  s.addDimension = function addDimension(this: Shape & ShapePmiMethods, dim: Omit<PmiDimension, 'kind'>) {
    appendItem(this, dimension(dim))
    return this
  }
  s.addGdt = function addGdt(this: Shape & ShapePmiMethods, g: Omit<PmiGdt, 'kind'>) {
    appendItem(this, gdt(g))
    return this
  }
  s.addDatum = function addDatum(this: Shape & ShapePmiMethods, d: Omit<PmiDatum, 'kind'>) {
    appendItem(this, datum(d))
    return this
  }
  s.addSurfaceFinish = function addSurfaceFinish(this: Shape & ShapePmiMethods, f: Omit<PmiSurfaceFinish, 'kind'>) {
    appendItem(this, surfaceFinish(f))
    return this
  }
  s.addNote = function addNote(this: Shape & ShapePmiMethods, n: Omit<PmiNote, 'kind'>) {
    appendItem(this, note(n))
    return this
  }
  s.addTechNote = function addTechNote(this: Shape & ShapePmiMethods, n: Omit<PmiTechNote, 'kind'>) {
    appendItem(this, techNote(n))
    return this
  }
  s.addThreadHole = function addThreadHole(this: Shape & ShapePmiMethods, th: Omit<PmiThreadHole, 'kind'>) {
    appendItem(this, threadHole(th))
    return this
  }
  s.getPmi = function getPmi(this: Shape & ShapePmiMethods): PmiSet {
    return pmiOf(this) ?? { items: [] }
  }
  s.clearPmi = function clearPmi(this: Shape & ShapePmiMethods) {
    const part = nameOf(this)
    // 注册表按零件名存：清本地并切断上游继承，否则继承来的条目会被聚合回来，
    // 用户看到的和"没清"一样。无名 Shape（测试里裸造的）只清字段。
    if (part !== undefined) clearPmiOfPart(part)
    this.pmi = { items: [] }
    return this
  }
  return s
}

/**
 * 记录一条标注：写注册表（有零件名时）+ 写 Shape 字段（纯数据契约 / 序列化兼容）。
 *
 * 两处同写不是冗余——注册表是**跨 op 存活的真源**，字段是**纯数据快照**（Shape
 * 被序列化、跨 worker 传递、或交给不经过脚本执行的下游时，只有字段跟得走）。
 * 查询统一走 `registry.pmiOf()`：注册表命中就用聚合结果，否则退回字段。
 *
 * @param shape - the part instance being annotated.
 * @param item - the PMI item (kind already filled).
 */
function appendItem(shape: Shape & { pmi?: PmiSet }, item: PmiItem): void {
  const part = nameOf(shape)
  // 无名 = op 实现内部刚造出来的中间产物（`fromBrep` 之后、语句命名之前）。
  // 注册表按零件名索引收不到它，先暂存，由 `defineOp.wrapped` 在语句出口归到
  // 这条语句的产物名下（见 `registry.ts#flushPendingPmi`）。
  if (part !== undefined) addPmiItem(part, item)
  else addPendingPmiItem(item)
  const cur = shape.pmi
  if (!cur || !cur.items || cur.items.length === 0) {
    shape.pmi = { items: [item] }
  } else {
    shape.pmi = { items: [...cur.items, item], meta: cur.meta }
  }
}

/**
 * 追加一条 PMI 标注（op 内部用；脚本面请用 Shape 实例方法）。
 *
 * 与 `addXxx` 方法共用同一 `appendItem`，保证"注册表 + 字段同写"这条约定一致。
 * `fai_drill` 的 `tapped` / `screw` 用它补本孔标注——注意它**不是**在搬运上游
 * 标注：上游那些归上游零件名，查询时沿血缘自然聚合得到，不需要任何搬运。
 *
 * @param shape - the product Shape to annotate.
 * @param item - the PMI item (kind already filled).
 */
export function appendPmiItem(shape: Shape, item: PmiItem): void {
  appendItem(shape as Shape & { pmi?: PmiSet }, item)
}
