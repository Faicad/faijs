/**
 * @faicad/cq-compat — CadQuery API compatibility layer for faijs.
 *
 * Implements a Workplane carrier (geometry hidden in .shape) and
 * CadQuery-style methods. All methods are async and return a new Workplane
 * (immutable updates). The carrier uses a custom prototype so compatOp's
 * `borrowDeep` does not traverse its fields when the library is auto-lifted.
 *
 * Design doc: docs/plans/2026-09-06-cadquery-compat-and-multifile-faijs.md
 */

import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { brepjsCompat } from '@faicad/faijs-core/api'
import { borrowBrepjsShape, adoptBrepjsProduct } from '@faicad/faijs-core/api/internal/l3-bridge'
import { brepOf } from '@faicad/faijs-core/shape'
import { getKernel } from '@faicad/faijs-core/occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { Shape } from '@faicad/faijs-core/mesh/types'

// ── cad namespace singleton (created once at module load) ──────────────────
const cad = createApiNamespace() as Record<string, (...args: unknown[]) => Promise<Shape>>

// ── Types ──────────────────────────────────────────────────────────────────

/** RGB color (sRGB 0..1). */
export type RGB = [number, number, number]

/**
 * A pending 2D profile wire (CadQuery `ctx.pendingWires` analogue).
 *
 * Upstream keeps a LIST of wires, and `extrude()` turns them into one face per
 * outermost wire with the enclosed wires punched as holes — verified against
 * cadquery 2.8.0 (two columns per pushPoint, and a plate with four holes):
 *
 *   `circle(4).circle(2).extrude(4)`                 -> annulus, vol 150.796
 *   `pushPoints([p1,p2]).circle(4).circle(2)`        -> TWO annuli (2 solids)
 *   `rect(2,2).rect(1.3,1.3,fc).vertices()`
 *     `.circle(0.125).extrude(0.5)`                  -> ONE plate, vol 1.901825
 *
 * `cx`/`cy` are workplane-LOCAL coordinates (a wire created under `pushPoints`
 * or after `vertices()` is already positioned at its point). `group` is the
 * index of the point it was created at, kept only for diagnostics.
 */
/** Snapshot of the plane a pending wire was created on (world coordinates). */
export interface WirePlane {
  origin: [number, number, number]
  xDir: [number, number, number]
  yDir: [number, number, number]
  normal: [number, number, number]
}

export type PendingWire =
  | { kind: 'rect'; w: number; d: number; cx: number; cy: number; construction: boolean; plane?: WirePlane }
  | { kind: 'circle'; radius: number; cx: number; cy: number; construction: boolean; plane?: WirePlane }
  | { kind: 'polygon'; n: number; d: number; cx: number; cy: number; construction: boolean; plane?: WirePlane }
  /** Open/closed point ring produced by moveTo/lineTo/polyline + close()/wire(). */
  | { kind: 'path'; pts: [number, number][]; construction: boolean; plane?: WirePlane }

/**
 * One drafted 2D edge, in workplane-LOCAL coordinates — the CadQuery
 * `ctx.pendingEdges` analogue. Only straight segments today; arcs would add a
 * discriminator here.
 */
export interface PendingEdge {
  from: [number, number]
  to: [number, number]
}

/**
 * Workplane carrier — object with a custom prototype so compatOp's
 * `borrowDeep` does NOT traverse its fields (it only walks objects whose
 * prototype === Object.prototype). This prevents .shape from being replaced
 * by a borrowed brepjs view when the library is auto-lifted.
 */
export interface Workplane {
  __cq: true
  /** Plane name: "XY" | "XZ" | "YZ". */
  plane: string
  /** Workplane origin in world coordinates. */
  origin: [number, number, number]
  /** Workplane normal (unit vector, local +Z). */
  normal: [number, number, number]
  /** Workplane local +X in world coordinates (CadQuery Plane.xDir convention). */
  xDir: [number, number, number]
  /** Workplane local +Y in world coordinates (= normal × xDir). */
  yDir: [number, number, number]
  /** Current geometry (faijs Shape), or null for empty workplane. */
  shape: Shape | null
  /** Pending face selector (e.g. ">Z", "<X"). Set by .faces(). */
  faceSel: string | null
  /** Pending edge selector (e.g. "|Z", ""). Set by .edges(). */
  edgeSel: string | null
  /** Pending vertex selector. Set by .vertices(). */
  vertexSel: string | null
  /** Accumulated pushPoints (2D offsets in workplane coords). */
  pts: [number, number][]
  /** Edge midpoints for construction rect (set by .edges()). */
  edgePts?: [number, number][]
  /** forConstruction flag — next rect/circle is construction geometry. */
  forConstruction: boolean
  /** Pending 2D rect profile (set by .rect(), consumed by .extrude()/.cutBlind()). */
  pendingRect?: { w: number; d: number }
  /** Pending 2D circle profile (set by .circle(), consumed by .extrude()/.cutBlind()). */
  pendingCircle?: { radius: number }
  /** Pending regular polygon profile (set by .polygon(), consumed by .extrude()/.cutBlind()). */
  pendingPolygon?: { n: number; d: number }
  /**
   * Pending 2D profile wires — the CadQuery `pendingWires` LIST.
   * `rect`/`circle`/`polygon` APPEND; `extrude` consumes. The single-slot
   * fields above are kept for the (single-wire) legacy path.
   */
  pendingWires?: PendingWire[]
  /**
   * Drafted 2D edges waiting to be combined into a wire — CadQuery
   * `ctx.pendingEdges`. Consumed by `wire()` / `close()`.
   */
  pendingEdges?: PendingEdge[]
  /**
   * Current drawing point in local coords — end of the last drafted edge, or
   * the plane origin when nothing has been drawn yet (upstream
   * `_findFromPoint`: last stack object, else `plane.origin`).
   */
  currentPoint?: [number, number]
  /**
   * First point of the wire currently being drafted, local coords — CadQuery
   * `ctx.firstPoint`. Set by the first non-construction edge, cleared by
   * `close()`.
   */
  firstPoint?: [number, number]
  /** Optional color (sRGB 0..1) for this part. */
  color?: RGB
}

/** Custom prototype — borrowDeep skips objects with non-Object prototype. */
const WP_PROTO = { __isCqWorkplane: true }

// ── Internal helpers ───────────────────────────────────────────────────────

