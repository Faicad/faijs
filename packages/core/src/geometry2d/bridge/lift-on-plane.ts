/**
 * 2D curve → 3D plane placement primitives (E2, occt-only bridge layer).
 *
 * This is the "lift" half of `sketchOnPlane`: it maps a pure-2D `Curve2dObj[]`
 * (or `Blueprint`) onto an arbitrary plane and assembles the resulting 3D edges
 * into a wire. `curvesAsEdgesOnPlane` / `assembleWire` mirror the plan's E2 work
 * items. The kernel edge/wire primitives are accepted as `Pick<BrepEngineApi, …>`
 * (the bridge may import the kernel contract, only `api/` is off-limits) so
 * callers pass `getBrepApi()` directly with no casts.
 * @module
 */
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import type { Curve2dObj, BSpline2d } from '../curve2d'
import { evaluateCurve2d } from '../curve2d'
import type { Blueprint } from '../blueprint'
import { namedPlane, liftPointToPlane, type Plane, type Vec3 } from './plane'

/**
 * Minimal kernel edge/wire surface needed for planar placement (plus the
 * NURBS/curve primitives the spline segments need: an exact parametric edge
 * cannot be built or trimmed without them).
 */
export type PlaneWireKernel = Pick<
  BrepEngineApi,
  | 'makeLineEdge'
  | 'makeArcEdge'
  | 'makeBezierEdge'
  | 'makeBSplineEdge'
  | 'makeCircleEdge'
  | 'curveSplit'
  | 'curveParameters'
  | 'makeWire'
>

/**
 * Build the 3D edge(s) for a single 2D curve lifted onto a plane. Line, bezier
 * and bspline build exact analytic edges; a full circle becomes one closed
 * kernel circle edge and a trimmed circle a true arc edge from three on-plane
 * lift points; ellipse falls back to a dense sampled polyline (no exact
 * ellipse-edge primitive on the contract yet).
 *
 * GOTCHA (brepkit, 2026-09-30 实证): a closed wire built from exactly TWO
 * half-arcs (`makeArcEdge`) makes brepkit's `makeFaceFromWire` produce a face
 * covering only 1/3 of the disc (measured extrude volume 523.6 vs πr²·5 = 1570.8),
 * while 3- or 4-arc wires and a single closed `makeCircleEdge` are exact. The
 * full-circle case therefore emits one `makeCircleEdge` rather than two arcs.
 * @param kernel - the kernel edge primitives.
 * @param plane - the target plane frame.
 * @param c - the ordered 2D curve to lift.
 * @returns the lifted 3D edge handle(s), in curve order.
 */
export function liftCurve2dToPlane(kernel: PlaneWireKernel, plane: Plane, c: Curve2dObj): BrepHandle[] {
  const on = (c2: Curve2dObj, t: number): Vec3 => liftPointToPlane(plane, ...evaluateCurve2d(c2, t))
  switch (c.kind2d) {
    case 'line':
      // P2 (2026-09-28, ArchDetail class): a fully-trimmed sketch can carry a
      // ZERO-LENGTH line; makeLineEdge(start, start) is rejected by the OCCT
      // kernel and killed the whole sketchOnPlane call. A zero-length segment
      // contributes nothing to the wire — skip it.
      if (c.len === 0) return []
      return [
        kernel.makeLineEdge(
          liftPointToPlane(plane, c.ox, c.oy),
          liftPointToPlane(plane, c.ox + c.dx * c.len, c.oy + c.dy * c.len),
        ),
      ]
    case 'bezier':
      return [kernel.makeBezierEdge(c.poles.map(([x, y]) => liftPointToPlane(plane, x, y)))]
    case 'bspline':
      return [buildBSplineEdge(kernel, plane, c)]
    case 'circle': {
      // Whole circle → one closed kernel circle edge. The winding sense picks
      // the axis sign so the seam/parametrisation follows the 2D curve.
      const normal = c.sense ? plane.zDir : { x: -plane.zDir.x, y: -plane.zDir.y, z: -plane.zDir.z }
      return [kernel.makeCircleEdge(liftPointToPlane(plane, c.cx, c.cy), normal, c.radius)]
    }
    case 'trimmed': {
      if (c.basis.kind2d === 'circle') return [kernel.makeArcEdge(on(c, 0), on(c, 0.5), on(c, 1))]
      // A trimmed spline is built WHOLE and then cut by the kernel, so the
      // sub-curve is the kernel's own exact subdivision rather than a
      // re-derived control polygon here.
      const full =
        c.basis.kind2d === 'bspline'
          ? buildBSplineEdge(kernel, plane, c.basis)
          : c.basis.kind2d === 'bezier'
            ? kernel.makeBezierEdge(c.basis.poles.map(([x, y]) => liftPointToPlane(plane, x, y)))
            : undefined
      if (full !== undefined) return [trimEdge(kernel, full, c.tStart, c.tEnd)]
      return sampledEdges(kernel, plane, c)
    }
    default:
      return sampledEdges(kernel, plane, c)
  }
}

