/**
 * 2D curve → face UV-surface placement primitives (E3, occt-only bridge layer).
 *
 * This is the "on-surface" half of `sketchOnFace`: it places a pure-2D
 * `Curve2dObj[]` contour onto the UV parameter domain of an existing face and
 * assembles 3D edges living on that surface. Unlike `liftCurve2dToPlane` (which
 * maps 2D onto a plane *frame*), `buildEdgeOnSurface` samples each 2D curve,
 * maps the samples into the face's UV space under a scale mode, evaluates the
 * surface at those UVs via `pointOnSurface(face,u,v)`, and interpolates a
 * B-spline edge through the resulting 3D points — the plan's §164 composite
 * approach (engine-method-map marks `buildEdgeOnSurface` as "occt 适配器组合实现").
 * It is surface-type-independent (plane / cylinder / any parametric surface).
 *
 * The three scale modes (plan §164):
 *   - `original`: `u=x, v=y` — reads 2D coordinates as face UVs directly.
 *   - `bounds` / `native`: affine-fit the 2D contour's bounding box onto the
 *     face's UV bounds, ratio-preserving — the generic mode for any face.
 *
 * The UV-mapping functions are pure and the bridge takes an injected
 * `Pick<BrepEngineApi, …>` kernel plus the target face handle, so the math is
 * unit-testable with a recording kernel exactly like `lift-on-plane.ts` (no
 * occt-wasm needed). The bridge imports the kernel contract and `geometry2d`
 * only — `api/` is off-limits.
 *
 * @module
 */
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepUvBounds, BrepHandle } from '../../brep/engine/types'
import type { Curve2dObj } from '../curve2d'
import { evaluateCurve2d, curveBounds } from '../curve2d'
import type { Blueprint } from '../blueprint'

/** How a 2D contour's coordinates map onto a face's UV space (`cad.sketchOnFace`). */
export type FaceScaleMode = 'original' | 'bounds' | 'native'

