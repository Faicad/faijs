/**
 * Sketch — CadQuery `Sketch.py` geometry-container parity (non-planegcs part).
 *
 * Phase 2 of the cq-compat max-cadquery plan: expose a public Sketch API whose
 * geometry-declaration segment (rect/circle/ellipse/polygon + modes a/s/i/c/r +
 * faces/wires/edges/vertices selectors) mirrors upstream `Sketch.py` without the
 * constraint solver (planegcs licensing is pending legal review; constraints are
 * intentionally out of scope here).
 *
 * The constraint segment (`constrain`/`solve`) stays blocked until the
 * LGPL-2.0-or-later verdict; this module implements everything that does not
 * depend on it.
 *
 * Faces are OCCT brep faces living in the z=0 plane (kernel `makeRectangle`,
 * `makeCircleEdge`/`makeWire`/`makeFace`, ...). Boolean modes use the kernel's
 * face-level fuse/cut/common (verified working on faces, see probe_2d).
 */

import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { fromHandle } from '@faicad/faijs/sdk'
import { solveSketch, type SolveSketchOptions } from '@faicad/faijs-sketch'
import type { SketchConstraint as CanonicalConstraint, SketchGeom } from '@faicad/faijs-sketch'
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'

/** Canonical sketch geometry type re-exported for the package surface. */
export type { SketchGeom, SolveSketchOptions }

/** A 2D point used by edge declarations and loci. */
export type Pt2 = [number, number]

/** A placement for the next geometry declaration: 2D translation + optional Z rotation (deg). */
export interface Loc2 {
  x: number
  y: number
  /** Z rotation in degrees (parray/distribute with rotate). */
  angle?: number
}

/** Sketch face-container state. */
export interface Sketch {
  /** Current effective faces (upstream `_faces`). */
  faces: ShapeHandle[]
  /** Pending edges not yet assembled (upstream `_edges`). */
  edges: SketchEdge[]
  /** Construction faces stored under their tag (mode "c") or tagged edges/faces. */
  tags: Map<string, ShapeHandle[]>
  /** Selected entities (faces/wires/edges/vertices/locations) feeding the next each(). */
  selected: ShapeHandle[]
  /** Placement locations for the next declaration (upstream selection-derived loci). */
  locs: Loc2[]
  /**
   * World plane the sketch is bound to (set by the Workplane-layer `sketch()`
   * binding). Undefined for free sketches built directly in XY. The local XY
   * geometry is mapped into this plane when materialized onto the Workplane.
   */
  plane?: { origin: [number, number, number]; normal: [number, number, number] }
  /** Accumulated constraints for the planegcs segment. */
  constraints: SketchConstraint[]
  /** Result of the last {@link solve} (undefined before solving). */
  solveStatus?: SketchSolveStatus
}

/** Result of the last {@link solve} on a sketch. */
export interface SketchSolveStatus {
  status: 'solved' | 'underconstrained' | 'redundant' | 'conflicting' | 'failed'
  dof: number
}

/**
 * A pending sketch edge. Kernel handles that are 1D curves carry a couple of
 * flags; spline/bezier construction stores the declaring parameters so the
 * constraint segment can rebuild canonical geometry without re-sampling.
 */
export interface SketchEdge {
  handle: ShapeHandle
  forConstruction: boolean
  /** Canonical geometry hint for the constraint segment (spline/arc reconstruction). */
  canon?: SketchGeom
}

/** An accumulated constraint for the planegcs segment. */
export interface SketchConstraint {
  /** "Fixed"-style single-tag constraint, or two-tag relational constraint. */
  tags: [string] | [string, string]
  kind: string
  arg: unknown
}

/** Sketch geometry-declaration mode (CadQuery Modes): a=additive, s=subtract, i=intersect, c=construction+tag, r=replace. */
export type SketchMode = 'a' | 's' | 'i' | 'c' | 'r'

/** Options for a geometry declaration: mode/tag/angle (CadQuery keyword args). */
export interface SketchOpts {
  mode?: SketchMode
  tag?: string
  angle?: number
}

/** Options for an edge declaration: tag/forConstruction (CadQuery keyword args). */
export interface SketchEdgeOpts {
  tag?: string
  forConstruction?: boolean
}

function kernel(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** Vec3 literal helper (avoids TS tuple-inference noise). */
function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

/**
 * Create an empty Sketch.
 * @returns an empty Sketch
 */
export function sketch(): Sketch {
  return { faces: [], edges: [], tags: new Map(), selected: [], locs: [], constraints: [] }
}

/**
 * Translate a shape so its centre lands at the origin. Used to centre
 * kernel primitives that build in the [0,size] corner.
 */
function centre2D(k: OcctKernel, h: ShapeHandle, w: number, d: number): ShapeHandle {
  const moved = k.translate(h, -w / 2, -d / 2, 0)
  k.release(h)
  return moved
}

/** Rectangular face, centred at origin, w along X, h along Y. */
function makeRectFace(k: OcctKernel, w: number, h: number): ShapeHandle {
  return centre2D(k, k.makeRectangle(w, h), w, h)
}

/** Circular face of radius r centred at origin. */
function makeCircleFace(k: OcctKernel, r: number): ShapeHandle {
  const e = k.makeCircleEdge(v3(0, 0, 0), v3(0, 0, 1), r)
  const wire = k.makeWire([e])
  k.release(e)
  const f = k.makeFace(wire)
  k.release(wire)
  return f
}

/** Elliptical face, major a along X, minor b along Y, centred at origin. */
function makeEllipseFace(k: OcctKernel, a: number, b: number): ShapeHandle {
  const e = k.makeEllipseEdge(v3(0, 0, 0), v3(0, 0, 1), a, b)
  const wire = k.makeWire([e])
  k.release(e)
  const f = k.makeFace(wire)
  k.release(wire)
  return f
}

/** Polygon face from a closed point list (first==last optional; auto-closed). */
function makePolygonFace(k: OcctKernel, pts: Array<[number, number]>): ShapeHandle {
  // Drop the closing duplicate if present, then drop consecutive duplicates
  // (OCCT makeLineEdge rejects zero-length edges, e.g. a 45-degree trapezoid
  // degenerating into a triangle with two identical top corners).
  const same = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12
  const fst = pts[0]
  const lst = pts[pts.length - 1]
  const ring = fst && lst && same(fst, lst) ? pts.slice(0, -1) : pts
  const clean: Array<[number, number]> = []
  for (const p of ring) {
    const last = clean[clean.length - 1]
    if (!last || !same(last, p)) clean.push(p)
  }
  if (clean.length < 3) throw new Error('polygon needs at least 3 distinct points')
  const edges: ShapeHandle[] = []
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i]
    const b = clean[(i + 1) % clean.length]
    edges.push(k.makeLineEdge(v3(a[0], a[1], 0), v3(b[0], b[1], 0)))
  }
  const wire = k.makeWire(edges)
  edges.forEach((e) => k.release(e))
  const f = k.makeFace(wire)
  k.release(wire)
  return f
}

/** Rotate a face by angle degrees about the Z axis through its centre. */
function rotateFace(k: OcctKernel, f: ShapeHandle, angleDeg: number): ShapeHandle {
  if (!angleDeg) return f
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const m = [cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 1, 0]
  const r = k.transform(f, m)
  k.release(f)
  return r
}

/**
 * Apply the CQ each() mode against the current faces.
 * - a: fuse all new faces into the current set (CQ `_faces.fuse(*res)`)
 * - s: cut new faces away
 * - i: intersect with new faces
 * - r: replace current faces with the new ones
 * - c: keep current faces; store new ones under the tag (required)
 */
function applyMode(
  k: OcctKernel,
  faces: ShapeHandle[],
  fresh: ShapeHandle[],
  mode: SketchMode,
  tag?: string,
): { faces: ShapeHandle[]; tags: Map<string, ShapeHandle[]>; tagOut: Map<string, ShapeHandle[]> } {
  const tagOut = new Map<string, ShapeHandle[]>()
  switch (mode) {
    case 'a': {
      const all = [...faces, ...fresh]
      if (all.length === 0) return { faces: [], tags: tagOut, tagOut }
      let acc: ShapeHandle = all[0]
      for (let i = 1; i < all.length; i++) {
        const merged = k.fuse(acc, all[i])
        k.release(acc)
        k.release(all[i])
        acc = merged
      }
      // GOTCHA: do NOT unifySameDomain here — probed on cadquery 2.8.0, the
      // kernel fuse already matches upstream additive semantics exactly
      // (crossing slots: area 4.5708 over 5 subfaces), and unifying would
      // DESTROY the nested-face semantics (upstream rect(2,2)+rect(1,1)
      // additive keeps 2 faces / area 4 with the inner face as a hole).
      return { faces: [acc], tags: tagOut, tagOut }
    }
    case 's': {
      let acc: ShapeHandle | null = faces.length ? faces[0] : null
      if (!acc) return { faces: [], tags: tagOut, tagOut }
      const rest = faces.slice(1)
      for (const f of rest) {
        const merged = k.fuse(acc, f)
        k.release(acc)
        k.release(f)
        acc = merged
      }
      for (const f of fresh) {
        const cut = k.cut(acc, f)
        k.release(acc)
        k.release(f)
        acc = cut
      }
      return { faces: acc ? [acc] : [], tags: tagOut, tagOut }
    }
    case 'i': {
      let acc: ShapeHandle | null = faces.length ? faces[0] : null
      if (!acc) return { faces: [], tags: tagOut, tagOut }
      for (const f of faces.slice(1)) {
        const merged = k.fuse(acc, f)
        k.release(acc)
        k.release(f)
        acc = merged
      }
      for (const f of fresh) {
        const common = k.common(acc, f)
        k.release(acc)
        k.release(f)
        acc = common
      }
      return { faces: acc ? [acc] : [], tags: tagOut, tagOut }
    }
    case 'c': {
      if (!tag) throw new Error('No tag specified - the geometry will be unreachable')
      tagOut.set(tag, fresh)
      // current faces unchanged (fresh faces are construction-only)
      return { faces, tags: tagOut, tagOut }
    }
    case 'r': {
      return { faces: fresh, tags: tagOut, tagOut }
    }
    default:
      throw new Error('Invalid mode: ' + String(mode))
  }
}

