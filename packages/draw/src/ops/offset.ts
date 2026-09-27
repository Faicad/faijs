/**
 * offsetOutline2d — D2 parallel (miter) offset of a closed polygon outline.
 *
 * Moves every edge of a closed polygon outward (or inward, for a negative
 * `dist`) by a constant distance and returns the offset vertices. Each offset
 * vertex is the intersection of its two incident edges, each shifted by `dist`
 * along its outward (right) normal — the standard miter join. On a convex CCW
 * contour the result is exact and still simple; on non-convex or self-overlapped
 * contours the miter can self-intersect — use `offsetPolygonLoops2d`, which
 * drives the offset through the Cavalier-caller self-intersection prune
 * (`pruneSelfIntersections`) and returns the kept loops.
 *
 * Pure 2D, no kernel. Imports core `geometry2d` only.
 *
 * @module
 */

import type { Point2d } from './custom-corners'
import { pruneSelfIntersections } from './polygon2d'

function unit(x: number, y: number): Point2d {
  const n = Math.hypot(x, y)
  return n > 1e-12 ? [x / n, y / n] : [1, 0]
}

/** Intersection of two lines `p1 + t·d1` and of `p2 + s·d2`, or `null` when parallel. */
function lineInter(p1: Point2d, d1: Point2d, p2: Point2d, d2: Point2d): Point2d | null {
  const det = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(det) < 1e-12) return null
  const ex = p2[0] - p1[0]
  const ey = p2[1] - p1[1]
  const t = (ex * d2[1] - ey * d2[0]) / det
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]]
}

/**
 * Offset the vertices of a closed polygon by a fixed distance (miter join).
 * @param verts - the closed CCW contour vertices.
 * @param dist - the offset distance; positive grows outward, negative shrinks.
 * @returns the offset contour vertices (same count), requiring a miter intersection.
 */
export function offsetOutline2d(verts: Point2d[], dist: number): Point2d[] {
  const n = verts.length
  if (n === 0) return []
  if (n === 1) return [[verts[0]![0], verts[0]![1]]]
  if (dist === 0) return verts.map(([x, y]) => [x, y])

  const out: Point2d[] = []
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n]!
    const cur = verts[i]!
    const next = verts[(i + 1) % n]!

    // In-edge (prev→cur) and out-edge (cur→next), each with its outward normal.
    const dIn = unit(cur[0] - prev[0], cur[1] - prev[1])
    const nIn: Point2d = [dIn[1], -dIn[0]]
    const dOut = unit(next[0] - cur[0], next[1] - cur[1])
    const nOut: Point2d = [dOut[1], -dOut[0]]

    // Each edge offset by moving one of its points along its outward normal.
    const pInEd: Point2d = [prev[0] + nIn[0] * dist, prev[1] + nIn[1] * dist]
    const pOutEd: Point2d = [cur[0] + nOut[0] * dist, cur[1] + nOut[1] * dist]

    const hit = lineInter(pInEd, dIn, pOutEd, dOut)
    out.push(hit ?? [cur[0], cur[1]])
  }
  return out
}

/**
 * Offset a closed polygon and prune any miter self-intersection, returning the
 * kept loops. For convex inputs this equals `offsetOutline2d` wrapped in a
 * single loop; for non-convex or self-overlapping contours the Cavalier prune
 * splits the offset at its self-crossings and keeps the positive-area lobes.
 * @param verts - the closed CCW contour vertices.
 * @param dist - the offset distance; positive grows outward, negative shrinks.
 * @returns the pruned closed loops.
 */
export function offsetPolygonLoops2d(verts: Point2d[], dist: number): Point2d[][] {
  if (verts.length === 0) return []
  return pruneSelfIntersections(offsetOutline2d(verts, dist))
}