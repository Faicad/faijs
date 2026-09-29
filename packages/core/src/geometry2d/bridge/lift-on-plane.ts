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
import type { Curve2dObj } from '../curve2d'
import { evaluateCurve2d } from '../curve2d'
import type { Blueprint } from '../blueprint'
import { namedPlane, liftPointToPlane, type Plane, type Vec3 } from './plane'

/** Minimal kernel edge/wire surface needed for planar placement. */
export type PlaneWireKernel = Pick<BrepEngineApi, 'makeLineEdge' | 'makeArcEdge' | 'makeBezierEdge' | 'makeWire'>

/**
 * Build the 3D edge(s) for a single 2D curve lifted onto a plane. Line and
 * bezier build exact analytic edges; circle / trimmed-circle build a true arc
 * edge from three on-plane lift points (a full circle is split into two arcs to
 * keep `makeArcEdge` well-formed); ellipse / bspline fall back to a dense
 * sampled polyline.
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
    case 'circle':
      return [
        kernel.makeArcEdge(on(c, 0), on(c, Math.PI / 2), on(c, Math.PI)),
        kernel.makeArcEdge(on(c, Math.PI), on(c, (3 * Math.PI) / 2), on(c, 2 * Math.PI)),
      ]
    case 'trimmed':
      if (c.basis.kind2d === 'circle') return [kernel.makeArcEdge(on(c, 0), on(c, 0.5), on(c, 1))]
      return sampledEdges(kernel, plane, c)
    default:
      return sampledEdges(kernel, plane, c)
  }
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

export { liftPointToPlane, namedPlane, makePlane, toVec3 } from './plane'
export type { Plane, Vec3, Vec3Input } from './plane'