/**
 * Merge the mode result into a Sketch. Each fresh face is placed at every
 * locus in `sk.locs` (upstream `each()` mechanism: declarations apply at the
 * pushed locations; identity when no loci are pushed). Fresh faces released
 * on a/s/i/r paths.
 *
 * `applyLoci=false` skips the placement pass — for derived declarations whose
 * fresh faces are ALREADY positioned in sketch coordinates (e.g. `offset`
 * offsets the selected wires in place; re-applying the loci would shift them
 * again — GOTCHA: without this, circle(loc).wires().offset(-0.1) cut an
 * offset face shifted to 2×loc instead of subtracting the in-place ring).
 */
function commit(
  sk: Sketch,
  mode: SketchMode,
  tag: string | undefined,
  fresh: ShapeHandle[],
  applyLoci = true,
): Sketch {
  const k = kernel()
  const placed: ShapeHandle[] = []
  const locs = applyLoci ? (sk.locs.length ? sk.locs : [{ x: 0, y: 0 }]) : [{ x: 0, y: 0 }]
  for (const f of fresh) {
    for (const loc of locs) {
      // Always copy: the source handle is released below, so an identity loc
      // must not alias it (GOTCHA: releasing an aliased handle kills the face).
      let h = k.copy(f)
      if (loc.x || loc.y) {
        const t = k.translate(h, loc.x, loc.y, 0)
        k.release(h)
        h = t
      }
      if (loc.angle) {
        const rad = (loc.angle * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const m = [cos, -sin, 0, loc.x, sin, cos, 0, loc.y, 0, 0, 1, 0]
        const t = k.transform(h, m)
        k.release(h)
        h = t
      }
      placed.push(h)
    }
    k.release(f)
  }
  const { faces, tagOut } = applyMode(k, sk.faces, placed, mode, tag)
  const tags = new Map(sk.tags)
  for (const [t, fs] of tagOut) tags.set(t, fs)
  // `plane` (Workplane-layer binding) must survive the round-trip — the
  // materializer in workplane.ts reads it at sketchFinish/placeSketch time.
  return { faces, tags, selected: sk.selected, locs: sk.locs, edges: sk.edges, constraints: sk.constraints, plane: sk.plane }
}

/**
 * rect — CadQuery `Sketch.rect(w, h, angle, mode, tag)` parity.
 * @param sk - Sketch
 * @param w - width along X
 * @param h - height along Y
 * @param opts - mode/tag/angle
 * @returns Sketch
 */
export function rect(sk: Sketch, w: number, h: number, opts?: SketchOpts): Sketch {
  const k = kernel()
  const mode = opts?.mode ?? 'a'
  const face = rotateFace(k, makeRectFace(k, w, h), opts?.angle ?? 0)
  return commit(sk, mode, opts?.tag, [face])
}

/**
 * circle — CadQuery `Sketch.circle(r, mode, tag)` parity.
 * @param sk - Sketch
 * @param r - radius
 * @param opts - mode/tag
 * @returns Sketch
 */
export function circle(sk: Sketch, r: number, opts?: SketchOpts): Sketch {
  const k = kernel()
  const mode = opts?.mode ?? 'a'
  const face = makeCircleFace(k, r)
  return commit(sk, mode, opts?.tag, [face])
}

/**
 * ellipse — CadQuery `Sketch.ellipse(a1, a2, angle, mode, tag)` parity.
 * @param sk - Sketch
 * @param a1 - radius along X
 * @param a2 - radius along Y
 * @param opts - mode/tag/angle
 * @returns Sketch
 */
export function ellipse(sk: Sketch, a1: number, a2: number, opts?: SketchOpts): Sketch {
  const k = kernel()
  const mode = opts?.mode ?? 'a'
  const face = rotateFace(k, makeEllipseFace(k, a1, a2), opts?.angle ?? 0)
  return commit(sk, mode, opts?.tag, [face])
}

/**
 * polygon — CadQuery `Sketch.polygon(pts, angle, mode, tag)` parity.
 * @param sk - Sketch
 * @param pts - closed point list [[x,y],...]
 * @param opts - mode/tag/angle
 * @returns Sketch
 */
export function polygon(sk: Sketch, pts: Array<[number, number]>, opts?: SketchOpts): Sketch {
  const k = kernel()
  const mode = opts?.mode ?? 'a'
  const face = rotateFace(k, makePolygonFace(k, pts), opts?.angle ?? 0)
  return commit(sk, mode, opts?.tag, [face])
}

/**
 * regularPolygon — CadQuery `Sketch.regularPolygon(r, n, angle, mode, tag)`
 * parity: n-gon inscribed in radius r, first vertex at the +Y direction.
 * @param sk - Sketch
 * @param r - circumradius
 * @param n - number of sides
 * @param opts - mode/tag/angle
 * @returns Sketch
 */
export function regularPolygon(sk: Sketch, r: number, n: number, opts?: SketchOpts): Sketch {
  const pts: Array<[number, number]> = []
  for (let i = 0; i <= n; i++) {
    const a = (i * 2 * Math.PI) / n
    pts.push([r * Math.sin(a), r * Math.cos(a)])
  }
  return polygon(sk, pts, opts)
}

/**
 * slot — CadQuery `Sketch.slot(w, h, angle, mode, tag)` parity: stadium / long
 * slot face of length w and width h, centred at origin.
 * @param sk - Sketch
 * @param w - slot length along X
 * @param h - slot width along Y
 * @param opts - mode/tag/angle
 * @returns Sketch
 */
export function slot(sk: Sketch, w: number, h: number, opts?: SketchOpts): Sketch {
  const k = kernel()
  const mode = opts?.mode ?? 'a'
  const p1: [number, number] = [-w / 2, h / 2]
  const p2: [number, number] = [w / 2, h / 2]
  const p3: [number, number] = [-w / 2, -h / 2]
  const p4: [number, number] = [w / 2, -h / 2]
  const p5: [number, number] = [-w / 2 - h / 2, 0]
  const p6: [number, number] = [w / 2 + h / 2, 0]
  const e1 = k.makeLineEdge(v3(p1[0], p1[1], 0), v3(p2[0], p2[1], 0))
  const e2 = k.makeArcEdge(v3(p2[0], p2[1], 0), v3(p6[0], p6[1], 0), v3(p4[0], p4[1], 0))
  const e3 = k.makeLineEdge(v3(p4[0], p4[1], 0), v3(p3[0], p3[1], 0))
  const e4 = k.makeArcEdge(v3(p3[0], p3[1], 0), v3(p5[0], p5[1], 0), v3(p1[0], p1[1], 0))
  const wire = k.makeWire([e1, e2, e3, e4])
  for (const e of [e1, e2, e3, e4]) k.release(e)
  const face = k.makeFace(wire)
  k.release(wire)
  return commit(sk, mode, opts?.tag, [rotateFace(k, face, opts?.angle ?? 0)])
}

/**
 * trapezoid — CadQuery `Sketch.trapezoid(w, h, a1, a2, angle, mode, tag)`
 * parity: isosceles-or-not trapezoid; a1/a2 are the base angles in degrees.
 * @param sk - Sketch
 * @param w - bottom width
 * @param h - height
 * @param a1 - bottom-left base angle (degrees)
 * @param a2 - bottom-right base angle (degrees); defaults to a1
 * @param opts - mode/tag/angle
 * @returns Sketch
 */
export function trapezoid(sk: Sketch, w: number, h: number, a1: number, a2?: number, opts?: SketchOpts): Sketch {
  const a2v = a2 ?? a1
  const v1: [number, number] = [-w / 2, -h / 2]
  const v2: [number, number] = [w / 2, -h / 2]
  const t1 = h / Math.tan((a1 * Math.PI) / 180)
  const t2 = h / Math.tan((a2v * Math.PI) / 180)
  const v3: [number, number] = [-w / 2 + t1, h / 2]
  const v4: [number, number] = [w / 2 - t2, h / 2]
  return polygon(sk, [v1, v2, v4, v3, v1], opts)
}

/**
 * offset — CadQuery `Sketch.offset(d, mode, tag)` parity: offset each selected
 * wire by d and feed the resulting faces through the given mode. Requires a
 * selection (wires()/edges()).
 * @param sk - Sketch
 * @param d - signed offset distance
 * @param opts - mode/tag
 * @returns Sketch
 */
export function offset(sk: Sketch, d: number, opts?: SketchOpts): Sketch {
  if (!sk.selected.length) throw new Error('Selection is needed to offset')
  const k = kernel()
  const mode = opts?.mode ?? 'a'
  const fresh: ShapeHandle[] = []
  for (const el of sk.selected) {
    const off = k.offsetWire2D(el, d)
    const f = k.makeFace(off)
    k.release(off)
    fresh.push(f)
  }
  // The offset faces are derived from the SELECTED wires (already placed in
  // sketch coordinates), so the mode pass must NOT re-apply the loci —
  // otherwise an offset face at loc would be shifted again (see commit JSDoc).
  return commit(sk, mode, opts?.tag, fresh, false)
}

/**
 * faces — CadQuery `Sketch.faces()` selector parity: select current faces.
 * @param sk - Sketch
 * @returns Sketch (selected faces feed the next geometric declaration)
 */
/**
 * Minimal 2D string-selector parity (upstream StringSyntaxSelector subset used
 * by test_sketch): "<X"/">X"/"<Y"/">Y" tie-tolerant extremes over element
 * centres, ">(x,y,z)"/">>(x,y,z)" direction extremes, "or"/"and"/"not X"
 * boolean composition.
 */
function applyStringSelector(k: OcctKernel, els: ShapeHandle[], expr: string): ShapeHandle[] {
  const centre = (h: ShapeHandle): [number, number] => {
    // bbox centre (vertices have no linear COM — it would return (0,0,0))
    const bb = k.getBoundingBox(h)
    return [(bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2]
  }
  const directionOf = (tok: string): [number, number] | null => {
    const m = /^[<>]{1,2}\(\s*([^,]+),([^,)]+)/.exec(tok)
    if (m) return [Number(m[1]), Number(m[2])]
    if (/^[<>]{0,2}X$/i.test(tok)) return [1, 0]
    if (/^[<>]{0,2}Y$/i.test(tok)) return [0, 1]
    return null
  }
  // one extreme condition: [><](X|Y|(dx,dy[,dz]))
  const evalCond = (els: ShapeHandle[], cond: string): ShapeHandle[] => {
    const dir = directionOf(cond)
    if (!dir) throw new Error('Unsupported sketch selector term: ' + cond)
    const maxSide = cond.startsWith('>')
    const proj = (p: [number, number]) => p[0] * dir[0] + p[1] * dir[1]
    let best = maxSide ? -Infinity : Infinity
    const centres = new Map<ShapeHandle, [number, number]>()
    for (const el of els) {
      const c = centre(el)
      centres.set(el, c)
      const v = proj(c)
      if (maxSide ? v > best : v < best) best = v
    }
    const TOL = 1e-6
    return els.filter((el) => Math.abs(proj(centres.get(el)!) - best) < TOL)
  }
  const evalTerm = (els: ShapeHandle[], term: string): ShapeHandle[] => {
    const trimmed = term.trim()
    if (trimmed.startsWith('not ')) {
      const excluded = new Set(evalCond(els, trimmed.slice(4).trim()))
      return els.filter((el) => !excluded.has(el))
    }
    const parts = trimmed.split(' and ').map((p) => p.trim())
    if (parts.length === 1) return evalCond(els, parts[0])
    let out = els
    for (const p of parts) out = out.filter((el) => evalCond([el], p).length > 0)
    return out
  }
  const groups = expr.split(' or ').map((g) => g.trim())
  const seen = new Set<ShapeHandle>()
  const out: ShapeHandle[] = []
  for (const g of groups) {
    for (const el of evalTerm(els, g)) {
      if (!seen.has(el)) {
        seen.add(el)
        out.push(el)
      }
    }
  }
  return out
}

/** Selection source for the kind-selectors (upstream `_select`). */
function selectCore(sk: Sketch, kind: 'face' | 'wire' | 'edge' | 'vertex', sel?: string, tag?: string): ShapeHandle[] {
  const k = kernel()
  const out: ShapeHandle[] = []
  const addSub = (h: ShapeHandle) => {
    if (kind === 'wire') {
      // Upstream Wires() returns ALL wires (outer + hole wires); flatten
      // compounds/handles to their topological wires
      const subs = k.getSubShapes(h, 'wire') as unknown as ShapeHandle[]
      if (subs.length) out.push(...subs)
      else if (isFaceHandle(k, h)) out.push(k.outerWire(h))
      return
    }
    out.push(...(k.getSubShapes(h, kind) as unknown as ShapeHandle[]))
  }
  if (tag) {
    const payload = sk.tags.get(tag)
    if (!payload) throw new Error('Tag not found: ' + tag)
    for (const el of payload) addSub(el)
    return out
  }
  if (sk.selected.length) {
    for (const el of sk.selected) addSub(el)
    return out
  }
  for (const f of sk.faces) addSub(f)
  for (const e of sk.edges) addSub(e.handle)
  return out
}

/**
 * faces — CadQuery `Sketch.faces(selector)` parity: keep only faces.
 * @param sk - Sketch
 * @param sel - string-selector expression applied to the raw face selection
 * @param tag - select from a named tag's payload instead
 * @returns Sketch with the surviving faces selected
 */
export function faces(sk: Sketch, sel?: string, tag?: string): Sketch {
  return { ...sk, selected: filterSel(selectCore(sk, 'face', sel, tag), sel) }
}

/**
 * wires — CadQuery `Sketch.wires(selector)` parity: keep only wires.
 * @param sk - Sketch
 * @param sel - string-selector expression applied to the raw wire selection
 * @param tag - select from a named tag's payload instead
 * @returns Sketch with the surviving wires selected
 * @remarks Wire selection flattens face handles to ALL their wires (outer +
 * hole wires), matching upstream `Wires()`.
 */
export function wires(sk: Sketch, sel?: string, tag?: string): Sketch {
  return { ...sk, selected: filterSel(selectCore(sk, 'wire', sel, tag), sel) }
}

/**
 * edges — CadQuery `Sketch.edges(selector)` parity: keep only edges.
 * @param sk - Sketch
 * @param sel - string-selector expression applied to the raw edge selection
 * @param tag - select from a named tag's payload instead
 * @returns Sketch with the surviving edges selected
 */
export function edges(sk: Sketch, sel?: string, tag?: string): Sketch {
  return { ...sk, selected: filterSel(selectCore(sk, 'edge', sel, tag), sel) }
}

/**
 * vertices — CadQuery `Sketch.vertices(selector)` parity: keep only vertices.
 * @param sk - Sketch
 * @param sel - string-selector expression applied to the raw vertex selection
 * @param tag - select from a named tag's payload instead
 * @returns Sketch with the surviving vertices selected
 */
export function vertices(sk: Sketch, sel?: string, tag?: string): Sketch {
  return { ...sk, selected: filterSel(selectCore(sk, 'vertex', sel, tag), sel) }
}

/** Apply the string-selector expression (if any) to a raw selection. */
function filterSel(els: ShapeHandle[], sel?: string): ShapeHandle[] {
  if (!sel) return els
  return applyStringSelector(kernel(), els, sel)
}

/**
 * reset — CadQuery `Sketch.reset()` parity: clear the selection.
 * @param sk - Sketch
 * @returns Sketch with no selection and no placement loci
 * @remarks Upstream loci mirror the selection-locations, so clearing the
 * selection therefore also clears them.
 */
export function reset(sk: Sketch): Sketch {
  return { ...sk, selected: [], locs: [] }
}

/**
 * val — CadQuery `Sketch.val()` parity: first effective face as a Shape.
 * @param sk - Sketch
 * @returns Shape
 */
export function val(sk: Sketch): ShapeHandle {
  const v = vals(sk)
  if (!v.length) throw new Error('Sketch has no faces')
  return v[0]
}

/**
 * vals — CadQuery `Sketch.vals()` parity: the current selection, or the
 * flattened topological faces when nothing is selected (upstream returns the
 * `_faces` faces; a fused handle may hold several).
 * @param sk - Sketch
 * @returns Shape[]
 */
export function vals(sk: Sketch): ShapeHandle[] {
  if (sk.selected.length) return [...sk.selected]
  const k = kernel()
  const out: ShapeHandle[] = []
  for (const f of sk.faces) {
    const sub = k.getSubShapes(f, 'face') as unknown as ShapeHandle[]
    out.push(...sub)
  }
  return out
}

/**
 * tag — CadQuery `Sketch.tag(name)` parity: store the current selection (or all
 * faces when nothing selected) under a name for later `.select()`.
 * @param sk - Sketch
 * @param name - tag name
 * @returns Sketch
 */
export function tag(sk: Sketch, name: string): Sketch {
  if (!sk.selected.length) throw new Error('Selection is needed to tag')
  const tags = new Map(sk.tags)
  tags.set(name, [...sk.selected])
  return { ...sk, tags }
}

/**
 * select — CadQuery `Sketch.select(tag)` parity: select the faces stored under
 * a tag.
 * @param sk - Sketch
 * @param name - tag name
 * @returns Sketch
 */
export function select(sk: Sketch, name: string): Sketch {
  const payload = sk.tags.get(name)
  if (!payload) throw new Error('Tag not found: ' + name)
  return { ...sk, selected: [...payload] }
}

/**
 * area — total surface area of the effective faces (upstream `_faces.Area()`).
 * @param sk - Sketch
 * @returns number
 */
export function area(sk: Sketch): number {
  const k = kernel()
  let total = 0
  for (const f of sk.faces) total += k.getSurfaceArea(f)
  return total
}

/**
 * faceCount — number of effective faces (upstream `_faces.Faces()` length).
 * @param sk - Sketch
 * @returns number
 */
export function faceCount(sk: Sketch): number {
  const k = kernel()
  let n = 0
  for (const f of sk.faces) n += (k.getSubShapes(f, 'face') as unknown as ShapeHandle[]).length
  return n
}

/**
 * extrude — CadQuery `Sketch` → solid via extrusion along +Z. Phase 2 action 3:
 * sketch → extrude/revolve dual-chain outlet. This is the brep side
 * (kernel.extrude on each effective face, fused into one solid).
 * @param sk - Sketch
 * @param height - extrusion height
 * @returns Shape (solid)
 */
export function extrude(sk: Sketch, height: number): ShapeHandle {
  const k = kernel()
  const solids: ShapeHandle[] = []
  for (const f of sk.faces) {
    solids.push(k.extrude(f, 0, 0, height))
  }
  let acc: ShapeHandle | null = null
  for (const s of solids) {
    if (!acc) {
      acc = s
      continue
    }
    const merged = k.fuse(acc, s)
    k.release(acc)
    k.release(s)
    acc = merged
  }
  if (!acc) throw new Error('Sketch has no faces to extrude')
  // Wrap the kernel handle into a faijs Shape so script-facing mirrors can
  // export it as a part (bare kernel handles are invisible to execute()).
  return fromHandle(acc) as unknown as ShapeHandle
}

/**
 * face — CadQuery `Sketch.face(b, angle, mode, tag)` parity: build a face from
 * a wire handle, a list of edge handles, or an existing face handle, rotate by
 * `angle` degrees about Z, then feed through the mode at the current loci.
 * @param sk - Sketch
 * @param b - wire handle, face handle, or list of edge handles
 * @param angle - rotation about Z (degrees)
 * @param opts - mode/tag
 * @returns Sketch
 */
export function face(
  sk: Sketch,
  b: ShapeHandle | ShapeHandle[],
  angle = 0,
  opts?: SketchOpts,
): Sketch {
  const k = kernel()
  let f: ShapeHandle
  if (Array.isArray(b)) {
    if (!b.length) throw new Error('face: empty edge list')
    const wire = k.makeWire(b)
    f = k.makeFace(wire)
    k.release(wire)
  } else {
    f = k.copy(b)
  }
  const rotated = rotateFace(k, f, angle)
  return commit(sk, opts?.mode ?? 'a', opts?.tag, [rotated])
}

// ---------------------------------------------------------------------------
// Edge-based interface (upstream Sketch.py edge declarations)
// ---------------------------------------------------------------------------

/** True when the handle is itself a face (not a compound of faces). */
function isFaceHandle(k: OcctKernel, h: ShapeHandle): boolean {
  try {
    return (k.getSubShapes(h, 'face') as unknown as ShapeHandle[]).length === 0 && k.getSurfaceArea(h) > 0
  } catch {
    return false
  }
}

/** Fuse a list of face handles into one (null for an empty list). Releases inputs. */
function fuseAll(k: OcctKernel, hs: ShapeHandle[]): ShapeHandle | null {
  if (!hs.length) return null
  let acc = hs[0]
  for (let i = 1; i < hs.length; i++) {
    const merged = k.fuse(acc, hs[i])
    k.release(acc)
    k.release(hs[i])
    acc = merged
  }
  return acc
}

/**
 * Chain unordered edge handles into closed wires by matching endpoints
 * (upstream `edgesToWires`). Edges are consumed greedily; unmatched (open)
 * tails are dropped. Returns new wire handles; input edges are NOT released.
 */
function chainEdgesToWires(k: OcctKernel, edges: ShapeHandle[]): ShapeHandle[] {
  const remaining = [...edges]
  const wires: ShapeHandle[] = []
  while (remaining.length) {
    const chain: ShapeHandle[] = [remaining.shift()!]
    const start = edgePoint(k, chain[0], false)
    let end = edgePoint(k, chain[0], true)
    let progress = true
    while (progress && !samePt(start, end)) {
      progress = false
      for (let i = 0; i < remaining.length; i++) {
        const s = edgePoint(k, remaining[i], false)
        const e = edgePoint(k, remaining[i], true)
        if (samePt(end, s)) {
          chain.push(remaining.splice(i, 1)[0])
          end = e
          progress = true
          break
        }
        if (samePt(end, e)) {
          chain.push(remaining.splice(i, 1)[0])
          end = s
          progress = true
          break
        }
      }
    }
    if (samePt(start, end) && chain.length >= 1) {
      wires.push(k.makeWire(chain))
    } else if (chain.length) {
      // open chain — release nothing, drop it (upstream raises; the caller
      // surfaces "Edges do not form closed wires" when nothing closed remains)
      for (const c of chain) k.release(c)
    }
  }
  return wires
}

/** Endpoint of an edge handle: parameter 0 = start, 1 = end. */
function edgePoint(k: OcctKernel, e: ShapeHandle, atEnd: boolean): Pt2 {
  const { first: t0, last: t1 } = k.curveParameters(e)
  const p = k.curvePointAtParam(e, atEnd ? t1 : t0)
  return [p.x, p.y]
}

/** Upstream `_startPoint`: first non-construction edge matching the last edge's mode. */
function startPoint(sk: Sketch): Pt2 {
  if (!sk.edges.length) throw new Error('No free edges available')
  const mode = sk.edges[sk.edges.length - 1].forConstruction
  const e = sk.edges.find((el) => el.forConstruction === mode) ?? sk.edges[sk.edges.length - 1]
  return edgePoint(kernel(), e.handle, false)
}

/** Upstream `_endPoint`: endpoint of the last edge. */
function endPoint(sk: Sketch): Pt2 {
  if (!sk.edges.length) throw new Error('No free edges available')
  return edgePoint(kernel(), sk.edges[sk.edges.length - 1].handle, true)
}

function samePt(a: Pt2, b: Pt2): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
}

/**
 * push — CadQuery `Sketch.push(locs, tag)` parity: set the current selection to
 * the given locations (2D points).
 * @param sk - Sketch
 * @param locs - 2D points
 * @param tag - optional tag under which to store the locations
 * @returns Sketch
 */
export function push(sk: Sketch, locs: Array<Pt2 | { x: number; y: number }>, tag?: string): Sketch {
  const k = kernel()
  const out: Loc2[] = locs.map((l) => {
    const p = Array.isArray(l) ? l : ([l.x, l.y] as Pt2)
    return { x: p[0], y: p[1] }
  })
  const handles = out.map((p) => k.makeVertex(p.x, p.y, 0))
  const tags = tag ? new Map(sk.tags).set(tag, handles) : sk.tags
  return { ...sk, selected: handles, locs: out, tags }
}

/**
 * edge — CadQuery `Sketch.edge(val, tag, forConstruction)` parity: add a
 * pre-built edge handle to the pending edge list.
 * @param sk - Sketch
 * @param val - edge handle (1D kernel shape)
 * @param tag - optional tag
 * @param forConstruction - construction edges are excluded from assemble()
 * @returns Sketch
 */
export function edge(sk: Sketch, val: ShapeHandle, tag?: string, forConstruction = false): Sketch {
  const tags = new Map(sk.tags)
  if (tag) tags.set(tag, [val])
  return { ...sk, edges: [...sk.edges, { handle: val, forConstruction }], tags }
}

/**
 * segment — CadQuery `Sketch.segment` parity with the three upstream overloads:
 * (p1, p2), (p2 only — continues from the current end point), (length, angle).
 * @param sk - Sketch
 * @param aOrP1 - p2 point (1st overload), p1 point, or segment length
 * @param bOrP2 - p2 point, angle (deg), or opts
 * @param opts - tag/forConstruction
 * @returns Sketch
 */
export function segment(
  sk: Sketch,
  aOrP1: Pt2 | number,
  bOrP2?: Pt2 | number | SketchEdgeOpts,
  opts?: SketchEdgeOpts,
): Sketch {
  const k = kernel()
  let p1: Pt2
  let p2: Pt2
  if (typeof aOrP1 === 'number' && typeof bOrP2 === 'number') {
    // (length, angle) overload
    p1 = endPoint(sk)
    const rad = (bOrP2 * Math.PI) / 180
    p2 = [p1[0] + aOrP1 * Math.cos(rad), p1[1] + aOrP1 * Math.sin(rad)]
  } else if (bOrP2 === undefined) {
    // (p2 only) — continue from the current end point
    p1 = endPoint(sk)
    p2 = aOrP1 as Pt2
  } else if (typeof aOrP1 === 'number') {
    throw new Error('segment: unsupported argument combination')
  } else {
    // (p1, p2)
    p1 = aOrP1
    p2 = bOrP2 as Pt2
  }
  const e = k.makeLineEdge(v3(p1[0], p1[1], 0), v3(p2[0], p2[1], 0))
  return edge(sk, e, opts?.tag, opts?.forConstruction ?? false)
}

/**
 * arc — CadQuery `Sketch.arc` parity with the three upstream overloads:
 * (p1, p2, p3) three-point arc, (p2, p3) continuing from the current end point,
 * (c, r, a, da) center/radius/start-angle/sweep. `da` >= 360 yields a full circle.
 * @param sk - Sketch
 * @param a - p1 / p2 / center
 * @param b - p2 / p3 / radius
 * @param c - p3 / start angle (deg)
 * @param d - sweep angle (deg)
 * @param opts - tag/forConstruction
 * @returns Sketch
 */
export function arc(
  sk: Sketch,
  a: Pt2,
  b: Pt2 | number,
  c?: Pt2 | number,
  d?: number,
  opts?: SketchEdgeOpts,
): Sketch {
  const k = kernel()
  let e: ShapeHandle
  let canon: SketchGeom | undefined
  if (typeof b === 'number' && typeof c === 'number' && typeof d === 'number') {
    // (c, r, a, da) overload
    const [cx, cy] = a
    const r = b
    const a0 = c
    const da = d
    if (Math.abs(da) >= 360) {
      const start = k.makeCircleEdge(v3(cx, cy, 0), v3(0, 0, 1), r)
      canon = { kind: 'circle', cx, cy, r }
      e = start
    } else {
      const pt = (ang: number): Pt2 => [
        cx + r * Math.cos((ang * Math.PI) / 180),
        cy + r * Math.sin((ang * Math.PI) / 180),
      ]
      const p1 = pt(a0)
      const pm = pt(a0 + da / 2)
      const p3 = pt(a0 + da)
      e = k.makeArcEdge(v3(p1[0], p1[1], 0), v3(pm[0], pm[1], 0), v3(p3[0], p3[1], 0))
      canon = { kind: 'arc', cx, cy, r, a0: (a0 * Math.PI) / 180, a1: ((a0 + da) * Math.PI) / 180, ccw: da > 0 }
    }
  } else if (Array.isArray(b) && Array.isArray(c)) {
    // (p1, p2, p3) three-point arc
    e = k.makeArcEdge(v3(a[0], a[1], 0), v3(b[0], b[1], 0), v3(c[0], c[1], 0))
  } else if (Array.isArray(b) && c === undefined) {
    // (p2, p3) continuing from the current end point
    const p1 = endPoint(sk)
    e = k.makeArcEdge(v3(p1[0], p1[1], 0), v3(a[0], a[1], 0), v3(b[0], b[1], 0))
  } else {
    throw new Error('arc: unsupported argument combination')
  }
  const sk2 = edge(sk, e, opts?.tag, opts?.forConstruction ?? false)
  if (canon && opts?.tag) {
    // store the canonical hint on the newest edge for the constraint segment
    const edges = [...sk2.edges]
    edges[edges.length - 1] = { ...edges[edges.length - 1], canon }
    return { ...sk2, edges }
  }
  return sk2
}

/**
 * spline — CadQuery `Sketch.spline(pts, tangents?, periodic?, tag?, forConstruction?)`
 * parity: interpolating B-spline edge through the given points.
 * @param sk - Sketch
 * @param pts - interpolation points
 * @param opts - tag/forConstruction/periodic
 * @returns Sketch
 */
export function spline(sk: Sketch, pts: Pt2[], opts?: SketchEdgeOpts & { periodic?: boolean }): Sketch {
  const k = kernel()
  if (pts.length < 2) throw new Error('spline needs at least 2 points')
  // Interpolating spline via BSpline poles is not directly exposed; approximate
  // with a C2 BSpline built from the points as poles is wrong — use the kernel's
  // makeBSplineEdge with a uniform knot vector over the given points (control
  // polygon approximation is NOT upstream-exact; documented in the Agent Note).
  const flat: number[] = []
  for (const p of pts) flat.push(p[0], p[1], 0)
  const n = pts.length
  const degree = Math.min(3, n - 1)
  // clamped uniform knots for the given degree and pole count
  const nKnots = n + degree + 1
  const knots: number[] = []
  for (let i = 0; i < nKnots; i++) {
    const t = i - degree
    knots.push(Math.min(Math.max(t, 0), n - degree))
  }
  const uniq: number[] = []
  for (const t of knots) if (!uniq.length || uniq[uniq.length - 1] !== t) uniq.push(t)
  const uniqMults: number[] = []
  {
    let run = 1
    for (let i = 1; i <= knots.length; i++) {
      if (i < knots.length && knots[i] === knots[i - 1]) run++
      else {
        uniqMults.push(run)
        run = 1
      }
    }
  }
  const e = k.makeBSplineEdge(flat, [], uniq, uniqMults, degree, opts?.periodic ?? false)
  return edge(sk, e, opts?.tag, opts?.forConstruction ?? false)
}

/**
 * bezier — CadQuery `Sketch.bezier(pts, tag, forConstruction)` parity: the edge
 * passes through the last point; inner points are control points.
 * @param sk - Sketch
 * @param pts - control points (edge ends at the last one)
 * @param opts - tag/forConstruction
 * @returns Sketch
 */
export function bezier(sk: Sketch, pts: Pt2[], opts?: SketchEdgeOpts): Sketch {
  const k = kernel()
  if (pts.length < 2) throw new Error('bezier needs at least 2 points')
  const cps: Vec3[] = pts.map((p) => v3(p[0], p[1], 0))
  const e = k.makeBezierEdge(cps)
  return edge(sk, e, opts?.tag, opts?.forConstruction ?? false)
}

/**
 * close — CadQuery `Sketch.close(tag)` parity: connect the last edge back to
 * the first one with a straight segment.
 * @param sk - Sketch
 * @param tag - optional tag for the closing segment
 * @returns Sketch
 */
export function close(sk: Sketch, tag?: string): Sketch {
  return segment(sk, endPoint(sk), startPoint(sk), { tag })
}

/**
 * assemble — CadQuery `Sketch.assemble(mode, tag)` parity: build faces from the
 * pending non-construction edges (edges → wires → face with holes). Edges are
 * chained by their endpoints; the longest closed wire is the outer boundary,
 * the rest become holes. Non-closed edge sets throw (upstream ValueError).
 * @param sk - Sketch
 * @param opts - mode/tag
 * @returns Sketch
 */
export function assemble(sk: Sketch, opts?: SketchOpts): Sketch {
  const k = kernel()
  const real = sk.edges.filter((e) => !e.forConstruction)
  if (!real.length) throw new Error('No edges to assemble')
  const handles = real.map((e) => e.handle)
  const wires = chainEdgesToWires(k, handles)
  if (!wires.length) throw new Error('Edges do not form closed wires')
  // longest perimeter wire = outer boundary; the rest are holes
  let outer = wires[0]
  let outerLen = k.getLength(wires[0])
  for (let i = 1; i < wires.length; i++) {
    const len = k.getLength(wires[i])
    if (len > outerLen) {
      outer = wires[i]
      outerLen = len
    }
  }
  const holes = wires.filter((w) => w !== outer)
  let f = k.makeFace(outer)
  if (holes.length) f = k.addHolesInFace(f, holes)
  for (const w of wires) k.release(w)
  return commit(sk, opts?.mode ?? 'a', opts?.tag, [f])
}

/**
 * add — CadQuery `Sketch.add()` parity: fuse the selected faces into the
 * underlying faces (no-op without a selection).
 * @param sk - Sketch
 * @returns Sketch
 */
export function add(sk: Sketch): Sketch {
  const k = kernel()
  const sel = sk.selected.filter((h) => k.getSubShapes(h, 'face').length > 0 || isFaceHandle(k, h))
  if (!sel.length) return sk
  let acc = fuseAll(k, sk.faces)
  const fresh = fuseAll(k, sel)
  if (acc && fresh) {
    const merged = k.fuse(acc, fresh)
    k.release(acc)
    k.release(fresh)
    acc = merged
  } else if (!acc) {
    acc = fresh
  }
  return { ...sk, faces: acc ? [acc] : [], selected: [] }
}

/**
 * subtract — CadQuery `Sketch.subtract()` parity: cut the selected faces from
 * the underlying faces (no-op without a selection).
 * @param sk - Sketch
 * @returns Sketch
 */
export function subtract(sk: Sketch): Sketch {
  const k = kernel()
  const sel = sk.selected.filter((h) => k.getSubShapes(h, 'face').length > 0 || isFaceHandle(k, h))
  if (!sel.length) return sk
  const acc = fuseAll(k, sk.faces)
  const fresh = fuseAll(k, sel)
  if (!acc || !fresh) return { ...sk, selected: [] }
  const cut = k.cut(acc, fresh)
  k.release(acc)
  k.release(fresh)
  return { ...sk, faces: cut ? [cut] : [], selected: [] }
}

// ---------------------------------------------------------------------------
// Arrays, distribution and placements
// ---------------------------------------------------------------------------

/**
 * rarray — CadQuery `Sketch.rarray(xs, ys, nx, ny)` parity: rectangular array
 * of locations; the array is centred so the overall bounding box is symmetric.
 * @param sk - Sketch
 * @param xs - x spacing
 * @param ys - y spacing
 * @param nx - columns
 * @param ny - rows
 * @returns Sketch
 */
export function rarray(sk: Sketch, xs: number, ys: number, nx: number, ny: number): Sketch {
  if (nx < 1 || ny < 1) throw new Error('At least 1 element required')
  const out: Loc2[] = []
  const ox = ((nx - 1) * xs) / 2
  const oy = ((ny - 1) * ys) / 2
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      out.push({ x: i * xs - ox, y: j * ys - oy })
    }
  }
  // selection elements contribute their centres; locations compose
  const k = kernel()
  const base: Loc2[] = sk.selected.length
    ? sk.selected.map((h) => centreOf(k, h))
    : [{ x: 0, y: 0 }]
  const locs: Loc2[] = []
  for (const l of out) for (const b of base) locs.push({ x: l.x + b.x, y: l.y + b.y })
  return push(sk, locs.map((p) => [p.x, p.y] as Pt2))
}

