/**
 * occt-kernel/revolve-degenerate — near-degenerate cone preservation for
 * full revolves of planar faces.
 *
 * Root cause (pinned 2026-11-13, fcstd-port ISO4762 screw family): OCCT's
 * revolve sweep (`BRepPrimAPI_MakeRevol`) canonicalizes the surface swept by
 * a profile LINE edge whose radial change is tiny relative to its axial
 * span. A slant line like `(4.999, 0) -> (5, -138)` (slope 7.2e-6 rad, the
 * Fasteners macro's 0.001 sliver) does NOT become the exact cone the profile
 * defines: modern OCCT returns a cylinder face at one endpoint radius whose
 * boundary circles do not even lie on it (an inconsistent face kept alive by
 * edge tolerance), or a lossy `SurfaceOfRevolution`. Old-OCCT corpus truth
 * (the saved .brp) carries the exact cone — volume/area/COM parity for that
 * corpus therefore needs the exact cone, which the sweep cannot produce.
 *
 * Repair (probe-validated to 1e-12 on the minimal trapezoid and to 3.6e-7
 * absolute on the real ISO4762 M10 profile, test/probe-revolve-repair.ts /
 * test/probe-revolve-s006.ts):
 *
 *  1. detect profile line edges with `0 < |Δr|`, axial span above 1e-6 and
 *     slope below SLOPE_TOL (everything the sweep may canonicalize);
 *  2. wire surgery: replace each such edge by a vertical line at
 *     `r_min - MARGIN` (STRICTLY inside the exact frustum) plus radial jogs
 *     at both stations — the modified profile revolves to a well-defined
 *     solid and no tangential contact remains anywhere;
 *  3. build the exact frustum per edge via `makeCone` (which keeps
 *     near-degenerate cones exactly) placed on the revolve axis;
 *  4. `fuseAll` — the coincident contacts are planar disc/annulus overlaps
 *     only, a clean boolean glue.
 *
 * The result is the exact cone the profile defines — matching the old-OCCT
 * corpus truth bit for bit where the sweep loses geometry.
 *
 * Scope gates (all static, checked before any construction): full
 * revolution, single planar face, axis contained in the profile plane,
 * `r_min` above 1e-3. Everything else takes the plain sweep path — zero
 * behavior change for non-degenerate profiles.
 */
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'

/** Max |Δr|/|Δt| (rad) treated as degenerate — the sweep keeps exact cones
 *  well above this; everything below MAY be canonicalized. */
const SLOPE_TOL = 1e-3
/** |angle| within this of 360° counts as a full revolution. */
const FULL_ANGLE_EPS = 1e-6
/** Min radius (mm) of a degenerate edge for the repair to apply. */
const MIN_RADIUS = 1e-3
/** Radial inset (mm) of the surgery vertical — strictly inside the frustum,
 *  large enough for robust boolean gluing (≫ Precision::Confusion 1e-7). */
const MARGIN = 1e-4
/** Plane/axis coincidence tolerance (mm, matches OCCT Confusion). */
const COINCIDENT_EPS = 1e-7
/** Min axial span (mm) of a degenerate edge. */
const MIN_AXIAL_SPAN = 1e-6
/** |Δr| below this is a true cylinder line — the sweep is exact, and the
 *  difference to any frustum is below BREP precision anyway.
 *  MUST stay ≥ occt-wasm makeCone's "two identic radii" refusal threshold
 *  (probed: refused at 1e-8, accepted at 1e-7 — OCCT Precision::Confusion)
 *  and above the planegcs solve noise on constrained endpoints (observed
 *  ~3e-11 on tangent-constrained head-side lines, s034/s037 regression). */
const MIN_DR = 1e-7

interface DegenerateEdge {
  /** original edge handle (kept for the wire rebuild bookkeeping) */
  edge: ShapeHandle
  /** endpoint vertex handles, edge-local order */
  v1: ShapeHandle
  v2: ShapeHandle
  /** endpoint positions */
  p1: Vec3
  p2: Vec3
  /** axial stations along the revolve axis */
  t1: number
  t2: number
  /** radii from the axis */
  r1: number
  r2: number
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })

/**
 * Attempt the degenerate-cone-preserving revolve.
 *
 * @param k - raw occt-wasm kernel (construction + measurement primitives).
 * @param shape - the profile shape handed to revolveVec.
 * @param center - a point on the revolve axis.
 * @param direction - revolve axis direction (need not be normalized).
 * @param angleDeg - revolve angle in degrees (repair applies at ±360 only).
 * @returns the repaired solid handle, or `undefined` when no repair applies
 *  (caller takes the plain sweep path — zero behavior change).
 */
