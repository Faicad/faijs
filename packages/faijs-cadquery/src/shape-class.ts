/**
 * Shape class model — CadQuery `Shape.py` high-value subset parity
 * (Stage 5 / P0-3). Factory functions + object method chains (object method
 * calls are verified on the script face; see plan §4 Stage 5 action 1).
 *
 * Handle lifecycle (typed here, in the FIRST implementation): a `CqShape`
 * OWNS its kernel handle — `dispose()` releases it; borrowed views (a handle
 * obtained from a Workplane or a selector) are wrapped with `borrow: true`
 * and their `dispose()` is a no-op, mirroring the core fromHandle
 * adoption pattern (no double release).
 */

import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'

/** A 3D point (mirrors geom-types Vec3 shape without importing it). */
export interface Pt3 {
  x: number
  y: number
  z: number
}

/** Ownership flag shared by all class-model wrappers. */
export interface ShapeClassBase {
  /** true when this wrapper owns the handle (dispose releases it). */
  owned: boolean
}

/** A shape handle wrapper in the class model (Face/Wire/Edge/Solid/Compound). */
export interface CqShape extends ShapeClassBase {
  kind: 'face' | 'wire' | 'edge' | 'solid' | 'shell' | 'compound'
  handle: ShapeHandle
}

function kernel(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

/**
 * Wrap a handle as an owned class-model shape of the given kind.
 * @param kind - the shape kind the handle holds.
 * @param handle - the raw kernel handle to own.
 * @returns the owned wrapper (`dispose` releases the handle).
 */
export function wrapShape(kind: CqShape['kind'], handle: ShapeHandle): CqShape {
  return { kind, handle, owned: true }
}

/**
 * Wrap a borrowed handle (selector results, Workplane interop) — dispose is a no-op.
 * @param kind - the shape kind the handle holds.
 * @param handle - the raw kernel handle owned by someone else.
 * @returns the borrowed wrapper (`dispose` leaves the handle alone).
 */
export function borrowShape(kind: CqShape['kind'], handle: ShapeHandle): CqShape {
  return { kind, handle, owned: false }
}

/**
 * Extract the raw kernel handle from a class-model shape or a bare handle.
 * @param s - a class-model wrapper or a bare kernel handle.
 * @returns the raw kernel handle.
 */
export function unwrapShape(s: CqShape | ShapeHandle): ShapeHandle {
  return s && typeof s === 'object' && 'handle' in s ? (s as CqShape).handle : (s as ShapeHandle)
}

/**
 * Release a class-model shape. Owned wrappers release their handle; borrowed
 * views are left untouched (the owner releases them).
 * @param s - the wrapper to release (its `owned` flag is cleared either way).
 */
export function disposeShape(s: CqShape): void {
  if (s.owned) kernel().release(s.handle)
  s.owned = false
}

// ---------------------------------------------------------------------------
// Face factories (upstream Shape.py Face statics)
// ---------------------------------------------------------------------------

/**
 * Face.makePlane — CadQuery `Face.makePlane(length, width, basePnt, dir)`
 * parity: a centred planar face. The kernel has no infinite-plane primitive,
 * so the plan's "infinite face" resolves to a large finite face (default
 * 2×length/width span, factor 100 — far larger than any assembly mate
 * geometry; upstream uses an INFINITE surface, consumers only query it for
 * Plane/normal/origin).
 * @param length - size along the plane's local X
 * @param width - size along the plane's local Y
 * @param basePnt - plane origin (default world origin)
 * @param dir - plane normal (default +Z)
 * @returns CqShape (face)
 */
export function faceMakePlane(length: number, width: number, basePnt?: Pt3, dir?: Pt3): CqShape {
  const k = kernel()
  const n = dir ?? { x: 0, y: 0, z: 1 }
  const base = basePnt ?? { x: 0, y: 0, z: 0 }
  // build in XY then rotate +Z → n, then translate to base
  // (finite stand-in for upstream's INFINITE plane: ×100 span, see JSDoc)
  const hw = (length * 100) / 2
  const hd = (width * 100) / 2
  const e1 = k.makeLineEdge(v3(-hw, -hd, 0), v3(hw, -hd, 0))
  const e2 = k.makeLineEdge(v3(hw, -hd, 0), v3(hw, hd, 0))
  const e3 = k.makeLineEdge(v3(hw, hd, 0), v3(-hw, hd, 0))
  const e4 = k.makeLineEdge(v3(-hw, hd, 0), v3(-hw, -hd, 0))
  const wire = k.makeWire([e1, e2, e3, e4])
  for (const e of [e1, e2, e3, e4]) k.release(e)
  let f = k.makeFace(wire)
  k.release(wire)
  // rotate +Z to n (shortest arc) unless already +Z
  const nlen = Math.hypot(n.x, n.y, n.z) || 1
  const nx = n.x / nlen
  const ny = n.y / nlen
  const nz = n.z / nlen
  if (Math.abs(nz - 1) > 1e-12 || Math.abs(nx) > 1e-12 || Math.abs(ny) > 1e-12) {
    // Rodrigues rotation about axis z×n
    const ax = -ny
    const ay = nx
    const alen = Math.hypot(ax, ay)
    if (alen > 1e-12) {
      const angle = Math.acos(Math.max(-1, Math.min(1, nz)))
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const t = 1 - c
      const ux = ax / alen
      const uy = ay / alen
      const uz = 0
      // rotation matrix rows (Rodrigues)
      const m = [
        t * ux * ux + c, t * ux * uy - s * uz, t * ux * uz + s * uy, 0,
        t * ux * uy + s * uz, t * uy * uy + c, t * uy * uz - s * ux, 0,
        t * ux * uz - s * uy, t * uy * uz + s * ux, t * uz * uz + c, 0,
      ]
      f = k.transform(f, m)
    }
  }
  if (base.x || base.y || base.z) {
    const t = k.translate(f, base.x, base.y, base.z)
    k.release(f)
    f = t
  }
  return wrapShape('face', f)
}

/**
 * Face.makeSplineApprox — CadQuery `Face.makeSplineApprox(points)` parity:
 * B-spline surface face through a regular point grid. Reuses the existing
 * `splineFace` op (workplane.ts) which already implements the grid → surface
 * pipeline on the brep chain.
 * @param points - regular point grid [rows][cols]
 * @param tol - approximation tolerance
 * @returns CqShape (face)
 */
export function faceMakeSplineApprox(points: Pt3[][], tol = 1e-3): CqShape {
  const k = kernel()
  if (!points.length || !points[0].length) throw new Error('makeSplineApprox needs a non-empty point grid')
  // Simple case: 1×N or N×1 grid → interpolate an edge, extrude nothing —
  // upstream requires a 2D grid for a surface; a degenerate grid throws.
  if (points.length < 2 || points[0].length < 2) {
    throw new Error('makeSplineApprox needs at least a 2×2 point grid')
  }
  void tol
  void k
  // The full grid→BSplineSurface pipeline lives in workplane.splineFace
  // (async, HostPorts-injected); the sync class-model path builds poles via
  // the kernel's interpolation is not exposed, so delegate is deferred to the
  // consumer. Documented in plan §8 — see Agent Note on the API surface.
  throw new Error('makeSplineApprox sync path not wired — use the splineFace op (async) instead')
}

// ---------------------------------------------------------------------------
// Compound factory (upstream Compound.makeCompound)
// ---------------------------------------------------------------------------

/**
 * Compound.makeCompound — CadQuery `Compound.makeCompound(shapes)` parity:
 * build a compound from a list of shapes (class-model wrappers or bare
 * handles; inputs are borrowed, the compound owns only itself).
 * @param shapes - shapes to aggregate
 * @returns CqShape (compound)
 */
export function makeCompound(shapes: Array<CqShape | ShapeHandle>): CqShape {
  const k = kernel()
  const handles = shapes.map(unwrapShape)
  if (!handles.length) throw new Error('makeCompound needs at least one shape')
  return wrapShape('compound', k.makeCompound(handles))
}

// ---------------------------------------------------------------------------
// Selectors (upstream Shape.shells/solids/compounds + selector classes)
// ---------------------------------------------------------------------------

/**
 * Shape.shells — topological shell extraction.
 * @param s - compound/solid shape (wrapper or handle)
 * @returns borrowed CqShape list
 */
export function shells(s: CqShape | ShapeHandle): CqShape[] {
  const k = kernel()
  return (k.getSubShapes(unwrapShape(s), 'shell') as unknown as ShapeHandle[]).map((h) => borrowShape('shell', h))
}

/**
 * Shape.solids — topological solid extraction.
 * @param s - compound/solid shape (wrapper or handle)
 * @returns borrowed CqShape list
 */
export function solids(s: CqShape | ShapeHandle): CqShape[] {
  const k = kernel()
  return (k.getSubShapes(unwrapShape(s), 'solid') as unknown as ShapeHandle[]).map((h) => borrowShape('solid', h))
}

/**
 * Shape.compounds — nested compound extraction.
 * @param s - shape (wrapper or handle)
 * @returns borrowed CqShape list
 */
export function compounds(s: CqShape | ShapeHandle): CqShape[] {
  const k = kernel()
  // kernel typings omit 'compound' but the runtime supports it (probe-verified)
  const subs = (k.getSubShapes as (h: ShapeHandle, t: string) => ShapeHandle[])(
    unwrapShape(s),
    'compound',
  )
  return subs.map((h) => borrowShape('compound', h))
}

/**
 * Shape.faces — topological face extraction.
 * @param s - shape (wrapper or handle)
 * @returns borrowed CqShape list
 */
export function facesOf(s: CqShape | ShapeHandle): CqShape[] {
  const k = kernel()
  return (k.getSubShapes(unwrapShape(s), 'face') as unknown as ShapeHandle[]).map((h) => borrowShape('face', h))
}

// ---------------------------------------------------------------------------
// Selector class hierarchy (upstream selectors.py, on-demand subset)
// ---------------------------------------------------------------------------

/** Abstract selector: filter a list of class-model shapes. */
export interface Selector {
  filter(items: CqShape[]): CqShape[]
}

/**
 * TypeSelector — upstream `TypeSelector(type)`: keep shapes whose kind matches.
 */
export class TypeSelector implements Selector {
  constructor(private readonly type: CqShape['kind'] | string) {}
  filter(items: CqShape[]): CqShape[] {
    return items.filter((i) => i.kind === this.type)
  }
}

/**
 * DirectionSelector — upstream `DirectionSelector(direction, tolerance)`:
 * keep faces whose outward normal is within tolerance of the given direction
 * (angle < tolerance, default 1e-4 rad — exact parallelism).
 *
 * GOTCHA (probe-verified): the kernel's parametric surface normal
 * (pointOnSurface cross product) does NOT carry the face orientation — all
 * four X-thin faces of two boxes report +X. The sign is disambiguated with
 * `containsPoint` against `context` (the owning solid/compound) by offsetting
 * the face centre along the candidate normal: an offset point INSIDE means
 * the normal flips. Without a context the parametric normal is used as-is.
 */
export class DirectionSelector implements Selector {
  constructor(
    private readonly direction: Pt3,
    private readonly tolerance = 1e-4,
    private readonly context?: CqShape | ShapeHandle,
  ) {}
  filter(items: CqShape[]): CqShape[] {
    const k = kernel()
    const n = norm3(this.direction)
    return items.filter((i) => {
      if (i.kind === 'face') {
        const face = unwrapShape(i)
        const bb = k.getBoundingBox(face)
        const ex = bb.xmax - bb.xmin
        const ey = bb.ymax - bb.ymin
        const ez = bb.zmax - bb.zmin
        // parametric normal at the face centre (u,v midpoint of the UV span)
        const p1 = k.pointOnSurface(face, 0.25, 0.25)
        const p2 = k.pointOnSurface(face, 0.75, 0.25)
        const p3 = k.pointOnSurface(face, 0.25, 0.75)
        const ux = p2.x - p1.x
        const uy = p2.y - p1.y
        const uz = p2.z - p1.z
        const vx = p3.x - p1.x
        const vy = p3.y - p1.y
        const vz = p3.z - p1.z
        let nx = uy * vz - uz * vy
        let ny = uz * vx - ux * vz
        let nz = ux * vy - uy * vx
        const nlen = Math.hypot(nx, ny, nz) || 1
        nx /= nlen
        ny /= nlen
        nz /= nlen
        if (this.context) {
          // sign disambiguation: offset the centre along the normal; inside ⇒ flip
          const cx = (bb.xmin + bb.xmax) / 2
          const cy = (bb.ymin + bb.ymax) / 2
          const cz = (bb.zmin + bb.zmax) / 2
          const eps = Math.min(ex, ey, ez, 1) * 1e-3 + 1e-6
          const probe = { x: cx + nx * eps, y: cy + ny * eps, z: cz + nz * eps }
          if (k.containsPoint(unwrapShape(this.context), probe, 1e-9)) {
            nx = -nx
            ny = -ny
            nz = -nz
          }
        }
        const cos = nx * n.x + ny * n.y + nz * n.z
        return Math.acos(Math.max(-1, Math.min(1, cos))) < this.tolerance
      }
      // non-face shapes: centre-ray comparison
      const bb = k.getBoundingBox(unwrapShape(i))
      const c = { x: (bb.xmin + bb.xmax) / 2, y: (bb.ymin + bb.ymax) / 2, z: (bb.zmin + bb.zmax) / 2 }
      const len = Math.hypot(c.x, c.y, c.z)
      if (len < 1e-12) return false
      const cos = (c.x * n.x + c.y * n.y + c.z * n.z) / len
      return Math.acos(Math.max(-1, Math.min(1, cos))) < this.tolerance
    })
  }
}

/**
 * NearestToPointSelector — upstream `NearestToPointSelector(pnt)`: the single
 * shape whose centre is nearest to the point.
 */
export class NearestToPointSelector implements Selector {
  constructor(private readonly pnt: Pt3) {}
  filter(items: CqShape[]): CqShape[] {
    const k = kernel()
    if (!items.length) return []
    let best = items[0]
    let bestD = Infinity
    for (const i of items) {
      const bb = k.getBoundingBox(i.handle)
      const c = { x: (bb.xmin + bb.xmax) / 2, y: (bb.ymin + bb.ymax) / 2, z: (bb.zmin + bb.zmax) / 2 }
      const d = (c.x - this.pnt.x) ** 2 + (c.y - this.pnt.y) ** 2 + (c.z - this.pnt.z) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return [best]
  }
}

/**
 * StringSyntaxSelector — upstream `StringSyntaxSelector(selector)` subset used
 * by the shape-class mirrors: `>X/<X/>Y/<Y/>Z/<Z` direction extremes over
 * bbox centres and `or` composition (per-term evaluation, union deduplicated).
 */
export class StringSyntaxSelector implements Selector {
  constructor(private readonly expr: string) {}
  filter(items: CqShape[]): CqShape[] {
    const k = kernel()
    const centre = (h: ShapeHandle): Pt3 => {
      const bb = k.getBoundingBox(h)
      return { x: (bb.xmin + bb.xmax) / 2, y: (bb.ymin + bb.ymax) / 2, z: (bb.zmin + bb.zmax) / 2 }
    }
    const dirOf = (tok: string): Pt3 | null => {
      if (/^[<>]{1,2}X$/i.test(tok)) return { x: 1, y: 0, z: 0 }
      if (/^[<>]{1,2}Y$/i.test(tok)) return { x: 0, y: 1, z: 0 }
      if (/^[<>]{1,2}Z$/i.test(tok)) return { x: 0, y: 0, z: 1 }
      const m = /^[<>]{1,2}\(\s*([^,]+),([^,)]+),([^,)]+)/.exec(tok)
      if (m) return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }
      return null
    }
    const evalCond = (els: CqShape[], cond: string): CqShape[] => {
      const dir = dirOf(cond)
      if (!dir) throw new Error('Unsupported selector term: ' + cond)
      const maxSide = cond.startsWith('>')
      let best = maxSide ? -Infinity : Infinity
      const proj = new Map<CqShape, number>()
      for (const el of els) {
        const c = centre(el.handle)
        const v = c.x * dir.x + c.y * dir.y + c.z * dir.z
        proj.set(el, v)
        if (maxSide ? v > best : v < best) best = v
      }
      const TOL = 1e-6
      return els.filter((el) => Math.abs(proj.get(el)! - best) < TOL)
    }
    const groups = this.expr.split(' or ').map((g) => g.trim())
    const seen = new Set<CqShape>()
    const out: CqShape[] = []
    for (const g of groups) {
      for (const el of evalCond(items, g)) {
        if (!seen.has(el)) {
          seen.add(el)
          out.push(el)
        }
      }
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// Shape introspection (upstream Shape.py query methods)
//
// These return values / metadata, not geometry — they are the "silent gap"
// audited in 2026-10-02-cadquery-port-gap-audit.md §3.1 (P1). The occt-wasm
// kernel already exposes every primitive (getVolume / getSurfaceArea /
// getLength / getCenterOfMass / getBoundingBox / isValid / getShapeType — see
// occt-primitives.ts:408-414 + 322), so parity here is a matter of exposing
// them on the class model, NOT of building new kernel capability. Values are
// verified against a one-time CadQuery 2.8.0 reference capture
// (tests/ref-harness/shape-introspection-probe.py) and frozen into
// src/shape-class.test.ts — see audit §5.1 (one-shot Python capture → TS
// assertion), never a per-run probe channel.
// ---------------------------------------------------------------------------

/** Axis-aligned bounding box (mirrors occt-wasm `BoundingBox`). */
export interface CqBBox {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  zmin: number
  zmax: number
}

/** Kernel surface for the introspection primitives used below. */
interface IntrospectKernel {
  getBoundingBox(h: ShapeHandle, useTriangulation?: boolean): CqBBox
  getVolume(h: ShapeHandle): number
  getSurfaceArea(h: ShapeHandle): number
  getLength(h: ShapeHandle): number
  getCenterOfMass(h: ShapeHandle): Pt3
  isValid(h: ShapeHandle): boolean
  getShapeType(h: ShapeHandle): string
  surfaceType(h: ShapeHandle): string
  curveType(h: ShapeHandle): string
}

function introspect(): IntrospectKernel {
  return kernel() as unknown as IntrospectKernel
}

/**
 * `Shape.BoundingBox()` — axis-aligned extent of the shape.
 * @param s - shape (wrapper or handle)
 * @returns the bounding box
 */
export function boundingBoxOf(s: CqShape | ShapeHandle): CqBBox {
  return introspect().getBoundingBox(unwrapShape(s))
}

/**
 * `Shape.Volume()` — solid/compound volume (mm³).
 * @param s - shape (wrapper or handle)
 * @returns volume
 */
export function volumeOf(s: CqShape | ShapeHandle): number {
  return introspect().getVolume(unwrapShape(s))
}

/**
 * `Shape.Area()` — surface area (mm²). For a face this is the face area; for a
 * solid/compound the total surface area.
 * @param s - shape (wrapper or handle)
 * @returns surface area
 */
export function areaOf(s: CqShape | ShapeHandle): number {
  return introspect().getSurfaceArea(unwrapShape(s))
}

/**
 * `Shape.Length()` — cumulative edge length (mm). For an edge this is its span;
 * for a wire/solid the sum of its edges.
 * @param s - shape (wrapper or handle)
 * @returns length
 */
export function lengthOf(s: CqShape | ShapeHandle): number {
  return introspect().getLength(unwrapShape(s))
}

/**
 * `Shape.Center()` — center of mass (mm). For a uniform solid/face this equals
 * the geometric center.
 * @param s - shape (wrapper or handle)
 * @returns center of mass
 */
export function centerOfMassOf(s: CqShape | ShapeHandle): Pt3 {
  return introspect().getCenterOfMass(unwrapShape(s))
}

/**
 * `Shape.isValid()`.
 * @param s - shape (wrapper or handle)
 * @returns true when the underlying BREP is valid
 */
export function isValidShape(s: CqShape | ShapeHandle): boolean {
  return introspect().isValid(unwrapShape(s))
}

/** Map occt-wasm `ShapeType` → CadQuery `geomType()` uppercase codes. */
const GEOM_TYPE_MAP: Record<string, string> = {
  compound: 'COMPOUND',
  compsolid: 'COMPSOLID',
  solid: 'SOLID',
  shell: 'SHELL',
  face: 'FACE',
  wire: 'WIRE',
  edge: 'EDGE',
  vertex: 'VERTEX',
  shape: 'SHAPE',
}

/**
 * `Shape.geomType()` — mirrors CadQuery's **heterogeneous** semantics
 * (probe-verified against CadQuery 2.8.0, see
 * `tests/ref-harness/shape-introspection-probe.py`):
 *  - solid / compound / shell / wire / vertex → the **TopAbs** type, uppercased
 *    (`'SOLID'` / `'SHELL'` / …);
 *  - **face → the SURFACE type** (`'PLANE'` / `'CYLINDER'` / `'BSPLINE'` / …);
 *  - **edge → the CURVE type** (`'LINE'` / `'CIRCLE'` / `'BSPLINE'` / …).
 *
 * GOTCHA: CadQuery `cq.Solid.makeBox(1,1,1)` reports `'COMPSOLID'` (its box
 * construction wraps the OCC solid as a comp-solid); faijs `makeBox` yields a
 * genuine `'SOLID'`. The two are the same geometry — only the TopAbs tag
 * differs, a CadQuery-side quirk, not a faijs defect.
 *
 * @param s - shape (wrapper or handle)
 * @returns the geometry type code
 */
export function geomTypeOf(s: CqShape | ShapeHandle): string {
  const h = unwrapShape(s)
  const t = introspect().getShapeType(h)
  if (t === 'face') return introspect().surfaceType(h).toUpperCase()
  if (t === 'edge') return introspect().curveType(h).toUpperCase()
  return GEOM_TYPE_MAP[t] ?? t.toUpperCase()
}

/** Normalise a 3D direction vector. */
function norm3(v: Pt3): Pt3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}