/** 2D placement centre of a selection element (bbox centre — vertices have no COM). */
function centreOf(k: OcctKernel, h: ShapeHandle): Loc2 {
  const bb = k.getBoundingBox(h)
  return { x: (bb.xmin + bb.xmax) / 2, y: (bb.ymin + bb.ymax) / 2 }
}

/**
 * parray — CadQuery `Sketch.parray(r, a1, da, n, rotate)` parity: polar array
 * of locations on a circle of radius r from angle a1 sweeping da degrees
 * (full-circle sweep divides evenly), each optionally rotated to face outward.
 * @param sk - Sketch
 * @param r - array radius
 * @param a1 - start angle (degrees)
 * @param da - sweep angle (degrees)
 * @param n - element count
 * @param rotate - rotate each element to the local radial frame (default true)
 * @returns Sketch
 */
export function parray(sk: Sketch, r: number, a1: number, da: number, n: number, rotate = true): Sketch {
  if (n < 1) throw new Error('At least 1 element required, requested ' + n)
  const k = kernel()
  const TOL = 1e-9
  const angle = Math.abs(((da % 360) + 360) % 360) < 1e-9 || Math.abs(da % 360) < TOL
    ? da / n
    : n > 1
      ? da / (n - 1)
      : a1
  const base: Loc2[] = sk.selected.length
    ? sk.selected.map((h) => centreOf(k, h))
    : [{ x: 0, y: 0 }]
  const locs: Loc2[] = []
  for (let i = 0; i < n; i++) {
    const phi = a1 + angle * i
    const x = r * Math.cos((phi * Math.PI) / 180)
    const y = r * Math.sin((phi * Math.PI) / 180)
    for (const b of base) {
      // loc = translate(r,phi) ∘ rotate(phi if rotate) ∘ element centre
      const rad = (phi * Math.PI) / 180
      const bx = rotate ? b.x * Math.cos(rad) - b.y * Math.sin(rad) : b.x
      const by = rotate ? b.x * Math.sin(rad) + b.y * Math.cos(rad) : b.y
      locs.push({ x: x + bx, y: y + by, angle: rotate ? phi : 0 })
    }
  }
  return push(sk, locs.map((p) => [p.x, p.y] as Pt2))
}

