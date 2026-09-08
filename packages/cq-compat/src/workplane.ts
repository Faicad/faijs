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
 * with an optional CadQuery-style index suffix like ">Z[-2]". This
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
 * @param sel - Selector string, e.g. ">Z", "<X", ">Z[-2]".
 * @param centerOption - Optional center computation option forwarded to the
 *   face-center evaluation.
 * @returns Promise resolving to the selected face's center point and outward
 *   normal.
 */
export async function resolveFaceSelector(
  shape: Shape,
  sel: string,
  centerOption?: string,
): Promise<{ center: [number, number, number]; normal: [number, number, number] }> {
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
 * @returns Promise<Workplane>
 *
 * CadQuery semantics (verified vs cadquery 2.8.0 `Workplane.box`): with the
 * default `centered=(True, True, True)` the box is centered on the workplane
 * origin in ALL three axes — including the normal direction. The old
 * "sit on the face" behaviour belonged to the makeBoxAt tool-body helper and
 * leaked into this public op (found by the parity harness, testBoxDefaults).
 */
export async function box(
  wp: Workplane,
  w: number,
  d: number,
  h: number,
): Promise<Workplane> {
  const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
  const o = Array.isArray(wp.origin) ? wp.origin : ([0, 0, 0] as [number, number, number])
  const axes = faceAxes(n)
  // World-space extents of a w×d×h box aligned to the (axis-aligned) basis.
  const sx = w * Math.abs(axes.x[0]) + d * Math.abs(axes.y[0]) + h * Math.abs(n[0])
  const sy = w * Math.abs(axes.x[1]) + d * Math.abs(axes.y[1]) + h * Math.abs(n[1])
  const sz = w * Math.abs(axes.x[2]) + d * Math.abs(axes.y[2]) + h * Math.abs(n[2])
  const boxShape = await cad.box(sx, sy, sz, { centered: true })
  // centered: box center == workplane origin (no lift along the normal)
  const shape = await cad.translate(boxShape, { offset: o })
  return clone(wp, { shape, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
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
  opts?: { forConstruction?: boolean },
): Workplane {
  if (opts?.forConstruction) {
    // Construction rect: store corners for vertices() and edge midpoints for edges()
    return clone(wp, {
      forConstruction: true,
      pendingRect: { w, d },
      pts: [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ],
      edgePts: [
        [0, -d / 2],
        [w / 2, 0],
        [0, d / 2],
        [-w / 2, 0],
      ],
    })
  }
  // Non-construction rect: store profile for extrude()/cutBlind()
  return clone(wp, { forConstruction: false, pendingRect: { w, d } })
}

/**
 * circle
 * @param wp - Workplane
 * @param radius - number
 * @returns Workplane
 */
export function circle(wp: Workplane, radius: number): Workplane {
  return clone(wp, { forConstruction: false, pendingCircle: { radius } })
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
  return clone(wp, { forConstruction: false, pendingPolygon: { n, d } })
}

/**
 * extrude
 * @param wp - Workplane
 * @param height - number
 * @returns Promise<Workplane>
 */
export async function extrude(wp: Workplane, height: number): Promise<Workplane> {
  // If there's a pending 2D profile (rect/circle/polygon) and no existing shape, create the 3D solid
  if (wp.pendingPolygon && !wp.shape) {
    const shape = await makePolygonPrismAt(wp, wp.pendingPolygon, height, wp.normal)
    return clone(wp, { shape, pendingPolygon: undefined, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
  }
  if (wp.pendingRect && !wp.shape) {
    const { w, d } = wp.pendingRect
    const shape = await makeBoxAt(wp, w, d, height)
    return clone(wp, { shape, pendingRect: undefined, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
  }
  if (wp.pendingCircle && !wp.shape) {
    const { radius } = wp.pendingCircle
    const shape = await makeCylinderAt(wp, radius, height)
    return clone(wp, { shape, pendingCircle: undefined, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
  }
  // Boss extrude on existing shape: create profile at each workplane point and union
  if (wp.shape) {
    const n = Array.isArray(wp.normal) ? wp.normal : ([0, 0, 1] as [number, number, number])
    // Slight overlap ensures OCCT fuse merges coplanar faces into one solid
    const OVERLAP = 0.1
    // If we have a pending profile on an existing shape, create and union
    if (wp.pendingPolygon || wp.pendingRect || wp.pendingCircle) {
      const ptsArr = Array.isArray(wp.pts) ? wp.pts : []
      const points = ptsArr.length > 0 ? ptsArr : ([[0, 0]] as [number, number][])
      let shape = wp.shape
      for (const [px, py] of points) {
        const bossWp: Workplane = { ...wp, origin: localToWorld(wp, px, py) }
        let boss: Shape
        if (wp.pendingPolygon) {
          boss = await makePolygonPrismAt(bossWp, wp.pendingPolygon, height + OVERLAP, wp.normal)
        } else if (wp.pendingRect) {
          const { w, d } = wp.pendingRect
          boss = await makeBoxAt(bossWp, w, d, height + OVERLAP)
        } else {
          boss = await makeCylinderAt(bossWp, wp.pendingCircle!.radius, height + OVERLAP)
        }
        const shifted = await cad.translate(boss, {
          offset: [-n[0] * OVERLAP, -n[1] * OVERLAP, -n[2] * OVERLAP],
        })
        shape = await fuseShapes(shape, shifted as unknown as Shape)
      }
      return clone(wp, {
        shape,
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
  const absDepth = Math.abs(depth)
  const invNormal: [number, number, number] = [-wp.normal[0], -wp.normal[1], -wp.normal[2]]
  let result = wp.shape
  // CadQuery semantics: pushPoints() before cutBlind() repeats the cut at every
  // point. With no pushed points, the cut happens at the workplane origin.
  const ptsArr = Array.isArray(wp.pts) && wp.pts.length > 0 ? wp.pts : ([[0, 0]] as [number, number][])
  for (const [px, py] of ptsArr) {
    const cutWp: Workplane = {
      ...wp,
      origin: localToWorld(wp, px, py),
      normal: invNormal,
    }
    let tool: Shape
    if (wp.pendingCircle) {
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
  return clone(wp, { shape: result, faceSel: null, edgeSel: null, pts: [], pendingRect: undefined, pendingCircle: undefined, pendingPolygon: undefined })
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

  const ptsArr = Array.isArray(wp.pts) ? wp.pts : []
  const points = ptsArr.length > 0 ? ptsArr : [[0, 0]] as [number, number][]
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
  opts?: { centerOption?: string; offset?: number },
): Promise<Workplane> {
  if (!wp.shape || !wp.faceSel) {
    // No face selected — just apply offset
    if (opts?.offset) {
      const offset = vscale(wp.normal, opts.offset)
      return clone(wp, { origin: vadd(wp.origin, offset), faceSel: null })
    }
    return clone(wp, { faceSel: null })
  }

  const { center, normal } = await resolveFaceSelector(wp.shape, wp.faceSel, opts?.centerOption)
  // CadQuery default centerOption is "ProjectedOrigin": project the current
  // origin onto the face plane. "CenterOfBoundBox"/"CenterOfMass" keep the
  // face centroid returned by resolveFaceSelector.
  let newOrigin: [number, number, number]
  if (opts?.centerOption && opts.centerOption !== 'ProjectedOrigin') {
    newOrigin = center
  } else {
    const t = vdot(vsub(center, wp.origin), normal)
    newOrigin = vadd(wp.origin, vscale(normal, t))
  }
  if (opts?.offset) {
    newOrigin = vadd(newOrigin, vscale(normal, opts.offset))
  }
  const axes = faceAxes(normal)
  return clone(wp, {
    origin: newOrigin,
    normal,
    xDir: axes.x,
    yDir: axes.y,
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
 * mirror
 * @param wp - Workplane
 * @param plane - string
 * @returns Promise<Workplane>
 */
export async function mirror(
  wp: Workplane,
  plane?: string,
): Promise<Workplane> {
  if (!wp.shape) return wp
  try {
    const shape = await cad.mirror(wp.shape, { plane: plane ?? 'XY' })
    return clone(wp, { shape })
  } catch {
    // mirror may fail for some geometries — return unchanged (v1 tolerance)
    return wp
  }
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
 * `|Z`-style selectors resolve to concrete edges via `resolveEdgeSelection`;
 * with no edge selector ALL edges are filleted (matching
 * `fillet(shape, undefined, r)` semantics). Failures propagate — silently
 * returning the unfilleted shape previously produced plates whose fillets
 * were missing entirely (mini_lathe bp/mb/mt/tp diagnosis, 2026-09-08).
 *
 * @param wp - Workplane whose current shape is filleted; consumes `edgeSel`.
 * @param radius - Fillet radius in world units.
 * @returns Promise resolving to a new Workplane holding the filleted shape.
 */
export async function fillet(wp: Workplane, radius: number): Promise<Workplane> {
  if (!wp.shape) return wp
  const edges = resolveEdgeSelection(wp.shape, wp.edgeSel)
  const result = compatFn('fillet')(borrowBrepjsShape(wp.shape), edges, radius)
  const product = unwrapBrepResult(result)
  const shape = adoptBrepjsProduct(product)
  return clone(wp, { shape, edgeSel: null })
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
