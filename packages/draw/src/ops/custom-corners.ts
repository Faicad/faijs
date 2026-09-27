/**
 * custom-corners — D3 round/chamfer corner splicing for the draw package.
 *
 * Two straight segments share a vertex `corner` (segment1 = `p → corner`,
 * segment2 = `corner → q`). A corner op replaces the sharp vertex with either a
 * chamfer (a straight inset segment) or a round fillet (a tangent circular
 * arc), trimming each segment back to its tangent point. The three boundary
 * curves produced are ready to be re-assembled into a `Blueprint`.
 *
 * Pure 2D. Imports core `geometry2d` only (`@facade/faijs/geometry2d`), per
 * plan §197/§199.
 *
 * @module
 */

import { makeLine2d, makeArc2dThreePoints, type Curve2dObj } from '@faicad/faijs/geometry2d'

/** A 2-tuple point used by the corner ops. */
export type Point2d = [number, number]

/** The kept segments plus the new corner piece, in boundary order. */
export interface CornerSplice {
  /** Kept first segment, from `p` to the first tangent point. */
  first: Curve2dObj
  /** The new corner piece (chamfer segment or the fillet arc). */
  corner: Curve2dObj
  /** Kept second segment, from the second tangent point to `q`. */
  second: Curve2dObj
  /** First tangent point (on `p → corner`). */
  tangent: Point2d
  /** Second tangent point (on `corner → q`). */
  tangent2: Point2d
}

/** A resolved fillet, additionally exposing the center and radius. */
export interface FilletCorner extends CornerSplice {
  /** The fillet arc center. */
  center: Point2d
  /** The fillet radius. */
  radius: number
}

function add(a: Point2d, b: Point2d): Point2d {
  return [a[0] + b[0], a[1] + b[1]]
}
function scale(a: Point2d, k: number): Point2d {
  return [a[0] * k, a[1] * k]
}
function sub(a: Point2d, b: Point2d): Point2d {
  return [a[0] - b[0], a[1] - b[1]]
}
function norm(a: Point2d): number {
  return Math.hypot(a[0], a[1])
}
function unit(a: Point2d): Point2d {
  const n = norm(a)
  return n > 1e-12 ? [a[0] / n, a[1] / n] : [1, 0]
}
function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

/** Distance from the shared vertex to the tangent point along each segment. */
function tangentDistance(radius: number, theta: number): number {
  const half = theta / 2
  return radius * (Math.cos(half) / Math.sin(half))
}

/**
 * Chamfer the corner where two segments meet at a shared vertex.
 *
 * Trims each segment back by `inset` from the corner and connects the two cut
 * points with a straight segment.
 *
 * @param corner - the shared corner vertex.
 * @param p - the far endpoint of the first segment (`p → corner`).
 * @param q - the far endpoint of the second segment (`corner → q`).
 * @param inset - the chamfer inset from the corner along each segment (> 0).
 * @returns the spliced chamfer (kept pieces + chamfer edge).
 */
export function chamfer2d(corner: Point2d, p: Point2d, q: Point2d, inset: number): CornerSplice {
  const v1 = unit(sub(p, corner))
  const v2 = unit(sub(q, corner))
  // The chamfer trims `inset` back from the corner along each segment; clamp to
  // the adjacent edge lengths so the cut points stay on the boundary.
  const insetMin = Math.max(0, Math.min(inset, norm(sub(p, corner)), norm(sub(q, corner))))
  const t1 = add(corner, scale(v1, insetMin))
  const t2 = add(corner, scale(v2, insetMin))
  return {
    first: makeLine2d(p[0], p[1], t1[0], t1[1]),
    corner: makeLine2d(t1[0], t1[1], t2[0], t2[1]),
    second: makeLine2d(t2[0], t2[1], q[0], q[1]),
    tangent: t1,
    tangent2: t2,
  }
}

/**
 * Fillet (round) the corner where two segments meet at a shared vertex.
 *
 * Replaces the corner with a circular arc of radius `radius`, tangent to both
 * segments. The tangent points sit at the same inset along each segment and the
 * arc is built through the two tangent points and the corner-side midpoint, so
 * its radius is exactly `radius` and its center lies on the angle bisector.
 *
 * @param corner - the shared corner vertex.
 * @param p - the far endpoint of the first segment (`p → corner`).
 * @param q - the far endpoint of the second segment (`corner → q`).
 * @param radius - the fillet radius (must be < each segment's length).
 * @returns the spliced fillet (kept pieces + arc).
 */
export function fillet2d(corner: Point2d, p: Point2d, q: Point2d, radius: number): FilletCorner {
  const v1 = unit(sub(p, corner))
  const v2 = unit(sub(q, corner))
  const dot = clip(v1[0] * v2[0] + v1[1] * v2[1], -1, 1)
  const theta = Math.acos(dot)
  const half = theta / 2
  // The tangent points sit `r·cot(half)` back from the corner along each segment.
  // On a sharp corner (small θ) that reach can exceed an adjacent edge, pushing a
  // tangent point off the segment; clamp the radius to the largest value whose
  // tangent points still fit both edges (CAD "fillet as large as the part allows").
  const reach = Math.min(norm(sub(p, corner)), norm(sub(q, corner)))
  let r = radius
  if (half > 1e-9) r = Math.max(0, Math.min(radius, reach * Math.tan(half)))
  else r = Math.max(0, radius) // θ≈0: straight-through; keep nominal radius (zero-angle fillet collapses)
  const tang = tangentDistance(r, theta)
  const r2 = add(corner, scale(v1, tang))
  const t2 = add(corner, scale(v2, tang))
  const bisector = unit([v1[0] + v2[0], v1[1] + v2[1]])
  const center = add(corner, scale(bisector, half > 1e-9 ? r / Math.sin(half) : 0))
  // Arc midpoint on the corner side: from the center, one radius toward the corner.
  const towardCorner: Point2d = r > 1e-12 ? unit(sub(corner, center)) : [0, 0]
  const mid = add(center, scale(towardCorner, r))
  const arc = makeArc2dThreePoints(r2[0], r2[1], mid[0], mid[1], t2[0], t2[1])
  return {
    first: makeLine2d(p[0], p[1], r2[0], r2[1]),
    corner: arc,
    second: makeLine2d(t2[0], t2[1], q[0], q[1]),
    tangent: r2,
    tangent2: t2,
    center,
    radius: r,
  }
}