/** An axis-aligned 2D box (the contour's coordinate span). */
export interface Rect2d {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** A 3D surface point (the `pointOnSurface` result). */
export interface SurfacePoint {
  x: number
  y: number
  z: number
}

/** `(x,y)` → `(u,v)` face parameter-space mapping (pure). */
export type UvMap = (x: number, y: number) => [number, number]

/** Kernel surface needed for curve-on-face placement (wider than the plane-lift Pick). */
export type SurfaceEdgesKernel = Pick<
  BrepEngineApi,
  'pointOnSurface' | 'uvBounds' | 'interpolatePoints' | 'makeLineEdge' | 'makeWire'
>

/** BrepVec3 element type handed to `interpolatePoints` / returned by `pointOnSurface`. */
export type SurfaceVec3 = SurfacePoint

/**
 * Sample the tight axis-aligned 2D bounding box of an ordered curve set, used
 * to affine-fit a contour onto a face's UV bounds under `bounds`/`native`.
 * @param curves - the ordered 2D curves of a single contour.
 * @returns the sampled bounding rect; an empty set becomes the origin rect.
 */
export function curves2dBounds(curves: readonly Curve2dObj[]): Rect2d {
  const segments = 100
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const c of curves) {
    // Sample across the curve's actual domain (a line spans [0,len] arc length, a
    // full circle [0,2π]); the naive [0,1] interval would under-measure both.
    const { first, last } = curveBounds(c)
    for (let k = 0; k <= segments; k++) {
      const t = first + ((last - first) * k) / segments
      const [x, y] = evaluateCurve2d(c, t)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x0 === Infinity) return { x0: 0, x1: 0, y0: 0, y1: 0 }
  return { x0, x1, y0, y1 }
}

/**
 * Build a `(x,y)` → `(u,v)` mapping for a scale mode against a face's UV bounds.
 * `original` returns the identity (2D coords are read as UVs). `bounds`/`native`
 * affine-scale the contour's 2D box onto the full UV bounds, preserving aspect.
 * @param mode - the face-scale mode.
 * @param rect - the 2D bounding box of the contour (sampled; ignored by `original`).
 * @param bounds - the face UV bounds from `uvBounds`.
 * @returns an `(x,y)` → `(u,v)` function (pure; assertable in unit tests).
 */
export function makeUvMap(mode: FaceScaleMode, rect: Rect2d, bounds: BrepUvBounds): UvMap {
  if (mode === 'original') return (x, y) => [x, y]
  const su = rect.x1 > rect.x0 ? (bounds.uMax - bounds.uMin) / (rect.x1 - rect.x0) : 0
  const sv = rect.y1 > rect.y0 ? (bounds.vMax - bounds.vMin) / (rect.y1 - rect.y0) : 0
  return (x, y) => [bounds.uMin + (x - rect.x0) * su, bounds.vMin + (y - rect.y0) * sv]
}

/**
 * Build the 3D edge for a single 2D curve laid on a face: sample the curve, map
 * samples to UV under the given mapping, evaluate the face surface there, and
 * interpolate a curve edge through the resulting 3D points. A curve that
 * evaluates to 2 or fewer distinct points is emitted as an exact `makeLineEdge`
 * (the planar fast path).
 * @param kernel - the surface kernel (`pointOnSurface` + `interpolatePoints`).
 * @param face - the target face handle (for `pointOnSurface(face,u,v)`).
 * @param uv - the UV mapping for this curve (see `makeUvMap`).
 * @param c - the ordered 2D curve to place on the face.
 * @param samples - the sample count per curve (>= 3 for smooth edges).
 * @returns the placed 3D edge handle (one per curve).
 */
export function buildEdgeOnSurface(
  kernel: Pick<SurfaceEdgesKernel, 'pointOnSurface' | 'interpolatePoints' | 'makeLineEdge'>,
  face: BrepHandle,
  uv: UvMap,
  c: Curve2dObj,
  samples = 12,
): BrepHandle {
  const raw: SurfacePoint[] = []
  for (let k = 0; k <= samples; k++) {
    const [x, y] = evaluateCurve2d(c, k / samples)
    const [u, v] = uv(x, y)
    raw.push(kernel.pointOnSurface(face, u, v))
  }
  const unique = Array.from(new Map(raw.map((p) => [`${p.x},${p.y},${p.z}`, p])).values())
  if (unique.length <= 2) {
    return kernel.makeLineEdge(unique[0]!, unique[unique.length - 1]!)
  }
  return kernel.interpolatePoints(unique, 3)
}

/**
 * Place every curve of a contour onto a face's UV space and assemble a wire.
 * Computes the face UV bounds and the contour's 2D box, derives the UV map for
 * the chosen scale mode, and buildings edges + a `makeWire` on the surface.
 * @param kernel - the surface kernel.
 * @param face - the target face handle.
 * @param mode - the face-scale mode (`original`/`bounds`/`native`).
 * @param bp - the blueprint whose ordered curves become on-face edges.
 * @param samples - samples per curve (default 12).
 * @returns `{ wire, uv }`: the assembled 3D wire and the UV map used.
 */
export function assembleWireOnFace(
  kernel: Pick<SurfaceEdgesKernel, 'pointOnSurface' | 'uvBounds' | 'interpolatePoints' | 'makeLineEdge' | 'makeWire'>,
  face: BrepHandle,
  mode: FaceScaleMode,
  bp: Blueprint,
  samples = 12,
): { wire: BrepHandle; uv: UvMap } {
  const bounds = kernel.uvBounds(face)
  const uv = makeUvMap(mode, curves2dBounds(bp.curves), bounds)
  const edges = bp.curves.map((c) => buildEdgeOnSurface(kernel, face, uv, c, samples) as never)
  return { wire: kernel.makeWire(edges), uv }
}