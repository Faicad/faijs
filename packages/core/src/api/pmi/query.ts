/**
 * api/pmi/query — PMI query functions (cad namespace, non-op)
 *
 * PMI 查询走 `cad` 命名空间的普通函数（不是 op）。
 * - `pmiItems(shape, filter?)` — query PMI annotations by kind/target type.
 * - `pmiOn(shape, ref)` — query PMI annotations attached to a specific TopoRef.
 * - `pmiDatums(shape)` — query datum identifier → datum mapping.
 *
 * These are plain functions (not defineOp): they produce no Shape, consume
 * Shape as input, and return pure data. They are registered in the cad
 * namespace via api-namespace.ts.
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-design.md §3.3
 */

import type { Shape } from '../../mesh/types'
import type { TopoRef } from '../../topology/naming/types'
import type { PmiItem, PmiDatum, PmiItemKind, PmiThreadHole } from './types'
import { pmiOf } from './registry'

/**
 * 读 Shape 上的聚合标注（走注册表 + 血缘回溯，而非 Shape 字段）。
 *
 * 查询函数全部经过这一个口，保证「几何 op 之后标注还在」对 `pmiItems` /
 * `pmiOn` / `pmiDatums` / `pmiThreads` 一致生效。
 */
function itemsOf(shape: Shape): readonly PmiItem[] {
  return pmiOf(shape)?.items ?? []
}

// ── 辅助：判断 PMI item 的目标是否包含给定 ref ──

/**
 * Collect all TopoRef targets from a PmiItem.
 * Dimension has `targets[]`; GDT/Datum/SurfaceFinish have `target`; Note has optional
 * `target`; ThreadHole 的 `target` 仅 BREP 链存在（mesh 链靠 `axis` 定位）。
 */
function getTargets(item: PmiItem): readonly TopoRef[] {
  switch (item.kind) {
    case 'dimension':
      return item.targets
    case 'gdt':
      return [item.target]
    case 'datum':
      return [item.target]
    case 'surfaceFinish':
      return [item.target]
    case 'note':
      return item.target ? [item.target] : []
    case 'threadHole':
      return item.target ? [item.target] : []
  }
}

/**
 * Check if two TopoRefs are the same (by kind + origin + role for face refs;
 * by kind + faces for edge/vertex refs).
 *
 * Conservative comparison: checks kind + origin + role for FaceTopoRef;
 * for other kinds, uses structural comparison of the `faces` array (RoleQualifier
 * pairs). This is sufficient for PMI query purposes — exact identity is not
 * required (the user passes the same TopoRef object that was used to attach).
 */
function refEquals(a: TopoRef, b: TopoRef): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'face': {
      const bb = b as typeof a
      return a.origin === bb.origin && a.role === bb.role
    }
    case 'edge': {
      const bb = b as typeof a
      return a.faces.length === bb.faces.length &&
        a.faces.every((f, i) => {
          const g = bb.faces[i]
          return f.origin === g.origin && f.role === g.role
        })
    }
    case 'vertex': {
      const bb = b as typeof a
      return a.faces.length === bb.faces.length &&
        a.faces.every((f, i) => {
          const g = bb.faces[i]
          return f.origin === g.origin && f.role === g.role
        })
    }
    case 'derived-face': {
      const bb = b as typeof a
      return a.op === bb.op &&
        a.between.length === bb.between.length &&
        a.between.every((f, i) => {
          const g = bb.between[i]
          return f.origin === g.origin && f.role === g.role
        })
    }
  }
}

// ── 查询函数 ──

/**
 * Query PMI annotations on a shape, optionally filtered by kind or target type.
 *
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name pmiItems
 * @returns PmiItem[] — matching PMI annotations.
 * @param shape - the shape to query. type:Shape required:true
 * @param filter - optional filter. type:object required:false
 * @example
 * const dims = cad.pmiItems(part0, { kind: 'dimension' })
 */
export function pmiItems(
  shape: Shape,
  filter?: { kind?: PmiItemKind; targetType?: TopoRef['kind'] },
): PmiItem[] {
  return itemsOf(shape).filter((item) => {
    if (filter?.kind && item.kind !== filter.kind) return false
    if (filter?.targetType) {
      const targets = getTargets(item)
      return targets.some((t) => t.kind === filter.targetType)
    }
    return true
  })
}

/**
 * Query all PMI annotations attached to a specific TopoRef.
 *
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name pmiOn
 * @returns PmiItem[] — annotations attached to the given TopoRef.
 * @param shape - the shape to query. type:Shape required:true
 * @param ref - the topology reference (face/edge/vertex). type:TopoRef required:true
 * @example
 * const annos = cad.pmiOn(part0, cad.faceRef(part0, 3))
 */
export function pmiOn(shape: Shape, ref: TopoRef): PmiItem[] {
  return itemsOf(shape).filter((item) => {
    const targets = getTargets(item)
    return targets.some((t) => refEquals(t, ref))
  })
}

/**
 * Query datum identifier → datum mapping.
 *
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name pmiDatums
 * @returns Record<string, PmiDatum> — datum identifier → datum.
 * @param shape - the shape to query. type:Shape required:true
 * @example
 * const datums = cad.pmiDatums(part0)
 */
export function pmiDatums(shape: Shape): Record<string, PmiDatum> {
  const result: Record<string, PmiDatum> = {}
  for (const item of itemsOf(shape)) {
    if (item.kind === 'datum') {
      result[item.identifier] = item
    }
  }
  return result
}

/**
 * 查询螺纹孔标注（含底孔几何 + 后加工攻丝两组信息）。
 *
 * 便捷封装：等价 `pmiItems(shape, { kind: 'threadHole' })`，但返回精确类型。
 *
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name pmiThreads
 * @returns PmiThreadHole[] — 该零件上的全部螺纹孔标注。
 * @param shape - the shape to query. type:Shape required:true
 * @example
 * const taps = cad.pmiThreads(part0)
 * console.log(cad.formatThreadHole(taps[0]))  // 'M6-6H ↓14（底孔 Φ5 ↓16，攻丝）'
 */
export function pmiThreads(shape: Shape): PmiThreadHole[] {
  return pmiItems(shape, { kind: 'threadHole' }) as PmiThreadHole[]
}