export function repairDegenerateRevolve(
  k: OcctKernel,
  shape: ShapeHandle,
  center: Vec3,
  direction: Vec3,
  angleDeg: number,
): ShapeHandle | undefined {
  // Full revolution only — the frustum primitive is a full 2π solid.
  if (Math.abs(Math.abs(angleDeg) - 360) > FULL_ANGLE_EPS) return undefined
  // Single planar face only.
  if (k.getShapeType(shape) !== 'face') return undefined
  if (k.surfaceType(shape) !== 'plane') return undefined

  const dirLen = len(direction)
  if (dirLen < 1e-12) return undefined
  const dir: Vec3 = scale(direction, 1 / dirLen)

  // Axis must lie in the profile plane (the meridian requirement — the
  // frustum construction is only valid for a profile plane containing the
  // axis).
  const nRaw = k.surfaceNormal(shape, 0, 0)
  const nLen = len(nRaw)
  if (nLen < 1e-12) return undefined
  const n = scale(nRaw, 1 / nLen)
  if (Math.abs(dot(n, dir)) > COINCIDENT_EPS) return undefined

  const wires = k.getSubShapes(shape, 'wire')
  if (wires.length === 0) return undefined
  // This engine builds faces as makeFace(outerWire) + addHolesInFace(...) —
  // wires[0] is the outer boundary by construction contract.
  const outerWire = wires[0]!
  const holeWires = wires.slice(1)
  const edges = k.getSubShapes(outerWire, 'edge')
  if (edges.length === 0) return undefined

  const axisT = (p: Vec3): number => dot(sub(p, center), dir)
  const radialVec = (p: Vec3, t: number): Vec3 => sub(sub(p, center), scale(dir, t))

  // Collect degenerate line edges (static detection on exact coordinates).
  const degen: DegenerateEdge[] = []
  for (const edge of edges) {
    if (k.curveType(edge) !== 'line') continue
    const vs = k.getSubShapes(edge, 'vertex')
    if (vs.length !== 2) continue
    const p1 = k.vertexPosition(vs[0]!)
    const p2 = k.vertexPosition(vs[1]!)
    const t1 = axisT(p1)
    const t2 = axisT(p2)
    const r1 = len(radialVec(p1, t1))
    const r2 = len(radialVec(p2, t2))
    const dr = Math.abs(r1 - r2)
    const dt = Math.abs(t1 - t2)
    if (dr <= MIN_DR) continue // true cylinder line — sweep is exact
    if (dt <= MIN_AXIAL_SPAN) continue // (near-)radial line — not a cone generator
    if (dr / dt >= SLOPE_TOL) continue // healthy cone — sweep keeps it exact
    if (Math.min(r1, r2) <= MIN_RADIUS) return undefined // too close to the axis — stay on the safe path
    // Axis-point-in-plane check (once, against this edge's endpoints).
    if (Math.abs(dot(n, sub(center, p1))) > COINCIDENT_EPS) return undefined
    degen.push({ edge, v1: vs[0]!, v2: vs[1]!, p1, p2, t1, t2, r1, r2 })
  }
  if (degen.length === 0) return undefined

  // ── wire surgery: degenerate edge → margin vertical + radial jogs ──
  // Jog lengths are ≥ MARGIN (1e-4) and the vertical is ≥ MIN_AXIAL_SPAN —
  // all three pieces are always non-degenerate, no zero-length guard needed.
  const degenSet = new Set(degen.map((d) => d.edge))
  const chain: ShapeHandle[] = []
  const perEdgeFrustums: { base: Vec3; rBase: number; rTop: number; h: number }[] = []
  for (const d of degen) {
    const rMin = Math.min(d.r1, d.r2)
    const rIn = rMin - MARGIN
    // unit radial directions at both stations
    const e1 = scale(radialVec(d.p1, d.t1), 1 / d.r1)
    const e2 = scale(radialVec(d.p2, d.t2), 1 / d.r2)
    const in1 = add(add(center, scale(dir, d.t1)), scale(e1, rIn))
    const in2 = add(add(center, scale(dir, d.t2)), scale(e2, rIn))
    const inV1 = k.makeVertex(in1.x, in1.y, in1.z)
    const inV2 = k.makeVertex(in2.x, in2.y, in2.z)
    chain.push(k.makeEdge(d.v1, inV1))
    chain.push(k.makeEdge(inV1, inV2))
    chain.push(k.makeEdge(inV2, d.v2))
    // frustum spec: base at the lower station (cone grows along +axis)
    if (d.t2 >= d.t1) {
      perEdgeFrustums.push({ base: add(center, scale(dir, d.t1)), rBase: d.r1, rTop: d.r2, h: d.t2 - d.t1 })
    } else {
      perEdgeFrustums.push({ base: add(center, scale(dir, d.t2)), rBase: d.r2, rTop: d.r1, h: d.t1 - d.t2 })
    }
  }
  for (const edge of edges) {
    if (!degenSet.has(edge)) chain.push(edge)
  }
  const modWire = k.makeWire(chain)
  let modFace = k.makeFace(modWire)
  k.release(modWire)
  if (holeWires.length > 0) {
    modFace = k.addHolesInFace(modFace, holeWires)
  }

  // ── revolve the modified profile (well-defined solid) ──
  // Snap to the exact full circle — callers may pass 360 ± float noise
  // (e.g. L3 `(angle*180)/π` of 2π) and the sweep must treat it as closed.
  const angleRad = angleDeg >= 0 ? Math.PI * 2 : -Math.PI * 2
  const revMod = k.revolve(modFace, { point: center, direction: dir }, angleRad)

  // ── exact frustums, placed on the axis ──
  const zAxis: Vec3 = { x: 0, y: 0, z: 1 }
  const frustums: ShapeHandle[] = []
  for (const f of perEdgeFrustums) {
    let cone = k.makeCone(f.rBase, f.rTop, f.h)
    // map +Z onto the revolve axis direction
    const c = dot(zAxis, dir)
    if (Math.abs(c - 1) > 1e-12) {
      if (Math.abs(c + 1) <= 1e-12) {
        cone = k.rotate(cone, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, Math.PI)
      } else {
        const rotAxis = cross(zAxis, dir)
        const rotLen = len(rotAxis)
        const rotDir = scale(rotAxis, 1 / rotLen)
        const angle = Math.acos(Math.max(-1, Math.min(1, c)))
        cone = k.rotate(cone, { point: { x: 0, y: 0, z: 0 }, direction: rotDir }, angle)
      }
    }
    cone = k.translate(cone, f.base.x, f.base.y, f.base.z)
    frustums.push(cone)
  }

  // ── fuse: coincident contacts are planar disc/annulus overlaps only ──
  return k.fuseAll([revMod, ...frustums])
}