function vadd(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function vscale(a: [number, number, number], s: number): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function vdot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function vsub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/**
 * Local → world mapping for axis-aligned workplane normals, verified against
 * installed CadQuery 2.8.0 (`faces(sel).workplane(...).plane.xDir`):
 *
 *   normal +Z → xDir +X, yDir +Y      normal -Z → xDir +X, yDir -Y
 *   normal +Y → xDir -X, yDir +Z      normal -Y → xDir +X, yDir +Z
 *   normal +X → xDir +Y, yDir +Z      normal -X → xDir -Y, yDir +Z
 */
const FACE_AXES: Record<string, { x: [number, number, number]; y: [number, number, number] }> = {
  '0,0,1': { x: [1, 0, 0], y: [0, 1, 0] },
  '0,0,-1': { x: [1, 0, 0], y: [0, -1, 0] },
  '0,1,0': { x: [-1, 0, 0], y: [0, 0, 1] },
  '0,-1,0': { x: [1, 0, 0], y: [0, 0, 1] },
  '1,0,0': { x: [0, 1, 0], y: [0, 0, 1] },
  '-1,0,0': { x: [0, -1, 0], y: [0, 0, 1] },
}

/** Get the local axes for an axis-aligned normal (throws for arbitrary normals). */
function faceAxes(normal: [number, number, number]): { x: [number, number, number]; y: [number, number, number] } {
  const key = `${normal[0]},${normal[1]},${normal[2]}`
  const axes = FACE_AXES[key]
  if (!axes) {
    throw new Error(`[cq-compat] unsupported workplane normal ${key} (axis-aligned only)`)
  }
  return axes
}

/** Map workplane-local (px, py) offsets to world coordinates. */
function localToWorld(
  wp: Pick<Workplane, 'origin' | 'xDir' | 'yDir'>,
  px: number,
  py: number,
): [number, number, number] {
  return vadd(wp.origin, vadd(vscale(wp.xDir, px), vscale(wp.yDir, py)))
}

/**
 * Reference points for eachpoint-style ops (box/sphere/cylinder/rect/circle/
 * polygon). Upstream positions each new object at whatever sits on the stack:
 * pushPoints() points win, otherwise the CURRENT DRAFTING POINT set by
 * moveTo/move (e.g. `workplane.rect(1,1).extrude(2).moveTo(0,2).rect(1,1)` —
 * `Workplane.testGlue`), otherwise the plane origin.
 */
function eachPoints(wp: Workplane): [number, number][] {
  if (Array.isArray(wp.pts) && wp.pts.length > 0) return wp.pts
  if (wp.currentPoint) return [wp.currentPoint]
  return [[0, 0]] as [number, number][]
}

/** Snapshot the current plane so a pending wire survives later workplane() moves. */
function planeOf(wp: Pick<Workplane, 'origin' | 'xDir' | 'yDir' | 'normal'>): WirePlane {
  return {
    origin: [...wp.origin] as [number, number, number],
    xDir: [...wp.xDir] as [number, number, number],
    yDir: [...wp.yDir] as [number, number, number],
    normal: [...wp.normal] as [number, number, number],
  }
}

/** Create an empty workplane on the given plane (CadQuery named-plane axes). */
function makeWorkplane(plane: string): Workplane {
  // Full named-plane table verified against cadquery 2.8.0 (Plane.named):
  // 'front' == XY, 'bottom' == XZ, etc. The old 3-entry table silently fell
  // back to XY for any other name — e.g. "front"→XY was luck, but "top" would
  // have been wrong. Unknown names now throw like upstream.
  const axes: Record<string, { n: [number, number, number]; x: [number, number, number] }> = {
    XY: { n: [0, 0, 1], x: [1, 0, 0] },
    YZ: { n: [1, 0, 0], x: [0, 1, 0] },
    ZX: { n: [0, 1, 0], x: [0, 0, 1] },
    XZ: { n: [0, -1, 0], x: [1, 0, 0] },
    YX: { n: [0, 0, -1], x: [0, 1, 0] },
    ZY: { n: [-1, 0, 0], x: [0, 0, 1] },
    front: { n: [0, 0, 1], x: [1, 0, 0] },
    back: { n: [0, 0, -1], x: [-1, 0, 0] },
    left: { n: [-1, 0, 0], x: [0, 0, 1] },
    right: { n: [1, 0, 0], x: [0, 0, -1] },
    top: { n: [0, 1, 0], x: [1, 0, 0] },
    bottom: { n: [0, -1, 0], x: [1, 0, 0] },
  }
  const a = axes[plane]
  if (!a) {
    throw new Error(`[cq-compat] unknown plane "${plane}" (upstream names: XY/YZ/ZX/XZ/YX/ZY/front/back/left/right/top/bottom)`)
  }
  const yDir: [number, number, number] = [
    a.n[1] * a.x[2] - a.n[2] * a.x[1],
    a.n[2] * a.x[0] - a.n[0] * a.x[2],
    a.n[0] * a.x[1] - a.n[1] * a.x[0],
  ]
  return Object.assign(Object.create(WP_PROTO), {
    __cq: true as const,
    plane,
    origin: [0, 0, 0] as [number, number, number],
    normal: a.n,
    xDir: a.x,
    yDir,
    shape: null,
    faceSel: null,
    edgeSel: null,
    vertexSel: null,
    pts: [] as [number, number][],
    forConstruction: false,
  }) as Workplane
}

/** Clone a workplane with overrides (preserves custom prototype). */
function clone(wp: Workplane, overrides: Partial<Workplane>): Workplane {
  return Object.assign(Object.create(WP_PROTO), wp, overrides) as Workplane
}

/**
 * Unwrap a vendored brepjs `Result` into its value, throwing on `Err`.
 *
 * The vendored boolean ops return `Result<T>` (`{ ok: true, value }` /
 * `{ ok: false, error }`). Silently swallowing an `Err` here would leave the
 * workplane carrying stale geometry, so failures must surface.
 */
function unwrapBrepResult(result: unknown): unknown {
  if (result && typeof result === 'object' && 'ok' in result) {
    const r = result as { ok: boolean; value?: unknown; error?: unknown }
    if (!r.ok) {
      const detail =
        typeof r.error === 'string'
          ? r.error
          : JSON.stringify(r.error, (_k, v) => (typeof v === 'bigint' ? String(v) : v)) ??
            String(r.error)
      throw new Error(`[cq-compat] brep boolean op failed: ${detail}`)
    }
    return r.value
  }
  return result
}

/** Call a `brepjsCompat` member by name (namespace is typed loosely here). */
function compatFn(name: string): (...args: unknown[]) => unknown {
  const fn = (brepjsCompat as Record<string, unknown>)[name] as
    | ((...args: unknown[]) => unknown)
    | undefined
  if (!fn) throw new Error(`[cq-compat] brepjsCompat.${name} is not available`)
  return fn
}

/** Merge same-domain faces/edges after a boolean (CadQuery `clean=True`). */
async function cleanShapes(shape: Shape): Promise<Shape> {
  const simplified = unwrapBrepResult(compatFn('simplify')(borrowBrepjsShape(shape)))
  return adoptBrepjsProduct(simplified)
}

/**
 * Fuse two shapes into ONE solid via the vendored brepjs fuse.
 *
 * Rationale: `cad.union` (defineOp → booleanBrep → fromBrep repack) has been
 * observed to return a compound of two disjoint solids instead of a fused
 * single solid (see docs/analysis/2026-09-08-cq-compat-union-compound-bug.md).
 * The vendored `fuse` preserves the first operand's solid type, so the result
 * stays a single solid. See docs/analysis/2026-09-08-cq-compat-union-compound-bug.md.
 */
async function fuseShapes(a: Shape, b: Shape): Promise<Shape> {
  const product = unwrapBrepResult(compatFn('fuse')(borrowBrepjsShape(a), borrowBrepjsShape(b)))
  return cleanShapes(adoptBrepjsProduct(product))
}

/** Cut a tool shape out of a base shape via the vendored brepjs cut. */
async function cutShapes(base: Shape, tool: Shape): Promise<Shape> {
  const product = unwrapBrepResult(compatFn('cut')(borrowBrepjsShape(base), borrowBrepjsShape(tool)))
  return cleanShapes(adoptBrepjsProduct(product))
}

/** Intersect two shapes via the vendored brepjs intersect. */
async function intersectShapes(a: Shape, b: Shape): Promise<Shape> {
  const product = unwrapBrepResult(compatFn('intersect')(borrowBrepjsShape(a), borrowBrepjsShape(b)))
  return cleanShapes(adoptBrepjsProduct(product))
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
        // CadQuery DirectionMinMaxSelector indexing (verified vs cadquery
        // 2.8.0): '>A[k]' → faces ascending along A; '<A[k]' → descending.
        // Only faces PERPENDICULAR to the axis participate (bbox thin along
        // the axis), matching CadQuery's normal-direction filter.
        const perp: typeof cands = cands.filter((cd) => {
          const bb = kernel.getBoundingBox(cd.handle)
          const ext = [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin][dir.axis]
          return ext <= 0.1
        })
        const idx = parseInt(idxMatch[1], 10)
        const sorted = perp
          .slice()
          .sort((a, b) =>
            dir.sign === 1
              ? a.center[dir.axis] - b.center[dir.axis]
              : b.center[dir.axis] - a.center[dir.axis],
          )
        const pick = idx < 0 ? sorted.length + idx : idx
        if (pick < 0 || pick >= sorted.length) {
          throw new Error(
            `[cq-compat] selector "${sel}": index ${idx} out of range (${sorted.length} faces)`,
          )
        }
        best = sorted[pick]
        // Outward normal: away from the shape bbox center along the axis.
        const max = bboxMax(shape)
        const min = bboxMin(shape)
        const shapeCenter = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2]
        normal = [0, 0, 0]
        normal[dir.axis] = best.center[dir.axis] >= shapeCenter[dir.axis] ? 1 : -1
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
  const faces = compatFn('getFaces')(borrowBrepjsShape(shape)) as unknown[]
  type Entry = { c: [number, number, number]; bounds: Record<string, number> }
  const entries: Entry[] = faces.map((f) => {
    const b = compatFn('getBounds')(f) as Record<string, number>
    return {
      c: [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2, (b.zMin + b.zMax) / 2],
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
    (fb.xMin + fb.xMax) / 2,
    (fb.yMin + fb.yMax) / 2,
    (fb.zMin + fb.zMax) / 2,
  ]
  // Outward normal: away from the shape bbox center along the axis.
  normal[axis] = faceCenter[axis] >= center[axis] ? 1 : -1
  return { center: faceCenter, normal }
}

/**
 * Build a regular-polygon prism on a workplane (vendored polygon face +
 * extrude). CadQuery `polygon(n, d)`: n-gon inscribed in a circle of diameter
 * `d`, first vertex on the workplane local +X.
 */
async function makePolygonPrismAt(
  wp: Workplane,
  poly: { n: number; d: number },
  length: number,
  dir: [number, number, number],
): Promise<Shape> {
  const pts: [number, number, number][] = []
  for (let i = 0; i < poly.n; i++) {
    const a = (2 * Math.PI * i) / poly.n
    pts.push(localToWorld(wp, Math.cos(a) * (poly.d / 2), Math.sin(a) * (poly.d / 2)))
  }
  const face = unwrapBrepResult(compatFn('polygon')(pts))
  const vec: [number, number, number] = [dir[0] * length, dir[1] * length, dir[2] * length]
  const prism = unwrapBrepResult(compatFn('extrude')(face, vec))
  return adoptBrepjsProduct(prism)
}

/**
 * Rotate a Z-axis-aligned primitive so its local +Z maps to `d` — ANY direction,
 * not just axis-aligned (verified vs cadquery 2.8.0: angled holes drill along
 * the transformed workplane normal). Euler decomposition that maps +Z onto d:
 *   θy = asin(dx), θx = atan2(−dy, dz)   (three.js XYZ-intrinsic, R = Rx·Ry)
 *   Rx(θx)·Ry(θy)·(0,0,1) = (dx, dy, dz)
 */
async function orientZTo(shape: Shape, d: [number, number, number]): Promise<Shape> {
  const len = Math.hypot(d[0], d[1], d[2])
  const dx = d[0] / len
  const dy = d[1] / len
  const dz = d[2] / len
  const thetaX = Math.atan2(-dy, dz)
  const thetaY = Math.asin(Math.max(-1, Math.min(1, dx)))
  const anglesDeg: [number, number, number] = [
    (thetaX * 180) / Math.PI,
    (thetaY * 180) / Math.PI,
    0,
  ]
  return cad.rotate_euler(shape, { anglesDeg }) as unknown as Shape
}

/**
 * Create a cone whose base (radius rBase) sits at the workplane origin and
 * whose apex side extends `height` along `wp.normal`-direction `d`.
 * Used for the full-cone countersink cut of cskHole (CadQuery semantics:
 * h = cskRadius / tan(cskAngle/2), cone from rBase to apex).
 */
async function makeConeAt(
  wp: Workplane,
  rBase: number,
  height: number,
  d: [number, number, number],
): Promise<Shape> {
  const cone = await cad.cone(rBase, 0, height, { centered: true })
  const oriented = await orientZTo(cone as unknown as Shape, d)
  const center = vadd(wp.origin, vscale(d, height / 2))
  return cad.translate(oriented, { offset: center })
}

/**
 * Create a cylinder at the workplane origin, oriented along normal.
 * Used for hole/cutBlind implementations.
 */
async function makeCylinderAt(
  wp: Workplane,
  radius: number,
  height: number,
): Promise<Shape> {
  const cyl = await cad.cylinder(radius, height, { centered: true })
  const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
  const o = Array.isArray(wp.origin) ? wp.origin : ([0, 0, 0] as [number, number, number])
  // Rotate the Z-axis cylinder so its axis aligns with the workplane normal.
  const oriented = await orientZTo(cyl as unknown as Shape, n)
  const center: [number, number, number] = [o[0] + n[0] * height / 2, o[1] + n[1] * height / 2, o[2] + n[2] * height / 2]
  return cad.translate(oriented, { offset: center })
}

/**
 * Create a box at the workplane origin: `w` along the workplane xDir, `d`
 * along yDir, `h` along the normal (CadQuery rect+extrude tool semantics).
 * The tool is built axis-aligned with the world extents implied by the
 * workplane basis, so it is correct for any axis-aligned normal.
 */
async function makeBoxAt(
  wp: Workplane,
  w: number,
  d: number,
  h: number,
): Promise<Shape> {
  const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
  const o = Array.isArray(wp.origin) ? wp.origin : ([0, 0, 0] as [number, number, number])
  const axes = faceAxes(n)
  // World-space extents of a w×d×h box aligned to the (axis-aligned) basis.
  const sx = w * Math.abs(axes.x[0]) + d * Math.abs(axes.y[0]) + h * Math.abs(n[0])
  const sy = w * Math.abs(axes.x[1]) + d * Math.abs(axes.y[1]) + h * Math.abs(n[1])
  const sz = w * Math.abs(axes.x[2]) + d * Math.abs(axes.y[2]) + h * Math.abs(n[2])
  const box = await cad.box(sx, sy, sz, { centered: true })
  const center: [number, number, number] = [o[0] + n[0] * h / 2, o[1] + n[1] * h / 2, o[2] + n[2] * h / 2]
  return cad.translate(box, { offset: center })
}

// ── Public API ─────────────────────────────────────────────────────────────

/** CadQuery `centered` parameter: bool or per-axis triple. */
type Centered3 = boolean | [boolean, boolean, boolean]

/** Normalize a `centered` parameter to a per-axis triple. */
function resolveCentered(c: Centered3): [boolean, boolean, boolean] {
  return typeof c === 'boolean' ? [c, c, c] : c
}

/** Build a compound Shape from several Shapes (brepjs makeCompound projection). */
function makeCompoundShape(shapes: Shape[]): Shape {
  if (shapes.length === 1) return shapes[0]
  const product = unwrapBrepResult(
    compatFn('makeCompound')(shapes.map((s) => borrowBrepjsShape(s))),
  )
  return adoptBrepjsProduct(product)
}

/**
 * Finish an eachpoint-style op (box/sphere/cylinder): `combine=True` (CadQuery
 * default) fuses the created bodies with each other and with the existing
 * solid on the workplane; `combine=False` leaves them as separate solids in a
 * compound (verified vs cadquery 2.8.0: testSpherePointList -> 4 solids).
 */
async function combineEachpoint(
  wp: Workplane,
  shapes: Shape[],
  combine: boolean,
): Promise<Workplane> {
  let shape: Shape
  if (combine) {
    shape = shapes[0]
    for (let i = 1; i < shapes.length; i++) {
      shape = await fuseShapes(shape, shapes[i])
    }
    if (wp.shape) shape = await fuseShapes(wp.shape, shape)
  } else {
    shape = makeCompoundShape(shapes)
  }
  return clone(wp, { shape, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
}

/**
 * Workplane
 * @param plane - string
 * @returns Workplane
 */
export function Workplane(plane: string = 'XY'): Workplane {
  return makeWorkplane(plane)
}

/**
 * add
 * @param wp - Workplane
 * @param shape - Shape
 * @returns Promise<Workplane>
 */
export async function add(wp: Workplane, shape: Shape): Promise<Workplane> {
  return clone(wp, { shape })
}

/**
 * box
 * @param wp - Workplane
 * @param w - number
 * @param d - number
 * @param h - number
 * @param opts - { centered?; combine? }
 * @returns Promise<Workplane>
 *
 * CadQuery semantics (verified vs cadquery 2.8.0 `Workplane.box`): with the
 * default `centered=(True, True, True)` the box is centered on the workplane
 * origin in ALL three axes — including the normal direction. The old
 * "sit on the face" behaviour belonged to the makeBoxAt tool-body helper and
 * leaked into this public op (found by the parity harness, testBoxDefaults).
 *
 * Each-point semantics (verified vs 2.8.0): box() is eachpoint-based — with
 * points pushed on the stack a box is created at every point; `combine=True`
 * (default) fuses them with the existing solid, `combine=False` leaves them
 * as separate solids in a compound (test_getitem / testBoxPointList).
 */
export async function box(
  wp: Workplane,
  w: number,
  d: number,
  h: number,
  opts?: { centered?: Centered3; combine?: boolean },
): Promise<Workplane> {
  const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
  const axes = faceAxes(n)
  // World-space extents of a w×d×h box aligned to the (axis-aligned) basis.
  const sx = w * Math.abs(axes.x[0]) + d * Math.abs(axes.y[0]) + h * Math.abs(n[0])
  const sy = w * Math.abs(axes.x[1]) + d * Math.abs(axes.y[1]) + h * Math.abs(n[1])
  const sz = w * Math.abs(axes.x[2]) + d * Math.abs(axes.y[2]) + h * Math.abs(n[2])
  const boxShape = await cad.box(sx, sy, sz, { centered: true })
  const c = resolveCentered(opts?.centered ?? true)
  // Uncentered axis: bbox corner sits on the point (offset by half the extent).
  const off: [number, number, number] = [
    c[0] ? 0 : (w / 2) * axes.x[0] + (d / 2) * axes.y[0] + (h / 2) * n[0],
    c[1] ? 0 : (w / 2) * axes.x[1] + (d / 2) * axes.y[1] + (h / 2) * n[1],
    c[2] ? 0 : (w / 2) * axes.x[2] + (d / 2) * axes.y[2] + (h / 2) * n[2],
  ]
  const points = eachPoints(wp)
  const shapes: Shape[] = []
  for (const [px, py] of points) {
    const center = vadd(localToWorld(wp, px, py), off)
    shapes.push(await cad.translate(boxShape, { offset: center }))
  }
  return combineEachpoint(wp, shapes, opts?.combine ?? true)
}

/**
 * sphere
 * @param wp - Workplane
 * @param radius - number
 * @param opts - { centered?; combine? }
 * @returns Promise<Workplane>
 *
 * CadQuery semantics (verified vs cadquery 2.8.0 `Workplane.sphere`): a sphere
 * is created for every point on the stack (or the workplane origin); per-axis
 * `centered=false` puts the sphere's bbox corner on the point. Only full
 * spheres are supported (angle1/angle2/angle3 partial sweeps are not
 * expressible with the cad.sphere primitive — upstream testSphereCustom stays
 * blocked on that).
 */
export async function sphere(
  wp: Workplane,
  radius: number,
  opts?: { centered?: Centered3; combine?: boolean },
): Promise<Workplane> {
  const c = resolveCentered(opts?.centered ?? true)
  const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
  const x = Array.isArray(wp.xDir) ? wp.xDir : ([1, 0, 0] as [number, number, number])
  const y = Array.isArray(wp.yDir) ? wp.yDir : ([0, 1, 0] as [number, number, number])
  // Local-frame offset: uncentered axis -> bbox corner on the point.
  const offLocal: [number, number, number] = [c[0] ? 0 : radius, c[1] ? 0 : radius, c[2] ? 0 : radius]
  const off = vadd(vadd(vscale(x, offLocal[0]), vscale(y, offLocal[1])), vscale(n, offLocal[2]))
  const points = eachPoints(wp)
  const shapes: Shape[] = []
  for (const [px, py] of points) {
    const center = vadd(localToWorld(wp, px, py), off)
    shapes.push(await cad.sphere({ radius, center }))
  }
  return combineEachpoint(wp, shapes, opts?.combine ?? true)
}

/**
 * Rotation R mapping local +Z onto `d`, reproducing OCCT `gp_Ax3(P, D)`
 * auto-XDirection (verified vs cadquery 2.8.0 by measuring
 * `Workplane.cylinder(..., direct=...)` center offsets for all six axis
 * directions). Applied to the per-axis `centered` offsets before the
 * workplane mapping, exactly as upstream `s.moved(Plane(...).location)` does.
 */
function ax3Rotation(d: [number, number, number]): [number, number, number][] {
  const key = `${d[0]},${d[1]},${d[2]}`
  // rows: R·ex, R·ey, R·ez
  const table: Record<string, [[number, number, number], [number, number, number], [number, number, number]]> = {
    '1,0,0': [[0, 0, 1], [0, -1, 0], [1, 0, 0]],
    '-1,0,0': [[0, 0, -1], [0, -1, 0], [-1, 0, 0]],
    '0,1,0': [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    '0,-1,0': [[0, 0, -1], [1, 0, 0], [0, -1, 0]],
    '0,0,1': [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    '0,0,-1': [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
  }
  const r = table[key]
  if (!r) throw new Error(`[cq-compat] cylinder direct ${key} not supported (axis directions only)`)
  return r
}

/**
 * cylinder
 * @param wp - Workplane
 * @param height - number
 * @param radius - number
 * @param opts - { direct?; centered?; combine? }
 * @returns Promise<Workplane>
 *
 * CadQuery semantics (verified vs cadquery 2.8.0 `Workplane.cylinder`): a
 * cylinder for every point on the stack; per-axis `centered` offsets are
 * applied in the LOCAL frame (xDir/yDir/normal), then rotated by the
 * `direct` plane orientation (ax3Rotation table), then mapped by the
 * workplane basis. `angle != 360` pie-slice sweeps are not supported.
 */
export async function cylinder(
  wp: Workplane,
  height: number,
  radius: number,
  opts?: { direct?: [number, number, number]; angle?: number; centered?: Centered3; combine?: boolean },
): Promise<Workplane> {
  const c = resolveCentered(opts?.centered ?? true)
  const d = opts?.direct ?? [0, 0, 1]
  if (opts?.angle !== undefined && opts.angle !== 360) {
    throw new Error('[cq-compat] cylinder angle != 360 is not supported')
  }
  const R = ax3Rotation(d)
  const rot = (v: [number, number, number]): [number, number, number] => [
    R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
    R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
    R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
  ]
  const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
  const x = Array.isArray(wp.xDir) ? wp.xDir : ([1, 0, 0] as [number, number, number])
  const y = Array.isArray(wp.yDir) ? wp.yDir : ([0, 1, 0] as [number, number, number])
  // Map a local vector through the workplane basis.
  const map = (v: [number, number, number]): [number, number, number] =>
    vadd(vadd(vscale(x, v[0]), vscale(y, v[1])), vscale(n, v[2]))
  // Uncentered axis -> base offset by half the local extent.
  const offLocal: [number, number, number] = [
    c[0] ? 0 : radius,
    c[1] ? 0 : radius,
    c[2] ? -height / 2 : 0,
  ]
  const off = map(rot(offLocal))
  const axis = map(d)
  const axisLen = Math.hypot(axis[0], axis[1], axis[2])
  const axisUnit: [number, number, number] = [axis[0] / axisLen, axis[1] / axisLen, axis[2] / axisLen]
  const points = eachPoints(wp)
  const shapes: Shape[] = []
  for (const [px, py] of points) {
    const base = vadd(localToWorld(wp, px, py), off)
    const bodyCenter = vadd(base, vscale(axisUnit, height / 2))
    const cyl = await cad.cylinder({ radius, height, centered: true })
    const oriented = await orientZTo(cyl as unknown as Shape, axisUnit)
    shapes.push(await cad.translate(oriented, { offset: bodyCenter }))
  }
  return combineEachpoint(wp, shapes, opts?.combine ?? true)
}

/**
 * torus — CadQuery free-function analogue (occ_impl.shapes.torus).
 *
 * Upstream takes DIAMETERS and builds a full torus centred at the origin,
 * axis +Z: `torus(d1, d2)` -> R = d1/2, r = d2/2, V = 2π²·R·r²
 * (`torus(10, 2)` -> 98.696, ref-verified against cadquery 2.8.0).
 *
 * @param wp - Workplane carrier (fresh `Workplane()` for the free function).
 * @param d1 - Major DIAMETER.
 * @param d2 - Minor DIAMETER.
 * @returns Promise<Workplane> carrying the torus solid.
 */
export async function torus(
  wp: Workplane,
  d1: number,
  d2: number,
  opts?: { combine?: boolean },
): Promise<Workplane> {
  const product = unwrapBrepResult(compatFn('torus')(d1 / 2, d2 / 2))
  const shape = adoptBrepjsProduct(product)
  return combineEachpoint(wp, [shape], opts?.combine ?? true)
}

/**
 * cone — CadQuery free-function analogue (occ_impl.shapes.cone).
 *
 * Upstream takes DIAMETERS with the base centred on the origin at z=0, axis
 * +Z: `cone(d1, d2, h)` -> R = d1/2, r = d2/2, V = π/3·h·(R²+Rr+r²)
 * (`cone(2, 1, 1)` -> 1.8326, ref-verified against cadquery 2.8.0). The
 * 2-arg upstream form `cone(d, h)` is the full cone — pass `d2 = 0`.
 *
 * @param wp - Workplane carrier (fresh `Workplane()` for the free function).
 * @param d1 - Base DIAMETER.
 * @param d2 - Top DIAMETER (0 for a full cone).
 * @param h - Height along +Z.
 * @returns Promise<Workplane> carrying the cone solid.
 */
export async function cone(
  wp: Workplane,
  d1: number,
  d2: number,
  h: number,
  opts?: { combine?: boolean },
): Promise<Workplane> {
  const base = await cad.cone(d1 / 2, d2 / 2, h, { centered: true })
  // Kernel cone with centered:true is centred at the origin mid-height; lift
  // by h/2 so the base circle sits on z=0 (upstream free-function semantics).
  const shape = await cad.translate(base as unknown as Shape, { offset: [0, 0, h / 2] })
  return combineEachpoint(wp, [shape as Shape], opts?.combine ?? true)
}

/**
 * rarray
 * @param wp - Workplane
 * @param xSpacing - number
 * @param ySpacing - number
 * @param xCount - number
 * @param yCount - number
 * @param center - boolean | [boolean, boolean]
 * @returns Workplane
 *
 * CadQuery semantics (verified vs cadquery 2.8.0 `Workplane.rarray`): pushes
 * an xCount×yCount grid of points; per-axis `center=true` centers the grid on
 * the workplane origin, `false` puts the lower corner on it.
 */
export function rarray(
  wp: Workplane,
  xSpacing: number,
  ySpacing: number,
  xCount: number,
  yCount: number,
  center: boolean | [boolean, boolean] = true,
): Workplane {
  if (xCount < 1 || yCount < 1 || (xSpacing <= 0 && ySpacing <= 0)) {
    throw new Error('[cq-compat] rarray: spacing and count must be > 0 in at least one direction')
  }
  const [cx, cy] = typeof center === 'boolean' ? [center, center] : center
  const ox = cx ? (-(xCount - 1) * xSpacing) / 2 : 0
  const oy = cy ? (-(yCount - 1) * ySpacing) / 2 : 0
  const pts: [number, number][] = []
  for (let i = 0; i < xCount; i++) {
    for (let j = 0; j < yCount; j++) {
      pts.push([i * xSpacing + ox, j * ySpacing + oy])
    }
  }
  return clone(wp, { pts })
}

/**
 * rect
 * @param wp - Workplane
 * @param w - number
 * @param d - number
 * @param opts - { forConstruction?: boolean }
 * @returns Workplane
 */
export function rect(
  wp: Workplane,
  w: number,
  d: number,
  opts?: { forConstruction?: boolean; centered?: boolean | [boolean, boolean] },
): Workplane {
  // Upstream (cadquery 2.8.0 Workplane.rect): centered may be a bool or a
  // per-axis 2-tuple; centered=false puts the CORNER on the reference point,
  // extending in the +x/+y directions (offset is +len/2 even for negatives).
  const centered = opts?.centered ?? true
  const [cxOn, cyOn] = Array.isArray(centered) ? centered : [centered, centered]
  const ox = cxOn ? 0 : w / 2
  const oy = cyOn ? 0 : d / 2
  const at = eachPoints(wp)
  if (opts?.forConstruction) {
    // Construction rect: store corners for vertices() and edge midpoints for edges()
    return clone(wp, {
      forConstruction: true,
      pendingRect: { w, d },
      pendingWires: [
        ...(wp.pendingWires ?? []),
        ...at.map(([px, py]) => ({ kind: 'rect' as const, w, d, cx: px + ox, cy: py + oy, construction: true, plane: planeOf(wp) })),
      ],
      pts: [
        [ox - w / 2, oy - d / 2],
        [ox + w / 2, oy - d / 2],
        [ox + w / 2, oy + d / 2],
        [ox - w / 2, oy + d / 2],
      ],
      edgePts: [
        [ox, oy - d / 2],
        [ox + w / 2, oy],
        [ox, oy + d / 2],
        [ox - w / 2, oy],
      ],
    })
  }
  // Non-construction rect: store profile for extrude()/cutBlind()
  return clone(wp, {
    forConstruction: false,
    pendingRect: { w, d },
    pendingWires: [
      ...(wp.pendingWires ?? []),
      ...at.map(([px, py]) => ({ kind: 'rect' as const, w, d, cx: px + ox, cy: py + oy, construction: false, plane: planeOf(wp) })),
    ],
  })
}

/**
 * circle
 * @param wp - Workplane
 * @param radius - number
 * @returns Workplane
 */
export function circle(wp: Workplane, radius: number): Workplane {
  // CadQuery eachpoint semantics: with pushed points / selected vertices the
  // circle is created at EVERY point, and all of them land in pendingWires.
  const at = eachPoints(wp)
  return clone(wp, {
    forConstruction: false,
    pendingCircle: { radius },
    pendingWires: [
      ...(wp.pendingWires ?? []),
      ...at.map(([cx, cy]) => ({ kind: 'circle' as const, radius, cx, cy, construction: false, plane: planeOf(wp) })),
    ],
  })
}

/**
 * polygon
 * @param wp - Workplane
 * @param n - number
 * @param d - number
 * @returns Workplane
 */
export function polygon(wp: Workplane, n: number, d: number): Workplane {
  // CadQuery polygon(nSides, diameter): regular n-gon inscribed in a circle of
  // the given diameter, first vertex on local +X. The prism is materialized
  // when consumed by extrude()/cutBlind() (makePolygonPrismAt).
  const at = eachPoints(wp)
  return clone(wp, {
    forConstruction: false,
    pendingPolygon: { n, d },
    pendingWires: [
      ...(wp.pendingWires ?? []),
      ...at.map(([cx, cy]) => ({ kind: 'polygon' as const, n, d, cx, cy, construction: false, plane: planeOf(wp) })),
    ],
  })
}

/**
 * Implicit workplane for a pending face selection.
 *
 * CadQuery semantics (verified against cadquery 2.8.0): after `faces(sel)`, a
 * 2D profile followed by extrude/cut operates on the SELECTED face's plane,
 * exactly as if `workplane()` had been called — even though `Workplane.plane`
 * still reports the original origin. Measured on `box(1,1,1)`:
 *   - `box(1,1,1).rect(1,.5).cutBlind(-0.2)`        -> CoM z = +0.011111
 *     (slot at z in [-0.2, 0])
 *   - `box(1,1,1).faces(">Z").rect(1,.5).cutBlind(-0.2)` -> CoM z = -0.044444
 *     (slot at z in [0.3, 0.5])
 *   - `...faces(">Z")...cutBlind(+0.2)`              -> volume unchanged (1.0):
 *     the cut starts at z=0.5 and misses the solid entirely.
 * Without this step the profile is built on the un-lifted workplane and the
 * feature lands half a body away.
 *
 * NOTE ON TYPES: `workplane()` never touches `.shape`, only origin/axes. But
 * reassigning `wp` resets TypeScript's narrowing of `wp.shape`, so call sites
 * must capture the shape in a local BEFORE calling this helper.
 *
 * @param wp - Workplane possibly carrying a face selection.
 * @returns Promise<Workplane> with the face plane applied, or `wp` unchanged.
 */
async function applyPendingFacePlane(wp: Workplane): Promise<Workplane> {
  if (!wp.faceSel) return wp
  return workplane(wp)
}

// ── Pending-wire profiles (CadQuery pendingWires parity) ───────────────────

/** Local-space (workplane 2D) bounding box of a pending wire. */
function wireBBox(w: PendingWire): { minX: number; minY: number; maxX: number; maxY: number } {
  if (w.kind === 'circle') {
    return {
      minX: w.cx - w.radius,
      minY: w.cy - w.radius,
      maxX: w.cx + w.radius,
      maxY: w.cy + w.radius,
    }
  }
  if (w.kind === 'rect') {
    return {
      minX: w.cx - w.w / 2,
      minY: w.cy - w.d / 2,
      maxX: w.cx + w.w / 2,
      maxY: w.cy + w.d / 2,
    }
  }
  if (w.kind === 'path') {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of w.pts) {
      minX = Math.min(minX, p[0])
      minY = Math.min(minY, p[1])
      maxX = Math.max(maxX, p[0])
      maxY = Math.max(maxY, p[1])
    }
    return { minX, minY, maxX, maxY }
  }
  // polygon: circumradius = d/2 (n-gon inscribed in a circle of diameter d)
  const r = w.d / 2
  return { minX: w.cx - r, minY: w.cy - r, maxX: w.cx + r, maxY: w.cy + r }
}

/**
 * Group pending wires into faces: every outermost wire becomes one face and
 * the wires it encloses become that face's holes.
 *
 * Mirrors cadquery 2.8.0 (measured, `sortWiresByBuildOrder`-like behaviour):
 *   `pushPoints([p1,p2]).circle(4).circle(2)` -> TWO annuli (2 solids)
 *   `rect(2,2)` + 4 corner circles            -> ONE plate with 4 holes
 *
 * Nesting is decided by bbox containment; area ties keep declaration order so
 * disjoint wires of equal size never swallow each other.
 */
function groupPendingWires(wires: PendingWire[]): { outer: PendingWire; holes: PendingWire[] }[] {
  const boxes = wires.map(wireBBox)
  const area = (i: number) => (boxes[i].maxX - boxes[i].minX) * (boxes[i].maxY - boxes[i].minY)
  const order = wires.map((_, i) => i).sort((a, b) => area(b) - area(a) || a - b)
  const groups: { outer: PendingWire; holes: PendingWire[] }[] = []
  const claimed = new Set<number>()
  for (const i of order) {
    if (claimed.has(i)) continue
    claimed.add(i)
    const ob = boxes[i]
    const holes: PendingWire[] = []
    for (const j of order) {
      if (claimed.has(j)) continue
      const hb = boxes[j]
      if (hb.minX >= ob.minX && hb.maxX <= ob.maxX && hb.minY >= ob.minY && hb.maxY <= ob.maxY) {
        claimed.add(j)
        holes.push(wires[j])
      }
    }
    groups.push({ outer: wires[i], holes })
  }
  return groups
}

// ── 2D drafting (CadQuery moveTo/lineTo/close/wire parity) ─────────────────

/**
 * Current drawing point in local coordinates.
 *
 * Upstream `_findFromPoint` returns the end point of the last stack object, or
 * `plane.origin` when the stack is empty — hence the `[0, 0]` fallback.
 */
function currentLocalPoint(wp: Workplane): [number, number] {
  return wp.currentPoint ?? ([0, 0] as [number, number])
}

/**
 * Draft one straight edge from the current point to `to` and advance there.
 *
 * `forConstruction` edges still move the current point (upstream calls
 * `newObject([edge])` unconditionally) but are NOT queued into `pendingEdges`
 * and never set `firstPoint` — upstream only queues via `_addPendingEdge`.
 */
function draftEdge(wp: Workplane, to: [number, number], forConstruction: boolean): Workplane {
  const from = currentLocalPoint(wp)
  if (forConstruction) {
    return clone(wp, { currentPoint: to })
  }
  const edges: PendingEdge[] = [...(wp.pendingEdges ?? []), { from, to }]
  return clone(wp, {
    pendingEdges: edges,
    currentPoint: to,
    firstPoint: wp.firstPoint ?? from,
  })
}

/**
 * moveTo — move the current point without drawing (CadQuery `Workplane.moveTo`).
 * @param wp - Workplane
 * @param x - target x in local coords (default 0)
 * @param y - target y in local coords (default 0)
 * @returns Workplane
 */
export function moveTo(wp: Workplane, x: number = 0, y: number = 0): Workplane {
  return clone(wp, { currentPoint: [x, y] as [number, number] })
}

/**
 * move2D — relative version of `moveTo` (CadQuery `Workplane.move`).
 *
 * NOTE: upstream spells this `move`, but the Shape-level `move` (the in-place
 * twin of `moved`, which takes `Location` arguments) already owns that name in
 * cq-compat, so the 2D drafting variant is exported as `move2D`.
 *
 * @param wp - Workplane
 * @param xDist - x offset from the current point (default 0)
 * @param yDist - y offset from the current point (default 0)
 * @returns Workplane
 */
export function move2D(wp: Workplane, xDist: number = 0, yDist: number = 0): Workplane {
  const p = currentLocalPoint(wp)
  return moveTo(wp, p[0] + xDist, p[1] + yDist)
}

/**
 * lineTo — draft a straight edge to an absolute local point
 * (CadQuery `Workplane.lineTo`).
 * @param wp - Workplane
 * @param x - target x in local coords
 * @param y - target y in local coords
 * @param forConstruction - edge is reference geometry only (default false)
 * @returns Workplane
 */
export function lineTo(wp: Workplane, x: number, y: number, forConstruction: boolean = false): Workplane {
  return draftEdge(wp, [x, y], forConstruction)
}

/**
 * line — draft a straight edge by a relative offset (CadQuery `Workplane.line`).
 * @param wp - Workplane
 * @param xDist - x offset from the current point
 * @param yDist - y offset from the current point
 * @param forConstruction - edge is reference geometry only (default false)
 * @returns Workplane
 */
export function line(wp: Workplane, xDist: number, yDist: number, forConstruction: boolean = false): Workplane {
  const p = currentLocalPoint(wp)
  return draftEdge(wp, [p[0] + xDist, p[1] + yDist], forConstruction)
}

/** vLine — vertical (local +Y) relative line (CadQuery `Workplane.vLine`). */
export function vLine(wp: Workplane, distance: number, forConstruction: boolean = false): Workplane {
  return line(wp, 0, distance, forConstruction)
}

/** hLine — horizontal (local +X) relative line (CadQuery `Workplane.hLine`). */
export function hLine(wp: Workplane, distance: number, forConstruction: boolean = false): Workplane {
  return line(wp, distance, 0, forConstruction)
}

/** vLineTo — vertical line to an absolute local y (CadQuery `Workplane.vLineTo`). */
export function vLineTo(wp: Workplane, yCoord: number, forConstruction: boolean = false): Workplane {
  return lineTo(wp, currentLocalPoint(wp)[0], yCoord, forConstruction)
}

/** hLineTo — horizontal line to an absolute local x (CadQuery `Workplane.hLineTo`). */
export function hLineTo(wp: Workplane, xCoord: number, forConstruction: boolean = false): Workplane {
  return lineTo(wp, xCoord, currentLocalPoint(wp)[1], forConstruction)
}

/**
 * polyline — draft a chain of edges through the given local points
 * (CadQuery `Workplane.polyline`).
 *
 * `includeCurrent=false` (upstream default) treats the FIRST point as an
 * implicit moveTo and only draws from it onward.
 *
 * @param wp - Workplane
 * @param pts - local 2D points
 * @param forConstruction - edges are reference geometry only (default false)
 * @param includeCurrent - start from the current point (default false)
 * @returns Workplane
 */
export function polyline(
  wp: Workplane,
  pts: [number, number][],
  forConstruction: boolean = false,
  includeCurrent: boolean = false,
): Workplane {
  if (!Array.isArray(pts) || pts.length === 0) return wp
  let cur = wp
  if (includeCurrent) {
    for (const p of pts) cur = draftEdge(cur, [p[0], p[1]], forConstruction)
    return cur
  }
  // Upstream: startPoint = pts[0] (no edge drawn), then edges to pts[1:].
  cur = clone(cur, { currentPoint: [pts[0][0], pts[0][1]] as [number, number] })
  for (const p of pts.slice(1)) cur = draftEdge(cur, [p[0], p[1]], forConstruction)
  return cur
}

/**
 * wire — combine all pending edges into one pending wire
 * (CadQuery `Workplane.wire`). No-op when there are no free edges (upstream
 * returns self unchanged in that case).
 *
 * @param wp - Workplane
 * @param forConstruction - keep the wire out of the solid profile (default false)
 * @returns Workplane
 */
export function wire(wp: Workplane, forConstruction: boolean = false): Workplane {
  const edges = wp.pendingEdges ?? []
  if (edges.length === 0) return wp
  const pts: [number, number][] = []
  for (const e of edges) {
    if (pts.length === 0) pts.push([e.from[0], e.from[1]])
    pts.push([e.to[0], e.to[1]])
  }
  // close() may already have appended the segment back to the first point;
  // drop the duplicated vertex so the ring has no zero-length edge.
  if (pts.length > 1) {
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) pts.pop()
  }
  const w: PendingWire = {
    kind: 'path',
    pts,
    construction: forConstruction,
    plane: planeOf(wp),
  }
  return clone(wp, {
    pendingEdges: [],
    pendingWires: forConstruction ? wp.pendingWires : [...(wp.pendingWires ?? []), w],
  })
}

/**
 * close — end drafting and build a closed wire (CadQuery `Workplane.close`).
 * Appends the closing segment when the end point is more than 1e-6 away from
 * the first point (upstream threshold), then delegates to `wire()`.
 *
 * @param wp - Workplane
 * @returns Workplane
 */
export function close(wp: Workplane): Workplane {
  const end = currentLocalPoint(wp)
  const start = wp.firstPoint
  if (!start) {
    throw new Error('[cq-compat] close: No start point specified - cannot close')
  }
  let cur = wp
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) > 1e-6) {
    cur = draftEdge(cur, [start[0], start[1]], false)
  }
  cur = clone(cur, { firstPoint: undefined })
  return wire(cur)
}

/** Build a brepjs wire for a pending 2D profile, in world coordinates. */
async function buildProfileWire(wp: Workplane, w: PendingWire): Promise<unknown> {
  // Use the wire's own creation-plane snapshot when present (loft sections can
  // live on different planes after intermediate workplane()/transformed calls).
  const pl = w.plane ?? {
    origin: wp.origin,
    xDir: wp.xDir,
    yDir: wp.yDir,
    normal: wp.normal,
  }
  const n = Array.isArray(pl.normal) ? pl.normal : ([0, 0, 1] as [number, number, number])
  if (w.kind === 'circle') {
    const center = localToWorld(pl, w.cx, w.cy)
    const edge = unwrapBrepResult(compatFn('makeCircle')(w.radius, center, n))
    return unwrapBrepResult(compatFn('assembleWire')([edge]))
  }
  if (w.kind === 'path') {
    // Drafted ring: consecutive points are edges, last closes back to first.
    // Zero-length segments (a close() that landed exactly on the start point)
    // are skipped — OCCT rejects them in a wire.
    const edges: unknown[] = []
    for (let i = 0; i < w.pts.length; i++) {
      const a = w.pts[i]
      const b = w.pts[(i + 1) % w.pts.length]
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) continue
      edges.push(
        unwrapBrepResult(compatFn('makeLine')(localToWorld(pl, a[0], a[1]), localToWorld(pl, b[0], b[1]))),
      )
    }
    if (edges.length === 0) throw new Error('[cq-compat] buildProfileWire: degenerate path wire')
    return unwrapBrepResult(compatFn('assembleWire')(edges))
  }
  const ring: [number, number][] =
    w.kind === 'rect'
      ? [
          [w.cx - w.w / 2, w.cy - w.d / 2],
          [w.cx + w.w / 2, w.cy - w.d / 2],
          [w.cx + w.w / 2, w.cy + w.d / 2],
          [w.cx - w.w / 2, w.cy + w.d / 2],
        ]
      : Array.from({ length: w.n }, (_, i) => {
          const a = (2 * Math.PI * i) / w.n
          return [
            w.cx + Math.cos(a) * (w.d / 2),
            w.cy + Math.sin(a) * (w.d / 2),
          ] as [number, number]
        })
  const edges: unknown[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    edges.push(unwrapBrepResult(compatFn('makeLine')(localToWorld(pl, a[0], a[1]), localToWorld(pl, b[0], b[1]))))
  }
  return unwrapBrepResult(compatFn('assembleWire')(edges))
}

/**
 * Extrude the pending wire LIST: one face per outermost wire, enclosed wires
 * punched as holes, all faces extruded by `height` along the workplane normal
 * and unioned. Only used when more than one solid wire is pending — the
 * single-wire case keeps the legacy prism path (zero regression risk).
 */
/** Rebuild a pending wire translated by `shift` in world space (used to place cut tools). */
function shiftWire(w: PendingWire, wp: Workplane, shift: [number, number, number]): PendingWire {
  const base = w.plane ?? {
    origin: wp.origin,
    xDir: wp.xDir,
    yDir: wp.yDir,
    normal: wp.normal,
  }
  return {
    ...w,
    plane: {
      origin: [base.origin[0] + shift[0], base.origin[1] + shift[1], base.origin[2] + shift[2]],
      xDir: base.xDir,
      yDir: base.yDir,
      normal: base.normal,
    },
  } as PendingWire
}

async function pendingPathPrism(
  wp: Workplane,
  vec: [number, number, number],
  shift?: [number, number, number],
): Promise<Shape> {
  const all = (wp.pendingWires ?? []).filter((w) => !w.construction)
  const groups = groupPendingWires(all)
  let result: Shape | null = null
  for (const g of groups) {
    const outer = await buildProfileWire(wp, shift ? shiftWire(g.outer, wp, shift) : g.outer)
    const holeWires: unknown[] = []
    for (const h of g.holes) {
      holeWires.push(await buildProfileWire(wp, shift ? shiftWire(h, wp, shift) : h))
    }
    const face = unwrapBrepResult(compatFn('makeFace')(outer, holeWires))
    const prism = unwrapBrepResult(compatFn('extrude')(face, vec))
    const solid = adoptBrepjsProduct(prism) as Shape
    result = result ? await fuseShapes(result, solid) : solid
  }
  if (!result) throw new Error('[cq-compat] extrude: no pending wire to extrude')
  return result
}

async function extrudePendingWires(wp: Workplane, height: number): Promise<Shape> {
  const dir = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
  const vec: [number, number, number] = [dir[0] * height, dir[1] * height, dir[2] * height]
  return pendingPathPrism(wp, vec)
}

/** True when a drafted (moveTo/lineTo/close) wire is pending — legacy paths never use it. */
function hasPathWire(wp: Workplane): boolean {
  return (wp.pendingWires ?? []).some((w) => !w.construction && w.kind === 'path')
}

/**
 * extrude
 * @param wp - Workplane
 * @param height - number
 * @param combine - true (default): fuse the new solid with the carried shape;
 *   false: the carrier holds ONLY the freshly extruded solid (upstream
 *   `extrude(..., False)` — verified: testSolidReferenceCombineFalse exports the
 *   lone boss, Compound vol 0.03125). The "cut"/"s" modes are NOT supported yet.
 * @returns Promise<Workplane>
 */
export async function extrude(
  wp: Workplane,
  height: number,
  combine: boolean = true,
): Promise<Workplane> {
  // CadQuery pendingWires LIST: nested wires form one holed face per outermost
  // wire. Single-wire cases fall through to the legacy prism path unchanged.
  const solidWires = (wp.pendingWires ?? []).filter((w) => !w.construction)
  // A drafted path wire can never take the legacy single-slot path (there is no
  // pendingRect/pendingCircle/pendingPolygon for it), so it always goes through
  // the pendingWires LIST path. Everything else keeps the old condition.
  if (solidWires.length > 1 || hasPathWire(wp)) {
    const base = wp.shape
    wp = await applyPendingFacePlane(wp)
    const prism = await extrudePendingWires(wp, height)
    const shape =
      combine === false || !base ? prism : await fuseShapes(base, prism)
    return clone(wp, {
      shape,
      pendingWires: [],
      pendingPolygon: undefined,
      pendingRect: undefined,
      pendingCircle: undefined,
      faceSel: null,
      edgeSel: null,
      vertexSel: null,
      pts: [],
    })
  }
  // If there's a pending 2D profile (rect/circle/polygon) and no existing shape, create the 3D solid
  if (wp.pendingPolygon && !wp.shape) {
    const shape = await makePolygonPrismAt(wp, wp.pendingPolygon, height, wp.normal)
    return clone(wp, { shape, pendingWires: [], pendingPolygon: undefined, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
  }
  if (wp.pendingRect && !wp.shape) {
    const { w, d } = wp.pendingRect
    const shape = await makeBoxAt(wp, w, d, height)
    return clone(wp, { shape, pendingWires: [], pendingRect: undefined, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
  }
  if (wp.pendingCircle && !wp.shape) {
    const { radius } = wp.pendingCircle
    const shape = await makeCylinderAt(wp, radius, height)
    return clone(wp, { shape, pendingWires: [], pendingCircle: undefined, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
  }
  // Boss extrude on existing shape: create profile at each workplane point and union
  if (wp.shape) {
    // A pending faces(sel) lifts the profile plane (CadQuery implicit workplane).
    const base = wp.shape
    wp = await applyPendingFacePlane(wp)
    const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
    // Slight overlap ensures OCCT fuse merges coplanar faces into one solid
    const OVERLAP = 0.1
    // If we have a pending profile on an existing shape, create and union
    if (wp.pendingPolygon || wp.pendingRect || wp.pendingCircle) {
      const points = eachPoints(wp)
      let shape = base
      let separate: Shape | null = null
      for (const [px, py] of points) {
        const bossWp: Workplane = { ...wp, origin: localToWorld(wp, px, py) }
        // combine=false keeps the new solid standalone: no OVERLAP padding (it
        // exists only to make the fuse merge coplanar faces) and no fuse.
        const h = combine === false ? height : height + OVERLAP
        let boss: Shape
        if (wp.pendingPolygon) {
          boss = await makePolygonPrismAt(bossWp, wp.pendingPolygon, h, wp.normal)
        } else if (wp.pendingRect) {
          const { w, d } = wp.pendingRect
          boss = await makeBoxAt(bossWp, w, d, h)
        } else {
          boss = await makeCylinderAt(bossWp, wp.pendingCircle!.radius, h)
        }
        if (combine === false) {
          separate = separate ? await fuseShapes(separate, boss) : boss
          continue
        }
        const shifted = await cad.translate(boss, {
          offset: [-n[0] * OVERLAP, -n[1] * OVERLAP, -n[2] * OVERLAP],
        })
        shape = await fuseShapes(shape, shifted as unknown as Shape)
        // The OVERLAP padding extends the boss BELOW the face plane so the OCCT
        // fuse merges the coplanar contact. When the profile overhangs the base
        // (e.g. a boss centred on a corner, testWorkplaneCenterMove), that
        // padding leaves stray material OUTSIDE the base under the face plane —
        // upstream keeps nothing there. Remove exactly that region:
        // (shifted boss \ base) ∩ half-space below the face plane.
        // Profiles fully inside the base's cross-section can never overhang,
        // so the cheap bbox test skips the two extra booleans entirely.
        const bossB = compatFn('getBounds')(borrowBrepjsShape(boss)) as Record<string, number>
        const baseB = compatFn('getBounds')(borrowBrepjsShape(base)) as Record<string, number>
        const PAD_EPS = 1e-6
        const axisOf = (v: [number, number, number]): number =>
          Math.abs(v[0]) > 0.5 ? 0 : Math.abs(v[1]) > 0.5 ? 1 : 2
        // In-plane axes = the two axes perpendicular to the face normal.
        const overhangs = [0, 1, 2]
          .filter((i) => i !== axisOf(n))
          .some((i) => {
            const key = ['x', 'y', 'z'] as const
            return (
              bossB[`${key[i]}Min`] < baseB[`${key[i]}Min`] - PAD_EPS ||
              bossB[`${key[i]}Max`] > baseB[`${key[i]}Max`] + PAD_EPS
            )
          })
        if (overhangs) {
          const stray = await cutShapes(shifted as unknown as Shape, base)
          // Slab covering the half-space below the face plane (local z <= 0).
          const o = Array.isArray(wp.origin) ? wp.origin : ([0, 0, 0] as [number, number, number])
          const BIG =
            2 *
              Math.max(
                baseB.xMax - baseB.xMin,
                baseB.yMax - baseB.yMin,
                baseB.zMax - baseB.zMin,
                bossB.xMax - bossB.xMin,
                bossB.yMax - bossB.yMin,
                bossB.zMax - bossB.zMin,
              ) +
            10
          const belowWp: Workplane = {
            ...wp,
            origin: [o[0] - n[0] * BIG, o[1] - n[1] * BIG, o[2] - n[2] * BIG],
          }
          const slab = await makeBoxAt(belowWp, BIG, BIG, BIG)
          const strayBelow = await intersectShapes(stray, slab)
          shape = await cutShapes(shape, strayBelow)
        }
      }
      if (combine === false && separate) {
        return clone(wp, {
          shape: separate,
          pendingWires: [],
          pendingPolygon: undefined,
          pendingRect: undefined,
          pendingCircle: undefined,
          faceSel: null,
          edgeSel: null,
          vertexSel: null,
          pts: [],
        })
      }
      return clone(wp, {
        shape,
        pendingWires: [],
        pendingPolygon: undefined,
        pendingRect: undefined,
        pendingCircle: undefined,
        faceSel: null,
        edgeSel: null,
        vertexSel: null,
        pts: [],
      })
    }
    // No pending profile — return unchanged
    return wp
  }
  // No shape and no pending profile — return unchanged
  return wp
}

/**
 * revolve — CadQuery `Workplane.revolve` parity.
 *
 * Consumes the pending wire LIST (same grouping as extrude: one holed face per
 * outermost wire) and revolves each face around an axis. Axis endpoints are
 * LOCAL workplane coordinates (verified against cadquery 2.8.0
 * `Workplane.revolve`): start defaults to the plane origin; when only start is
 * given, end defaults to `(0, start.y)` if `start.y != 0` else `(0, 1)` — i.e.
 * the local +Y direction. Angle 0 is normalized to 360 (OCCT cannot do a
 * 0-degree revolve).
 *
 * @param wp - Workplane
 * @param angleDegrees - revolution angle (default 360)
 * @param axisStart - axis start point in local 2D coords
 * @param axisEnd - axis end point in local 2D coords
 * @param combine - true: fuse with base; "cut": subtract from base; false: keep separate
 * @returns Promise<Workplane>
 */
export async function revolve(
  wp: Workplane,
  angleDegrees = 360,
  axisStart?: [number, number] | [number, number, number],
  axisEnd?: [number, number] | [number, number, number],
  combine: boolean | 'cut' = true,
): Promise<Workplane> {
  let angle = ((angleDegrees % 360) + 360) % 360
  if (angle === 0) angle = 360

  const sLocal: [number, number] = axisStart ? [axisStart[0], axisStart[1]] : [0, 0]
  const eLocal: [number, number] = axisEnd
    ? [axisEnd[0], axisEnd[1]]
    : sLocal[1] !== 0
      ? [0, sLocal[1]]
      : [0, 1]
  const startW = localToWorld(wp, sLocal[0], sLocal[1])
  const endW = localToWorld(wp, eLocal[0], eLocal[1])
  const axis: [number, number, number] = [endW[0] - startW[0], endW[1] - startW[1], endW[2] - startW[2]]
  const len = Math.hypot(axis[0], axis[1], axis[2])
  if (len === 0) throw new Error('[cq-compat] revolve: axis start and end coincide')
  const dir: [number, number, number] = [axis[0] / len, axis[1] / len, axis[2] / len]

  const all = (wp.pendingWires ?? []).filter((w) => !w.construction)
  if (all.length === 0) throw new Error('[cq-compat] revolve: no pending wire to revolve')

  wp = await applyPendingFacePlane(wp)
  const rad = (angle * Math.PI) / 180
  let result: Shape | null = null
  for (const g of groupPendingWires(all)) {
    const outer = await buildProfileWire(wp, g.outer)
    const holeWires: unknown[] = []
    for (const h of g.holes) holeWires.push(await buildProfileWire(wp, h))
    const face = unwrapBrepResult(compatFn('makeFace')(outer, holeWires))
    const revolved = unwrapBrepResult(compatFn('revolve')(face, { at: startW, axis: dir, angle: rad }))
    const solid = adoptBrepjsProduct(revolved) as Shape
    result = result ? await fuseShapes(result, solid) : solid
  }

  const base = wp.shape
  let shape = result as Shape
  if (combine === 'cut' && base) shape = await cutShapes(base, shape)
  else if (combine === true && base) shape = await fuseShapes(base, shape)
  // combine === false → keep the revolved solid alone

  return clone(wp, {
    shape,
    pendingWires: [],
    pendingPolygon: undefined,
    pendingRect: undefined,
    pendingCircle: undefined,
    faceSel: null,
    edgeSel: null,
    vertexSel: null,
    pts: [],
  })
}

/**
 * loft — CadQuery `Workplane.loft` parity.
 *
 * Consumes the pending wire LIST as loft sections (each wire built on its own
 * creation-plane snapshot, so intermediate workplane(offset)/transformed moves
 * are honored). Upstream default is a smooth (ruled=False) loft.
 *
 * @param wp - Workplane
 * @param opts - { ruled?: boolean; combine?: boolean | 'cut' }
 * @returns Promise<Workplane>
 */
export async function loft(
  wp: Workplane,
  opts?: { ruled?: boolean; combine?: boolean | 'cut' },
): Promise<Workplane> {
  const sections: unknown[] = []
  for (const w of wp.pendingWires ?? []) {
    if (w.construction) continue
    sections.push(await buildProfileWire(wp, w))
  }
  if (sections.length === 0) throw new Error('[cq-compat] loft: no pending wire sections')

  wp = await applyPendingFacePlane(wp)
  const solid = adoptBrepjsProduct(
    unwrapBrepResult(compatFn('loft')(sections, { ruled: opts?.ruled ?? false })),
  ) as Shape

  const base = wp.shape
  let shape = solid
  const combine = opts?.combine ?? true
  if (combine === 'cut' && base) shape = await cutShapes(base, shape)
  else if (combine === true && base) shape = await fuseShapes(base, shape)
  // combine === false → keep the loft alone

  return clone(wp, {
    shape,
    pendingWires: [],
    pendingPolygon: undefined,
    pendingRect: undefined,
    pendingCircle: undefined,
    faceSel: null,
    edgeSel: null,
    vertexSel: null,
    pts: [],
  })
}

/**
 * cutBlind
 * @param wp - Workplane
 * @param depth - number
 * @param opts - { w?: number; d?: number; radius?: number }
 * @returns Promise<Workplane>
 */
export async function cutBlind(
  wp: Workplane,
  depth: number,
  opts?: { w?: number; d?: number; radius?: number },
): Promise<Workplane> {
  if (!wp.shape) return wp
  const base = wp.shape
  wp = await applyPendingFacePlane(wp)
  const absDepth = Math.abs(depth)
  const invNormal: [number, number, number] = [-wp.normal[0], -wp.normal[1], -wp.normal[2]]
  let result = base
  // CadQuery semantics: pushPoints() before cutBlind() repeats the cut at every
  // point. With no pushed points, the cut happens at the workplane origin.
  const ptsArr = eachPoints(wp)
  for (const [px, py] of ptsArr) {
    const cutWp: Workplane = {
      ...wp,
      origin: localToWorld(wp, px, py),
      normal: invNormal,
    }
    let tool: Shape
    if (hasPathWire(wp)) {
      // Drafted wire (moveTo/lineTo/polyline + close): extrude the profile into
      // the cut tool along the (inverted) workplane normal.
      tool = await pendingPathPrism(wp, [
        invNormal[0] * absDepth,
        invNormal[1] * absDepth,
        invNormal[2] * absDepth,
      ])
    } else if (wp.pendingCircle) {
      tool = await makeCylinderAt(cutWp, wp.pendingCircle.radius, absDepth)
    } else if (wp.pendingRect) {
      tool = await makeBoxAt(cutWp, wp.pendingRect.w, wp.pendingRect.d, absDepth)
    } else if (wp.pendingPolygon) {
      tool = await makePolygonPrismAt(cutWp, wp.pendingPolygon, absDepth, invNormal)
    } else if (opts?.radius !== undefined) {
      tool = await makeCylinderAt(cutWp, opts.radius, absDepth)
    } else if (opts?.w !== undefined && opts?.d !== undefined) {
      tool = await makeBoxAt(cutWp, opts.w, opts.d, absDepth)
    } else {
      tool = await makeBoxAt(cutWp, 1000, 1000, absDepth)
    }
    result = await cutShapes(result, tool)
  }
  return clone(wp, { shape: result, faceSel: null, edgeSel: null, pts: [], pendingWires: [], pendingRect: undefined, pendingCircle: undefined, pendingPolygon: undefined })
}

/**
 * cutThruAll
 * @param wp - Workplane
 * @returns Promise<Workplane>
 *
 * CadQuery semantics (verified vs cadquery 2.8.0 `Workplane.cutThruAll`):
 * uses the pending 2D profile to cut through ALL material in BOTH normal
 * directions of the workplane. The tool body spans the whole solid along
 * the workplane normal (computed from the shape bounding box), so it is
 * exact for any profile depth.
 */
export async function cutThruAll(wp: Workplane): Promise<Workplane> {
  if (!wp.shape) return wp
  const base = wp.shape
  wp = await applyPendingFacePlane(wp)
  if (!wp.pendingCircle && !wp.pendingRect && !wp.pendingPolygon && !hasPathWire(wp)) {
    throw new Error('[cq-compat] cutThruAll requires a pending 2D profile')
  }
  const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
  const o = Array.isArray(wp.origin) ? wp.origin : ([0, 0, 0] as [number, number, number])
  const bmin = bboxMin(base)
  const bmax = bboxMax(base)
  // Span: farthest bbox corner from the workplane origin along the normal.
  let span = 0
  for (const cx of [bmin[0], bmax[0]]) {
    for (const cy of [bmin[1], bmax[1]]) {
      for (const cz of [bmin[2], bmax[2]]) {
        span = Math.max(span, Math.abs((cx - o[0]) * n[0] + (cy - o[1]) * n[1] + (cz - o[2]) * n[2]))
      }
    }
  }
  const B = span + 1
  // CadQuery semantics: pushPoints() before cutThruAll() repeats the cut at
  // every point (mirrors cutBlind). With no pushed points, one cut at the
  // workplane origin.
  const ptsArr = eachPoints(wp)
  let shape = base
  for (const [px, py] of ptsArr) {
    // Tool base at point - n·B, extending 2B along +n — covers both directions.
    const thruWp: Workplane = { ...wp, origin: vsub(localToWorld(wp, px, py), vscale(n, B)) }
    let tool: Shape
    if (hasPathWire(wp)) {
      // Drafted wire: the tool must span the whole solid along the normal and
      // start B below the workplane — same envelope as the primitive tools.
      // The profile lives on its own creation plane, so the offset goes into
      // the prism base, not into wp.origin.
      tool = await pendingPathPrism(
        wp,
        [n[0] * 2 * B, n[1] * 2 * B, n[2] * 2 * B],
        vscale(n, -B),
      )
    } else if (wp.pendingCircle) {
      tool = await makeCylinderAt(thruWp, wp.pendingCircle.radius, 2 * B)
    } else if (wp.pendingRect) {
      tool = await makeBoxAt(thruWp, wp.pendingRect.w, wp.pendingRect.d, 2 * B)
    } else {
      tool = await makePolygonPrismAt(thruWp, wp.pendingPolygon!, 2 * B, n)
    }
    shape = await cutShapes(shape, tool)
  }
  return clone(wp, { shape, faceSel: null, edgeSel: null, pts: [], pendingWires: [], pendingRect: undefined, pendingCircle: undefined, pendingPolygon: undefined })
}

/**
 * hole
 * @param wp - Workplane
 * @param diameter - number
 * @param depth - number
 * @returns Promise<Workplane>
 */
export async function hole(
  wp: Workplane,
  diameter: number,
  depth?: number,
): Promise<Workplane> {
  if (!wp.shape) return wp
  const radius = diameter / 2
  const max = await bboxMax(wp.shape)
  const min = await bboxMin(wp.shape)
  // Through-hole with margin, measured along the workplane normal.
  const ext: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const totalHeight = Math.abs(vdot(ext, wp.normal)) + 4
  const holeHeight = depth ?? totalHeight

  const points = eachPoints(wp)
  let result = wp.shape

  for (const [px, py] of points) {
    const holeOrigin = localToWorld(wp, px, py)
    const invNormal: [number, number, number] = [-wp.normal[0], -wp.normal[1], -wp.normal[2]]
    const cyl = await makeCylinderAt(
      { ...wp, origin: holeOrigin, normal: invNormal },
      radius,
      holeHeight,
    )
    result = await cutShapes(result, cyl)
  }

  return clone(wp, { shape: result, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
}

/**
 * cboreHole
 * @param wp - Workplane
 * @param diameter - number
 * @param cboreDiameter - number
 * @param cboreDepth - number
 * @param depth - number | undefined (bore depth; undefined drills through, upstream depth=None)
 * @returns Promise<Workplane>
 */
export async function cboreHole(
  wp: Workplane,
  diameter: number,
  cboreDiameter: number,
  cboreDepth: number,
  depth?: number,
): Promise<Workplane> {
  // hole() consumes and clears wp.pts — snapshot them first so the counterbore
  // lands on every pushed point, not just the origin fallback [0, 0].
  const savedPts = Array.isArray(wp.pts) ? [...wp.pts] : []
  let result = await hole(wp, diameter, depth)
  // Counterbore: larger shallow hole. Upstream (verified vs cadquery 2.8.0
  // Workplane.cboreHole) cuts EXACTLY cboreDepth below the workplane — the old
  // "+1 safety margin" over-cut every counterbore by 1 mm (parity harness,
  // testCounterBores__c2).
  if (result.shape) {
    const cboreRadius = cboreDiameter / 2
    const points = savedPts.length > 0 ? savedPts : ([[0, 0]] as [number, number][])
    let shape = result.shape
    for (const [px, py] of points) {
      const origin = localToWorld(result, px, py)
      const invNormal: [number, number, number] = [-result.normal[0], -result.normal[1], -result.normal[2]]
      const cyl = await makeCylinderAt({ ...result, origin, normal: invNormal }, cboreRadius, cboreDepth)
      shape = await cutShapes(shape, cyl)
    }
    result = clone(result, { shape })
  }
  return clone(result, { pts: [] })
}

/**
 * cskHole
 * @param wp - Workplane
 * @param diameter - number
 * @param cskDiameter - number
 * @param cskAngle - number
 * @returns Promise<Workplane>
 */
export async function cskHole(
  wp: Workplane,
  diameter: number,
  cskDiameter: number,
  cskAngle: number,
): Promise<Workplane> {
  // hole() consumes and clears wp.pts — snapshot them first (same as cboreHole).
  const savedPts = Array.isArray(wp.pts) ? [...wp.pts] : []
  let result = await hole(wp, diameter)
  if (result.shape) {
    const cskRadius = cskDiameter / 2
    // CadQuery cskHole: full cone from cskRadius at the surface to an apex,
    // depth h = cskRadius / tan(cskAngle/2).
    const cskDepth = cskRadius / Math.tan((cskAngle * Math.PI) / 360)
    const points = savedPts.length > 0 ? savedPts : ([[0, 0]] as [number, number][])
    let shape = result.shape
    for (const [px, py] of points) {
      const origin = localToWorld(result, px, py)
      const invNormal: [number, number, number] = [-result.normal[0], -result.normal[1], -result.normal[2]]
      const cone = await makeConeAt({ ...result, origin }, cskRadius, cskDepth, invNormal)
      shape = await cutShapes(shape, cone)
    }
    result = clone(result, { shape })
  }
  return clone(result, { pts: [] })
}

/**
 * threadedHole
 * @param wp - Workplane
 * @param diameterOrFastener - number | unknown
 * @param depth - number
 * @returns Promise<Workplane>
 */
export async function threadedHole(
  wp: Workplane,
  diameterOrFastener: number | unknown,
  depth?: number,
): Promise<Workplane> {
  const diameter = typeof diameterOrFastener === 'number' ? diameterOrFastener : 5
  return hole(wp, diameter, depth)
}

/**
 * faces
 * @param wp - Workplane
 * @param sel - string
 * @returns Workplane
 */
export function faces(wp: Workplane, sel: string): Workplane {
  return clone(wp, { faceSel: sel, edgeSel: null, vertexSel: null })
}

/**
 * edges
 * @param wp - Workplane
 * @param sel - string | { slice?: [number, number]; index?: number }
 * @returns Workplane
 */
export function edges(
  wp: Workplane,
  sel?: string | { slice?: [number, number]; index?: number },
): Workplane {
  let pts = wp.edgePts ?? (Array.isArray(wp.pts) ? wp.pts : [])
  if (sel && typeof sel === 'object') {
    if (sel.slice) {
      const [start, end] = sel.slice
      pts = pts.slice(start === undefined ? 0 : start, end === undefined ? pts.length : end)
    } else if (sel.index !== undefined) {
      const idx = sel.index < 0 ? pts.length + sel.index : sel.index
      pts = [pts[idx]]
    }
  }
  return clone(wp, { edgeSel: typeof sel === 'string' ? sel : '', faceSel: null, vertexSel: null, pts: [...pts] })
}

/**
 * vertices
 * @param wp - Workplane
 * @param sel - string | { slice?: [number, number]; index?: number }
 * @returns Workplane
 */
export function vertices(
  wp: Workplane,
  sel?: string | { slice?: [number, number]; index?: number },
): Workplane {
  let pts = Array.isArray(wp.pts) ? wp.pts : []
  if (sel && typeof sel === 'object') {
    if (sel.slice) {
      const [start, end] = sel.slice
      pts = pts.slice(start === undefined ? 0 : start, end === undefined ? pts.length : end)
    } else if (sel.index !== undefined) {
      const idx = sel.index < 0 ? pts.length + sel.index : sel.index
      pts = [pts[idx]]
    }
  }
  return clone(wp, { vertexSel: typeof sel === 'string' ? sel : '', faceSel: null, edgeSel: null, pts: [...pts] })
}

/**
 * workplane
 * @param wp - Workplane
 * @param opts - { centerOption?: string; offset?: number }
 * @returns Promise<Workplane>
 */
export async function workplane(
  wp: Workplane,
  opts?: { centerOption?: string; offset?: number; invert?: boolean },
): Promise<Workplane> {
  // Upstream (cadquery 2.8.0 Workplane.workplane): invert flips the plane
  // normal (Plane.invert keeps xDir, flips zDir, yDir = zDir × xDir flips
  // accordingly); the offset is then applied along the (possibly inverted)
  // normal.
  const invert = opts?.invert === true
  const flip = (n: [number, number, number]): [number, number, number] => [
    -n[0],
    -n[1],
    -n[2],
  ]
  if (!wp.shape || !wp.faceSel) {
    // No face selected — just apply offset
    const normal = invert ? flip(wp.normal) : wp.normal
    if (opts?.offset) {
      const offset = vscale(normal, opts.offset)
      return clone(wp, { origin: vadd(wp.origin, offset), faceSel: null })
    }
    if (invert) {
      const yDir: [number, number, number] = [
        normal[1] * wp.xDir[2] - normal[2] * wp.xDir[1],
        normal[2] * wp.xDir[0] - normal[0] * wp.xDir[2],
        normal[0] * wp.xDir[1] - normal[1] * wp.xDir[0],
      ]
      return clone(wp, { normal, yDir, faceSel: null })
    }
    return clone(wp, { faceSel: null })
  }

  const { center, normal: faceNormal } = await resolveFaceSelector(wp.shape, wp.faceSel, opts?.centerOption)
  // CadQuery default centerOption is "ProjectedOrigin": project the current
  // origin onto the face plane. "CenterOfBoundBox"/"CenterOfMass" keep the
  // face centroid returned by resolveFaceSelector.
  let newOrigin: [number, number, number]
  if (opts?.centerOption && opts.centerOption !== 'ProjectedOrigin') {
    newOrigin = center
  } else {
    const t = vdot(vsub(center, wp.origin), faceNormal)
    newOrigin = vadd(wp.origin, vscale(faceNormal, t))
  }
  const normal = invert ? flip(faceNormal) : faceNormal
  if (opts?.offset) {
    newOrigin = vadd(newOrigin, vscale(normal, opts.offset))
  }
  // Upstream Workplane.workplane `_computeXdir`: xDir = (0,0,1)×normal, or
  // (1,0,0) when the face is parallel with the XY plane (degenerate cross);
  // then yDir = normal×xDir. Verified to reproduce FACE_AXES for all six axis
  // normals while also supporting arbitrary (e.g. faces("+XY") diagonal) ones.
  let xDir: [number, number, number] = [1, 0, 0]
  const crLen = Math.hypot(normal[1], normal[0])
  if (crLen > 1e-9) {
    xDir = [-normal[1] / crLen, normal[0] / crLen, 0]
  }
  const yDir: [number, number, number] = [
    normal[1] * xDir[2] - normal[2] * xDir[1],
    normal[2] * xDir[0] - normal[0] * xDir[2],
    normal[0] * xDir[1] - normal[1] * xDir[0],
  ]
  return clone(wp, {
    origin: newOrigin,
    normal,
    xDir,
    yDir,
    faceSel: null,
    edgeSel: null,
    vertexSel: null,
    pts: [],
  })
}

/**
 * center
 * @param wp - Workplane
 * @param x - number
 * @param y - number
 * @returns Workplane
 */
export function center(wp: Workplane, x: number, y: number): Workplane {
  // CadQuery semantics: offset along the workplane LOCAL x/y axes.
  return clone(wp, { origin: localToWorld(wp, x, y) })
}

/**
 * pushPoints
 * @param wp - Workplane
 * @param pts - [number, number][]
 * @returns Workplane
 */
export function pushPoints(wp: Workplane, pts: [number, number][]): Workplane {
  const existing = Array.isArray(wp.pts) ? wp.pts : []
  return clone(wp, { pts: [...existing, ...pts] })
}

/**
 * translate
 * @param wp - Workplane
 * @param v - [number, number, number]
 * @returns Promise<Workplane>
 */
export async function translate(
  wp: Workplane,
  v: [number, number, number],
): Promise<Workplane> {
  if (!wp.shape) return clone(wp, { origin: vadd(wp.origin, v) })
  const shape = await cad.translate(wp.shape, { offset: v })
  return clone(wp, { shape, origin: vadd(wp.origin, v) })
}

/**
 * rotate
 * @param wp - Workplane
 * @param axis - [number, number, number]
 * @param angle - number
 * @returns Promise<Workplane>
 */
export async function rotate(
  wp: Workplane,
  axis: [number, number, number],
  angle: number,
): Promise<Workplane> {
  if (!wp.shape) return wp
  const anglesDeg: [number, number, number] = [
    axis[0] * angle,
    axis[1] * angle,
    axis[2] * angle,
  ]
  const shape = await cad.rotate_euler(wp.shape, { anglesDeg })
  return clone(wp, { shape })
}

/**
 * Mirror-plane normals for the string form (upstream `Shape.mirror`,
 * cadquery 2.8.0: both spellings of a plane map to the SAME mirror plane —
 * 'YX' has normal (0,-1,0) but mirrors through the same y=0 plane as 'XZ').
 */
const MIRROR_PLANE_NORMALS: Record<string, [number, number, number]> = {
  XY: [0, 0, 1],
  YX: [0, 0, 1],
  XZ: [0, 1, 0],
  ZX: [0, 1, 0],
  YZ: [1, 0, 0],
  ZY: [1, 0, 0],
}

/**
 * mirror — full upstream `Workplane.mirror` semantics (cadquery 2.8.0, verified
 * against cq.py:1113):
 *   - string form: 'XY'..'ZY' named mirror planes
 *   - vector form: plane normal, mirrored about `basePointVector` (default origin)
 *   - Workplane form (upstream Face form): normal + center of the selected face;
 *     basePointVector only overrides the center when explicitly given
 *   - `union`: fuse the mirrored copy with the original (upstream `self.union(newS)`)
 *
 * The kernel projection is `cad.mirror(shape, { normal, at })` — the previous
 * implementation passed `{ plane }`, which MirrorOptions does not know, so every
 * mirror silently used the default normal [1,0,0] (latent bug, found while
 * writing the test_mirror mirrors).
 */
export async function mirror(
  wp: Workplane,
  mirrorPlane?: string | number[] | Workplane,
  basePointVector?: [number, number, number],
  union?: boolean,
): Promise<Workplane> {
  if (!wp.shape) return wp
  let normal: [number, number, number]
  let at: [number, number, number]
  if (mirrorPlane && typeof mirrorPlane === 'object' && !Array.isArray(mirrorPlane)) {
    // Workplane carrying a face selection (upstream Face form).
    const fp = mirrorPlane as Workplane
    if (!fp.faceSel || !fp.shape) return wp
    const resolved = await resolveFaceSelector(fp.shape, fp.faceSel)
    normal = resolved.normal
    at = basePointVector ?? resolved.center
  } else if (Array.isArray(mirrorPlane)) {
    normal = [mirrorPlane[0] ?? 0, mirrorPlane[1] ?? 0, mirrorPlane[2] ?? 0]
    at = basePointVector ?? [0, 0, 0]
  } else {
    const key = String(mirrorPlane ?? 'XY').toUpperCase()
    normal = MIRROR_PLANE_NORMALS[key] ?? [0, 0, 1]
    at = basePointVector ?? [0, 0, 0]
  }
  const mirrored = await cad.mirror(wp.shape, { normal, at })
  const shape = union ? await fuseShapes(wp.shape, mirrored) : mirrored
  // Upstream returns a newObject stack holding only the mirrored/unioned
  // objects — pending selectors do not survive a mirror.
  return clone(wp, { shape, faceSel: null, edgeSel: null, vertexSel: null })
}

/**
 * faceCompound — extract the faces picked by a direction selector as a
 * standalone compound Shape (upstream module-level `Shape.faces(">Z")`, which
 * returns a Compound of faces — unlike `Workplane.faces()`, which only records
 * the selection). Needed by test_single_ent_selector where the exported var IS
 * the face compound (ref: Compound, area 2 = two unit-box top faces).
 *
 * `sel = 'all'` picks EVERY face of the shape — the upstream
 * `compound(shape.Faces())` free-function form (test_constructors c1/c2).
 */
export async function faceCompound(wp: Workplane, sel: string): Promise<Workplane> {
  if (!wp.shape) return wp
  const s = NAMED_VIEW_TO_AXIS[sel.trim().toLowerCase()] ?? sel
  if (s.trim().toLowerCase() === 'all') {
    const faces = compatFn('getFaces')(borrowBrepjsShape(wp.shape)) as unknown[]
    if (faces.length === 0) {
      throw new Error('[cq-compat] faceCompound "all": shape has no faces')
    }
    const product = compatFn('makeCompound')(faces) as unknown
    const shape = adoptBrepjsProduct(unwrapBrepResult(product))
    return clone(wp, { shape, faceSel: null, edgeSel: null, vertexSel: null })
  }
  const m = /^([<>])([XYZ])(?:\[-?\d+\])?$/.exec(s.trim())
  if (!m) {
    throw new Error(`[cq-compat] unsupported face selector for faceCompound "${sel}"`)
  }
  const axis = m[2] === 'X' ? 0 : m[2] === 'Y' ? 1 : 2
  const sign = m[1] === '>' ? 1 : -1
  const bounds = (h: unknown): Record<string, number> =>
    compatFn('getBounds')(h) as Record<string, number>
  const faces = compatFn('getFaces')(borrowBrepjsShape(wp.shape)) as unknown[]
  // DirectionMinMaxSelector: among faces perpendicular to the axis, take ALL
  // faces whose center sits at the extremum (ties included — the two-boxes
  // compound exports BOTH top faces).
  const perp = faces.filter((f) => {
    const b = bounds(f)
    return [b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin][axis] <= 0.1
  })
  if (perp.length === 0) {
    throw new Error(`[cq-compat] no planar face for selector "${sel}"`)
  }
  const center = (b: Record<string, number>): number =>
    [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2, (b.zMin + b.zMax) / 2][axis]
  const extremum = perp
    .map((f) => center(bounds(f)))
    .reduce((best, c) => (sign * c > sign * best ? c : best))
  const picked = perp.filter((f) => Math.abs(center(bounds(f)) - extremum) <= 1e-6)
  const product = compatFn('makeCompound')(picked) as unknown
  const shape = adoptBrepjsProduct(unwrapBrepResult(product))
  return clone(wp, { shape, faceSel: null, edgeSel: null, vertexSel: null })
}

/**
 * edgeCompound — extract the edges picked by a direction selector as a
 * standalone compound Shape (upstream `shape.edges(">Z")` on a Solid, which
 * returns a Compound of edges). Needed by TestCQSelectors.testShape where the
 * exported var IS the edge compound (ref: Compound of the 4 top edges).
 *
 * Semantics (upstream DirectionMinMaxSelector = CenterNthSelector n=-1):
 * order ALL edges by their center-of-mass projection onto the axis and take
 * the extremum cluster (ties included). For a centered box the vertical edges'
 * centers sit at z=0 while the top edges sit at z=+h/2 — so `">Z"` picks
 * exactly the 4 top edges.
 */
export async function edgeCompound(wp: Workplane, sel: string): Promise<Workplane> {
  if (!wp.shape) return wp
  const s = NAMED_VIEW_TO_AXIS[sel.trim().toLowerCase()] ?? sel
  const m = /^([<>])([XYZ])(?:\[-?\d+\])?$/.exec(s.trim())
  if (!m) {
    throw new Error(`[cq-compat] unsupported face selector for edgeCompound "${sel}"`)
  }
  const axis = m[2] === 'X' ? 0 : m[2] === 'Y' ? 1 : 2
  const sign = m[1] === '>' ? 1 : -1
  const bounds = (h: unknown): Record<string, number> =>
    compatFn('getBounds')(h) as Record<string, number>
  const edges = compatFn('getEdges')(borrowBrepjsShape(wp.shape)) as unknown[]
  const center = (b: Record<string, number>): number =>
    [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2, (b.zMin + b.zMax) / 2][axis]
  const extremum = edges
    .map((e) => center(bounds(e)))
    .reduce((best, c) => (sign * c > sign * best ? c : best))
  const picked = edges.filter((e) => Math.abs(center(bounds(e)) - extremum) <= 1e-6)
  const product = compatFn('makeCompound')(picked) as unknown
  const shape = adoptBrepjsProduct(unwrapBrepResult(product))
  return clone(wp, { shape, faceSel: null, edgeSel: null, vertexSel: null })
}

// ── Location / moved / move (阶段 E) ─────────────────────────────────────

/**
 * Minimal analogue of CadQuery's `Location`.
 *
 * Upstream (`cadquery/occ_impl/geom.py::Location`) builds a `gp_Trsf` from a
 * translation plus an Euler rotation using **degrees** and
 * `gp_Extrinsic_XYZ` order, then maps `p -> R·p + t` (rotate first, translate
 * second). We keep exactly those two fields; rotation is stored in degrees so
 * mirrors can pass upstream angle literals verbatim.
 *
 * Not modelled: the `Location(Plane)` / `Location(Plane, VectorLike)` overloads
 * and `TopLoc_Location` composition — no mirror case needs them yet.
 */
export interface CqLocation {
  readonly __cqLocation: true
  /** Translation (mm). */
  readonly pos: [number, number, number]
  /** Euler rotation in degrees (upstream gp_Extrinsic_XYZ). */
  readonly rot: [number, number, number]
}

function locNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function locVec3(a: unknown): [number, number, number] {
  if (Array.isArray(a)) return [locNum(a[0]), locNum(a[1]), locNum(a[2])]
  return [0, 0, 0]
}

/** Type guard for a `Location` produced by {@link Location}. */
export function isLocation(v: unknown): v is CqLocation {
  return typeof v === 'object' && v !== null && (v as { __cqLocation?: unknown }).__cqLocation === true
}

/**
 * Location — CadQuery `Location` constructor.
 *
 * Accepted forms (all verified against the upstream overloads used by
 * `tests/test_free_functions.py::test_moved`):
 *   `Location([x, y, z])`
 *   `Location([x, y, z], [rx, ry, rz])`
 *   `Location(x, y, z)` / `Location(x, y, z, rx, ry, rz)`
 *   `Location({ x, y, z, rx, ry, rz })`   ← the `.moved(z=-1)` keyword form
 */
export function Location(...args: unknown[]): CqLocation {
  const nums = args.filter((a): a is number => typeof a === 'number')
  const arrs = args.filter((a): a is unknown[] => Array.isArray(a))
  const obj = args.find((a) => typeof a === 'object' && a !== null && !Array.isArray(a)) as
    | Record<string, unknown>
    | undefined

  let pos: [number, number, number] = [0, 0, 0]
  let rot: [number, number, number] = [0, 0, 0]
  if (obj) {
    pos = [locNum(obj.x), locNum(obj.y), locNum(obj.z)]
    rot = [locNum(obj.rx), locNum(obj.ry), locNum(obj.rz)]
  } else if (nums.length >= 6) {
    pos = [nums[0], nums[1], nums[2]]
    rot = [nums[3], nums[4], nums[5]]
  } else if (nums.length >= 3) {
    pos = [nums[0], nums[1], nums[2]]
  } else if (arrs.length >= 2) {
    pos = locVec3(arrs[0])
    rot = locVec3(arrs[1])
  } else if (arrs.length === 1) {
    pos = locVec3(arrs[0])
  }
  return { __cqLocation: true, pos, rot }
}

/**
 * composeLocations(a, b) — the Location product `a * b` (upstream `Location.__mul__`):
 * apply `b` first, then `a`. Result: R = Ra·Rb, t = Ra·t_b + t_a.
 *
 * Mirrors need this because a Workplane whose carried shape is a **compound**
 * cannot be fed back into `moved` — the faijs runtime only re-attaches the BREP
 * handle across statement boundaries for solids (see `moved`'s KNOWN LIMITATION
 * note), so `bs1.moved(l3, l4)` has to be written as one `moved` over the
 * composed locations instead of two chained ones.
 */
export function composeLocations(a: CqLocation, b: CqLocation): CqLocation {
  const ra = rotationMatrixDeg(a.rot)
  const rb = rotationMatrixDeg(b.rot)
  const mul = (m: number[], n: number[]): number[] => {
    const out = new Array<number>(9).fill(0)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[i * 3 + j] = m[i * 3] * n[j] + m[i * 3 + 1] * n[3 + j] + m[i * 3 + 2] * n[6 + j]
      }
    }
    return out
  }
  const r = mul(ra, rb)
  const tb = b.pos
  const t: [number, number, number] = [
    ra[0] * tb[0] + ra[1] * tb[1] + ra[2] * tb[2] + a.pos[0],
    ra[3] * tb[0] + ra[4] * tb[1] + ra[5] * tb[2] + a.pos[1],
    ra[6] * tb[0] + ra[7] * tb[1] + ra[8] * tb[2] + a.pos[2],
  ]
  // recover Euler angles from the composed matrix (gp_Extrinsic_XYZ: R = Rz·Ry·Rx)
  const rot: [number, number, number] = [0, 0, 0]
  const cy = Math.hypot(r[0], r[3])
  if (cy > 1e-12) {
    rot[1] = (Math.atan2(-r[6], cy) * 180) / Math.PI
    rot[2] = (Math.atan2(r[3], r[0]) * 180) / Math.PI
    rot[0] = (Math.atan2(r[7], r[8]) * 180) / Math.PI
  } else {
    rot[1] = (Math.atan2(-r[6], cy) * 180) / Math.PI
    rot[2] = 0
    rot[0] = (Math.atan2(-r[5], r[4]) * 180) / Math.PI
  }
  const zero = (v: number): number => (v === 0 ? 0 : v)
  return {
    __cqLocation: true,
    pos: [zero(t[0]), zero(t[1]), zero(t[2])],
    rot: [zero(rot[0]), zero(rot[1]), zero(rot[2])],
  }
}

/**
 * Normalise the variadic argument list of `moved`/`move` into a Location list.
 *
 * Upstream dispatch (`Shape.moved`, cadquery 2.8.0) — the forms a mirror needs:
 *   `moved(loc)` / `moved(loc1, loc2, …)` / `moved([loc1, loc2])`
 *   `moved((0,0,1))` / `moved((0,0,1), (0,0,-1))` / `moved([(0,0,1), (0,0,-1)])`
 *   `moved(0, 0, -1)` / `moved(z=-1)`
 */
function toLocations(args: unknown[]): CqLocation[] {
  if (args.length === 0) return []
  if (args.every((a) => typeof a === 'number')) {
    const n = args as number[]
    return [
      {
        __cqLocation: true,
        pos: [locNum(n[0]), locNum(n[1]), locNum(n[2])],
        rot: [locNum(n[3]), locNum(n[4]), locNum(n[5])],
      },
    ]
  }
  const out: CqLocation[] = []
  for (const a of args) {
    if (isLocation(a)) {
      out.push(a)
    } else if (Array.isArray(a)) {
      if (a.length > 0 && isLocation(a[0])) {
        out.push(...(a as CqLocation[]))
      } else if (a.length > 0 && Array.isArray(a[0])) {
        for (const v of a) out.push(Location(v as number[]))
      } else {
        out.push(Location(a as number[]))
      }
    } else if (a && typeof a === 'object') {
      out.push(Location(a as Record<string, number>))
    }
  }
  return out
}

/**
 * Row-major 3x3 rotation for Euler angles in degrees, `gp_Extrinsic_XYZ` order
 * (rotations about the FIXED axes X, then Y, then Z: R = Rz·Ry·Rx) — the order
 * upstream `Location` uses.
 */
function rotationMatrixDeg(rot: [number, number, number]): number[] {
  const rad = Math.PI / 180
  const [rx, ry, rz] = rot.map((d) => d * rad) as [number, number, number]
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx]
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1]
  const mul = (a: number[], b: number[]): number[] => {
    const out = new Array<number>(9).fill(0)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
      }
    }
    return out
  }
  return mul(Rz, mul(Ry, Rx))
}

/**
 * Apply one Location to a shape: rotate about the world origin, then translate
 * (p -> R·p + t, matching upstream `gp_Trsf.SetRotation` + `SetTranslationPart`).
 *
 * Uses the kernel `applyMatrix` projection rather than `cad.translate` /
 * `cad.rotate_euler`: the latter two are solid-only and throw
 * "input is not BREP" on a compound, which is exactly what `moved` produces
 * when it is given more than one location.
 */
async function applyLocation(shape: Shape, loc: CqLocation): Promise<Shape> {
  const [rx, ry, rz] = loc.rot
  const [x, y, z] = loc.pos
  if (rx === 0 && ry === 0 && rz === 0 && x === 0 && y === 0 && z === 0) return shape

  // Two paths, chosen by the number of solids in the carrier:
  //
  //  - a SINGLE solid goes through the faijs `cad.rotate_euler` / `cad.translate`
  //    defineOps. Those re-register the OCCT handle in a way that survives a
  //    statement boundary, so the result exports as a true BREP STEP.
  //  - a COMPOUND must use the kernel `applyMatrix` projection (the defineOps
  //    are solid-only and reject it). That product does NOT keep its BREP slot
  //    across a statement boundary — the STEP then falls back to a
  //    TESSELLATED_SOLID — so mirrors avoid feeding a compound back into
  //    `moved` (they fold the locations with composeLocations instead).
  let solids = 0
  try {
    solids = (brepjsCompat.getSolids(borrowBrepjsShape(shape) as never) as unknown[]).length
  } catch {
    solids = 0
  }
  if (solids <= 1) {
    let s = shape
    if (rx !== 0 || ry !== 0 || rz !== 0) {
      s = await cad.rotate_euler(s, { anglesDeg: [rx, ry, rz] })
    }
    if (x !== 0 || y !== 0 || z !== 0) {
      s = await cad.translate(s, { offset: [x, y, z] })
    }
    return s
  }
  const product = unwrapBrepResult(
    compatFn('applyMatrix')(borrowBrepjsShape(shape), {
      linear: rotationMatrixDeg(loc.rot) as never,
      translation: [x, y, z] as never,
    }),
  )
  return adoptBrepjsProduct(product)
}

/**
 * moved — apply one or more Locations to the carried geometry.
 *
 * Upstream is `Shape.moved(*locs)`: one location returns a moved copy, several
 * return a **compound** holding one copy per location (no boolean union —
 * `test_moved` asserts `bs1.Volume() == 2` and `len(bs1.Solids()) == 2` for two
 * disjoint unit boxes, which only holds for a compound).
 *
 * @param wp - Workplane
 * @param locs - Location | [x,y,z] | {x,y,z,rx,ry,rz} | list thereof
 * @returns Promise<Workplane>
 */
export async function moved(wp: Workplane, ...locs: unknown[]): Promise<Workplane> {
  if (!wp.shape) return wp
  const resolved = toLocations(locs)
  const copies: Shape[] = []
  for (const l of resolved) copies.push(await applyLocation(wp.shape, l))
  let shape: Shape
  if (copies.length === 0) {
    shape = wp.shape
  } else if (copies.length === 1) {
    shape = copies[0]
  } else {
    // Upstream `_compound_or_shape` groups the copies without any boolean or
    // clean pass — mirroring that keeps the topology (face/solid counts) equal
    // to upstream, which the STEP comparison gates on.
    const handles = copies.map((c) => borrowBrepjsShape(c))
    shape = adoptBrepjsProduct(unwrapBrepResult(compatFn('makeCompound')(handles)))
  }
  return clone(wp, {
    shape,
    faceSel: null,
    edgeSel: null,
    vertexSel: null,
    pts: [],
    pendingWires: [],
  })
}

/**
 * move — upstream mutates the shape in place; cq-compat carriers are immutable
 * so this is an alias of {@link moved}.
 *
 * @param wp - Workplane
 * @param locs - same forms as {@link moved}
 * @returns Promise<Workplane>
 */
export async function move(wp: Workplane, ...locs: unknown[]): Promise<Workplane> {
  return moved(wp, ...locs)
}

/**
 * union
 * @param wp - Workplane
 * @param other - Workplane | Shape
 * @returns Promise<Workplane>
 */
export async function union(
  wp: Workplane,
  other: Workplane | Shape,
): Promise<Workplane> {
  if (!wp.shape) return wp
  const otherShape = 'shape' in other ? (other as Workplane).shape : (other as Shape)
  if (!otherShape) return wp
  const shape = await fuseShapes(wp.shape, otherShape)
  return clone(wp, { shape })
}

/**
 * combine
 * @param wp - Workplane
 * @returns Promise<Workplane>
 *
 * CadQuery semantics note (verified vs cadquery 2.8.0): upstream `combine()`
 * fuses all stack items. cq-compat fuses eagerly inside the building ops
 * (extrude / eachpoint with combine=True), so by the time combine() runs the
 * stack holds a single fused solid — the op degenerates to a `clean()` pass
 * (same-face merge), which matches the upstream test expectations
 * (testCombine: 11 faces either way).
 */
export async function combine(wp: Workplane): Promise<Workplane> {
  if (!wp.shape) return wp
  const shape = await cleanShapes(wp.shape)
  return clone(wp, { shape })
}

/**
 * cut
 * @param wp - Workplane
 * @param other - Workplane | Shape
 * @returns Promise<Workplane>
 */
export async function cut(
  wp: Workplane,
  other: Workplane | Shape,
): Promise<Workplane> {
  if (!wp.shape) return wp
  const otherShape = 'shape' in other ? (other as Workplane).shape : (other as Shape)
  if (!otherShape) return wp
  const shape = await cad.subtract(wp.shape, otherShape)
  return clone(wp, { shape })
}

/**
 * compound — upstream module-level `compound(*shapes)` free function: bundle
 * several shapes into a single Compound WITHOUT any boolean operation. Needed
 * by test_history_bool (imprint result = base solid + tool solid as a
 * compound) and test_union_compound-style cases.
 *
 * Accepts Shapes and Workplanes (their current shape is used); null/empty
 * entries are skipped. Returns a Shape whose value is the compound itself, so
 * mirrors write `let result = c` directly.
 */
export function compound(...items: (Workplane | Shape | null | undefined)[]): Shape | null {
  const shapes = items
    .map((it) => (it && typeof it === 'object' && 'shape' in (it as Workplane) ? (it as Workplane).shape : (it as Shape)))
    .filter((s): s is Shape => Boolean(s))
  if (shapes.length === 0) return null
  return makeCompoundShape(shapes)
}

/**
 * intersect
 * @param wp - Workplane
 * @param other - Workplane | Shape
 * @returns Promise<Workplane>
 */
export async function intersect(
  wp: Workplane,
  other: Workplane | Shape,
): Promise<Workplane> {
  if (!wp.shape) return wp
  const otherShape = 'shape' in other ? (other as Workplane).shape : (other as Shape)
  if (!otherShape) return wp
  const shape = await intersectShapes(wp.shape, otherShape)
  return clone(wp, { shape })
}

/**
 * fillet
 * @param wp - Workplane
 * @param radius - number
 * @returns Promise<Workplane>
 */
/**
 * Resolve a CadQuery edge selector string to concrete edge handles.
 *
 * Supports CadQuery's parallel-axis selectors "|X" / "|Y" / "|Z" (edges whose
 * bounding box is thin across the two perpendicular axes) and an empty / absent
 * selector meaning "all edges". Face/edge geometry beyond axis-parallel lines
 * is out of scope for this layer.
 */
function resolveEdgeSelection(shape: Shape, sel: string | null | undefined): unknown[] {
  const edges = compatFn('getEdges')(borrowBrepjsShape(shape)) as unknown[]
  if (!sel || sel === '') return edges
  const m = /^\|([XYZ])$/.exec(sel.trim())
  if (!m) {
    throw new Error(`[cq-compat] unsupported edge selector "${sel}" (supported: |X |Y |Z)`)
  }
  const axisIdx = m[1] === 'X' ? 0 : m[1] === 'Y' ? 1 : 2
  const perp = [0, 1, 2].filter((i) => i !== axisIdx)
  // The kernel inflates edge bounding boxes by ~0.1mm of tolerance padding, so
  // an axis-parallel edge is identified RELATIVELY: its extent along the axis
  // must dominate the two perpendicular extents (which stay padding-sized).
  const PAD = 0.5 // mm — max perpendicular extent for an axis-parallel edge
  return edges.filter((e) => {
    const b = compatFn('getBounds')(e) as Record<string, number>
    const min = [b.xMin, b.yMin, b.zMin]
    const max = [b.xMax, b.yMax, b.zMax]
    const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    const axisExtent = extents[axisIdx]
    return (
      perp.every((i) => extents[i] <= PAD) &&
      axisExtent > 2 * Math.max(extents[perp[0]], extents[perp[1]])
    )
  })
}

/**
 * Fillet selected edges of the current shape.
 *
 * Edge resolution mirrors chamfer: an explicit `|Z`-style / empty edgeSel goes
 * through `resolveEdgeSelection`; a pending face selection
 * (`.faces(">Z").fillet(r)`) fillets THE SELECTED FACE's edges via
 * `resolveFaceEdgeSelection` (upstream `.faces("+Z").edges().fillet(r)`
 * semantics — the missing faceSel branch made testTopFaceFillet fillet all 12
 * edges instead of the 4 top ones). Failures propagate — silently returning
 * the unfilleted shape previously produced plates whose fillets were missing
 * entirely (mini_lathe bp/mb/mt/tp diagnosis, 2026-09-08).
 *
 * @param wp - Workplane whose current shape is filleted; consumes `edgeSel`/`faceSel`.
 * @param radius - Fillet radius in world units.
 * @returns Promise resolving to a new Workplane holding the filleted shape.
 */
export async function fillet(wp: Workplane, radius: number): Promise<Workplane> {
  if (!wp.shape) return wp
  let edges: unknown[]
  if (wp.edgeSel !== null && wp.edgeSel !== undefined) {
    edges = resolveEdgeSelection(wp.shape, wp.edgeSel)
  } else if (wp.faceSel) {
    edges = resolveFaceEdgeSelection(wp.shape, wp.faceSel)
  } else {
    edges = resolveEdgeSelection(wp.shape, undefined)
  }
  const result = compatFn('fillet')(borrowBrepjsShape(wp.shape), edges, radius)
  const product = unwrapBrepResult(result)
  const shape = adoptBrepjsProduct(product)
  return clone(wp, { shape, edgeSel: null, faceSel: null })
}

/**
 * chamfer
 * @param wp - Workplane
 * @param length - number
 * @param length2 - number | undefined
 * @returns Promise<Workplane>
 *
 * CadQuery semantics (verified vs cadquery 2.8.0 `Workplane.chamfer`):
 * chamfers the selected edges of the current shape. Edge resolution order:
 * explicit `edges("|Z")` selector; else, if a face selector is pending
 * (`.faces(">Z").chamfer(l)`), the edges OF the selected face; else all
 * edges. LIMITATION: asymmetric `length2` is NOT supported — the occt-wasm
 * kernel chamfer takes a single uniform distance (resolveUniformRadius
 * degrades a pair to d1), so length2 throws instead of silently producing a
 * symmetric chamfer.
 */
export async function chamfer(
  wp: Workplane,
  length: number,
  length2?: number,
): Promise<Workplane> {
  if (length2 !== undefined) {
    throw new Error('[cq-compat] chamfer length2 (asymmetric) is not supported by the occt-wasm kernel')
  }
  if (!wp.shape) return wp
  let edges: unknown[]
  if (wp.edgeSel !== null && wp.edgeSel !== undefined) {
    edges = resolveEdgeSelection(wp.shape, wp.edgeSel)
  } else if (wp.faceSel) {
    edges = resolveFaceEdgeSelection(wp.shape, wp.faceSel)
  } else {
    edges = resolveEdgeSelection(wp.shape, undefined)
  }
  const result = compatFn('chamfer')(borrowBrepjsShape(wp.shape), edges, length)
  const product = unwrapBrepResult(result)
  const shape = adoptBrepjsProduct(product)
  return clone(wp, { shape, edgeSel: null, faceSel: null })
}

/**
 * Resolve the edges belonging to the face picked by a direction selector
 * (upstream `.faces(">Z").chamfer(l)` chamfers the edges of that face).
 * Reuses the direction-minimum/maximum rule of resolveFaceSelector: among
 * faces perpendicular to the axis, the extremal one along it wins; its edges
 * are those whose bounding box lies inside the face's (kernel pads bounds by
 * ~0.1mm of tolerance, so a small positive slack is used).
 */
function resolveFaceEdgeSelection(shape: Shape, sel: string): unknown[] {
  // '+'/'-' are accepted as aliases of '>'/'<' (CadQuery allows both spellings;
  // resolveFaceSelector's axis table does the same).
  const m = /^([<>+\-])([XYZ])(?:\[-?\d+\])?$/.exec(sel.trim())
  if (!m) {
    throw new Error(`[cq-compat] unsupported face selector for chamfer "${sel}"`)
  }
  const axis = m[2] === 'X' ? 0 : m[2] === 'Y' ? 1 : 2
  const sign = m[1] === '>' || m[1] === '+' ? 1 : -1
  const bounds = (h: unknown): Record<string, number> =>
    compatFn('getBounds')(h) as Record<string, number>
  const faces = compatFn('getFaces')(borrowBrepjsShape(shape)) as unknown[]
  const perp = faces.filter((f) => {
    const b = bounds(f)
    return [b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin][axis] <= 0.1
  })
  if (perp.length === 0) {
    throw new Error(`[cq-compat] no planar face for selector "${sel}"`)
  }
  const faceCenter = (b: Record<string, number>): number =>
    [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2, (b.zMin + b.zMax) / 2][axis]
  const target = perp
    .map((f) => ({ f, b: bounds(f) }))
    .reduce((best, cur) => (sign * (faceCenter(cur.b) - faceCenter(best.b)) > 0 ? cur : best))
  const fc = faceCenter(target.b)
  // Edge bounds carry ±0.1mm kernel tolerance padding (measured: a unit-box
  // edge reports extents inflated by 0.2), while face bounds are tight. An
  // edge of the face lies IN its plane, so along the axis it is thin (pure
  // padding) and its center coincides with the face center.
  const EDGE_AXIS_MAX = 0.25
  const EDGE_CENTER_TOL = 0.15
  const edges = compatFn('getEdges')(borrowBrepjsShape(shape)) as unknown[]
  return edges.filter((e) => {
    const b = bounds(e)
    const ext = [b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin][axis]
    const c = [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2, (b.zMin + b.zMax) / 2][axis]
    return ext <= EDGE_AXIS_MAX && Math.abs(c - fc) <= EDGE_CENTER_TOL
  })
}

/**
 * shell
 * @param wp - Workplane
 * @param thickness - number
 * @returns Promise<Workplane>
 */
export async function shell(wp: Workplane, thickness: number): Promise<Workplane> {
  if (!wp.shape) return wp
  try {
    const handle = borrowBrepjsShape(wp.shape)
    const shellFn = (brepjsCompat as Record<string, unknown>).shell as
      | ((...args: unknown[]) => unknown)
      | undefined
    if (!shellFn) return wp
    const result = shellFn(handle, thickness) as { ok?: boolean; value?: unknown } | unknown
    const product =
      result && typeof result === 'object' && 'ok' in result
        ? (result as { ok: boolean; value?: unknown }).value
        : result
    if (product) {
      const shape = adoptBrepjsProduct(product)
      return clone(wp, { shape })
    }
  } catch {
    // Shell failed — return unchanged
  }
  return wp
}

/**
 * val
 * @param wp - Workplane
 * @returns Shape | null
 */
export function val(wp: Workplane): Shape | null {
  return wp.shape
}

/**
 * vals
 * @param wp - Workplane
 * @returns (Shape | null)[]
 */
export function vals(wp: Workplane): (Shape | null)[] {
  return wp.shape ? [wp.shape] : []
}

/**
 * transformed
 * @param wp - Workplane
 * @param opts - { offset?: [number, number, number]; rotate?: [number, number, number] }
 * @returns Promise<Workplane>
 */
export async function transformed(
  wp: Workplane,
  opts: { offset?: [number, number, number]; rotate?: [number, number, number] },
): Promise<Workplane> {
  let result = wp
  if (opts.offset) {
    // CadQuery applies the offset in LOCAL coordinates:
    // world offset = x·xDir + y·yDir + z·normal.
    const [x, y, z] = opts.offset
    const world = vadd(wp.origin, vadd(vscale(wp.xDir, x), vadd(vscale(wp.yDir, y), vscale(wp.normal, z))))
    result = clone(result, { origin: world })
  }
  if (opts.rotate) {
    // Upstream semantics (cadquery 2.8.0 Plane.rotated, verified): the plane's
    // DIRECTION vectors are rotated about the plane's own basis axes — x about
    // xDir, y about yDir, z about the normal — composed as T = Tx·Ty·Tz. The
    // origin is unaffected and the shape is NOT touched. The previous
    // implementation called rotate() (an op that rotates the shape with euler
    // angles) which silently returned the plane unchanged / rotated geometry.
    const [rxd, ryd, rzd] = opts.rotate
    const rad = Math.PI / 180
    const ax: [number, number, number] = [...wp.xDir]
    const ay: [number, number, number] = [...wp.yDir]
    const az: [number, number, number] = [...wp.normal]
    const rotAbout = (v: [number, number, number], a: [number, number, number], ang: number): [number, number, number] => {
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const cross: [number, number, number] = [
        a[1] * v[2] - a[2] * v[1],
        a[2] * v[0] - a[0] * v[2],
        a[0] * v[1] - a[1] * v[0],
      ]
      const dot = a[0] * v[0] + a[1] * v[1] + a[2] * v[2]
      return [
        v[0] * c + cross[0] * s + a[0] * dot * (1 - c),
        v[1] * c + cross[1] * s + a[1] * dot * (1 - c),
        v[2] * c + cross[2] * s + a[2] * dot * (1 - c),
      ]
    }
    const apply = (v: [number, number, number]): [number, number, number] =>
      rotAbout(rotAbout(rotAbout(v, az, rzd * rad), ay, ryd * rad), ax, rxd * rad)
    const newX = apply(ax)
    const newZ = apply(az)
    const newY: [number, number, number] = [
      newZ[1] * newX[2] - newZ[2] * newX[1],
      newZ[2] * newX[0] - newZ[0] * newX[2],
      newZ[0] * newX[1] - newZ[1] * newX[0],
    ]
    result = clone(result, { xDir: newX, yDir: newY, normal: newZ })
  }
  return result
}

/**
 * setColor
 * @param wp - Workplane
 * @param color - RGB
 * @returns Workplane
 */
export function setColor(wp: Workplane, color: RGB): Workplane {
  return clone(wp, { color })
}