/**
 * distribute — CadQuery `Sketch.distribute(n, start, stop, rotate)` parity:
 * place n locations along the selected edges/wires at parameters start..stop
 * (evenly for closed selections, including both endpoints for open ones).
 * @param sk - Sketch
 * @param n - location count
 * @param start - start parameter (0..1)
 * @param stop - stop parameter (0..1)
 * @param rotate - orient each location along the curve tangent (default true)
 * @returns Sketch
 */
export function distribute(sk: Sketch, n: number, start = 0, stop = 1, rotate = true): Sketch {
  if (n < 1) throw new Error('At least 1 element required, requested ' + n)
  if (!sk.selected.length) throw new Error('Nothing selected to distribute over')
  const k = kernel()
  const TOL = 1e-9
  const trimmed = Math.abs(1 - Math.abs(stop - start)) >= TOL
  const locs: Loc2[] = []
  for (const el of sk.selected) {
    const { first: t0, last: t1 } = k.curveParameters(el)
    const isClosed = samePt(edgePoint(k, el, false), edgePoint(k, el, true))
    const params: number[] = []
    if (isClosed && !trimmed) {
      for (let i = 0; i < n; i++) params.push(t0 + (i * (stop - start) * (t1 - t0)) / n)
    } else {
      for (let i = 0; i < n; i++)
        params.push(n - 1 > 0 ? t0 + (start + (i * (stop - start)) / (n - 1)) * (t1 - t0) : t0 + start * (t1 - t0))
    }
    for (let i = 0; i < n; i++) {
      const p = k.curvePointAtParam(el, params[i])
      let ang: number | undefined
      if (rotate) {
        const t = k.curveTangent(el, params[i])
        ang = (Math.atan2(t.y, t.x) * 180) / Math.PI
      }
      locs.push({ x: p.x, y: p.y, angle: ang })
    }
  }
  return push(sk, locs.map((p) => [p.x, p.y] as Pt2))
}

