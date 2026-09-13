/**
 * gears — raw-handle primitives for the cq_gears port (E1–E6 companion layer).
 *
 * cq_gears' tooth faces are B-spline patches built from (u,v) point grids and
 * assembled by sewing — these need raw kernel construction primitives that no
 * Workplane op exposes (bsplineSurface / approximatePoints / interpolatePoints,
 * tolerant edge chaining, sew+makeSolid). The fai_cq_gears v1 port probed them
 * in its own `kernel.ts` / `geom-build.ts` / `spline-face.ts`; per the port
 * plan (§4) the implementations must live INSIDE cq-compat — this file is that
 * landing spot. fai_cq_gears only imports from here; it must not touch
 * occt-wasm directly.
 *
 * Everything here is a verbatim port of the proven v1 implementations (same
 * kernel call sequence → bit-identical geometry).
 */

import { initOcctWasm } from '@faicad/faijs-core'
import type { BrepEngineApi, BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import type { Vec3 } from './geom-types'

/** Rotation/mirror axis (occt-wasm shape). */
export interface GearAxis {
  point: BrepVec3
  direction: BrepVec3
}

/**
 * Raw occt-wasm capability surface — superset of `BrepEngineApi`.
 *
 * Declares exactly the methods the cq_gears port consumes; the probe test in
 * fai_cq_gears asserts each one exists on the live kernel, so a kernel upgrade
 * that renames a binding turns red immediately instead of failing at runtime
 * with `undefined is not a function`.
 */
export interface GearKernel extends BrepEngineApi {
  // ── surface / curve construction (CadQuery makeSplineApprox family) ──
  /** `GeomAPI_PointsToBSplineSurface`: point grid → B-spline surface → Face. */
  bsplineSurface(points: BrepVec3[], rows: number, cols: number): BrepHandle
  /** `GeomAPI_PointsToBSpline`: point list → approximated B-spline curve (with Tol3D). */
  approximatePoints(points: BrepVec3[], tolerance?: number): BrepHandle
  /** Cubic B-spline interpolation curve through all points. */
  interpolatePoints(points: BrepVec3[], periodic?: boolean): BrepHandle

  // ── topology construction ──
  /** `BRepBuilderAPI_Sewing`: faces → sewn shell (cq `make_shell` analogue). */
  sew(shapes: BrepHandle[], tolerance?: number): BrepHandle
  makeSolid(shell: BrepHandle): BrepHandle
  /** TopAbs_ShapeEnum type name ("solid" / "shell" / "face" …, for diagnostics/assertions). */
  getShapeType(shape: BrepHandle): string
  buildSolidFromFaces(faces: BrepHandle[], tolerance?: number): BrepHandle
  makeNonPlanarFace(wire: BrepHandle): BrepHandle
  makeFaceOnSurface(face: BrepHandle, wire: BrepHandle): BrepHandle
  outerWire(face: BrepHandle): BrepHandle

  // ── healing ──
  healWire(wire: BrepHandle, tolerance?: number): BrepHandle
  healFace(face: BrepHandle, tolerance?: number): BrepHandle

  // ── transforms / booleans ──
  rotate(shape: BrepHandle, axis: GearAxis, angleRad: number): BrepHandle
  /** `BRepPrimAPI_MakeRevol`: face/wire revolved around `axis` (cq `Workplane.revolve`, 360°=2π). */
  revolve(shape: BrepHandle, axis: GearAxis, angleRad: number): BrepHandle
  mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle
  reverseShape(shape: BrepHandle): BrepHandle
  vertexPosition(vertex: BrepHandle): BrepVec3
  split(shape: BrepHandle, tools: BrepHandle[]): BrepHandle
  fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle
  shell(
    solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, tolerance: number,
  ): BrepHandle
  thicken(shape: BrepHandle, thickness: number, tolerance: number): BrepHandle
  makeCircleArc(
    center: BrepVec3, normal: BrepVec3, radius: number, startAngle: number, endAngle: number,
  ): BrepHandle
  makeHelixWire(
    origin: BrepVec3, axis: BrepVec3, pitch: number, height: number, radius: number,
  ): BrepHandle

  // ── queries ──
  getSurfaceArea(shape: BrepHandle): number
  projectPointOnFace(face: BrepHandle, point: BrepVec3): BrepVec3
  surfaceType(face: BrepHandle): string
  subShapeCount(shape: BrepHandle, type: 'vertex' | 'edge' | 'wire' | 'face' | 'shell' | 'solid'): number
  isFace(shape: BrepHandle): boolean
  isWire(shape: BrepHandle): boolean
  isShell(shape: BrepHandle): boolean
  isEdge(shape: BrepHandle): boolean
}

let gearKernelPromise: Promise<GearKernel> | null = null

/**
 * Get the raw occt-wasm kernel (process-wide singleton).
 *
 * Same instance as `initOcctWasm()` — this only asserts the richer
 * `GearKernel` type, never constructs a second kernel (handles are indices
 * into one kernel arena and must not cross instances).
 *
 * @returns the raw kernel (promise; initializes wasm on first call)
 */
export function getGearKernel(): Promise<GearKernel> {
  if (!gearKernelPromise) {
    gearKernelPromise = initOcctWasm().then((k) => k as unknown as GearKernel)
  }
  return gearKernelPromise
}

// ── tolerant edge chaining (port of fai_cq_gears v1 geom-build.ts) ─────────

/** The two endpoints of an edge (order = the edge's parameter direction). */
export interface GearEdgeEnds {
  edge: BrepHandle
  a: Vec3
  b: Vec3
}

function gearDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * Endpoints of an edge, via the curve parameter domain.
 *
 * ⚠️ Endpoint red line (probed 2026-09-11): `getSubShapes(edge, 'vertex')`
 * returns fewer than 2 vertices for **B-spline curve edges** (OCCT stores no
 * explicit vertices on them), which used to make edge chaining treat every
 * edge as its own wire. The correct path is `curveParameters(edge)` →
 * `curvePointAtParam(edge, param)` — valid for ALL edge kinds (line / arc /
 * B-spline); the vertex fallback only covers degenerate edges without an
 * underlying curve.
 *
 * @param kernel raw OCCT kernel
 * @param edge edge handle
 * @returns both endpoints (closed edges: first == last)
 */
export function gearEdgeEnds(kernel: GearKernel, edge: BrepHandle): GearEdgeEnds {
  try {
    const { first, last } = kernel.curveParameters(edge)
    return {
      edge,
      a: kernel.curvePointAtParam(edge, first),
      b: kernel.curvePointAtParam(edge, last),
    }
  } catch {
    // Fallback: rare degenerate edges without an underlying curve.
    const vs = kernel.getSubShapes(edge, 'vertex')
    if (vs.length < 2) {
      const p = kernel.vertexPosition(vs[0])
      return { edge, a: p, b: p }
    }
    return { edge, a: kernel.vertexPosition(vs[0]), b: kernel.vertexPosition(vs[1]) }
  }
}

/**
 * TS port of OCCT `ShapeAnalysis_FreeBounds::ConnectEdgesToWires` — chain
 * unordered edges into wires by endpoint proximity within `tol`.
 *
 * faijs/occt-wasm has no such binding and `makeWire(edges)` is
 * `BRepBuilderAPI_MakeWire` — measured (2026-09-08) to silently drop edges on
 * unordered input (68 edges → 9-edge broken wire). Endpoint pairing is O(n²)
 * (n = 4·z teeth, at most a few hundred — fine).
 *
 * Gaps above OCCT precision (~1e-7) get a bridging line segment, matching
 * upstream ConnectEdgesToWires behaviour.
 *
 * @param kernel raw OCCT kernel
 * @param edges unordered edge set
 * @param tol endpoint pairing tolerance (mm); cq uses `wire_comb_tol = 1e-2`
 * @returns one or more wires, each with its edges chained head-to-tail
 */
export function connectEdgesToWires(
  kernel: GearKernel,
  edges: BrepHandle[],
  tol: number,
): BrepHandle[] {
  if (!Number.isFinite(tol) || tol <= 0) {
    throw new Error(`connectEdgesToWires: tol must be a positive finite number, got ${String(tol)}`)
  }
  const pool: GearEdgeEnds[] = edges.map((e) => gearEdgeEnds(kernel, e))
  const used = new Array<boolean>(pool.length).fill(false)
  const wires: BrepHandle[] = []

  for (let start = 0; start < pool.length; start++) {
    if (used[start]) continue
    used[start] = true

    const chain: BrepHandle[] = [pool[start].edge]
    let tail = pool[start].b
    const head = pool[start].a

    // Chain forward: find an unused edge whose endpoint touches `tail` within tol.
    for (;;) {
      let found = -1
      let best = Infinity
      for (let j = 0; j < pool.length; j++) {
        if (used[j]) continue
        const dA = gearDist(pool[j].a, tail)
        const dB = gearDist(pool[j].b, tail)
        const d = Math.min(dA, dB)
        if (d <= tol && d < best) {
          best = d
          found = j
        }
      }
      if (found < 0) break
      used[found] = true
      const e = pool[found]
      const flip = gearDist(e.a, tail) <= gearDist(e.b, tail)
      if (best > 1e-7) {
        chain.push(kernel.makeLineEdge(tail, flip ? e.a : e.b))
      }
      // Edge points the wrong way: reverseShape makes a reversed copy.
      chain.push(flip ? e.edge : kernel.reverseShape(e.edge))
      tail = flip ? e.b : e.a
      // Back at the start ⇒ closed loop, stop.
      if (gearDist(tail, head) <= tol) break
    }

    // Close the loop: bridge the tail-to-head gap too.
    const endGap = gearDist(tail, head)
    if (chain.length > 1 && endGap > 1e-7 && endGap <= tol) {
      chain.push(kernel.makeLineEdge(tail, head))
    }

    wires.push(kernel.makeWire(chain))
  }
  return wires
}

/**
 * cq `Face.makeFromWires(outer, holes)` analogue.
 *
 * @param kernel raw OCCT kernel
 * @param outer outer wire
 * @param holes inner hole wires (may be empty)
 * @returns face handle
 */
export function gearFaceFromWires(
  kernel: GearKernel,
  outer: BrepHandle,
  holes: BrepHandle[] = [],
): BrepHandle {
  const f = kernel.makeFace(outer)
  return holes.length > 0 ? kernel.addHolesInFace(f, holes) : f
}

/**
 * cq `make_shell(faces, tol)` + `Solid.makeSolid(shell)` analogue.
 *
 * A non-shell sew result is NOT silently swallowed — that is a construction
 * failure signal.
 *
 * @param kernel raw OCCT kernel
 * @param faces faces to sew
 * @param sewingTol sewing tolerance (mm, cq `shell_sewing_tol`)
 * @returns solid built from the sewn shell
 */
export function gearShellToSolid(
  kernel: GearKernel,
  faces: BrepHandle[],
  sewingTol: number,
): BrepHandle {
  const shell = kernel.sew(faces, sewingTol)
  if (!kernel.isShell(shell) && !kernel.isSolid(shell)) {
    throw new Error(
      `gearShellToSolid: sew did not produce a shell (got ${String(kernel.getShapeType(shell))})`,
    )
  }
  return kernel.makeSolid(shell)
}

// ── spline tooth faces (port of fai_cq_gears v1 spline-face.ts) ────────────

/**
 * Tooth-face B-spline face strategies (mirrors cq `Face.makeSplineApprox`).
 *
 * | strategy | how | semantic delta vs cq |
 * |---|---|---|
 * | `grid-approx` | `kernel.bsplineSurface(flat, rows, cols)` (also `GeomAPI_PointsToBSplineSurface`) | OCCT default DegMin/DegMax/Tol3D; cq passes 3/8/1e-2 explicitly |
 * | `row-approx-loft` | per-row `approximatePoints(row, tol)` → `loft(wires, false, false)` | curve-level tol same name/meaning; surface is skinned, not fitted at once |
 * | `row-interp-loft` | per-row `interpolatePoints(row)` → `loft` | passes through every sample point (interpolation) |
 */
export type GearSplineFaceStrategy = 'grid-approx' | 'row-approx-loft' | 'row-interp-loft'

/** All selectable strategies (tests iterate in this order for the deviation table). */
export const GEAR_SPLINE_FACE_STRATEGIES: readonly GearSplineFaceStrategy[] = [
  'grid-approx',
  'row-approx-loft',
  'row-interp-loft',
]

/**
 * Default strategy chosen by P0 measurement (2026-09-08).
 *
 * Per the measured table in the fai_cq_gears spike: S2's area relative
 * deviation is 5.6e-7 / max sample-point distance 2.6e-6 mm — about three
 * orders of magnitude better than S1/S3. See
 * `docs/analysis/2026-09-08-fai-cq-gears-spike.md`.
 */
export const DEFAULT_GEAR_SPLINE_FACE_STRATEGY: GearSplineFaceStrategy = 'row-approx-loft'

/** Face building options (tolerance + degrees, aligned with cq `makeSplineApprox`). */
export interface GearSplineFaceOptions {
  /** Approximation tolerance (mm). cq's `spline_approx_tol`, default 1e-2. */
  tolerance?: number
  /** Surface minimum degree (cq: 3) — only meaningful for grid-approx/row-approx-loft. */
  minDeg?: number
  /** Surface maximum degree (cq: 8). */
  maxDeg?: number
}

/** A row×col point grid with its dimensions (structural — no gear types here). */
export interface GearSplineGrid {
  /** `rows` point rows of `cols` points each. */
  points: Vec3[][]
  rows: number
  cols: number
}

/**
 * Build a face from a row×col point grid with the given strategy.
 *
 * @throws kernel errors propagate verbatim (never swallowed — red line)
 *
 * @param kernel raw OCCT kernel
 * @param grid row×col point grid
 * @param strategy face building strategy
 * @param options tolerance/degree options
 * @returns single face handle (Face)
 */
export function buildGearSplineFace(
  kernel: GearKernel,
  grid: GearSplineGrid,
  strategy: GearSplineFaceStrategy,
  options: GearSplineFaceOptions = {},
): BrepHandle {
  const tol = options.tolerance ?? 1e-2
  switch (strategy) {
    case 'grid-approx':
      return buildGearGridApprox(kernel, grid)
    case 'row-approx-loft':
      return buildGearRowLoft(kernel, grid, (row) => kernel.approximatePoints(row, tol))
    case 'row-interp-loft':
      return buildGearRowLoft(kernel, grid, (row) => kernel.interpolatePoints(row, false))
  }
}

/** S1: fit the whole grid to one B-spline surface at once. */
function buildGearGridApprox(kernel: GearKernel, grid: GearSplineGrid): BrepHandle {
  const flat: Vec3[] = []
  for (const row of grid.points) for (const p of row) flat.push(p)
  return kernel.bsplineSurface(flat, grid.rows, grid.cols)
}

/** S2/S3: per-row curve → `loft` skinning. */
function buildGearRowLoft(
  kernel: GearKernel,
  grid: GearSplineGrid,
  makeCurve: (row: Vec3[]) => BrepHandle,
): BrepHandle {
  const wires = grid.points.map((row) => kernel.makeWire([makeCurve(row)]))
  // `loft(wires, isSolid=false, ruled=false)` returns a **shell** (measured
  // 2026-09-08), while cq's tooth face is a TopoDS_Face; downstream sew /
  // projectPointOnFace require a Face, so extract the sole face.
  return soleGearFace(kernel, kernel.loft(wires, false, false))
}

/**
 * Reduce a "single-face shell" to a Face; a Face passes through unchanged.
 *
 * @throws when the face count is not 1 (silently taking the first would mask problems)
 *
 * @param kernel raw OCCT kernel
 * @param shape any shape (Face / single-face shell / …)
 * @returns the sole Face
 */
export function soleGearFace(kernel: GearKernel, shape: BrepHandle): BrepHandle {
  if (kernel.isFace(shape)) return shape
  const faces = kernel.getSubShapes(shape, 'face')
  if (faces.length !== 1) {
    throw new Error(
      `soleGearFace: expected a single face, got ${faces.length} (shapeType=${String(kernel.getShapeType(shape))})`,
    )
  }
  return faces[0]
}

/** Distance from a point to a face (`projectPointOnFace`).
 *
 * @param kernel raw OCCT kernel
 * @param face target face
 * @param p query point
 * @returns euclidean distance (mm)
 */
export function gearDistanceToFace(kernel: GearKernel, face: BrepHandle, p: Vec3): number {
  const q = kernel.projectPointOnFace(face, p)
  return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)
}

/** Distance statistics (max / RMS / sample count). */
export interface GearDeviationStats {
  max: number
  rms: number
  n: number
}

/**
 * Distance statistics of reference sample points against a face.
 *
 * Parameterization-independent: samples come from the cq side's (u,v) grid, so
 * the two surfaces may have different parameterizations.
 *
 * @param kernel raw OCCT kernel
 * @param face face under test
 * @param samplePoints reference sample points (3D)
 * @returns max distance / RMS / sample count
 */
export function gearFaceDeviation(
  kernel: GearKernel,
  face: BrepHandle,
  samplePoints: Vec3[],
): GearDeviationStats {
  let max = 0
  let sumSq = 0
  for (const p of samplePoints) {
    const d = gearDistanceToFace(kernel, face, p)
    if (d > max) max = d
    sumSq += d * d
  }
  return { max, rms: Math.sqrt(sumSq / samplePoints.length), n: samplePoints.length }
}
