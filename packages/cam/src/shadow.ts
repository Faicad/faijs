/**
 * Shadow / polygon machinery — ported from BREP.io `src/cam/ShadowCutterEntity.ts`.
 *
 * Pure 2D polygon operations over clipper-lib (union / offset) plus the
 * top-down shadow loop model used by shadow-cutter and roughing strategies.
 */
import ClipperLib from 'clipper-lib'
import { makeEmptyCamToolpathProgram, makeFlatEndMillCutter, roundCamPoint } from './types.js'
import type { CamPoint3, CamBounds, CamCutterDefinition, CamCutterOrientation, CamToolpathPath, CamToolpathPoint, CamToolpathProgram, CamToolpathSegment } from './types.js'
import type { CamMachineProfile } from './profile.js'
import {
  EPS,
  ensureCounterClockwise,
  loopInsideLoop,
  pointInPolygon,
  polygonArea,
  point2Key,
  roundCoord,
  simplifyLoop,
} from './geometry.js'
import type { CamPoint2, ShadowLoop, Triangle } from './geometry.js'

/** CAM_OPERATION_TYPE_SHADOW_CUTTER — CAM toolpath constant (BREP.io port). */
export const CAM_OPERATION_TYPE_SHADOW_CUTTER = 'shadow-cutter'

const CLIPPER_SCALE = 10000

/** loopsFromEdges — CAM toolpath helper (BREP.io port).
 *
 *
 * @param edges - the edges value.
 * @returns CamPoint2[][] - computed result.
 */
export function loopsFromEdges(edges: Array<{ a: CamPoint2; b: CamPoint2 }>): CamPoint2[][] {
  const pointsByKey = new Map<string, CamPoint2>()
  const adjacency = new Map<string, Set<string>>()
  const edgeKeys = new Set<string>()
  const addPoint = (point: CamPoint2) => {
    const key = point2Key(point)
    if (!pointsByKey.has(key)) pointsByKey.set(key, [roundCoord(point[0]), roundCoord(point[1])])
    if (!adjacency.has(key)) adjacency.set(key, new Set())
    return key
  }
  for (const edge of edges) {
    const a = addPoint(edge.a)
    const b = addPoint(edge.b)
    if (a === b) continue
    adjacency.get(a)?.add(b)
    adjacency.get(b)?.add(a)
    edgeKeys.add(a < b ? `${a}|${b}` : `${b}|${a}`)
  }

  const unused = new Set(edgeKeys)
  const loops: CamPoint2[][] = []
  const mark = (a: string, b: string) => unused.delete(a < b ? `${a}|${b}` : `${b}|${a}`)
  const hasEdge = (a: string, b: string) => unused.has(a < b ? `${a}|${b}` : `${b}|${a}`)
  while (unused.size) {
    const firstEdge = unused.values().next().value as string
    const [start, firstNext] = firstEdge.split('|')
    const loopKeys = [start]
    let prev = start
    let current = firstNext
    mark(prev, current)
    let guard = 0
    while (guard < edgeKeys.size + 4) {
      guard += 1
      if (current === start) break
      loopKeys.push(current)
      const neighbors = Array.from(adjacency.get(current) || [])
      let next = neighbors.find((candidate) => candidate !== prev && hasEdge(current, candidate))
      if (!next) next = neighbors.find((candidate) => hasEdge(current, candidate))
      if (!next) break
      mark(current, next)
      prev = current
      current = next
    }
    if (current !== start || loopKeys.length < 3) continue
    const loop = simplifyLoop(loopKeys.map((key) => pointsByKey.get(key)).filter(Boolean) as CamPoint2[])
    if (Math.abs(polygonArea(loop)) > EPS) loops.push(ensureCounterClockwise(loop))
  }
  return loops
}

/** projectedShadowLoopsFromTriangles — CAM toolpath helper (BREP.io port).
 *
 *
 * @param triangles - the triangles value.
 * @returns CamPoint2[][] - computed result.
 */
export function projectedShadowLoopsFromTriangles(triangles: Triangle[]): CamPoint2[][] {
  const contours: CamPoint2[][] = []
  for (const triangle of triangles) {
    let loop: CamPoint2[] = triangle.map((point) => [roundCoord(point[0]), roundCoord(point[1])] as CamPoint2)
    loop = simplifyLoop(loop)
    if (loop.length < 3 || Math.abs(polygonArea(loop)) <= EPS) continue
    if (polygonArea(loop) < 0) loop = loop.slice().reverse()
    contours.push(loop)
  }
  return unionContoursWithClipper(contours)
}

