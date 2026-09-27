/**
 * boolean-union — D1 2D boolean over polygonal boundaries.
 *
 * Computes the union, intersection, or difference of two closed polygonal
 * contours by the classic kept-edge splice. Every edge of A and B is split at
 * each point where it crosses the other polygon; a sub-edge is kept when its
 * midpoint lies on the kept side, then the kept sub-edges are assembled by
 * walking end-to-start into closed loops. Union keeps boundary not interior to
 * the other, intersection keeps that interior, and difference keeps A not in B
 * plus the B-boundary interior to A read in the excising (reversed) direction.
 * Works for simple (incl. non-convex) polygons whose crossings are transversal;
 * collinear-overlapping runs are not pruned (the full boolean would splice
 * those).
 *
 * Pure 2D, no kernel. Uses the D1 classifiers from `./boolean`.
 *
 * @module
 */

import { pointInContour, segmentIntersection } from './boolean'
import type { Point2d } from './custom-corners'

type Op = 'union' | 'intersection' | 'difference'
interface Edge {
  a: Point2d
  b: Point2d
}

function midOf(e: Edge): Point2d {
  return [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]
}
function lerp(a: Point2d, b: Point2d, t: number): Point2d {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
function key6(p: Point2d): string {
  return `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`
}

/**
 * Clip a polygon's edges against the classifier curve, keeping each split
 * sub-edge whose midpoint lies on the requested side of `other`.
 * @param poly - the source polygon.
 * @param other - the opposite polygon used for the inside/outside test.
 * @param inside - keep sub-edges inside `other` when `true`, else keep outside.
 * @param reverse - emit the kept sub-edges in the reversed orientation.
 * @returns the kept sub-edges.
 */
function clipEdges(poly: Point2d[], other: Point2d[], inside: boolean, reverse = false): Edge[] {
  const out: Edge[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % n]!
    const ts: number[] = []
    const m = other.length
    for (let j = 0; j < m; j++) {
      const hit = segmentIntersection(a, b, other[j]!, other[(j + 1) % m]!)
      if (hit) ts.push(hit.t)
    }
    const cuts = ts.sort((p, q) => p - q).filter((t, idx, arr) => idx === 0 || t - arr[idx - 1]! > 1e-9)
    const bounds: number[] = [0, ...cuts, 1]
    for (let k = 0; k < bounds.length - 1; k++) {
      const e: Edge = { a: lerp(a, b, bounds[k]!), b: lerp(a, b, bounds[k + 1]!) }
      if (pointInContour(midOf(e), other) === inside) {
        out.push(reverse ? { a: e.b, b: e.a } : e)
      }
    }
  }
  return out
}

/**
 * Assemble open oriented edges into closed loops by walking end-to-start.
 * Assumes a well-formed boundary where each vertex has out-degree ≤ 1 (true for
 * a boolean result on two simple polygons).
 * @param edges - oriented open edges.
 * @returns closed loops; in each, the first point equals the last.
 */
function splice(edges: Edge[]): Point2d[][] {
  const outgoing = new Map<string, Edge[]>()
  for (const e of edges) {
    const k = key6(e.a)
    const list = outgoing.get(k)
    if (list) list.push(e)
    else outgoing.set(k, [e])
  }
  const used = new Set<Edge>()
  const loops: Point2d[][] = []
  for (const e0 of edges) {
    if (used.has(e0)) continue
    const loop: Point2d[] = []
    let cur: Edge | null = e0
    while (cur && !used.has(cur)) {
      used.add(cur)
      loop.push([cur.a[0], cur.a[1]])
      const k = key6(cur.b)
      const list = outgoing.get(k)
      cur = list ? (list.find((e) => !used.has(e)) ?? null) : null
    }
    if (loop.length) loops.push(spliceCollinear(loop))
  }
  // Drop degenerate (zero-area / one-segment) loops left by collinear runs.
  return loops.filter((L) => L.length >= 3 && Math.abs(loopArea(L)) > 1e-6)
}

/** Signed shoelace area of a closed loop. */
function loopArea(pts: Point2d[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** True when `q` lies on the segment `p→r` (collinear and between, or endpoint). */
function collinearBetween(p: Point2d, q: Point2d, r: Point2d, eps = 1e-9): boolean {
  const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  if (Math.abs(cross) > eps) return false
  const dot = (q[0] - p[0]) * (r[0] - p[0]) + (q[1] - p[1]) * (r[1] - p[1])
  const lenSq = (r[0] - p[0]) ** 2 + (r[1] - p[1]) ** 2
  return dot >= -eps && dot <= lenSq + eps
}

/**
 * D1 collinear splice: dedup adjacent points, then collapse genuinely-collinear
 * interior vertices so a shared seam that survives as part of a straight outer
 * run merges into a single straight edge instead of leaving a degenerate loop.
 */
function spliceCollinear(pts: Point2d[]): Point2d[] {
  const out: Point2d[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-9) out.push([p[0], p[1]])
  }
  if (out.length > 1) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9) out.pop()
  }
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      const p = out[(i + out.length - 1) % out.length]!
      const q = out[i]!
      const r = out[(i + 1) % out.length]!
      if (collinearBetween(p, q, r)) {
        out.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return out
}

/**
 * Produce the kept boundary edges for an operation.
 * @param polyA - the first contour.
 * @param polyB - the second contour.
 * @param op - union keeps boundary not interior to either; intersection keeps
 *   the overlap; difference keeps A not in B plus the B-boundary inside A read
 *   in the reversed (excising) orientation.
 * @returns the directed kept edges.
 */
function keptEdges(polyA: Point2d[], polyB: Point2d[], op: Op): Edge[] {
  if (op === 'union') {
    return [...clipEdges(polyA, polyB, false), ...clipEdges(polyB, polyA, false)]
  }
  if (op === 'difference') {
    return [...clipEdges(polyA, polyB, false), ...clipEdges(polyB, polyA, true, true)]
  }
  return [...clipEdges(polyA, polyB, true), ...clipEdges(polyB, polyA, true)]
}

/**
 * Boolean union of two polygons.
 * @param polyA - the first closed contour.
 * @param polyB - the second closed contour.
 * @returns the boundary loops of the union.
 */
export function booleanUnion2d(polyA: Point2d[], polyB: Point2d[]): Point2d[][] {
  return splice(keptEdges(polyA, polyB, 'union'))
}

/**
 * Boolean intersection of two polygons.
 * @param polyA - the first closed contour.
 * @param polyB - the second closed contour.
 * @returns the boundary loops of the intersection.
 */
export function booleanIntersect2d(polyA: Point2d[], polyB: Point2d[]): Point2d[][] {
  return splice(keptEdges(polyA, polyB, 'intersection'))
}

/**
 * Boolean difference of two polygons (`polyA` minus `polyB`).
 * @param polyA - the base closed contour.
 * @param polyB - the closed contour to subtract.
 * @returns the boundary loops of the difference.
 */
export function booleanDifference2d(polyA: Point2d[], polyB: Point2d[]): Point2d[][] {
  // No area overlap (disjoint or only edge-touching ⇒ A ∩ B is empty): A − B = A.
  const inner = splice(keptEdges(polyA, polyB, 'intersection'))
  const hasArea = inner.some((L) => Math.abs(loopArea(L)) > 1e-6)
  if (!hasArea) {
    return spliceCollinear(polyA).length >= 3 ? [spliceCollinear(polyA)] : []
  }
  return splice(keptEdges(polyA, polyB, 'difference'))
}