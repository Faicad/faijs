/**
 * @platform occt — 本文件 import occt-kernel（getOcctKernel：draft-angle punch
 * 的 frustum loft 走原生 occt `loft`，适配器层无此能力）。
 *
 * `cad.punchHole`: cut a face-placed 2D profile out of a solid (E4 pocket/through
 * hole with optional taper).
 *
 * The hole profile is a set of closed 2D contours placed on a target face of the
 * solid (the same placement step as `cad.sketchOnFace`). Each placed contour is
 * extruded from the face *into* the part along the face inward normal, and the
 * resulting prism is the "punch" tool; a Boolean `cut` removes it from the host —
 * a profile-based pocket (`height` given) or through-hole (`height: null`).
 *
 * v1 scope: the punch is a straight linear prism, or — when `draftAngle > 0` — a
 * **tapered frustum** whose walls recede by `draftAngle` over the punch depth
 * (built as an occt `loft` between a mouth wire in the host plane and an inset
 * end wire at depth `depth·tan(draftAngle)`). The op is a composition over the
 * E3 on-surface placement + `kernel.extrude`/occt `loft` + `kernel.cut` and
 * declares `engines: ['occt']` (surface sampling + Boolean cut + draft loft need
 * the BREP platform).
 * @module
 */
import type { Shape } from '../mesh/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'
import { getBrepApi } from '../brep/handle-bridge'
import { solidToShape } from '../brep/brep-ops'
import { fromBrep, brepOf } from '../shape'
import { getOcctKernel } from '../occt-kernel/occtKernel'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { TopoRefError } from '../topology/naming'
import { resolveFaceHandle, type FaceSelector } from './sketch-on-face'
import { makeUvMap, curves2dBounds, type UvMap } from '../geometry2d/bridge/on-surface'
import { evaluateCurve2d } from '../geometry2d/curve2d'
import { profileSegToCurve } from '../geometry2d/adapt'
import { assertProfileParams, type ProfileLoop } from './profile'

/** Parameters for `cad.punchHole`. */
export interface PunchHoleParams {
  /** Ordered 2D closed contour(s) describing the hole profile (same shape as `cad.profile`). */
  contours: ProfileLoop[]
  /** The target solid on which the hole is punched. */
  on: Shape
  /** The host face: a 1-based ordinal or a `cad.faceRef(on, n)` result. */
  face: FaceSelector
  /** Removal depth along the face inward normal. `null`/absent = through hole. */
  height?: number | null
  /** Taper on the hole walls (degrees; default 0 = straight wall). Built as a frustum via occt loft. */
  draftAngle?: number
  /** UV mapping mode for contour placement (default `'original'`). */
  scaleMode?: 'original' | 'bounds' | 'native'
}

/** Extra length past the host extent so a through-hole clears the opposite side. */
const THROUGH_MARGIN = 10

/**
 * Depth of the punch extrusion: the explicit `height`, or the host's bounding-box
 * diagonal (+ margin) for a through hole.
 * @param kernel - the BREP engine surface.
 * @param solid - the host solid handle.
 * @param height - the blind depth, or null for through.
 * @returns the positive extrude length.
 */
function punchDepth(kernel: BrepEngineApi, solid: BrepHandle, height: number | null | undefined): number {
  if (height !== null && height !== undefined) return height
  const box = kernel.getBoundingBox(solid)
  const diag = Math.hypot(box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin)
  return diag + THROUGH_MARGIN
}

/**
 * Map a contour's sampled 2D points onto the host face's UV space, evaluate the
 * surface there, and return a clean, coplanar polygon (sample points projected
 * onto the host's plane through its normal). Rebuilding a straight-edged planar
 * face is deliberate: extruding the on-surface bridge's wire-derived face (a
 * near-coplanar shell, z varies by ~1e-7) collapses its OCCT volume to ~0 — see
 * GOTCHA `punch-hole` (E4).
 * @param kernel - the BREP engine surface.
 * @param host - the host face handle.
 * @param mode - the face scale mode.
 * @param uv - the UV mapping for this contour.
 * @param anchor - an in-plane point of the host face (for the projection plane).
 * @param n - the host face outward normal (unit).
 * @param contour - the 2D contour to punch.
 * @returns a flat polygon of 3D points (each approximately in the host plane).
 */