/** unionContoursWithClipper — CAM toolpath helper (BREP.io port).
 *
 *
 * @param contours - the contours value.
 * @returns CamPoint2[][] - computed result.
 */
export function unionContoursWithClipper(contours: CamPoint2[][]): CamPoint2[][] {
  const subject = contours
    .map((points) => points.map((point) => ({
      X: Math.round(point[0] * CLIPPER_SCALE),
      Y: Math.round(point[1] * CLIPPER_SCALE),
    })))
    .filter((path) => path.length >= 3)
  if (!subject.length) return []
  try {
    const clipper = new ClipperLib.Clipper()
    clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true)
    const solution: Array<Array<{ X: number; Y: number }>> = []
    const succeeded = clipper.Execute(
      ClipperLib.ClipType.ctUnion,
      solution,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    )
    if (!succeeded) return []
    return solution
      .map((path) => simplifyLoop(path.map((point) => [
        roundCoord(point.X / CLIPPER_SCALE),
        roundCoord(point.Y / CLIPPER_SCALE),
      ] as CamPoint2)))
      .filter((loop) => loop.length >= 3 && Math.abs(polygonArea(loop)) > EPS)
  } catch {
    return []
  }
}

/** buildShadowLoops — CAM toolpath helper (BREP.io port).
 *
 *
 * @param projectedLoops - the projectedLoops value.
 * @returns ShadowLoop[] - computed result.
 */
export function buildShadowLoops(projectedLoops: CamPoint2[][]): ShadowLoop[] {
  // The silhouette union already yields nested loops for regions with no
  // material at any height — exactly the machinable through-holes. Classify
  // by nesting parity: even depth = outer boundary, odd depth = hole.
  const records = projectedLoops
    .map((points) => ensureCounterClockwise(simplifyLoop(points)))
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS)
    .map((points) => ({ points, area: Math.abs(polygonArea(points)) }))
  const loops = records.map((candidate) => {
    const nestingDepth = records.filter((container) => (
      container.area > candidate.area + EPS
      && loopInsideLoop(candidate.points, container.points)
    )).length
    return {
      role: nestingDepth % 2 === 0 ? 'outer' as const : 'hole' as const,
      points: candidate.points,
      area: candidate.area,
    }
  })
  return loops
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'outer' ? -1 : 1
      return b.area - a.area
    })
    .map((loop) => ({ role: loop.role, points: loop.points }))
}

/** unionProjectedShadowLoops — CAM toolpath helper (BREP.io port).
 *
 *
 * @param loops - the loops value.
 * @returns CamPoint2[][] - computed result.
 */
export function unionProjectedShadowLoops(loops: ShadowLoop[]): CamPoint2[][] {
  const contours = loops
    .map((loop) => {
      let points = ensureCounterClockwise(simplifyLoop(loop.points))
      if (loop.role === 'hole') points = points.slice().reverse()
      return points
    })
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS)
  return unionContoursWithClipper(contours)
}

/** mergeOuterOffsetLoops — CAM toolpath helper (BREP.io port).
 *
 *
 * @param loops - the loops value.
 * @returns ShadowLoop[] - computed result.
 */
export function mergeOuterOffsetLoops(loops: ShadowLoop[]): ShadowLoop[] {
  const outerLoops = loops.filter((loop) => loop.role === 'outer')
  const holeLoops = loops.filter((loop) => loop.role === 'hole')
  if (outerLoops.length <= 1) return loops
  const contours = outerLoops
    .map((loop) => ensureCounterClockwise(simplifyLoop(loop.points)))
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS)
  if (contours.length <= 1) return loops
  const mergedOuterLoops = unionContoursWithClipper(contours)
    .map((points) => ensureCounterClockwise(simplifyLoop(points)))
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS)
    .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))
    .map((points) => ({ role: 'outer' as const, points }))
  return mergedOuterLoops.length ? [...mergedOuterLoops, ...holeLoops] : loops
}

/** offsetPolygon — CAM toolpath helper (BREP.io port).
 *
 *
 * @param points - the points value.
 * @param distance - the distance value.
 * @returns CamPoint2[][] - computed result.
 */
