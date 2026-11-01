/**
 * Shared CAM geometry primitives — ported from BREP.io
 * `src/cam/ShadowCutterEntity.ts` (pure geometric subset, no three.js /
 * scene-graph dependency).
 *
 * Coordinate convention (design decision D4): the faijs scene is +Z up, which
 * already matches CAM machine coordinates, so `toMachinePoint` is identity by
 * default. The function exists as the single conversion point so a future
 * (e.g. weapp) backend can swap the convention without touching the algorithm.
 */
import { roundCamCoord, roundCamPoint } from './types.js'
import type { CamPoint3, CamBounds } from './types.js'

/** AnyRecord — CAM toolpath type (BREP.io port). */
export type AnyRecord = Record<string, any>
/** CamPoint2 — CAM toolpath type (BREP.io port). */
export type CamPoint2 = [number, number]

/** Triangle — CAM toolpath type (BREP.io port). */
export type Triangle = [CamPoint3, CamPoint3, CamPoint3]
/** ShadowLoopRole — CAM toolpath type (BREP.io port). */
export type ShadowLoopRole = 'outer' | 'hole'
/** ShadowLoop — CAM toolpath type (BREP.io port). */
export type ShadowLoop = {
  role: ShadowLoopRole
  points: CamPoint2[]
}

/** EPS — CAM toolpath constant (BREP.io port). */
export const EPS = 1e-7

/** finiteNumber — CAM toolpath helper (BREP.io port).
 *
 *
 * @param value - the value value.
 * @param fallback - the fallback value.
 * @returns number - computed result.
 */
export function finiteNumber(value: any, fallback: number): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/** positiveNumber — CAM toolpath helper (BREP.io port).
 *
 *
 * @param value - the value value.
 * @param fallback - the fallback value.
 * @param min - the min value.
 * @returns number - computed result.
 */
export function positiveNumber(value: any, fallback: number, min = EPS): number {
  return Math.max(min, Math.abs(finiteNumber(value, fallback)))
}

/** roundCoord — CAM toolpath helper (BREP.io port).
 *
 *
 * @param value - the value value.
 * @returns number - computed result.
 */
export function roundCoord(value: number): number {
  return roundCamCoord(value)
}

// ---- 2D polygon primitives (shared by shadow / surfacing / roughing) ----

/** cross2 — CAM toolpath helper (BREP.io port).
 *
 *
 * @param origin - the origin value.
 * @param a - the a value.
 * @param b - the b value.
 * @returns number - computed result.
 */
export function cross2(origin: CamPoint2, a: CamPoint2, b: CamPoint2): number {
  return ((a[0] - origin[0]) * (b[1] - origin[1])) - ((a[1] - origin[1]) * (b[0] - origin[0]))
}

/** polygonArea — CAM toolpath helper (BREP.io port).
 *
 *
 * @param points - the points value.
 * @returns number - computed result.
 */
export function polygonArea(points: CamPoint2[]): number {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += (a[0] * b[1]) - (b[0] * a[1])
  }
  return area * 0.5
}

/** ensureCounterClockwise — CAM toolpath helper (BREP.io port).
 *
 *
 * @param points - the points value.
 * @returns CamPoint2[] - computed result.
 */
export function ensureCounterClockwise(points: CamPoint2[]): CamPoint2[] {
  return polygonArea(points) < 0 ? points.slice().reverse() : points.slice()
}

/** simplifyLoop — CAM toolpath helper (BREP.io port).
 *
 *
 * @param points - the points value.
 * @param tol - the tol value.
 * @returns CamPoint2[] - computed result.
 */
export function simplifyLoop(points: CamPoint2[], tol = EPS): CamPoint2[] {
  let out: CamPoint2[] = []
  for (const point of points) {
    const next: CamPoint2 = [roundCoord(point[0]), roundCoord(point[1])]
    const previous = out[out.length - 1]
    if (!previous || Math.hypot(next[0] - previous[0], next[1] - previous[1]) > tol) out.push(next)
  }
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= tol) out = out.slice(0, -1)
  }
  let changed = true
  let guard = 0
  while (changed && out.length >= 3 && guard < 64) {
    changed = false
    guard += 1
    const next: CamPoint2[] = []
    for (let index = 0; index < out.length; index += 1) {
      const prev = out[(index - 1 + out.length) % out.length]
      const point = out[index]
      const after = out[(index + 1) % out.length]
      const edgeLen = Math.min(Math.hypot(point[0] - prev[0], point[1] - prev[1]), Math.hypot(after[0] - point[0], after[1] - point[1]))
      if (edgeLen <= tol || Math.abs(cross2(prev, point, after)) <= Math.max(tol, edgeLen * 1e-7)) {
        changed = true
        continue
      }
      next.push(point)
    }
    out = next
  }
  return out
}