function buildPolygon3d(
  kernel: BrepEngineApi,
  host: BrepHandle,
  uv: UvMap,
  anchor: { x: number; y: number; z: number },
  n: { x: number; y: number; z: number },
  contour: ProfileLoop,
): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = []
  // Dedupe consecutive coincident samples across the contour.
  const push = (p: { x: number; y: number; z: number }) => {
    const last = pts[pts.length - 1]
    if (last && Math.abs(last.x - p.x) < 1e-7 && Math.abs(last.y - p.y) < 1e-7 && Math.abs(last.z - p.z) < 1e-7) return
    pts.push(p)
  }
  for (const seg of contour.segments) {
    const c = profileSegToCurve(seg as never)
    for (let k = 0; k <= 12; k++) {
      const [x, y] = evaluateCurve2d(c, k / 12)
      const [u, v] = uv(x, y)
      const raw = kernel.pointOnSurface(host, u, v)
      // Project onto the host face plane (through `anchor` + `n`) for exact coplanarity.
      const d = (raw.x - anchor.x) * n.x + (raw.y - anchor.y) * n.y + (raw.z - anchor.z) * n.z
      push({ x: raw.x - n.x * d, y: raw.y - n.y * d, z: raw.z - n.z * d })
    }
  }
  // Close the loop: drop a trailing point equal to the first.
  if (pts.length > 1) {
    const a = pts[0]!
    const b = pts[pts.length - 1]!
    if (Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7 && Math.abs(a.z - b.z) < 1e-7) pts.pop()
  }
  return pts
}

/**
 * Build and cut the punch solid for every placed profile on the host face and
 * Boolean-cut it from `solid`, returning the holed solid handle.
 * @param kernel - the BREP engine surface.
 * @param solid - the host solid handle.
 * @param params - the punch parameters.
 * @returns the holed solid handle.
 */
