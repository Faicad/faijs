/**
 * boolean helpers — D1 2D boolean kernel foundation.
 *
 * The two low-level classifiers a 2D boolean (fuse/cut/intersect) needs:
 * a point-in-contour inside/outside tie-break and a segment/segment
 * intersection probe. Both are pure, O(n) per contour, and exact up to machine
 * epsilon; they deliberately sit at the start of the D1 splice: every clip /
 * slice decision reduces to "which side of which contour is this vertex" and
 * "where do these two edges cross".
 *
 * Pure 2D, no kernel. Imports core `geometry2d` only.
 *
 * @module
 */

import type { Point2d } from './custom-corners'

/**
 * Classify a point as inside (true) or outside (false) a closed contour.
 *
 * Uses the even-odd ray-cast test against the horizontal ray `+x`: each edge
 * that strictly straddles the point's `y` flips the parity when its crossing `x`
 * lies to the right of the point. Boundary contact is treated as a numeric
 * accident (return the side value); callers needing robust boundary handling
 * should snap vertices onto edges explicitly.
 *
 * @param p - the query point.
 * @param pts - the closed (implicitly) contour vertices.
 * @returns true when `p` is strictly inside the contour.
 */
export function pointInContour(p: Point2d, pts: Point2d[]): boolean {
  const n = pts.length
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = pts[i]!
    const b = pts[j]!
    if (a[1] > p[1] !== b[1] > p[1]) {
      const xInt = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
      if (p[0] < xInt) inside = !inside
    }
  }
  return inside
}

/**
 * Find the intersection of two line segments, if any.
 *
 * Returns the parameter `t` along the first segment (`a1 + t·(a2−a1)`) and `u`
 * along the second (`b1 + u·(b2−b1)`), both within `[0,1]` (within `eps`), plus
 * the point. Returns `null` for parallel or non-overlap. Collinear-but-overlap
 * is reported as `null` here (clients treat it specially for splicing).
 *
 * @param a1 - first segment start.
 * @param a2 - first segment end.
 * @param b1 - second segment start.
 * @param b2 - second segment end.
 * @param eps - the coincidence tolerance (`1e-9`).
 * @returns the intersection, or `null` when the segments do not cross.
 */
export function segmentIntersection(
  a1: Point2d,
  a2: Point2d,
  b1: Point2d,
  b2: Point2d,
  eps = 1e-9,
): { point: Point2d; t: number; u: number } | null {
  const d1 = [a2[0] - a1[0], a2[1] - a1[1]] as Point2d
  const d2 = [b2[0] - b1[0], b2[1] - b1[1]] as Point2d
  const denom = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(denom) < eps) return null
  const e = [b1[0] - a1[0], b1[1] - a1[1]]
  const t = (e[0] * d2[1] - e[1] * d2[0]) / denom
  const u = (e[0] * d1[1] - e[1] * d1[0]) / denom
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  return {
    point: [a1[0] + t * d1[0], a1[1] + t * d1[1]],
    t: Math.max(0, Math.min(1, t)),
    u: Math.max(0, Math.min(1, u)),
  }
}