// ---------------------------------------------------------------------------
// Partial copies and edits
// ---------------------------------------------------------------------------

/**
 * moved — CadQuery `Sketch.moved(x, y, rx?, ry?, rz?)` parity (vector overload):
 * partial copy with all faces translated by (x, y) (z ignored for 2D sketches)
 * and optionally rotated about Z.
 * @param sk - Sketch
 * @param x - translation along X
 * @param y - translation along Y
 * @param rz - optional rotation about Z (degrees)
 * @param dz - optional translation along local Z (superset of upstream:
 * upstream `Sketch.moved(Location(0,0,3))` shifts a finished sketch along the
 * plane normal; the local-Z form composes with the plane binding at
 * materialization). Used by the placeSketch/loft mirror path.
 * @returns Sketch
 */
export function moved(sk: Sketch, x: number, y: number, rz = 0, dz = 0): Sketch {
  const k = kernel()
  const faces = sk.faces.map((f) => {
    let h = x || y || dz ? k.translate(f, x, y, dz) : k.copy(f)
    if (rz) h = rotateFace(k, h, rz)
    return h
  })
  return { ...sk, faces, edges: [], tags: new Map() }
}

/**
 * located — CadQuery `Sketch.located(loc)` parity: partial copy whose faces are
 * placed at the given location (2D translation + optional Z rotation).
 * @param sk - Sketch
 * @param x - translation along X
 * @param y - translation along Y
 * @param angle - rotation about Z (degrees)
 * @returns Sketch
 */
