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
import type {
  PmiDimension,
  PmiGdt,
  PmiDatum,
  PmiSurfaceFinish,
  PmiNote,
  PmiItem,
  PmiSet,
} from './types'
import { dimension, gdt, datum, surfaceFinish, note } from './types'

/** Shape PMI method signatures (mounted at runtime by attachPmiMethods). */
export interface ShapePmiMethods {
  /**
   * Add a dimensional tolerance annotation.
   * @param dim - The dimension annotation (without `kind`).
   * @returns this (chainable).
   * @example
   * part0.addDimension({
   *   dimType: 'diameter',
   *   targets: [cad.faceRef(part0, 3)],
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
  s.getPmi = function getPmi(this: Shape & ShapePmiMethods): PmiSet {
    return (this as Shape & { pmi?: PmiSet }).pmi ?? { items: [] }
  }
  s.clearPmi = function clearPmi(this: Shape & ShapePmiMethods) {
    (this as Shape & { pmi?: PmiSet }).pmi = { items: [] }
    return this
  }
  return s
}

/**
 * Append a PmiItem to the shape's `pmi` field, creating the PmiSet if needed.
 *
 * Internal helper — items array is always replaced with a new array (immutable update),
 * so existing references to the old array remain valid.
 */
function appendItem(shape: Shape & { pmi?: PmiSet }, item: PmiItem): void {
  const cur = shape.pmi
  if (!cur || !cur.items || cur.items.length === 0) {
    shape.pmi = { items: [item] }
  } else {
    shape.pmi = { items: [...cur.items, item], meta: cur.meta }
  }
}
