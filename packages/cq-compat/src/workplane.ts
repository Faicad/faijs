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
import type { Shape } from '@faicad/faijs-core/mesh/types'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'

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
  /** Workplane normal (unit vector). */
  normal: [number, number, number]
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

/** Create an empty workplane on the given plane. */
function makeWorkplane(plane: string): Workplane {
  const normal: [number, number, number] =
    plane === 'XY' ? [0, 0, 1] : plane === 'XZ' ? [0, 1, 0] : [1, 0, 0]
  return Object.assign(Object.create(WP_PROTO), {
    __cq: true as const,
    plane,
    origin: [0, 0, 0] as [number, number, number],
    normal,
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
 * Simplified: supports ">Z", "<Z", ">X", "<X", ">Y", "<Y" and indexed
 * variants like ">Z[-2]" via bbox approximation.
 */
function resolveFaceSelector(
  shape: Shape,
  sel: string,
): { center: [number, number, number]; normal: [number, number, number] } {
  const max = bboxMax(shape)
  const min = bboxMin(shape)
  const center: [number, number, number] = [
    (max[0] + min[0]) / 2,
    (max[1] + min[1]) / 2,
    (max[2] + min[2]) / 2,
  ]

  // Strip index suffix like [-2]
  const baseSel = sel.replace(/\[-?\d+\]$/, '')

  if (baseSel === '>Z' || baseSel === '+Z') {
    return { center: [center[0], center[1], max[2]], normal: [0, 0, 1] }
  }
  if (baseSel === '<Z' || baseSel === '-Z') {
    return { center: [center[0], center[1], min[2]], normal: [0, 0, -1] }
  }
  if (baseSel === '>X' || baseSel === '+X') {
    return { center: [max[0], center[1], center[2]], normal: [1, 0, 0] }
  }
  if (baseSel === '<X' || baseSel === '-X') {
    return { center: [min[0], center[1], center[2]], normal: [-1, 0, 0] }
  }
  if (baseSel === '>Y' || baseSel === '+Y') {
    return { center: [center[0], max[1], center[2]], normal: [0, 1, 0] }
  }
  if (baseSel === '<Y' || baseSel === '-Y') {
    return { center: [center[0], min[1], center[2]], normal: [0, -1, 0] }
  }
  // Default: return center
  return { center, normal: [0, 0, 1] }
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
  return cad.translate(cyl, { offset: wp.origin })
}

/**
 * Create a box at the workplane origin.
 */
async function makeBoxAt(
  wp: Workplane,
  w: number,
  d: number,
  h: number,
): Promise<Shape> {
  const box = await cad.box(w, d, h, { centered: true })
  return cad.translate(box, { offset: wp.origin })
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
 */
export async function box(
  wp: Workplane,
  w: number,
  d: number,
  h: number,
): Promise<Workplane> {
  const shape = await makeBoxAt(wp, w, d, h)
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
  return clone(wp, { forConstruction: false, pendingCircle: { radius: d / 2 } })
}

/**
 * extrude
 * @param wp - Workplane
 * @param height - number
 * @returns Promise<Workplane>
 */
export async function extrude(wp: Workplane, height: number): Promise<Workplane> {
  // If there's a pending 2D profile (rect/circle), create the 3D solid
  if (wp.pendingRect) {
    const { w, d } = wp.pendingRect
    const shape = await makeBoxAt(wp, w, d, height)
    return clone(wp, { shape, pendingRect: undefined, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
  }
  if (wp.pendingCircle) {
    const { radius } = wp.pendingCircle
    const shape = await makeCylinderAt(wp, radius, height)
    return clone(wp, { shape, pendingCircle: undefined, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
  }
  // Boss extrude on existing shape: create profile at workplane origin and union
  if (wp.shape) {
    // If we have a pending profile on an existing shape, create and union
    if (wp.pendingRect) {
      const { w, d } = wp.pendingRect
      const boss = await makeBoxAt(wp, w, d, height)
      const shape = await cad.union(wp.shape, boss)
      return clone(wp, { shape, pendingRect: undefined })
    }
    if (wp.pendingCircle) {
      const { radius } = wp.pendingCircle
      const boss = await makeCylinderAt(wp, radius, height)
      const shape = await cad.union(wp.shape, boss)
      return clone(wp, { shape, pendingCircle: undefined })
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
  let tool: Shape
  if (wp.pendingCircle) {
    tool = await makeCylinderAt(wp, wp.pendingCircle.radius, absDepth + 2)
  } else if (wp.pendingRect) {
    tool = await makeBoxAt(wp, wp.pendingRect.w, wp.pendingRect.d, absDepth + 2)
  } else if (opts?.radius !== undefined) {
    tool = await makeCylinderAt(wp, opts.radius, absDepth + 2)
  } else if (opts?.w !== undefined && opts?.d !== undefined) {
    tool = await makeBoxAt(wp, opts.w, opts.d, absDepth + 2)
  } else {
    // Default: use a large box (should not happen with proper transpilation)
    tool = await makeBoxAt(wp, 1000, 1000, absDepth + 2)
  }
  const result = await cad.subtract(wp.shape, tool)
  return clone(wp, { shape: result, faceSel: null, edgeSel: null, pts: [], pendingRect: undefined, pendingCircle: undefined })
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
  const totalHeight = max[2] - min[2] + 4 // through-hole with margin
  const holeHeight = depth ?? totalHeight

  const ptsArr = Array.isArray(wp.pts) ? wp.pts : []
  const points = ptsArr.length > 0 ? ptsArr : [[0, 0]] as [number, number][]
  let result = wp.shape

  for (const [px, py] of points) {
    const holeOrigin: [number, number, number] = [
      wp.origin[0] + px,
      wp.origin[1] + py,
      wp.origin[2],
    ]
    const cyl = await makeCylinderAt(
      { ...wp, origin: holeOrigin },
      radius,
      holeHeight,
    )
    result = await cad.subtract(result, cyl)
  }

  return clone(wp, { shape: result, faceSel: null, edgeSel: null, vertexSel: null, pts: [] })
}

/**
 * cboreHole
 * @param wp - Workplane
 * @param diameter - number
 * @param cboreDiameter - number
 * @param cboreDepth - number
 * @returns Promise<Workplane>
 */
export async function cboreHole(
  wp: Workplane,
  diameter: number,
  cboreDiameter: number,
  cboreDepth: number,
): Promise<Workplane> {
  let result = wp
  result = await hole(result, diameter)
  // Counterbore: larger shallow hole
  if (result.shape) {
    const cboreRadius = cboreDiameter / 2
    const cborePts = Array.isArray(result.pts) ? result.pts : []
    const points = cborePts.length > 0 ? cborePts : [[0, 0]] as [number, number][]
    let shape = result.shape
    for (const [px, py] of points) {
      const origin: [number, number, number] = [
        result.origin[0] + px,
        result.origin[1] + py,
        result.origin[2],
      ]
      const cyl = await makeCylinderAt({ ...result, origin }, cboreRadius, cboreDepth + 1)
      shape = await cad.subtract(shape, cyl)
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
  let result = await hole(wp, diameter)
  if (result.shape) {
    const cskRadius = cskDiameter / 2
    const cskDepth = cskRadius / Math.tan((cskAngle * Math.PI) / 360)
    const cborePts = Array.isArray(result.pts) ? result.pts : []
    const points = cborePts.length > 0 ? cborePts : [[0, 0]] as [number, number][]
    let shape = result.shape
    for (const [px, py] of points) {
      const origin: [number, number, number] = [
        result.origin[0] + px,
        result.origin[1] + py,
        result.origin[2],
      ]
      const cyl = await makeCylinderAt({ ...result, origin }, cskRadius, cskDepth + 1)
      shape = await cad.subtract(shape, cyl)
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

  const { center, normal } = resolveFaceSelector(wp.shape, wp.faceSel)
  let newOrigin = center
  if (opts?.offset) {
    newOrigin = vadd(newOrigin, vscale(normal, opts.offset))
  }
  return clone(wp, {
    origin: newOrigin,
    normal,
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
  // Local X/Y axes: for XY plane, x→world X, y→world Y
  // Simplified: assume XY plane
  const origin = Array.isArray(wp.origin) ? wp.origin : [0, 0, 0]
  return clone(wp, {
    origin: [origin[0] + x, origin[1] + y, origin[2]],
  })
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
  const shape = await cad.union(wp.shape, otherShape)
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
  const shape = await cad.intersect(wp.shape, otherShape)
  return clone(wp, { shape })
}

/**
 * fillet
 * @param wp - Workplane
 * @param radius - number
 * @returns Promise<Workplane>
 */
export async function fillet(wp: Workplane, radius: number): Promise<Workplane> {
  if (!wp.shape) return wp
  try {
    const handle = borrowBrepjsShape(wp.shape)
    // brepjsCompat.fillet signature: fillet(shape, edges, radius)
    // For v1, pass null/undefined edges to fillet all edges,
    // or pass the shape directly if the API supports it.
    const filletFn = (brepjsCompat as Record<string, unknown>).fillet as
      | ((...args: unknown[]) => unknown)
      | undefined
    if (!filletFn) {
      // Fallback: no fillet (should not happen — fillet is in brepjsCompat)
      return clone(wp, { edgeSel: null })
    }
    const result = filletFn(handle, null, radius) as { ok?: boolean; value?: unknown } | unknown
    // Result may be Result<ValidSolid> or raw handle
    const product =
      result && typeof result === 'object' && 'ok' in result
        ? (result as { ok: boolean; value?: unknown }).value
        : result
    if (product) {
      const shape = adoptBrepjsProduct(product)
      return clone(wp, { shape, edgeSel: null })
    }
  } catch {
    // Fillet failed — return shape unchanged (v1 tolerance)
  }
  return clone(wp, { edgeSel: null })
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
    result = await translate(result, opts.offset)
  }
  if (opts.rotate) {
    const [rx, ry, rz] = opts.rotate
    if (rx) result = await rotate(result, [1, 0, 0], rx)
    if (ry) result = await rotate(result, [0, 1, 0], ry)
    if (rz) result = await rotate(result, [0, 0, 1], rz)
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