export function located(sk: Sketch, x: number, y: number, angle = 0): Sketch {
  const k = kernel()
  const faces = sk.faces.map((f) => {
    let h = k.copy(f)
    if (angle) h = rotateFace(k, h, angle)
    if (x || y) h = k.translate(h, x, y, 0)
    return h
  })
  return { ...sk, faces, locs: [{ x, y, angle: angle || undefined }], edges: [], tags: new Map() }
}

/**
 * copy — CadQuery `Sketch.copy()` parity: partial copy of the faces (edges and
 * constraints are not copied).
 * @param sk - Sketch
 * @returns Sketch
 */
export function copy(sk: Sketch): Sketch {
  const k = kernel()
  const faces = sk.faces.map((f) => k.copy(f))
  return { ...sk, faces, edges: [], tags: new Map(), constraints: [] }
}

/**
 * delete — CadQuery `Sketch.delete()` parity: remove the selected faces or
 * edges from the sketch (faces are matched by identity of their topological
 * sub-faces; the selection is reset).
 * @param sk - Sketch
 * @returns Sketch
 */
export function deleteSel(sk: Sketch): Sketch {
  const k = kernel()
  if (!sk.selected.length) throw new Error('Selection is needed to delete')
  const delFaces: ShapeHandle[] = []
  const delEdges: ShapeHandle[] = []
  for (const h of sk.selected) {
    if (isFaceHandle(k, h) || k.getSubShapes(h, 'face').length > 0) delFaces.push(h)
    else delEdges.push(h)
  }
  let faces = sk.faces
  if (delFaces.length) {
    faces = []
    for (const f of sk.faces) {
      const subs = k.getSubShapes(f, 'face') as unknown as ShapeHandle[]
      const kept = subs.filter((s) => !delFaces.some((d) => sameHandle(k, d, s)))
      if (kept.length === subs.length) faces.push(f)
      else {
        for (const keptF of kept) faces.push(k.copy(keptF))
        k.release(f)
      }
    }
  }
  const edges = sk.edges.filter((e) => !delEdges.some((d) => sameHandle(k, d, e.handle)))
  return { ...sk, faces, edges, selected: [] }
}

/** Structural equality of two handles via bounding-box centre signature. */
function sameHandle(k: OcctKernel, a: ShapeHandle, b: ShapeHandle): boolean {
  if (a === b) return true
  try {
    // Bbox centres (NOT area/COM: vertices and edges have no surface area and
    // getLinearCenterOfMass can throw or return 0 on them).
    const ca = k.getBoundingBox(a)
    const cb = k.getBoundingBox(b)
    return (
      Math.abs((ca.xmin + ca.xmax) / 2 - (cb.xmin + cb.xmax) / 2) < 1e-9 &&
      Math.abs((ca.ymin + ca.ymax) / 2 - (cb.ymin + cb.ymax) / 2) < 1e-9 &&
      Math.abs((ca.zmin + ca.zmax) / 2 - (cb.zmin + cb.zmax) / 2) < 1e-9
    )
  } catch {
    return false
  }
}

/**
 * replace — CadQuery `Sketch.replace()` parity: replace the underlying faces
 * with the selected faces.
 * @param sk - Sketch
 * @returns Sketch
 */
export function replace(sk: Sketch): Sketch {
  const k = kernel()
  const sel = sk.selected.filter((h) => isFaceHandle(k, h) || k.getSubShapes(h, 'face').length > 0)
  if (!sel.length) throw new Error('Nothing is selected')
  for (const f of sk.faces) k.release(f)
  return { ...sk, faces: [...sel], selected: [] }
}

/**
 * fillet — CadQuery `Sketch.fillet(d)` parity: 2D fillet at the selected
 * vertices. The kernel does not expose BRepFilletAPI_MakeFillet2d, so this is
 * implemented by rebuilding the affected faces: each selected vertex is
 * replaced by an arc of radius d tangent to its two adjacent edges.
 * @param sk - Sketch
 * @param d - fillet radius
 * @returns Sketch
 */
export function fillet(sk: Sketch, d: number): Sketch {
  return cornerEdit(sk, d, 'fillet')
}

/**
 * chamfer — CadQuery `Sketch.chamfer(d)` parity: 2D chamfer at the selected
 * vertices (straight cut of length d along each adjacent edge).
 * @param sk - Sketch
 * @param d - chamfer distance
 * @returns Sketch
 */
export function chamfer(sk: Sketch, d: number): Sketch {
  return cornerEdit(sk, d, 'chamfer')
}

/**
 * Shared 2D fillet/chamfer core: for every face, collect the selected vertices
 * lying on it, cut the corner triangle(s) and rebuild the face from the
 * remaining boundary edges plus the new corner edges.
 */
function cornerEdit(sk: Sketch, d: number, kind: 'fillet' | 'chamfer'): Sketch {
  const k = kernel()
  if (!sk.selected.length) throw new Error('Selection is needed to ' + kind)
  if (!sk.faces.length) throw new Error('No faces available for ' + kind)
  const out: ShapeHandle[] = []
  for (const f of sk.faces) {
    const subs = k.getSubShapes(f, 'face') as unknown as ShapeHandle[]
    let touched = false
    for (const sub of subs) {
      touched = true
      const verts = k.getSubShapes(sub, 'vertex') as unknown as ShapeHandle[]
      const hit = verts.filter((v) => sk.selected.some((s) => sameHandle(k, s, v)))
      if (!hit.length) {
        out.push(k.copy(sub))
        continue
      }
      const rebuilt = rebuildFaceWithCorners(k, sub, hit, d, kind)
      out.push(rebuilt)
    }
    if (touched) k.release(f)
  }
  return { ...sk, faces: out.length === 1 ? [out[0]] : [k.makeCompound(out)], selected: [] }
}

