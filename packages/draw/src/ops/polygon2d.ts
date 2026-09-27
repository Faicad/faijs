/**
 * polygon2d — D2 polygon classification helpers for the offset self-intersection
 * prune.
 *
 * `polygonSignedArea` returns the shoelace signed area (positive for
 * counter-clockwise), and `isSimplePolygon` reports a closed contour with no
 * proper edge–edge crossings (it permits collinear/touching runs, which are
 * degenerate, not "intersecting" in the pruning sense). The D2 prune uses the
 * area to drop negative/zero lobes and the simplicity test to know when a prune
 * is still needed.
 *
 * Pure 2D, no kernel.
 *
 * @module
 */

import { segmentIntersection } from './boolean'
import type { Point2d } from './custom-corners'

/**
 * Signed area of a closed polygon via the shoelace sum.
 * @param pts - the closed contour vertices.
 * @returns positive for a counter-clockwise polygon, negative for clockwise.
 */
export function polygonSignedArea(pts: Point2d[]): number {
  let s = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/**
 * Test whether two segments properly cross (a transversal intersection strictly
 * interior to both), ignoring collinear touches.
 * @param a - first segment start.
 * @param b - first segment end.
 * @param c - second segment start.
 * @param d - second segment end.
 * @returns true when the two segments properly cross away from endpoints.
 */
export function segmentsProperlyCross(a: Point2d, b: Point2d, c: Point2d, d: Point2d): boolean {
  const orient = (o: Point2d, p: Point2d, q: Point2d): number =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

/**
 * Test whether a closed contour is simple (no proper self-crossings).
 * @param pts - the closed contour vertices.
 * @returns false when any two non-adjacent edges properly cross.
 */
export function isSimplePolygon(pts: Point2d[]): boolean {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges (share a corner)
      if (j === i || (j + 1) % n === i || (j === n - 1 && i === 0) || j === i + 1) continue
      const c = pts[j]!
      const d = pts[(j + 1) % n]!
      if (segmentsProperlyCross(a, b, c, d)) return false
    }
  }
  return true
}

/** Drop consecutive duplicate vertices and a trailing closer equal to the head. */
function scrub(pts: Point2d[]): Point2d[] {
  const out: Point2d[] = []
  for (const p of pts) {
    if (out.length && Math.hypot(out[out.length - 1]![0] - p[0], out[out.length - 1]![1] - p[1]) < 1e-9) continue
    out.push(p)
  }
  if (out.length > 1 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) < 1e-9) {
    out.pop()
  }
  return out
}

/** First proper self-crossing of a closed polyline, else `null`. */
function firstCrossing(pts: Point2d[]): { i: number; j: number; x: Point2d } | null {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (j === n - 1 && i === 0) || j === i + 1) continue
      const hit = segmentIntersection(a, b, pts[j]!, pts[(j + 1) % n]!)
      if (hit && segmentsProperlyCross(a, b, pts[j]!, pts[(j + 1) % n]!)) {
        return { i, j, x: hit.point }
      }
    }
  }
  return null
}

/**
 * Decompose a closed polyline that proper-self-intersects into its elementary
 * lobes.
 * @param pts - the closed vertices (may self-cross).
 * @returns the elementary lobes (each simple, in the input winding).
 */
export function decomposeSelfIntersections(pts: Point2d[]): Point2d[][] {
  const clean = scrub(pts)
  const cr = firstCrossing(clean)
  if (!cr) return [clean]
  const { i, j, x } = cr
  const loop1 = [...clean.slice(0, i + 1), x, ...clean.slice(j + 1)]
  const loop2 = [...clean.slice(i + 1, j + 1), x]
  return [...decomposeSelfIntersections(loop1), ...decomposeSelfIntersections(loop2)]
}

/**
 * Cavalier-style self-intersection prune: decompose a self-crossing closed
 * polyline into its elementary lobes and keep only the positive-area (CCW)
 * ones, returning each as its own simple loop. A non-self-crossing input passes
 * through unchanged.
 * @param pts - the closed polyline (offsets of non-convex contours self-cross).
 * @returns the kept lobes as closed loops.
 */
export function pruneSelfIntersections(pts: Point2d[]): Point2d[][] {
  const lobes = decomposeSelfIntersections(pts)
  return lobes
    .map(scrub)
    .filter((l) => l.length >= 3)
    .filter((l) => polygonSignedArea(l) > 1e-9)
}