export function offsetPolygon(points: CamPoint2[], distance: number): CamPoint2[][] {
  const loop = ensureCounterClockwise(simplifyLoop(points))
  if (loop.length < 3) return []
  if (Math.abs(distance) <= EPS) return [loop]
  return offsetPolygonWithClipper(loop, distance)
    .filter((loop) => offsetLoopIsValid(loop, points, distance))
    .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))
}

function offsetPolygonWithClipper(points: CamPoint2[], distance: number): CamPoint2[][] {
  const path = points.map((point) => ({
    X: Math.round(point[0] * CLIPPER_SCALE),
    Y: Math.round(point[1] * CLIPPER_SCALE),
  }))
  const solution: Array<Array<{ X: number; Y: number }>> = []
  const offsetter = new ClipperLib.ClipperOffset(2, 0.25 * CLIPPER_SCALE)
  offsetter.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  offsetter.Execute(solution, distance * CLIPPER_SCALE)
  return solution
    .map((pathPoints) => pathPoints.map((point) => [
      roundCoord(point.X / CLIPPER_SCALE),
      roundCoord(point.Y / CLIPPER_SCALE),
    ] as CamPoint2))
    .map((loop) => ensureCounterClockwise(simplifyLoop(loop)))
    .filter((loop) => loop.length >= 3 && Math.abs(polygonArea(loop)) > EPS)
}

function offsetLoopIsValid(loop: CamPoint2[], sourceLoop: CamPoint2[], distance: number) {
  if (loop.length < 3 || Math.abs(polygonArea(loop)) <= EPS) return false
  const radius = Math.abs(distance)
  const tolerance = Math.max(1e-3, radius * 1e-4)
  for (let index = 0; index < loop.length; index += 1) {
    const a = loop[index]
    const b = loop[(index + 1) % loop.length]
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const point: CamPoint2 = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ]
      const inside = pointInPolygon(point, sourceLoop)
      if (distance > 0 && inside) return false
      if (distance < 0 && !inside && !pointNearPolygonBoundary(point, sourceLoop, tolerance)) return false
      const finiteDistance = distanceToPolygonSegments(point, sourceLoop).distance
      if (finiteDistance < radius - tolerance) return false
    }
  }
  return true
}

function pointNearPolygonBoundary(point: CamPoint2, polygon: CamPoint2[], tolerance: number) {
  return distanceToPolygonSegments(point, polygon).distance <= tolerance
}

function distanceToPolygonSegments(point: CamPoint2, polygon: CamPoint2[]) {
  let best = Infinity
  let bestIndex = -1
  let bestT = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const lenSq = (dx * dx) + (dy * dy)
    const rawT = lenSq > EPS ? (((point[0] - a[0]) * dx) + ((point[1] - a[1]) * dy)) / lenSq : 0
    const t = Math.min(1, Math.max(0, rawT))
    const closest: CamPoint2 = [a[0] + dx * t, a[1] + dy * t]
    const distanceValue = Math.hypot(point[0] - closest[0], point[1] - closest[1])
    if (distanceValue < best) {
      best = distanceValue
      bestIndex = index
      bestT = t
    }
  }
  return { distance: best, index: bestIndex, t: bestT }
}

/** buildDepthLevels — CAM toolpath helper (BREP.io port).
 *
 *
 * @param topZ - the topZ value.
 * @param bottomZ - the bottomZ value.
 * @param stepDown - the stepDown value.
 * @returns number[] - computed result.
 */
export function buildDepthLevels(topZ: number, bottomZ: number, stepDown: number): number[] {
  const levels: number[] = []
  let current = topZ
  while (current > bottomZ + EPS) {
    current = Math.max(bottomZ, current - stepDown)
    levels.push(roundCoord(current))
  }
  return levels.length ? levels : [roundCoord(bottomZ)]
}

/** makeSteppedLoopPath — CAM toolpath helper (BREP.io port).
 *
 *
 * @param options - the options value.
 * @returns CamToolpathPath - computed result.
 */