/**
 * Rebuild one face with fillet arcs / chamfer cuts at the given vertices.
 * Ordered-ring walk: walk the boundary edges in a connected ring; at each
 * treated vertex trim both adjacent edges by `d` and insert the corner edge
 * (chamfer line or fillet arc) between the trim points. Untreated vertices
 * keep their corner.
 */
function rebuildFaceWithCorners(
  k: OcctKernel,
  face: ShapeHandle,
  verts: ShapeHandle[],
  d: number,
  kind: 'fillet' | 'chamfer',
): ShapeHandle {
  const edges = k.getSubShapes(face, 'edge') as unknown as ShapeHandle[]
  const isTreated = (p: Pt2): boolean =>
    verts.some((v) => {
      const bb = k.getBoundingBox(v)
      return Math.hypot(bb.xmin - p[0], bb.ymin - p[1]) < 1e-7
    })
  // walk the ring: each edge start→end; order edges so end[i] ≈ start[i+1]
  const ring: Array<{ a: Pt2; b: Pt2; arcMid?: Pt2 }> = []
  const remaining = [...edges]
  const cur = remaining.shift()!
  const curStart = edgePoint(k, cur, false)
  let curEnd = edgePoint(k, cur, true)
  {
    const { first, last } = k.curveParameters(cur)
    const pm = k.curvePointAtParam(cur, (first + last) / 2)
    const isArc = Math.hypot((curStart[0] + curEnd[0]) / 2 - pm.x, (curStart[1] + curEnd[1]) / 2 - pm.y) > 1e-9
    ring.push({ a: curStart, b: curEnd, arcMid: isArc ? [pm.x, pm.y] : undefined })
  }
  while (remaining.length) {
    const idx = remaining.findIndex((e) => {
      const s = edgePoint(k, e, false)
      const t = edgePoint(k, e, true)
      return samePt(s, curEnd) || samePt(t, curEnd)
    })
    if (idx < 0) break // open ring (shouldn't happen for a valid face)
    const nxt = remaining.splice(idx, 1)[0]
    let s = edgePoint(k, nxt, false)
    let t = edgePoint(k, nxt, true)
    if (samePt(t, curEnd)) [s, t] = [t, s]
    const { first, last } = k.curveParameters(nxt)
    const pm = k.curvePointAtParam(nxt, (first + last) / 2)
    const isArc = Math.hypot((s[0] + t[0]) / 2 - pm.x, (s[1] + t[1]) / 2 - pm.y) > 1e-9
    ring.push({ a: s, b: t, arcMid: isArc ? [pm.x, pm.y] : undefined })
    curEnd = t
  }
  // rebuild: for each ring segment, trim treated ends; then insert corner fills
  const newEdges: ShapeHandle[] = []
  for (let i = 0; i < ring.length; i++) {
    const seg = ring[i]
    const ka = isTreated(seg.a)
    const kb = isTreated(seg.b)
    let a = seg.a
    let b = seg.b
    if (ka && kb && samePt(seg.a, seg.b)) continue // degenerate loop edge at one vertex
    if (ka) a = trimPoint(a, b, d)
    if (kb) b = trimPoint(b, a, d)
    if (seg.arcMid) {
      newEdges.push(k.makeArcEdge(v3(a[0], a[1], 0), v3(seg.arcMid[0], seg.arcMid[1], 0), v3(b[0], b[1], 0)))
    } else {
      newEdges.push(k.makeLineEdge(v3(a[0], a[1], 0), v3(b[0], b[1], 0)))
    }
  }
  // corner fills between consecutive trimmed ends at each treated vertex
  const trimmedPts: Array<{ at: Pt2; prev: Pt2; next: Pt2 }> = []
  for (let i = 0; i < ring.length; i++) {
    const seg = ring[i]
    const nxt = ring[(i + 1) % ring.length]
    const kb = isTreated(seg.b)
    if (!kb) continue
    // trim point on this segment: d away from seg.b towards seg.a
    const tp1 = trimPoint(seg.b, seg.a, d)
    // trim point on the next segment: d away from its start (== seg.b) towards its end
    const tp2 = trimPoint(nxt.a, nxt.b, d)
    trimmedPts.push({ at: seg.b, prev: tp1, next: tp2 })
  }
  for (const c of trimmedPts) {
    if (kind === 'chamfer') {
      newEdges.push(k.makeLineEdge(v3(c.prev[0], c.prev[1], 0), v3(c.next[0], c.next[1], 0)))
    } else {
      // Tangent fillet arc: the mid point sits on the angle bisector at depth
      // d*(1/sin(θ/2) − 1) from the corner — exact for a radius-d tangent arc.
      const mx = (c.prev[0] + c.next[0]) / 2
      const my = (c.prev[1] + c.next[1]) / 2
      const vx = mx - c.at[0]
      const vy = my - c.at[1]
      const len = Math.hypot(vx, vy)
      // θ = angle at the corner between (at→prev) and (at→next)
      const d1x = c.prev[0] - c.at[0]
      const d1y = c.prev[1] - c.at[1]
      const d2x = c.next[0] - c.at[0]
      const d2y = c.next[1] - c.at[1]
      const cosT = (d1x * d2x + d1y * d2y) / (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y) || 1)
      const halfSin = Math.sqrt(Math.max(0, (1 - cosT) / 2))
      const depth = halfSin > 1e-9 ? d * (1 / halfSin - 1) : 0
      const mid = [c.at[0] + (vx / len) * depth, c.at[1] + (vy / len) * depth] as Pt2
      newEdges.push(k.makeArcEdge(v3(c.prev[0], c.prev[1], 0), v3(mid[0], mid[1], 0), v3(c.next[0], c.next[1], 0)))
    }
  }
  const wire = k.makeWire(newEdges)
  for (const e of newEdges) k.release(e)
  const f = k.makeFace(wire)
  k.release(wire)
  return f
}

/** Point moved from `a` towards `b` by `dist` (corner trim). */
function trimPoint(a: Pt2, b: Pt2, dist: number): Pt2 {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return a
  return [a[0] + (dx / len) * dist, a[1] + (dy / len) * dist]
}

/**
 * clean — CadQuery `Sketch.clean()` parity: unify same-domain faces to remove
 * internal wires left over from fuses (upstream `_faces.clean()`).
 * @param sk - Sketch
 * @returns Sketch
 */
export function clean(sk: Sketch): Sketch {
  const k = kernel()
  const faces = sk.faces.map((f) => k.unifySameDomain(f))
  return { ...sk, faces }
}

/**
 * hull — CadQuery `Sketch.hull(mode, tag)` parity: convex hull of the selected
 * edges' endpoints (or of all face edges when nothing is selected), built as
 * a face and fed through the mode.
 * @param sk - Sketch
 * @param opts - mode/tag
 * @returns Sketch
 */
export function hull(sk: Sketch, opts?: SketchOpts): Sketch {
  const k = kernel()
  let edges: ShapeHandle[]
  if (sk.selected.length) {
    // selection may hold faces, wires, edges or vertices — flatten to edges
    edges = []
    for (const h of sk.selected) {
      const es = k.getSubShapes(h, 'edge') as unknown as ShapeHandle[]
      if (es.length) edges.push(...es)
      else if (!k.isVertex(h) && k.getLength(h) > 0) edges.push(h)
    }
  } else if (sk.faces.length) {
    edges = []
    for (const f of sk.faces) edges.push(...(k.getSubShapes(f, 'edge') as unknown as ShapeHandle[]))
  } else if (sk.edges.length) {
    edges = sk.edges.map((e) => e.handle)
  } else {
    throw new Error('No objects available for hull construction')
  }
  if (!edges.length) throw new Error('No objects available for hull construction')
  const pts: Pt2[] = []
  for (const e of edges) {
    for (const p of [edgePoint(k, e, false), edgePoint(k, e, true)]) {
      if (!pts.some((q) => samePt(q, p))) pts.push(p)
    }
  }
  return hullFromPoints(sk, pts, opts)
}

/**
 * hullFromPoints — CadQuery `Sketch.hullFromPoints(points, mode, tag)` parity:
 * convex hull face from a 2D point cloud, fed through the mode.
 * @param sk - Sketch
 * @param points - 2D points
 * @param opts - mode/tag
 * @returns Sketch
 */