/** pointInPolygon — CAM toolpath helper (BREP.io port).
 *
 *
 * @param point - the point value.
 * @param polygon - the polygon value.
 * @returns boolean - computed result.
 */
export function pointInPolygon(point: CamPoint2, polygon: CamPoint2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]
    const pj = polygon[j]
    const intersects = ((pi[1] > point[1]) !== (pj[1] > point[1]))
      && (point[0] < ((pj[0] - pi[0]) * (point[1] - pi[1])) / ((pj[1] - pi[1]) || EPS) + pi[0])
    if (intersects) inside = !inside
  }
  return inside
}

/** loopInsideLoop — CAM toolpath helper (BREP.io port).
 *
 *
 * @param loop - the loop value.
 * @param container - the container value.
 * @returns boolean - computed result.
 */
export function loopInsideLoop(loop: CamPoint2[], container: CamPoint2[]): boolean {
  if (loop.length < 3 || container.length < 3) return false
  return loop.every((point) => pointInPolygon(point, container))
}

/** point2Key — CAM toolpath helper (BREP.io port).
 *
 *
 * @param point - the point value.
 * @returns string - computed result.
 */
export function point2Key(point: CamPoint2): string {
  return `${roundCoord(point[0])},${roundCoord(point[1])}`
}

/** toMachinePoint — CAM toolpath helper (BREP.io port).
 *
 *
 * @param point - the point value.
 * @returns CamPoint3 - computed result.
 */
export function toMachinePoint(point: CamPoint3): CamPoint3 {
  return roundCamPoint(point)
}

/** triangleBounds — CAM toolpath helper (BREP.io port).
 *
 *
 * @param triangles - the triangles value.
 * @returns CamBounds | null - computed result.
 */
export function triangleBounds(triangles: Triangle[]): CamBounds | null {
  if (!triangles.length) return null
  const min: CamPoint3 = [Infinity, Infinity, Infinity]
  const max: CamPoint3 = [-Infinity, -Infinity, -Infinity]
  for (const triangle of triangles) {
    for (const point of triangle) {
      min[0] = Math.min(min[0], point[0])
      min[1] = Math.min(min[1], point[1])
      min[2] = Math.min(min[2], point[2])
      max[0] = Math.max(max[0], point[0])
      max[1] = Math.max(max[1], point[1])
      max[2] = Math.max(max[2], point[2])
    }
  }
  return { min: roundCamPoint(min), max: roundCamPoint(max) }
}

/** trianglesFromMesh — CAM toolpath helper (BREP.io port).
 *
 *
 * @param positions - the positions value.
 * @param indices - the indices value.
 * @param triangleFilter - the triangleFilter value.
 * @returns Triangle[] - computed result.
 */
export function trianglesFromMesh(
  positions: Float32Array | ArrayLike<number>,
  indices: Uint32Array | ArrayLike<number>,
  triangleFilter?: (triangleIndex: number) => boolean,
): Triangle[] {
  const out: Triangle[] = []
  for (let i = 0; i + 2 < indices.length; i += 3) {
    if (triangleFilter && !triangleFilter(i / 3)) continue
    const a = vertexAt(positions, Number(indices[i]))
    const b = vertexAt(positions, Number(indices[i + 1]))
    const c = vertexAt(positions, Number(indices[i + 2]))
    if (a && b && c) out.push([a, b, c])
  }
  return out
}

function vertexAt(positions: Float32Array | ArrayLike<number>, index: number): CamPoint3 | null {
  const base = index * 3
  if (base < 0 || base + 2 >= positions.length) return null
  const point: CamPoint3 = [
    Number(positions[base]),
    Number(positions[base + 1]),
    Number(positions[base + 2]),
  ]
  return point.every(Number.isFinite) ? toMachinePoint(point) : null
}

/** makeFaceTriangleFilter — CAM toolpath helper (BREP.io port).
 *
 *
 * @param faceRanges - the faceRanges value.
 * @param faceIndices - the faceIndices value.
 * @returns ((triangleIndex: number) => boolean) | null - computed result.
 */
export function makeFaceTriangleFilter(
  faceRanges: Array<{ start: number; count: number }> | undefined,
  faceIndices: number[],
): ((triangleIndex: number) => boolean) | null {
  if (!Array.isArray(faceRanges) || faceRanges.length === 0) return null
  if (!Array.isArray(faceIndices) || faceIndices.length === 0) return null
  const selected = new Set<number>()
  for (const index of faceIndices) {
    const range = faceRanges[index]
    if (!range) continue
    for (let t = range.start; t < range.start + range.count; t += 1) selected.add(t)
  }
  if (selected.size === 0) return null
  return (triangleIndex: number) => selected.has(triangleIndex)
}
