/**
 * cadquery-selectors/face — CadQuery face 字符串选择器
 *
 * 等价搬运自 `packages/cq-compat/src/workplane.ts` 的 `resolveFaceSelector`
 * （含其私有 `NAMED_VIEW_TO_AXIS`、`bboxMax`/`bboxMin`、`cad` 单例）。仅 import
 * 路径改为 core 内部相对路径，逻辑逐行不变，零功能增减。
 *
 * @platform occt — face 选择对 BREP 面做枚举/比较，经 `getKernel()` 与
 * `getBrepApi()` 访问 occt 原生内核（getSubShapes / surface 查询等）。
 */

import { createApiNamespace } from '../api-namespace'
import { getKernel } from '../../occt-kernel/occtKernel'
import { getBrepApi } from '../../brep/handle-bridge'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import { brepOf } from '../../shape'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { Shape } from '../../mesh/types'
import { asBrepShape } from './borrow-bridge'

// ── cad namespace singleton (created once at module load) ──────────────────
const cad = createApiNamespace() as Record<string, (...args: unknown[]) => Promise<Shape>>

/** core 直连 helpers（原 cq-compat 私有 helper，等价搬运）。 */
function kern(): BrepEngineApi {
  return getBrepApi()
}
function ownHandle(shape: Shape): BrepHandle {
  return brepOf(shape) as BrepHandle
}

/** Get bbox max of a shape (via cad.bboxMax — synchronous). */
function bboxMax(shape: Shape): [number, number, number] {
  return cad.bboxMax(shape) as unknown as [number, number, number]
}

/** Get bbox min of a shape. */
function bboxMin(shape: Shape): [number, number, number] {
  return cad.bboxMin(shape) as unknown as [number, number, number]
}

/**
 * Resolve a face selector to a world-space point (face center) and normal.
 *
 * CadQuery semantics: `faces(">Z")` selects the face(s) at the extreme of the
 * axis, and `workplane()` places the origin at the selected face's center —
 * `centerOption: "CenterOfMass"` (default) uses the face's surface centroid,
 * `"CenterOfBoundBox"` uses the face's bounding-box center.
 *
 * Supported forms: ">Z", "<Z", ">X", "<X", ">Y", "<Y", "+Z"/"-Z" aliases, each
 * with an optional CadQuery-style index suffix like ">Z[-2]". The six CadQuery
 * named views ("front"/"back"/"left"/"right"/"top"/"bottom") are accepted and
 * normalised to their axis equivalent (front=>">Z", back=>"<Z", left=>"<X",
 * right=>">X", top=>">Y", bottom=>"<Y"). This
 * implementation enumerates the actual BREP faces and picks the one whose
 * bbox-center is the extreme along the selector axis (ties broken by larger
 * surface area, so a main face wins over a small coplanar boss face). When the
 * shape has no BREP handle or the kernel is unavailable, it falls back to the
 * whole-shape bounding-box approximation.
 *
 * Indexed selectors (`">Z[-2]"`) follow CadQuery's DirectionMinMaxSelector
 * indexing, verified against the installed cadquery 2.8.0: `">A[k]"` lists all
 * faces ASCENDING along axis A (`[0]` = lowest, `[-1]` = highest); `"<A[k]"`
 * lists them DESCENDING (`[0]` = highest). The picked face's normal is the
 * outward direction (away from the shape bbox center).
 *
 * @param shape - Shape whose BREP faces are enumerated for selection.
 * @param sel - Selector string, e.g. ">Z", "<X", ">Z[-2]", or a named view
 *   ("front"/"back"/"left"/"right"/"top"/"bottom").
 * @param centerOption - Optional center computation option forwarded to the
 *   face-center evaluation.
 * @returns Promise resolving to the selected face's center point and outward
 *   normal.
 */
/**
 * CadQuery named views → axis selector (cadquery/selectors.py:687-694).
 * Verified against installed cadquery 2.8.0 by evaluating
 * `Workplane().rect(1,1).extrude(1).faces(n).val()` for each name.
 */
const NAMED_VIEW_TO_AXIS: Record<string, string> = {
  front: '>Z',
  back: '<Z',
  left: '<X',
  right: '>X',
  top: '>Y',
  bottom: '<Y',
}