export function makeSteppedLoopPath(options: {
  id: string
  operationId: string
  operationName: string
  loop: ShadowLoop
  levels: number[]
  safeZ: number
  cutter: CamCutterDefinition
  orientation: CamCutterOrientation
  feedRate: number
  plungeRate: number
  spindleRPM: number
}): CamToolpathPath {
  const { id, operationId, operationName, loop, levels, safeZ, cutter, orientation, feedRate, plungeRate, spindleRPM } = options
  const depthLevels = levels.map(roundCoord)
  const first2 = loop.points[0] || [0, 0] as CamPoint2
  const points: CamToolpathPoint[] = [{
    position: [roundCoord(first2[0]), roundCoord(first2[1]), roundCoord(safeZ)],
    orientation,
    metadata: { loopRole: loop.role, safe: true },
  }]
  const segments: CamToolpathSegment[] = []
  const addPoint = (position: CamPoint3, metadata: Record<string, any> = {}) => {
    const index = points.length
    points.push({ position: roundCamPoint(position), orientation, metadata })
    return index
  }
  depthLevels.forEach((z, levelIndex) => {
    const level = levelIndex + 1
    const plungeStartIndex = points.length - 1
    const levelStartIndex = addPoint(
      [roundCoord(first2[0]), roundCoord(first2[1]), z],
      { loopRole: loop.role, level, z },
    )
    segments.push({
      id: `${id}-L${level}-PLUNGE`,
      kind: 'plunge',
      startIndex: plungeStartIndex,
      endIndex: levelStartIndex,
      orientation,
      cutter,
      feedRate: plungeRate,
      spindleRPM,
      metadata: { level, z },
    })
    let previousIndex = levelStartIndex
    for (let pointIndex = 1; pointIndex <= loop.points.length; pointIndex += 1) {
      const point = loop.points[pointIndex % loop.points.length]
      const nextIndex = addPoint(
        [roundCoord(point[0]), roundCoord(point[1]), z],
        { loopRole: loop.role, level, z },
      )
      segments.push({
        id: `${id}-L${level}-CUT${pointIndex}`,
        kind: 'cut',
        startIndex: previousIndex,
        endIndex: nextIndex,
        orientation,
        cutter,
        feedRate,
        spindleRPM,
        metadata: { level, z },
      })
      previousIndex = nextIndex
    }
  })
  const retractStartIndex = points.length - 1
  const retractEndIndex = addPoint(
    [roundCoord(first2[0]), roundCoord(first2[1]), roundCoord(safeZ)],
    { loopRole: loop.role, safe: true },
  )
  segments.push({
    id: `${id}-RETRACT`,
    kind: 'retract',
    startIndex: retractStartIndex,
    endIndex: retractEndIndex,
    orientation,
    cutter,
    spindleRPM,
  })
  return {
    id,
    operationId,
    operationName,
    points,
    segments,
    cutter,
    defaultOrientation: orientation,
    feedRate,
    plungeRate,
    spindleRPM,
    metadata: {
      loopRole: loop.role,
      loopPointCount: loop.points.length,
      zLevels: depthLevels,
    },
  }
}

/** boundsFromLoopsAndZ — CAM toolpath helper (BREP.io port).
 *
 *
 * @param loops - the loops value.
 * @param topZ - the topZ value.
 * @param bottomZ - the bottomZ value.
 * @returns CamBounds - computed result.
 */
export function boundsFromLoopsAndZ(loops: ShadowLoop[], topZ: number, bottomZ: number): CamBounds {
  const allPoints = loops.flatMap((loop) => loop.points)
  const xs = allPoints.map((point) => point[0])
  const ys = allPoints.map((point) => point[1])
  return {
    min: [roundCoord(Math.min(...xs)), roundCoord(Math.min(...ys)), roundCoord(bottomZ)],
    max: [roundCoord(Math.max(...xs)), roundCoord(Math.max(...ys)), roundCoord(topZ)],
  }
}

/** makeEmptyShadowResult — CAM toolpath helper (BREP.io port).
 *
 *
 * @param options - the options value.
 * @returns CamToolpathProgram - computed result.
 */
export function makeEmptyShadowResult(options: {
  operationId: string
  operationName: string
  machine: CamMachineProfile
  targetBounds?: CamBounds | null
  cutter?: CamCutterDefinition | null
  toolDiameter?: number
  spindleRPM?: number
  warnings?: string[]
}): CamToolpathProgram {
  const {
    operationId,
    operationName,
    machine,
    targetBounds = null,
    cutter = null,
    toolDiameter = 0,
    spindleRPM = 0,
    warnings = [],
  } = options
  return makeEmptyCamToolpathProgram({
    operationId,
    operationName,
    machine,
    targetBounds,
    cutter: cutter || makeFlatEndMillCutter({ diameter: toolDiameter }),
    spindleRPM,
    warnings,
  })
}
