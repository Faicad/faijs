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
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'

/** Sketch face-container state. */
export interface Sketch {
  /** Current effective faces (upstream `_faces`). */
  faces: ShapeHandle[]
  /** Construction faces stored under their tag (mode "c"). */
  tags: Map<string, ShapeHandle[]>
  /** Selected entities (faces/wires/edges/vertices) feeding the next each(). */
  selected: ShapeHandle[]
  /** Pushed iteration locations (push/selection-derived). */
  locs: Array<[number, number]>
}

/** Sketch geometry-declaration mode (CadQuery Modes): a=additive, s=subtract, i=intersect, c=construction+tag, r=replace. */
export type SketchMode = 'a' | 's' | 'i' | 'c' | 'r'

/** Options for a geometry declaration: mode/tag/angle (CadQuery keyword args). */
export interface SketchOpts {
  mode?: SketchMode
  tag?: string
  angle?: number
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
  return { faces: [], tags: new Map(), selected: [], locs: [] }
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
      let acc: ShapeHandle | null = null
      const all = [...faces, ...fresh]
      if (all.length === 0) return { faces: [], tags: tagOut, tagOut }
      acc = all[0]
      for (let i = 1; i < all.length; i++) {
        const merged = k.fuse(acc, all[i])
        k.release(acc)
        k.release(all[i])
        acc = merged
      }
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

/** Merge the mode result into a Sketch (fresh faces released on a/s/i/r paths). */
function commit(sk: Sketch, mode: SketchMode, tag: string | undefined, fresh: ShapeHandle[]): Sketch {
  const k = kernel()
  const { faces, tagOut } = applyMode(k, sk.faces, fresh, mode, tag)
  const tags = new Map(sk.tags)
  for (const [t, fs] of tagOut) tags.set(t, fs)
  return { faces, tags, selected: sk.selected, locs: sk.locs }
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
  return commit(sk, mode, opts?.tag, fresh)
}

/**
 * faces — CadQuery `Sketch.faces()` selector parity: select current faces.
 * @param sk - Sketch
 * @returns Sketch (selected faces feed the next geometric declaration)
 */
export function faces(sk: Sketch): Sketch {
  // Upstream _faces.Faces() returns the TOPOLOGICAL faces; a fused face
  // handle may hold several (e.g. two overlapping rects stay 2 faces after
  // fuse, asserted by upstream test_modes). Flatten via getSubShapes.
  const k = kernel()
  const out: ShapeHandle[] = []
  for (const f of sk.faces) {
    const sub = k.getSubShapes(f, 'face') as unknown as ShapeHandle[]
    out.push(...sub)
  }
  return { ...sk, selected: out }
}

/**
 * wires — CadQuery `Sketch.wires()` selector parity: select boundary wires of
 * the current faces.
 * @param sk - Sketch
 * @returns Sketch
 */
export function wires(sk: Sketch): Sketch {
  const k = kernel()
  const wires: ShapeHandle[] = []
  for (const f of sk.faces) {
    const w = k.outerWire(f)
    wires.push(w)
  }
  return { ...sk, selected: wires }
}

/**
 * edges — CadQuery `Sketch.edges()` selector parity: select all edges of the
 * current faces.
 * @param sk - Sketch
 * @returns Sketch
 */
export function edges(sk: Sketch): Sketch {
  const k = kernel()
  const out: ShapeHandle[] = []
  for (const f of sk.faces) {
    const es = k.getSubShapes(f, 'edge') as unknown as ShapeHandle[]
    out.push(...es)
  }
  return { ...sk, selected: out }
}

/**
 * vertices — CadQuery `Sketch.vertices()` selector parity: select all vertices
 * of the current faces.
 * @param sk - Sketch
 * @returns Sketch
 */
export function vertices(sk: Sketch): Sketch {
  const k = kernel()
  const out: ShapeHandle[] = []
  for (const f of sk.faces) {
    const vs = k.getSubShapes(f, 'vertex') as unknown as ShapeHandle[]
    out.push(...vs)
  }
  return { ...sk, selected: out }
}

/**
 * reset — CadQuery `Sketch.reset()` parity: clear the selection so the next
 * geometric declaration applies to the whole sketch.
 * @param sk - Sketch
 * @returns Sketch
 */
export function reset(sk: Sketch): Sketch {
  return { ...sk, selected: [] }
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
  const tags = new Map(sk.tags)
  const payload = sk.selected.length ? sk.selected : sk.faces
  tags.set(name, [...payload])
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
 * Release all handles held by a Sketch (run at end of script/unit test).
 * @param sk - Sketch whose kernel handles are released
 */
export function dispose(sk: Sketch): void {
  const k = kernel()
  for (const f of sk.faces) k.release(f)
  for (const [, fs] of sk.tags) for (const f of fs) k.release(f)
  for (const e of sk.selected) k.release(e)
}