/**
 * Resolve a CadQuery-style face selector string to the selected face's center
 * point and outward normal.
 *
 * Supported forms: ">Z", "<Z", ">X", "<X", ">Y", "<Y", each with an optional
 * CadQuery-style index suffix like ">Z[-2]", plus the six named views
 * ("front"/"back"/"left"/"right"/"top"/"bottom") which are aliases for the
 * corresponding axis selectors per cadquery/selectors.py:687-694.
 * @param shape - Shape whose BREP faces are enumerated for selection.
 * @param sel - Selector string, e.g. ">Z", "front", ">Z[-2]".
 * @param centerOption - Optional center computation option forwarded to the
 *   face-center evaluation.
 * @returns Promise resolving to the selected face's center point and outward
 *   normal.
 * @throws Error when the selector matches no face or has unknown syntax
 *   (never falls back silently).
 */
export async function resolveFaceSelector(
  shape: Shape,
  sel: string,
  centerOption?: string,
): Promise<{ center: [number, number, number]; normal: [number, number, number] }> {
  // compatOp 提升边界：实参可能是借用视图（见 asBrepShape 注释）——归一为真实
  // Shape，否则 brepOf 为 undefined 会落到 bbox 兜底并在 cad.bboxMax 崩溃。
  shape = asBrepShape(shape)
  // CadQuery named views are aliases for an axis DirectionMinMaxSelector
  // (cadquery/selectors.py:687-694):
  //   front=>(0,0,1,max)  back=>(0,0,1,min)   left=>(1,0,0,min)
  //   right=>(1,0,0,max)  top=>(0,1,0,max)    bottom=>(0,1,0,min)
  // Normalise once so every branch below sees a plain axis selector; without
  // this the lookup misses and the whole-shape bbox fallback silently returns
  // the shape centre instead of the face plane (half-a-hole volume error).
  sel = NAMED_VIEW_TO_AXIS[sel.trim().toLowerCase()] ?? sel
  // Strip index suffix like [-2]
  const baseSel = sel.replace(/\[-?\d+\]$/, '')
  const axisDir: Record<string, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
    '>Z': { axis: 2, sign: 1 }, '+Z': { axis: 2, sign: 1 },
    '<Z': { axis: 2, sign: -1 }, '-Z': { axis: 2, sign: -1 },
    '>X': { axis: 0, sign: 1 }, '+X': { axis: 0, sign: 1 },
    '<X': { axis: 0, sign: -1 }, '-X': { axis: 0, sign: -1 },
    '>Y': { axis: 1, sign: 1 }, '+Y': { axis: 1, sign: 1 },
    '<Y': { axis: 1, sign: -1 }, '-Y': { axis: 1, sign: -1 },
  }
  const normals: Record<string, [number, number, number]> = {
    '>Z': [0, 0, 1], '+Z': [0, 0, 1], '<Z': [0, 0, -1], '-Z': [0, 0, -1],
    '>X': [1, 0, 0], '+X': [1, 0, 0], '<X': [-1, 0, 0], '-X': [-1, 0, 0],
    '>Y': [0, 1, 0], '+Y': [0, 1, 0], '<Y': [0, -1, 0], '-Y': [0, -1, 0],
  }
  const dir = axisDir[baseSel]
  const fallbackNormal = normals[baseSel] ?? ([0, 0, 1] as [number, number, number])

  // ── Multi-axis direction selectors ("+XY", ">XZ", "-YZ" … cadquery
  // selectors.py:625 axes table XY=(1,1,0) XZ=(1,0,1) YZ=(0,1,1)) ──
  // '+'/'-' → DirectionSelector: only faces whose outward normal is PARALLEL
  // to the (±) direction (angle < 1e-4 rad, selectors.py:234). '>'/'<' →
  // DirectionMinMaxSelector (selectors.py:399): the face whose center of MASS
  // is farthest along the direction. Index suffixes mean DirectionNthSelector
  // there — not supported, throw instead of silently approximating.
  const multi = /^([<>+-])(XY|XZ|YZ)$/.exec(baseSel)
  if (multi) {
    if (/\[-?\d+\]$/.test(sel.trim())) {
      throw new Error(
        `[cq-compat] selector "${sel}": indexed multi-axis selectors not supported`,
      )
    }
    const axesTable: Record<string, [number, number, number]> = {
      XY: [1, 1, 0],
      XZ: [1, 0, 1],
      YZ: [0, 1, 1],
    }
    let d = axesTable[multi[2]]
    if (multi[1] === '-') d = [-d[0], -d[1], -d[2]]
    const dLen = Math.hypot(d[0], d[1], d[2])
    const dirV: [number, number, number] = [d[0] / dLen, d[1] / dLen, d[2] / dLen]
    const handleM = brepOf(shape)
    if (!handleM) {
      throw new Error(`[cq-compat] selector "${sel}": BREP unavailable`)
    }
    const kernelM = getKernel() as unknown as OcctKernel
    const faceList = kernelM.getSubShapes(handleM as unknown as ShapeHandle, 'face') as unknown as ShapeHandle[]
    if (faceList.length === 0) {
      throw new Error(`[cq-compat] selector "${sel}": shape has no faces`)
    }
    const faceNormalOf = (f: ShapeHandle): [number, number, number] => {
      const uv = kernelM.uvBounds(f)
      const n = kernelM.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
      return [n.x, n.y, n.z]
    }
    const comOf = (f: ShapeHandle): [number, number, number] => {
      const c = kernelM.getSurfaceCenterOfMass(f)
      return [c.x, c.y, c.z]
    }
    const dot = (a: [number, number, number], b: [number, number, number]): number =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    if (multi[1] === '+' || multi[1] === '-') {
      // DirectionSelector: angle(normal, dir) < 1e-4 rad (selectors.py:235).
      const PAR_TOL = Math.cos(1e-4)
      const found = faceList.find((f) => dot(faceNormalOf(f), dirV) > PAR_TOL)
      if (!found) {
        throw new Error(
          `[cq-compat] selector "${sel}": no face with normal parallel to the direction`,
        )
      }
      return { center: comOf(found), normal: faceNormalOf(found) }
    }
    // '>'/'<': DirectionMinMaxSelector over center-of-mass projections.
    let bestF: ShapeHandle | null = null
    let bestVal = 0
    for (const f of faceList) {
      const val = dot(comOf(f), dirV)
      if (!bestF || (multi[1] === '>' ? val > bestVal + 1e-9 : val < bestVal - 1e-9)) {
        bestF = f
        bestVal = val
      }
    }
    return { center: comOf(bestF!), normal: faceNormalOf(bestF!) }
  }

  // ── Face-based selection (BREP kernel available) ──
  try {
    const handle = brepOf(shape)
    const kernel = getKernel() as unknown as OcctKernel
    if (handle && dir) {
      const faces = kernel.getSubShapes(handle as unknown as ShapeHandle, 'face') as unknown as ShapeHandle[]
      const cands: { handle: ShapeHandle; center: [number, number, number] }[] = []
      for (const f of faces) {
        const bb = kernel.getBoundingBox(f)
        cands.push({
          handle: f,
          center: [
            (bb.xmin + bb.xmax) / 2,
            (bb.ymin + bb.ymax) / 2,
            (bb.zmin + bb.zmax) / 2,
          ],
        })
      }
      let best: { handle: ShapeHandle; center: [number, number, number] } | null = null
      let normal = fallbackNormal
      // Extract the index suffix, if any.
      const idxMatch = /\[(-?\d+)\]$/.exec(sel.trim())
      if (idxMatch) {
        // CadQuery face indexing (verified vs cadquery 2.8.0):
        //   '>A[k]' / '<A[k]'  DirectionMinMaxSelector: '>' ascending, '<' descending
        //   '+A[k]' / '-A[k]'  DirectionSelector: list the extreme face first, then
        //                      inward — '-' ascending, '+' descending along A
        //                      (faces("-Y")[1] is the 2nd -Y face from the -Y extreme,
        //                      NOT the +Y extreme face).
        // Only faces PERPENDICULAR to the axis participate (bbox thin along the axis).
        // For '+'/'-' selectors we additionally keep only faces whose outward normal
        // is parallel to the selector axis with the matching sign (CadQuery filters
        // by exact normal direction), so a boss face and its base sibling don't
        // collide in the index.
        const sc = baseSel[0]
        const isDirSelector = sc === '+' || sc === '-'
        const perp: typeof cands = cands.filter((cd) => {
          const bb = kernel.getBoundingBox(cd.handle)
          const ext = [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin][dir.axis]
          if (ext > 0.1) return false
          if (isDirSelector) {
            const uv = kernel.uvBounds(cd.handle)
            const n = kernel.surfaceNormal(cd.handle, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
            const nv: [number, number, number] = [n.x, n.y, n.z]
            if (Math.abs(nv[dir.axis]) < 0.999) return false
            if (Math.sign(nv[dir.axis]) !== dir.sign) return false
          }
          return true
        })
        const idx = parseInt(idxMatch[1], 10)
        const asc = sc === '>' || sc === '-'
        const sorted = perp
          .slice()
          .sort((a, b) => (asc ? a.center[dir.axis] - b.center[dir.axis] : b.center[dir.axis] - a.center[dir.axis]))
        const pick = idx < 0 ? sorted.length + idx : idx
        if (pick < 0 || pick >= sorted.length) {
          throw new Error(
            `[cq-compat] selector "${sel}": index ${idx} out of range (${sorted.length} faces)`,
          )
        }
        best = sorted[pick]
        if (isDirSelector) {
          // DirectionSelector: the outward normal is exactly the selector axis/sign.
          normal = fallbackNormal
        } else {
          // DirectionMinMaxSelector: outward normal from face position vs shape centre.
          const max = bboxMax(shape)
          const min = bboxMin(shape)
          const shapeCenter = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2]
          normal = [0, 0, 0]
          normal[dir.axis] = best.center[dir.axis] >= shapeCenter[dir.axis] ? 1 : -1
        }
      } else {
        for (const cd of cands) {
          const val = cd.center[dir.axis]
          if (!best) {
            best = cd
            continue
          }
          const bestVal = best.center[dir.axis]
          if (dir.sign === 1 ? val > bestVal + 1e-6 : val < bestVal - 1e-6) {
            best = cd
          } else if (Math.abs(val - bestVal) <= 1e-6) {
            // Tie (e.g. coplanar faces at the same extreme): prefer the larger face
            const area = kernel.getSurfaceArea(cd.handle)
            if (area > kernel.getSurfaceArea(best.handle)) best = cd
          }
        }
      }
      if (best) {
        let origin: [number, number, number]
        if (centerOption === 'CenterOfBoundBox') {
          origin = best.center
        } else {
          // CenterOfMass: surface (area-weighted) centroid
          const com = kernel.getSurfaceCenterOfMass(best.handle)
          origin = [com.x, com.y, com.z]
        }
        return { center: origin, normal }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('out of range')) throw e
    // No BREP / kernel not ready — fall through to bbox approximation
  }

  // ── Fallback: whole-shape bbox (previous behavior) ──
  const max = bboxMax(shape)
  const min = bboxMin(shape)
  const center: [number, number, number] = [
    (max[0] + min[0]) / 2,
    (max[1] + min[1]) / 2,
    (max[2] + min[2]) / 2,
  ]

  const m = /^([<>+-])([XYZ])(?:\[(-?\d+)\])?$/.exec(sel.trim())
  if (!m) {
    // Default: return center
    return { center, normal: [0, 0, 1] }
  }
  const [, sign, axisChar, idxStr] = m
  const axis = axisChar === 'X' ? 0 : axisChar === 'Y' ? 1 : 2
  // '>' and '+' select the max side; '<' and '-' select the min side.
  const maxDir = sign === '>' || sign === '+'
  const normal: [number, number, number] = [0, 0, 0]
  normal[axis] = maxDir ? 1 : -1

  if (idxStr === undefined) {
    const extreme: [number, number, number] = [center[0], center[1], center[2]]
    extreme[axis] = maxDir ? max[axis] : min[axis]
    return { center: extreme, normal }
  }

  // Indexed selector — enumerate real faces and sort by bbox center along axis.
  // CadQuery semantics: '>A[k]' ascending, '<A[k]' descending (see doc above).
  const idx = parseInt(idxStr, 10)
  const faces = kern().getSubShapes(ownHandle(shape), 'face') as unknown[]
  type Entry = { c: [number, number, number]; bounds: Record<string, number> }
  const entries: Entry[] = faces.map((f) => {
    const b = kern().getBoundingBox(f as BrepHandle) as unknown as Record<string, number>
    return {
      c: [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, (b.zmin + b.zmax) / 2],
      bounds: b,
    }
  })
  if (entries.length === 0) {
    throw new Error(`[cq-compat] selector "${sel}": shape has no faces`)
  }
  entries.sort((a, b) => (maxDir ? a.c[axis] - b.c[axis] : b.c[axis] - a.c[axis]))
  const pick = idx < 0 ? entries.length + idx : idx
  if (pick < 0 || pick >= entries.length) {
    throw new Error(
      `[cq-compat] selector "${sel}": index ${idx} out of range (${entries.length} faces)`,
    )
  }
  const fb = entries[pick].bounds
  const faceCenter: [number, number, number] = [
    (fb.xmin + fb.xmax) / 2,
    (fb.ymin + fb.ymax) / 2,
    (fb.zmin + fb.zmax) / 2,
  ]
  // Outward normal: away from the shape bbox center along the axis.
  normal[axis] = faceCenter[axis] >= center[axis] ? 1 : -1
  return { center: faceCenter, normal }
}