/** Lift a 2D B-spline onto the plane as one exact NURBS edge (rational included). */
function buildBSplineEdge(kernel: PlaneWireKernel, plane: Plane, c: BSpline2d): BrepHandle {
  const poles: number[] = []
  for (const [x, y] of c.poles) {
    const v = liftPointToPlane(plane, x, y)
    poles.push(v.x, v.y, v.z)
  }
  return kernel.makeBSplineEdge(poles, c.weights ? [...c.weights] : [], c.knots, c.multiplicities, c.degree, c.isPeriodic)
}

/**
 * Cut an edge down to `[first, last]` on its own parameter axis.
 *
 * `curveSplit` requires a STRICTLY interior parameter and rejects a domain end
 * (`curveSplit: parameter out of range`), so each side is only cut when it is
 * actually trimmed — an edge trimmed on one side alone would otherwise throw.
 *
 * @param kernel - the kernel edge primitives.
 * @param edge - the whole basis edge.
 * @param first - trim start on the edge's parameter axis.
 * @param last - trim end on the edge's parameter axis.
 * @returns the sub-edge (the same handle when no trim applies).
 */
function trimEdge(kernel: PlaneWireKernel, edge: BrepHandle, first: number, last: number): BrepHandle {
  const b = kernel.curveParameters(edge)
  const eps = 1e-9 * Math.max(1, Math.abs(b.last - b.first))
  let cur = edge
  if (last < b.last - eps) cur = kernel.curveSplit(cur, last)[0]
  const b2 = kernel.curveParameters(cur)
  if (first > b2.first + eps) cur = kernel.curveSplit(cur, first)[1]
  return cur
}

/** Sample a non-analytic curve into a polyline of `makeLineEdge`s on the plane. */
function sampledEdges(kernel: PlaneWireKernel, plane: Plane, c: Curve2dObj): BrepHandle[] {
  const out: BrepHandle[] = []
  for (let k = 0; k < 32; k++) {
    const t0 = k / 32
    const t1 = (k + 1) / 32
    out.push(kernel.makeLineEdge(liftPointToPlane(plane, ...evaluateCurve2d(c, t0)), liftPointToPlane(plane, ...evaluateCurve2d(c, t1))))
  }
  return out
}

/**
 * Lift an ordered list of 2D curves to edges on a plane frame.
 * @param kernel - the kernel edge/wire primitives.
 * @param plane - the target plane.
 * @param curves - the ordered 2D curves (a closed loop stays closed).
 * @returns the lifted 3D edge handles in the same order.
 */
export function curvesAsEdgesOnPlane(kernel: PlaneWireKernel, plane: Plane, curves: readonly Curve2dObj[]): BrepHandle[] {
  const out: BrepHandle[] = []
  for (const c of curves) out.push(...liftCurve2dToPlane(kernel, plane, c))
  return out
}

/**
 * Assemble a Blueprint's curves into a 3D wire on a plane — the shared placement
 * step for all of the profile / draw / sketch sources.
 * @param kernel - the curve kernel/wire primitives.
 * @param planeOrName - a plane frame or a named plane string (`'XY'` / `'XZ'` / …).
 * @param bp - the blueprint whose ordered curves become the wire.
 * @returns the assembled 3D wire.
 */
export function assembleWire(kernel: PlaneWireKernel, planeOrName: Plane | string, bp: Blueprint): BrepHandle {
  const plane = typeof planeOrName === 'string' ? namedPlane(planeOrName) : planeOrName
  return kernel.makeWire(curvesAsEdgesOnPlane(kernel, plane, bp.curves))
}

export { liftPointToPlane, worldToPlane, namedPlane, makePlane, toVec3 } from './plane'
export type { Plane, Vec3, Vec3Input } from './plane'