export function punchSolidOf(kernel: BrepEngineApi, solid: BrepHandle, params: PunchHoleParams): BrepHandle {
  const host = resolveFaceHandle(kernel, params.on, params.face)
  const mode = params.scaleMode ?? 'original'
  const depth = punchDepth(kernel, solid, params.height ?? null)

  const draft = params.draftAngle ?? 0
  const draftRad = (draft * Math.PI) / 180

  // Punch inward = opposite the host face outward normal.
  const n0 = kernel.surfaceNormal(host, 0, 0)
  const nlen = Math.hypot(n0.x, n0.y, n0.z) || 1
  const n = { x: n0.x / nlen, y: n0.y / nlen, z: n0.z / nlen }

  // In-plane anchor via the host face's UV center.
  const ub = kernel.uvBounds(host)
  const uMid = (ub.uMin + ub.uMax) / 2
  const vMid = (ub.vMin + ub.vMax) / 2
  const anchor = kernel.pointOnSurface(host, uMid, vMid)

  const bounds = ub
  let result = solid
  for (const contour of params.contours) {
    const curves = contour.segments.map((s) => profileSegToCurve(s as never))
    const uv = makeUvMap(mode, curves2dBounds(curves), bounds)
    const mouth = buildPolygon3d(kernel, host, uv, anchor, n, contour)
    if (mouth.length < 3) throw new Error('punchHole: contour is degenerate (fewer than 3 distinct points)')

    // Mouth wire on the host plane.
    const mouthEdges = [] as BrepHandle[]
    for (let i = 0; i < mouth.length; i++) {
      const a = mouth[i]!
      const b = mouth[(i + 1) % mouth.length]!
      mouthEdges.push(kernel.makeLineEdge(a, b) as never)
    }

    let punch: BrepHandle
    if (draft !== 0) {
      // Drafted hole = a tapered frustum: the mouth wire at the host plane and an
      // end wire (recessed by `depth*tan(draftAngle)` toward the contour centre)
      // at the punch depth, lofted together via occt. Verified: occt `loft` of two
      // parallel-planar rect wires reproduces the analytic frustum volume exactly.
      const inset = depth * Math.tan(draftRad)
      // Uniform wall recess: each wall recedes by `inset` = depth·tan(draftAngle)
      // measured *perpendicular* to that wall. For a homothetic scale about the
      // centroid by factor s, the perpendicular recess of an edge at distance h
      // from the centroid is h·(1−s); so choose s = 1 − inset/h̄ with h̄ the mean
      // centroid→edge distance (h̄ = the half-side for a square/rect ⇒ walls land
      // at exactly draftAngle).
      const cx = mouth.reduce((s, p) => s + p.x, 0) / mouth.length
      const cy = mouth.reduce((s, p) => s + p.y, 0) / mouth.length
      const cz = mouth.reduce((s, p) => s + p.z, 0) / mouth.length
      let edgeSum = 0
      for (let i = 0; i < mouth.length; i++) {
        const a = mouth[i]!
        const b = mouth[(i + 1) % mouth.length]!
        // centroid → edge midpoint projection in the host plane
        const mx = (a.x + b.x) / 2 - cx
        const my = (a.y + b.y) / 2 - cy
        const mz = (a.z + b.z) / 2 - cz
        edgeSum += Math.hypot(mx, my, mz)
      }
      const hBar = edgeSum / mouth.length
      if (!Number.isFinite(hBar) || hBar <= 1e-9 || inset >= hBar * 0.999) {
        throw new Error(
          `E_PUNCH_DRAFT_OVER_TAPER: draftAngle ${draft}° inset ${inset.toFixed(3)} must be < half-width ${hBar.toFixed(3)} at depth ${depth}`,
        )
      }
      const s = 1 - inset / hBar
      const endPoints = mouth.map((p) => ({
        x: cx + (p.x - cx) * s - n.x * depth,
        y: cy + (p.y - cy) * s - n.y * depth,
        z: cz + (p.z - cz) * s - n.z * depth,
      }))
      const endEdges = endPoints.map((p, i) => {
        const a = endPoints[i]!
        const b = endPoints[(i + 1) % endPoints.length]!
        return kernel.makeLineEdge(a, b) as never
      }) as BrepHandle[]
      const k = getOcctKernel()
      punch = k.loft(
        [kernel.makeWire(mouthEdges), kernel.makeWire(endEdges)] as unknown as never[],
        true,
        true,
      ) as unknown as BrepHandle
    } else {
      const prismFace = kernel.makeFace(kernel.makeWire(mouthEdges))
      punch = kernel.extrude(prismFace, -n.x * depth, -n.y * depth, -n.z * depth)
    }
    try {
      result = kernel.cut(result, punch)
    } finally {
      kernel.release(punch)
    }
  }
  return result
}

/**
 * Build a Shape: the host solid with the profile(s) punched out of `params.on`.
 * @param kernel - the BREP engine surface.
 * @param params - the punch parameters.
 * @returns the holed Shape.
 */
export function buildPunchHole(kernel: BrepEngineApi, params: PunchHoleParams): Shape {
  const solid = brepOf(params.on) as BrepHandle | undefined
  if (!solid) {
    throw new TopoRefError('E_TOPO_MESH_UNSUPPORTED', 'face', 'punchHole: target `on` has no BREP solid')
  }
  const holed = punchSolidOf(kernel, solid, params)
  return fromBrep(solidToShape(kernel, holed), { solid: holed })
}

/**
 * `cad.punchHole`: cut a face-placed 2D profile out of a solid.
 * @group 创建
 * @inputs 1
 * @async false
 * @qual ok
 * @name punchHole
 * @returns Shape with the profile punched out of `on`.
 * @param params.contours - ordered 2D closed contours (the hole profile).type:any[] required:true
 * @param params.on - the target solid to punch.type:Shape required:true
 * @param params.face - host face: 1-based ordinal or `cad.faceRef(on, n)`.type:any required:true
 * @param params.height - blind depth along the face inward normal (null/absent = through).type:number|object required:false
 * @param params.draftAngle - wall taper in degrees (default 0 = straight; built as an occt loft frustum).type:number required:false
 * @param params.scaleMode - UV mapping: 'original' | 'bounds' | 'native'.type:string required:false
 */
export const punchHole = defineOp({
  engines: ['occt'],
  brep(params: Record<string, unknown>) {
    assertProfileParams(params)
    return buildPunchHole(getBrepApi(), params as unknown as PunchHoleParams)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,
})