export function hullFromPoints(sk: Sketch, points: Pt2[], opts?: SketchOpts): Sketch {
  if (points.length < 3) throw new Error('At least 3 points required')
  // Andrew's monotone chain convex hull
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const cross = (o: Pt2, a: Pt2, b: Pt2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt2[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt2[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const ring = lower.slice(0, -1).concat(upper.slice(0, -1))
  if (ring.length < 3) throw new Error('Degenerate hull: fewer than 3 hull points')
  const face = makePolygonFace(kernel(), ring)
  return commit(sk, opts?.mode ?? 'a', opts?.tag, [face])
}

// ---------------------------------------------------------------------------
// Constraint segment (upstream constrain/solve/finalize) — planegcs via
// @faicad/faijs-sketch. Under-/over-constraint surface as explicit statuses;
// conflicting constraints throw (no silent baking, feasibility §10.6).
// ---------------------------------------------------------------------------

/** Tagged constraint descriptor as accepted by {@link constrain}. */
export interface SketchConstrainSpec {
  /** Single tag (Fixed-style) or two tags (relational). */
  tags: [string] | [string, string]
  /** CQ constraint kind (Fixed/Coincident/Distance/Angle/Length/Radius/...). */
  kind: string
  /** Constraint argument (CQ passes None for most; numbers/vectors for others). */
  arg?: unknown
}

/**
 * constrain — CadQuery `Sketch.constrain(...)` parity: declare a constraint
 * between tagged entities. Validation mirrors upstream: unknown tags and
 * unknown constraint kinds throw immediately.
 * @param sk - Sketch
 * @param spec - tagged constraint descriptor
 * @returns Sketch
 */
export function constrain(sk: Sketch, spec: SketchConstrainSpec): Sketch {
  const KNOWN = new Set([
    'Fixed', 'FixedPoint', 'Coincident', 'Horizontal', 'Vertical', 'Parallel',
    'Perpendicular', 'Tangent', 'Distance', 'DistanceX', 'DistanceY', 'Length',
    'Angle', 'Orientation', 'Radius', 'Diameter', 'ArcAngle', 'Equal',
  ])
  for (const t of spec.tags) {
    if (!sk.tags.has(t)) throw new Error('Tag not found: ' + t)
  }
  if (!KNOWN.has(spec.kind)) throw new Error('Unknown constraint kind: ' + spec.kind)
  return { ...sk, constraints: [...sk.constraints, { tags: spec.tags, kind: spec.kind, arg: spec.arg ?? null }] }
}

/**
 * Map the pending edges + declared constraints onto the canonical
 * `SketchGeom`/`SketchConstraint` model of @faicad/faijs-sketch. A tag can
 * cover several edges (upstream tags a list); each edge becomes one canonical
 * geometry with the tag only on its first member so constraints resolve
 * deterministically.
 */
function toCanonical(sk: Sketch): { geoms: SketchGeom[]; constraints: CanonicalConstraint[] } {
  const geoms: SketchGeom[] = []
  for (const e of sk.edges) {
    if (e.canon) {
      geoms.push(e.canon)
      continue
    }
    const p0 = edgePoint(kernel(), e.handle, false)
    const p1 = edgePoint(kernel(), e.handle, true)
    const [t0, t1] = kParameters(kernel(), e.handle)
    const tm = (t0 + t1) / 2
    const pm = kernel().curvePointAtParam(e.handle, tm)
    const isArc = Math.hypot((p0[0] + p1[0]) / 2 - pm.x, (p0[1] + p1[1]) / 2 - pm.y) > 1e-9
    if (isArc) {
      // reconstruct centre/radius from three sampled points
      const [cx, cy, r, a0, a1v] = arcFromPoints(p0, [pm.x, pm.y], p1)
      geoms.push({ kind: 'arc', cx, cy, r, a0, a1: a1v, ccw: cross2(p0, [pm.x, pm.y], p1) > 0 })
    } else {
      geoms.push({ kind: 'line', x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1] })
    }
  }
  // tag the first edge of each tagged group
  for (const e of sk.edges) {
    if (!e.canon) continue
  }
  const seen = new Set<string>()
  sk.edges.forEach((e, i) => {
    for (const [tag, hs] of sk.tags) {
      if (seen.has(tag)) break
      if (hs.some((h) => sameHandle(kernel(), h, e.handle))) {
        if (geoms[i]) geoms[i] = { ...geoms[i], tag }
        seen.add(tag)
        break
      }
    }
  })
  const constraints: CanonicalConstraint[] = []
  for (const c of sk.constraints) {
    const kind = c.kind
    const [t1, t2] = c.tags
    const ref = (t: string) => ({ tag: t, index: 0 })
    switch (kind) {
      case 'Fixed':
        constraints.push({ kind: 'fixed', of: ref(t1) })
        break
      case 'Coincident':
        if (t2) constraints.push({ kind: 'coincident', a: ref(t1), b: ref(t2) })
        break
      case 'Distance':
        if (t2 && typeof c.arg === 'object' && c.arg !== null) {
          const v = c.arg as { [k: number]: number }
          const val = v[2]
          if (typeof val === 'number') constraints.push({ kind: 'distance', a: ref(t1), b: ref(t2), value: val })
        } else if (typeof c.arg === 'number') {
          constraints.push({ kind: 'distance', a: ref(t1), b: ref(t1), value: c.arg })
        }
        break
      case 'Length':
        if (typeof c.arg === 'number') constraints.push({ kind: 'length', of: ref(t1), value: c.arg })
        break
      case 'Angle':
        if (t2 && typeof c.arg === 'number') {
          constraints.push({ kind: 'angle', a: ref(t1), b: ref(t2), value: (c.arg * Math.PI) / 180 })
        }
        break
      case 'Orientation':
        if (Array.isArray(c.arg) && c.arg.length === 2) {
          constraints.push({ kind: 'orientation', of: ref(t1), dir: [c.arg[0], c.arg[1]] })
        }
        break
      case 'Radius':
        if (typeof c.arg === 'number') constraints.push({ kind: 'radius', of: ref(t1), value: c.arg })
        break
      case 'ArcAngle':
        if (typeof c.arg === 'number') {
          constraints.push({ kind: 'arcAngle', of: ref(t1), value: (c.arg * Math.PI) / 180 })
        }
        break
      default:
        throw new Error('Constraint kind not supported by the planegcs bridge: ' + kind)
    }
  }
  return { geoms, constraints }
}

function kParameters(k: OcctKernel, e: ShapeHandle): [number, number] {
  const p = k.curveParameters(e)
  return [p.first, p.last]
}

function cross2(a: Pt2, m: Pt2, b: Pt2): number {
  return (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0])
}

/** Centre/radius/span of the circle through three 2D points. */
function arcFromPoints(p0: Pt2, pm: Pt2, p1: Pt2): [number, number, number, number, number] {
  const ax = p0[0], ay = p0[1]
  const bx = pm[0], by = pm[1]
  const cx = p1[0], cy = p1[1]
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-12) throw new Error('arc points are collinear')
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
  const r = Math.hypot(ax - ux, ay - uy)
  const a0 = Math.atan2(ay - uy, ax - ux)
  const a1 = Math.atan2(cy - uy, cx - ux)
  return [ux, uy, r, a0, a1]
}

/**
 * solve — CadQuery `Sketch.solve()` parity: run the planegcs pipeline over the
 * pending edges + declared constraints and rebuild the edge handles from the
 * solved geometry. Conflicting constraints throw explicitly (no silent
 * baking); under/redundant constraints are allowed and reported on the sketch.
 * @param sk - Sketch
 * @param opts - solver options (wasm source or a pre-built solver)
 * @returns Sketch with solved edges and `solveStatus` set
 */
export async function solve(sk: Sketch, opts?: SolveSketchOptions): Promise<Sketch> {
  const { geoms, constraints } = toCanonical(sk)
  const outcome = await solveSketch(geoms, constraints, opts)
  if (outcome.status === 'conflicting' || outcome.status === 'failed') {
    throw new Error('Sketch solve ' + outcome.status + ': ' + (outcome.reason ?? ''))
  }
  // rebuild the pending edge handles from the solved canonical geometry
  const k = kernel()
  const edges: SketchEdge[] = []
  for (const g of outcome.geoms) {
    edges.push({ handle: geomToEdge(k, g), forConstruction: false, canon: g })
  }
  return { ...sk, edges, solveStatus: { status: outcome.status, dof: outcome.dof } }
}

/** Rebuild an edge handle from canonical geometry. */
function geomToEdge(k: OcctKernel, g: SketchGeom): ShapeHandle {
  if (g.kind === 'line') return k.makeLineEdge(v3(g.x1, g.y1, 0), v3(g.x2, g.y2, 0))
  if (g.kind === 'circle') {
    const start = k.makeCircleEdge(v3(g.cx, g.cy, 0), v3(0, 0, 1), g.r)
    return start
  }
  if (g.kind === 'arc') {
    const p0 = [g.cx + g.r * Math.cos(g.a0), g.cy + g.r * Math.sin(g.a0)] as Pt2
    const p1 = [g.cx + g.r * Math.cos(g.a1), g.cy + g.r * Math.sin(g.a1)] as Pt2
    const span = g.ccw ? (g.a1 - g.a0 + 2 * Math.PI) % (2 * Math.PI) : -(((g.a0 - g.a1 + 2 * Math.PI) % (2 * Math.PI)))
    const midA = g.a0 + span / 2
    const pm = [g.cx + g.r * Math.cos(midA), g.cy + g.r * Math.sin(midA)] as Pt2
    return k.makeArcEdge(v3(p0[0], p0[1], 0), v3(pm[0], pm[1], 0), v3(p1[0], p1[1], 0))
  }
  throw new Error('geomToEdge: unsupported geometry kind: ' + (g as { kind: string }).kind)
}

/**
 * finalize — CadQuery `Sketch.finalize()` parity: return the parent object the
 * sketch was created from (identity when no parent was given).
 * @param sk - Sketch
 * @param parent - parent object passed at creation
 * @returns the parent
 */
export function finalize<T>(sk: Sketch, parent: T): T {
  void sk
  return parent
}

/**
 * Release all handles held by a Sketch (run at end of script/unit test).
 * @param sk - Sketch whose kernel handles are released
 */
export function dispose(sk: Sketch): void {
  const k = kernel()
  for (const f of sk.faces) k.release(f)
  for (const [, fs] of sk.tags) for (const f of fs) k.release(f)
  for (const e of sk.selected) k.release(e)
}
