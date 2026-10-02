/**
 * cadquery-selectors/edge — CadQuery edge 选择器（handle 解析）
 *
 * 等价搬运自 `packages/cq-compat/src/workplane.ts` 的 `resolveEdgeSelection` /
 * `resolveFaceEdgeSelection`（含其私有 `kern`/`ownHandle` helper）。仅 import
 * 路径改为 core 内部相对路径，逻辑逐行不变，零功能增减。
 */

import { getBrepApi } from '../../brep/handle-bridge'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import { brepOf } from '../../shape'
import type { Shape } from '../../mesh/types'

/** core 直连 helpers（原 cq-compat 私有 helper，等价搬运）。 */
function kern(): BrepEngineApi {
  return getBrepApi()
}
function ownHandle(shape: Shape): BrepHandle {
  return brepOf(shape) as BrepHandle
}

/**
 * Resolve a CadQuery edge selector string to concrete edge handles.
 *
 * Supports CadQuery's parallel-axis selectors "|X" / "|Y" / "|Z" (edges whose
 * bounding box is thin across the two perpendicular axes) and an empty / absent
 * selector meaning "all edges". Face/edge geometry beyond axis-parallel lines
 * is out of scope for this layer.
 *
 * @param shape - Shape whose BREP edges are enumerated for selection.
 * @param sel - CadQuery edge selector ("|X"/"|Y"/"|Z"/"#X"/"#Y"/"#Z"), or empty/null for all edges.
 * @returns the matched edge handles.
 */
export function resolveEdgeSelection(shape: Shape, sel: string | null | undefined): unknown[] {
  const edges = kern().getSubShapes(ownHandle(shape), 'edge') as unknown[]
  if (!sel || sel === '') return edges
  const mHash = /^#([XYZ])$/.exec(sel.trim())
  if (mHash) {
    // CadQuery "#Z" (DirectionMinMaxSelector): edges sitting at the MAXIMUM
    // along the axis, ties included (the top rim of a box — #Z differs from
    // "|Z" which selects axis-PARALLEL edges).
    const axisIdx = mHash[1] === 'X' ? 0 : mHash[1] === 'Y' ? 1 : 2
    const centers = edges.map((e) => {
      const b = kern().getBoundingBox(e as BrepHandle) as unknown as Record<string, number>
      return [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, (b.zmin + b.zmax) / 2][axisIdx]
    })
    const best = Math.max(...centers)
    const TOL = 1e-6
    return edges.filter((_, i) => centers[i] >= best - TOL)
  }
  const m = /^\|([XYZ])$/.exec(sel.trim())
  if (!m) {
    throw new Error(`[cq-compat] unsupported edge selector "${sel}" (supported: |X |Y |Z #X #Y #Z)`)
  }
  const axisIdx = m[1] === 'X' ? 0 : m[1] === 'Y' ? 1 : 2
  const perp = [0, 1, 2].filter((i) => i !== axisIdx)
  // The kernel inflates edge bounding boxes by ~0.1mm of tolerance padding, so
  // an axis-parallel edge is identified RELATIVELY: its extent along the axis
  // must dominate the two perpendicular extents (which stay padding-sized).
  const PAD = 0.5 // mm — max perpendicular extent for an axis-parallel edge
  return edges.filter((e) => {
    const b = kern().getBoundingBox(e as BrepHandle) as unknown as Record<string, number>
    const min = [b.xmin, b.ymin, b.zmin]
    const max = [b.xmax, b.ymax, b.zmax]
    const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    const axisExtent = extents[axisIdx]
    return (
      perp.every((i) => extents[i] <= PAD) &&
      axisExtent > 2 * Math.max(extents[perp[0]], extents[perp[1]])
    )
  })
}

/**
 * Resolve the edges belonging to the face picked by a direction selector
 * (upstream `.faces(">Z").chamfer(l)` chamfers the edges of that face).
 * Reuses the direction-minimum/maximum rule of resolveFaceSelector: among
 * faces perpendicular to the axis, the extremal one along it wins; its edges
 * are those whose bounding box lies inside the face's (kernel pads bounds by
 * ~0.1mm of tolerance, so a small positive slack is used).
 *
 * @param shape - Shape whose BREP faces/edges are enumerated.
 * @param sel - Direction face selector (">Z"/"<X"/"+Y"/"-Z", optional index suffix).
 * @returns the handles of the edges lying in the selected face's plane.
 */
export function resolveFaceEdgeSelection(shape: Shape, sel: string): unknown[] {
  // '+'/'-' are accepted as aliases of '>'/'<' (CadQuery allows both spellings;
  // resolveFaceSelector's axis table does the same).
  const m = /^([<>+-])([XYZ])(?:\[-?\d+\])?$/.exec(sel.trim())
  if (!m) {
    throw new Error(`[cq-compat] unsupported face selector for chamfer "${sel}"`)
  }
  const axis = m[2] === 'X' ? 0 : m[2] === 'Y' ? 1 : 2
  const sign = m[1] === '>' || m[1] === '+' ? 1 : -1
  const bounds = (h: unknown): Record<string, number> =>
    kern().getBoundingBox(h as BrepHandle) as unknown as Record<string, number>
  const faces = kern().getSubShapes(ownHandle(shape), 'face') as unknown[]
  const perp = faces.filter((f) => {
    const b = bounds(f)
    return [b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin][axis] <= 0.1
  })
  if (perp.length === 0) {
    throw new Error(`[cq-compat] no planar face for selector "${sel}"`)
  }
  const faceCenter = (b: Record<string, number>): number =>
    [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, (b.zmin + b.zmax) / 2][axis]
  const target = perp
    .map((f) => ({ f, b: bounds(f) }))
    .reduce((best, cur) => (sign * (faceCenter(cur.b) - faceCenter(best.b)) > 0 ? cur : best))
  const fc = faceCenter(target.b)
  // Edge bounds carry ±0.1mm kernel tolerance padding (measured: a unit-box
  // edge reports extents inflated by 0.2), while face bounds are tight. An
  // edge of the face lies IN its plane, so along the axis it is thin (pure
  // padding) and its center coincides with the face center.
  const EDGE_AXIS_MAX = 0.25
  const EDGE_CENTER_TOL = 0.15
  const edges = kern().getSubShapes(ownHandle(shape), 'edge') as unknown[]
  return edges.filter((e) => {
    const b = bounds(e)
    const ext = [b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin][axis]
    const c = [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, (b.zmin + b.zmax) / 2][axis]
    return ext <= EDGE_AXIS_MAX && Math.abs(c - fc) <= EDGE_CENTER_TOL
  })
}