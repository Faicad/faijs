/**
 * Roughing (constant-Z roughing) toolpath generation — ported from BREP.io
 * `src/cam/RoughingEntity.ts`.
 *
 * Adaptations for faijs: pure functions over triangle arrays; the BREP.io
 * `resolveTargetSolids` / `extractTrianglesFromSolid` scene-graph plumbing is
 * replaced by the caller passing the part triangles directly (see
 * `generate.ts`).
 */
import { CAM_TOOLPATH_SCHEMA_VERSION, makeEmptyCamToolpathProgram, makeFlatEndMillCutter, normalizeCamOrientation, roundCamPoint, summarizeCamToolpathProgram } from './types.js'
import { generateGcodeForCamToolpathProgram } from './gcode.js'
import type { CamBounds, CamCutterDefinition, CamCutterOrientation, CamPoint3, CamToolpathPath, CamToolpathPoint, CamToolpathProgram, CamToolpathSegment } from './types.js'
import type { CamMachineProfile } from './profile.js'
import { EPS, finiteNumber, polygonArea, positiveNumber, roundCoord, simplifyLoop, triangleBounds } from './geometry.js'
import type { AnyRecord, CamPoint2, ShadowLoop, Triangle } from './geometry.js'
import {
  loopsFromEdges,
  mergeOuterOffsetLoops,
  offsetPolygon,
  projectedShadowLoopsFromTriangles,
  unionProjectedShadowLoops,
} from './shadow.js'

/** CAM_OPERATION_TYPE_ROUGHING — CAM toolpath constant (BREP.io port). */
export const CAM_OPERATION_TYPE_ROUGHING = 'roughing'

/** RoughingSlice — CAM toolpath type (BREP.io port). *//** RoughingSlice — CAM toolpath type (BREP.io port). *//** RoughingSlice — CAM toolpath type (BREP.io port). *//** RoughingSlice — CAM toolpath type (BREP.io port). */type RoughingSlice = {
  index: number
  topZ: number
  bottomZ: number
}

/** RoughingPass — CAM toolpath type (BREP.io port). *//** RoughingPass — CAM toolpath type (BREP.io port). *//** RoughingPass — CAM toolpath type (BREP.io port). *//** RoughingPass — CAM toolpath type (BREP.io port). */type RoughingPass = {
  id: string
  loop: ShadowLoop
  slice: RoughingSlice
  protectedCenterLoops: ShadowLoop[]
}

/** RoughingParams — CAM toolpath type (BREP.io port). */
export type RoughingParams = {
  toolDiameter?: number
  toolLength?: number
  stockAllowance?: number
  stepDown?: number
  extraDepth?: number
  safeHeight?: number
  feedRate?: number
  plungeRate?: number
  spindleRPM?: number
  debugSlices?: boolean
}

/** generateRoughingToolpath — CAM toolpath helper (BREP.io port).
 *
 *
 * @param options - the options value.
 * @returns CamToolpathProgram - computed result.
 */
export function generateRoughingToolpath(options: {
  operationId: string
  operationName: string
  machine: CamMachineProfile
  params: RoughingParams
  triangles: Triangle[]
}): CamToolpathProgram {
  const { operationId, operationName, machine, params, triangles } = options
  const warnings: string[] = []
  const toolDiameter = positiveNumber(params.toolDiameter, 3.175)
  const toolLength = positiveNumber(params.toolLength, 25)
  const cutter = makeFlatEndMillCutter({
    id: `${operationId}-CUTTER`,
    diameter: toolDiameter,
    cuttingLength: toolLength,
    overallLength: toolLength,
  })
  const toolRadius = toolDiameter * 0.5
  const stockAllowance = Math.max(0, finiteNumber(params.stockAllowance, 0))
  const offsetDistance = toolRadius + stockAllowance
  const feedRate = positiveNumber(params.feedRate, 800, 1)
  const plungeRate = positiveNumber(params.plungeRate, 200, 1)
  const stepDown = positiveNumber(params.stepDown, 1, EPS)
  const extraDepth = Math.max(0, finiteNumber(params.extraDepth, 0))
  const debugSlicesEnabled = params.debugSlices === true
  const spindleRPM = Math.min(
    positiveNumber(params.spindleRPM, 12000, 1),
    Math.max(1, Number(machine.maxSpindleRPM) || 1),
  )

  const targetBounds = triangleBounds(triangles)
  if (!targetBounds) {
    return makeEmptyRoughingResult({
      operationId,
      operationName,
      machine,
      cutter,
      toolDiameter,
      spindleRPM,
      warnings: ['No target solids are available for Roughing generation.'],
    })
  }

  const topZ = targetBounds.max[2]
  const bottomZ = targetBounds.min[2] - extraDepth
  const safeHeight = Math.max(0, finiteNumber(params.safeHeight, 5))
  const safeZ = roundCoord(Math.max(Number(machine.safeParkZ) || 0, topZ + safeHeight))
  const slices = buildRoughingSlices(topZ, bottomZ, stepDown)
  if (!slices.length) {
    return makeEmptyRoughingResult({
      operationId,
      operationName,
      machine,
      targetBounds,
      cutter,
      toolDiameter,
      spindleRPM,
      warnings: ['Roughing step height did not produce any slices.'],
    })
  }

  const orientation = normalizeCamOrientation({ toolAxis: [0, 0, -1], forward: [1, 0, 0] })
  const passes: RoughingPass[] = []
  const debugSlices: AnyRecord[] = []
  let outlinePointCount = 0
  let activeSliceCount = 0
  for (const slice of slices) {
    const localSliceLoops = buildSliceShadowLoops(triangles, slice)
    if (debugSlicesEnabled && localSliceLoops.length) {
      debugSlices.push(makeRoughingDebugSlice(slice, localSliceLoops, { operationId, operationName }))
    }

    // A vertical 3-axis cutter occupies the whole column above its tip. Use
    // every retained triangle above this cut depth, not only the current
    // step-down slab, so neither the cutting edge nor the shank can enter an
    // overhang while following a lower contour.
    const protectedMaterialLoops = buildSliceShadowLoops(triangles, {
      ...slice,
      topZ,
    })
    const rawOffsetLoops = protectedMaterialLoops.flatMap((loop) => {
      const distance = loop.role === 'hole' ? -offsetDistance : offsetDistance
      return offsetPolygon(loop.points, distance)
        .map((points) => ({ role: loop.role, points }))
    }).filter((loop) => loop.points.length >= 3)
    const offsetLoops = uniqueShadowLoops(mergeOuterOffsetLoops(rawOffsetLoops))
    if (!offsetLoops.length) continue
    activeSliceCount += 1
    outlinePointCount += offsetLoops.reduce((sum, loop) => sum + loop.points.length, 0)
    offsetLoops.forEach((loop, loopIndex) => {
      passes.push({
        id: `${operationId}-S${slice.index}-${loop.role === 'hole' ? 'H' : 'O'}${loopIndex + 1}`,
        loop,
        slice,
        protectedCenterLoops: offsetLoops,
      })
    })
  }

  if (!passes.length) {
    return makeEmptyRoughingResult({
      operationId,
      operationName,
      machine,
      targetBounds,
      cutter,
      toolDiameter,
      spindleRPM,
      warnings: ['Could not generate Roughing slice shadows.'],
    })
  }

  const paths = [makeRoughingContinuousPath({
    id: `${operationId}-ROUGH`,
    operationId,
    operationName,
    passes,
    safeZ,
    cutter,
    orientation,
    feedRate,
    plungeRate,
    spindleRPM,
  })]

  const bounds = boundsFromPaths(paths, topZ, bottomZ)
  const resultBase: Omit<CamToolpathProgram, 'gcode'> = {
    schemaVersion: CAM_TOOLPATH_SCHEMA_VERSION,
    operationId,
    operationName,
    units: 'mm',
    coordinateSystem: 'machine',
    generatedAt: new Date().toISOString(),
    machine,
    bounds,
    targetBounds,
    safeZ,
    cutter,
    spindleRPM,
    paths,
    summary: summarizeCamToolpathProgram({
      paths,
      targetCount: triangles.length > 0 ? 1 : 0,
      triangleCount: triangles.length,
      levelCount: slices.length,
      warningCount: warnings.length,
      outlinePointCount,
      offsetDistance: roundCoord(offsetDistance),
    }),
    warnings,
    metadata: {
      strategy: 'roughing',
      sliceCount: slices.length,
      activeSliceCount,
      offsetDistance: roundCoord(offsetDistance),
      topZ: roundCoord(topZ),
      bottomZ: roundCoord(bottomZ),
      protectsFullCutterColumn: true,
      debugSlicesEnabled,
      debugSliceCount: debugSlices.length,
      ...(debugSlicesEnabled ? { debugSlices } : {}),
    },
  }
  return { ...resultBase, gcode: generateGcodeForCamToolpathProgram(resultBase) }
}

/** buildRoughingSlices — CAM toolpath helper (BREP.io port).
 *
 *
 * @param topZ - the topZ value.
 * @param bottomZ - the bottomZ value.
 * @param stepDown - the stepDown value.
 * @returns RoughingSlice[] - computed result.
 */
export function buildRoughingSlices(topZ: number, bottomZ: number, stepDown: number): RoughingSlice[] {
  const slices: RoughingSlice[] = []
  let currentTop = topZ
  let index = 1
  while (currentTop > bottomZ + EPS && index < 10000) {
    const nextBottom = Math.max(bottomZ, currentTop - stepDown)
    slices.push({
      index,
      topZ: roundCoord(currentTop),
      bottomZ: roundCoord(nextBottom),
    })
    currentTop = nextBottom
    index += 1
  }
  return slices
}

/** buildSliceShadowLoops — CAM toolpath helper (BREP.io port).
 *
 *
 * @param triangles - the triangles value.
 * @param slice - the slice value.
 * @returns ShadowLoop[] - computed result.
 */
export function buildSliceShadowLoops(triangles: Triangle[], slice: RoughingSlice): ShadowLoop[] {
  // Inset the bottom clip plane so faces lying exactly at the slice bottom
  // (e.g. a pocket floor this slice cuts down to) do not fill their region.
  const sliceHeight = Math.max(0, slice.topZ - slice.bottomZ)
  const bottomInset = Math.min(sliceHeight * 1e-4, 1e-4)
  const clippedProjectionLoops = projectedLoopsFromClippedSlab(triangles, slice.bottomZ + bottomInset, slice.topZ)
  const classifiedSources: ShadowLoop[] = [
    ...classifyProjectedLoops(clippedProjectionLoops),
  ]
  for (const z of sliceSectionSampleZs(slice)) {
    classifiedSources.push(...classifyProjectedLoops(sectionLoopsAtZ(triangles, z)))
  }
  const filledLoops = unionProjectedShadowLoops(classifiedSources)
  return classifyProjectedLoops(filledLoops.length ? filledLoops : clippedProjectionLoops)
}

function sliceSectionSampleZs(slice: RoughingSlice) {
  const bottomZ = Math.min(slice.bottomZ, slice.topZ)
  const topZ = Math.max(slice.bottomZ, slice.topZ)
  const height = topZ - bottomZ
  if (!(height > EPS)) return []
  const inset = Math.min(height * 1e-4, 1e-4)
  const candidates = [
    bottomZ + inset,
    bottomZ + height * 0.25,
    bottomZ + height * 0.5,
    bottomZ + height * 0.75,
    topZ - inset,
  ]
  const seen = new Set<string>()
  const out: number[] = []
  for (const z of candidates) {
    const clamped = roundCoord(Math.max(bottomZ, Math.min(topZ, z)))
    const key = clamped.toFixed(6)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clamped)
  }
  return out
}

function makeRoughingDebugSlice(slice: RoughingSlice, loops: ShadowLoop[], source: { operationId: string; operationName: string }) {
  return {
    id: `roughing-slice-${slice.index}`,
    index: slice.index,
    label: `Slice ${slice.index}`,
    operationId: source.operationId,
    operationName: source.operationName,
    topZ: roundCoord(slice.topZ),
    bottomZ: roundCoord(slice.bottomZ),
    loops: loops.map((loop) => ({
      role: loop.role,
      points: loop.points.map((point) => [roundCoord(point[0]), roundCoord(point[1])]),
    })),
  }
}

function makeRoughingContinuousPath({
  id,
  operationId,
  operationName,
  passes,
  safeZ,
  cutter,
  orientation,
  feedRate,
  plungeRate,
  spindleRPM,
}: {
  id: string
  operationId: string
  operationName: string
  passes: RoughingPass[]
  safeZ: number
  cutter: CamCutterDefinition
  orientation: CamCutterOrientation
  feedRate: number
  plungeRate: number
  spindleRPM: number
}): CamToolpathPath {
  const first2 = passes[0]?.loop.points[0] || [0, 0] as CamPoint2
  const points: CamToolpathPoint[] = [{
    position: [roundCoord(first2[0]), roundCoord(first2[1]), roundCoord(safeZ)],
    orientation,
    metadata: { strategy: 'roughing', safe: true },
  }]
  const segments: CamToolpathSegment[] = []
  let currentIndex = 0
  let currentXY: CamPoint2 = [roundCoord(first2[0]), roundCoord(first2[1])]
  let currentZ = roundCoord(safeZ)
  let currentPass: RoughingPass | null = null
  let segmentNumber = 1

  const passMetadata = (pass: RoughingPass, extra: Record<string, any> = {}) => ({
    strategy: 'roughing',
    passId: pass.id,
    sliceIndex: pass.slice.index,
    sliceTopZ: roundCoord(pass.slice.topZ),
    sliceBottomZ: roundCoord(pass.slice.bottomZ),
    loopRole: pass.loop.role,
    z: roundCoord(pass.slice.bottomZ),
    ...extra,
  })
  const safeMetadata = (pass: RoughingPass | null, extra: Record<string, any> = {}) => ({
    strategy: 'roughing',
    ...(pass ? {
      passId: pass.id,
      sliceIndex: pass.slice.index,
      sliceTopZ: roundCoord(pass.slice.topZ),
      sliceBottomZ: roundCoord(pass.slice.bottomZ),
      loopRole: pass.loop.role,
    } : {}),
    safe: true,
    ...extra,
  })
  const addMove = (
    kind: CamToolpathSegment['kind'],
    xy: CamPoint2,
    z: number,
    pass: RoughingPass | null,
    metadata: Record<string, any> = {},
  ) => {
    const nextXY: CamPoint2 = [roundCoord(xy[0]), roundCoord(xy[1])]
    const nextZ = roundCoord(z)
    if (sameXY(currentXY, nextXY) && Math.abs(currentZ - nextZ) <= EPS) return currentIndex
    const pointIndex = points.length
    const pointMetadata = metadata.safe ? safeMetadata(pass, metadata) : pass ? passMetadata(pass, metadata) : metadata
    points.push({
      position: [nextXY[0], nextXY[1], nextZ],
      orientation,
      metadata: pointMetadata,
    })
    segments.push({
      id: `${id}-${segmentNumber++}-${kind.toUpperCase()}`,
      kind,
      startIndex: currentIndex,
      endIndex: pointIndex,
      orientation,
      cutter,
      feedRate: kind === 'plunge' ? plungeRate : feedRate,
      spindleRPM,
      metadata: pointMetadata,
    })
    currentIndex = pointIndex
    currentXY = nextXY
    currentZ = nextZ
    return currentIndex
  }
  const retractToSafe = (pass: RoughingPass | null) => {
    addMove('retract', currentXY, safeZ, pass, { safe: true })
  }
  const rapidAtSafe = (xy: CamPoint2, pass: RoughingPass | null) => {
    addMove('rapid', xy, safeZ, pass, { safe: true })
  }

  passes.forEach((pass, passIndex) => {
    const loop = passIndex === 0 ? pass.loop.points : rotateLoopToNearestPoint(pass.loop.points, currentXY)
    if (loop.length < 3) return
    const start = loop[0]
    const z = roundCoord(pass.slice.bottomZ)
    const sameStart = sameXY(currentXY, start)
    if (passIndex === 0) {
      if (!sameStart) rapidAtSafe(start, pass)
      addMove('plunge', start, z, pass)
    } else if (sameStart) {
      addMove('plunge', start, z, pass)
    } else if (currentPass && canLinkAtCurrentZ(currentXY, start, currentPass.protectedCenterLoops)) {
      addMove('link', start, currentZ, pass, { z: currentZ, linkToSliceIndex: pass.slice.index })
      addMove('plunge', start, z, pass)
    } else {
      retractToSafe(currentPass || pass)
      rapidAtSafe(start, pass)
      addMove('plunge', start, z, pass)
    }

    for (let pointIndex = 1; pointIndex <= loop.length; pointIndex += 1) {
      addMove('cut', loop[pointIndex % loop.length], z, pass, { cutIndex: pointIndex })
    }
    currentPass = pass
  })
  retractToSafe(currentPass)
  const zLevels = Array.from(new Set(passes.map((pass) => roundCoord(pass.slice.bottomZ))))
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
      strategy: 'roughing',
      passCount: passes.length,
      sliceCount: new Set(passes.map((pass) => pass.slice.index)).size,
      loopRoles: Array.from(new Set(passes.map((pass) => pass.loop.role))),
      loopPointCount: passes.reduce((sum, pass) => sum + pass.loop.points.length, 0),
      zLevels,
    },
  }
}

function rotateLoopToNearestPoint(loop: CamPoint2[], target: CamPoint2) {
  if (!loop.length) return loop
  let bestIndex = 0
  let bestDistance = Infinity
  loop.forEach((point, index) => {
    const distance = Math.hypot(point[0] - target[0], point[1] - target[1])
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return loop.slice(bestIndex).concat(loop.slice(0, bestIndex))
}

function sameXY(a: CamPoint2, b: CamPoint2, tolerance = 1e-4) {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance
}

function canLinkAtCurrentZ(from: CamPoint2, to: CamPoint2, protectedCenterLoops: ShadowLoop[]) {
  if (!protectedCenterLoops.length) return false
  const parameters = [0, 1]
  for (const loop of protectedCenterLoops) {
    for (let index = 0; index < loop.points.length; index += 1) {
      parameters.push(...segmentEdgeIntersectionParameters(
        from,
        to,
        loop.points[index],
        loop.points[(index + 1) % loop.points.length],
      ))
    }
  }
  const sorted = parameters
    .map((value) => Math.max(0, Math.min(1, value)))
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > EPS)
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] - sorted[index - 1] <= EPS) continue
    const t = (sorted[index - 1] + sorted[index]) * 0.5
    const point: CamPoint2 = [
      from[0] + ((to[0] - from[0]) * t),
      from[1] + ((to[1] - from[1]) * t),
    ]
    if (pointInsideSliceShadow(point, protectedCenterLoops) && !pointOnLoopBoundary(point, protectedCenterLoops)) {
      return false
    }
  }
  return true
}

function segmentEdgeIntersectionParameters(from: CamPoint2, to: CamPoint2, a: CamPoint2, b: CamPoint2) {
  const rx = to[0] - from[0]
  const ry = to[1] - from[1]
  const sx = b[0] - a[0]
  const sy = b[1] - a[1]
  const qpx = a[0] - from[0]
  const qpy = a[1] - from[1]
  const denominator = (rx * sy) - (ry * sx)
  const crossQpR = (qpx * ry) - (qpy * rx)
  if (Math.abs(denominator) <= EPS) {
    if (Math.abs(crossQpR) > EPS) return []
    const lengthSq = (rx * rx) + (ry * ry)
    if (lengthSq <= EPS * EPS) return []
    return [
      ((a[0] - from[0]) * rx + (a[1] - from[1]) * ry) / lengthSq,
      ((b[0] - from[0]) * rx + (b[1] - from[1]) * ry) / lengthSq,
    ].filter((value) => value >= -EPS && value <= 1 + EPS)
  }
  const t = ((qpx * sy) - (qpy * sx)) / denominator
  const u = crossQpR / denominator
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? [t] : []
}

function pointOnLoopBoundary(point: CamPoint2, loops: ShadowLoop[], tolerance = 1e-6) {
  return loops.some((loop) => loop.points.some((start, index) => {
    const end = loop.points[(index + 1) % loop.points.length]
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const lengthSq = (dx * dx) + (dy * dy)
    if (lengthSq <= EPS * EPS) return Math.hypot(point[0] - start[0], point[1] - start[1]) <= tolerance
    const t = Math.max(0, Math.min(1, (((point[0] - start[0]) * dx) + ((point[1] - start[1]) * dy)) / lengthSq))
    return Math.hypot(point[0] - (start[0] + (dx * t)), point[1] - (start[1] + (dy * t))) <= tolerance
  }))
}

function pointInsideSliceShadow(point: CamPoint2, loops: ShadowLoop[]) {
  const insideOuter = loops.some((loop) => loop.role === 'outer' && pointInsideLoop(point, loop.points))
  if (!insideOuter) return false
  const insideHole = loops.some((loop) => loop.role === 'hole' && pointInsideLoop(point, loop.points))
  return !insideHole
}

function projectedLoopsFromClippedSlab(triangles: Triangle[], bottomZ: number, topZ: number): CamPoint2[][] {
  const projectedTriangles: Triangle[] = []
  for (const triangle of triangles) {
    const clipped = clipTriangleToZSlab(triangle, bottomZ, topZ)
    if (clipped.length < 3) continue
    const projected = simplifyLoop(clipped.map((point) => [roundCoord(point[0]), roundCoord(point[1])] as CamPoint2))
    if (projected.length < 3 || Math.abs(polygonArea(projected)) <= EPS) continue
    for (let index = 1; index + 1 < clipped.length; index += 1) {
      projectedTriangles.push([
        clipped[0],
        clipped[index],
        clipped[index + 1],
      ])
    }
  }
  return projectedTriangles.length ? projectedShadowLoopsFromTriangles(projectedTriangles) : []
}

function clipTriangleToZSlab(triangle: Triangle, bottomZ: number, topZ: number): CamPoint3[] {
  let polygon: CamPoint3[] = triangle.map((point) => roundCamPoint(point))
  polygon = clipPolygonToZPlane(polygon, bottomZ, true)
  polygon = clipPolygonToZPlane(polygon, topZ, false)
  return polygon.map((point) => roundCamPoint(point))
}

function clipPolygonToZPlane(points: CamPoint3[], planeZ: number, keepAbove: boolean): CamPoint3[] {
  if (!points.length) return []
  const out: CamPoint3[] = []
  const isInside = (point: CamPoint3) => keepAbove
    ? point[2] >= planeZ - EPS
    : point[2] <= planeZ + EPS
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const previous = points[(index - 1 + points.length) % points.length]
    const currentInside = isInside(current)
    const previousInside = isInside(previous)
    if (currentInside !== previousInside) {
      out.push(intersectEdgeAtZ(previous, current, planeZ))
    }
    if (currentInside) out.push(current)
  }
  return out
}

function intersectEdgeAtZ(a: CamPoint3, b: CamPoint3, z: number): CamPoint3 {
  // Canonical endpoint order so triangles sharing this edge compute the exact
  // same floating-point intersection; otherwise rounding can split the shared
  // vertex into two keys and break loop reconstruction.
  if (b[2] < a[2] || (b[2] === a[2] && (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1])))) {
    const swap = a
    a = b
    b = swap
  }
  const dz = b[2] - a[2]
  const t = Math.abs(dz) > EPS ? (z - a[2]) / dz : 0
  return roundCamPoint([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    z,
  ])
}

function sectionLoopsAtZ(triangles: Triangle[], z: number): CamPoint2[][] {
  const edges: Array<{ a: CamPoint2; b: CamPoint2 }> = []
  for (const triangle of triangles) {
    const minZ = Math.min(triangle[0][2], triangle[1][2], triangle[2][2])
    const maxZ = Math.max(triangle[0][2], triangle[1][2], triangle[2][2])
    if (z < minZ - EPS || z > maxZ + EPS) continue
    const segment = trianglePlaneSegment(triangle, z)
    if (segment) edges.push(segment)
  }
  return loopsFromEdges(edges)
}

function trianglePlaneSegment(triangle: Triangle, z: number): { a: CamPoint2; b: CamPoint2 } | null {
  if (triangle.every((point) => Math.abs(point[2] - z) <= EPS)) return null
  const points: CamPoint3[] = []
  for (let index = 0; index < 3; index += 1) {
    const a = triangle[index]
    const b = triangle[(index + 1) % 3]
    const da = a[2] - z
    const db = b[2] - z
    const aOn = Math.abs(da) <= EPS
    const bOn = Math.abs(db) <= EPS
    if (aOn && bOn) {
      points.push(roundCamPoint(a), roundCamPoint(b))
    } else if (aOn) {
      points.push(roundCamPoint(a))
    } else if (bOn) {
      points.push(roundCamPoint(b))
    } else if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      points.push(intersectEdgeAtZ(a, b, z))
    }
  }
  const unique = uniquePoints3(points)
  if (unique.length < 2) return null
  const [a, b] = longestPointPair(unique)
  const a2: CamPoint2 = [roundCoord(a[0]), roundCoord(a[1])]
  const b2: CamPoint2 = [roundCoord(b[0]), roundCoord(b[1])]
  return Math.hypot(a2[0] - b2[0], a2[1] - b2[1]) > EPS ? { a: a2, b: b2 } : null
}

function classifyProjectedLoops(loops: CamPoint2[][]): ShadowLoop[] {
  const records = uniquePointLoops(loops)
    .map((points) => simplifyLoop(points))
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS && !isSliverLoop(points))
    .map((points) => ({ points, area: Math.abs(polygonArea(points)) }))
    .sort((a, b) => b.area - a.area)
  const out: ShadowLoop[] = []
  for (const candidate of records) {
    const nestingDepth = records.filter((container) => (
      container.area > candidate.area + EPS
      && candidate.points.every((point) => pointInsideLoop(point, container.points))
    )).length
    out.push({
      role: nestingDepth % 2 === 0 ? 'outer' : 'hole',
      points: candidate.points,
    })
  }
  return uniqueShadowLoops(out).sort((a, b) => {
    if (a.role !== b.role) return a.role === 'outer' ? -1 : 1
    return Math.abs(polygonArea(b.points)) - Math.abs(polygonArea(a.points))
  })
}

function isSliverLoop(points: CamPoint2[]) {
  let perimeter = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  if (!(perimeter > EPS)) return true
  // Coordinates are quantized at 1e-4, so unions of nearly coincident section
  // polygons can leave hairline loops; drop anything thinner than 1e-3.
  const meanWidth = (2 * Math.abs(polygonArea(points))) / perimeter
  return meanWidth < 1e-3
}

function pointInsideLoop(point: CamPoint2, loop: CamPoint2[]) {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
    const pi = loop[i]
    const pj = loop[j]
    const intersects = ((pi[1] > point[1]) !== (pj[1] > point[1]))
      && (point[0] < ((pj[0] - pi[0]) * (point[1] - pi[1])) / ((pj[1] - pi[1]) || EPS) + pi[0])
    if (intersects) inside = !inside
  }
  return inside
}

function uniqueShadowLoops(loops: ShadowLoop[]): ShadowLoop[] {
  const seen = new Set<string>()
  const out: ShadowLoop[] = []
  for (const loop of loops) {
    const points = simplifyLoop(loop.points)
    if (points.length < 3 || Math.abs(polygonArea(points)) <= EPS) continue
    const key = `${loop.role}:${canonicalLoopKey(points)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ role: loop.role, points })
  }
  return out
}

function uniquePointLoops(loops: CamPoint2[][]): CamPoint2[][] {
  const seen = new Set<string>()
  const out: CamPoint2[][] = []
  for (const loop of loops) {
    const points = simplifyLoop(loop)
    if (points.length < 3 || Math.abs(polygonArea(points)) <= EPS) continue
    const key = canonicalLoopKey(points)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(points)
  }
  return out
}

function canonicalLoopKey(loop: CamPoint2[]) {
  const tokens = loop.map((point) => `${roundCoord(point[0])},${roundCoord(point[1])}`)
  let best = ''
  for (const source of [tokens, tokens.slice().reverse()]) {
    for (let index = 0; index < source.length; index += 1) {
      const rotated = source.slice(index).concat(source.slice(0, index)).join('|')
      if (!best || rotated < best) best = rotated
    }
  }
  return best
}

function uniquePoints3(points: CamPoint3[]): CamPoint3[] {
  const seen = new Set<string>()
  const out: CamPoint3[] = []
  for (const point of points) {
    const rounded = roundCamPoint(point)
    const key = rounded.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(rounded)
  }
  return out
}

function longestPointPair(points: CamPoint3[]): [CamPoint3, CamPoint3] {
  let best: [CamPoint3, CamPoint3] = [points[0], points[1]]
  let bestDistance = -Infinity
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const distance = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1], points[i][2] - points[j][2])
      if (distance > bestDistance) {
        bestDistance = distance
        best = [points[i], points[j]]
      }
    }
  }
  return best
}

function boundsFromPaths(paths: CamToolpathPath[], topZ: number, bottomZ: number): CamBounds {
  const positions = paths.flatMap((path) => path.points.map((point) => point.position))
  const xs = positions.map((point) => point[0])
  const ys = positions.map((point) => point[1])
  return {
    min: [roundCoord(Math.min(...xs)), roundCoord(Math.min(...ys)), roundCoord(bottomZ)],
    max: [roundCoord(Math.max(...xs)), roundCoord(Math.max(...ys)), roundCoord(topZ)],
  }
}

function makeEmptyRoughingResult({
  operationId,
  operationName,
  machine,
  targetBounds = null,
  cutter = null,
  toolDiameter = 0,
  spindleRPM = 0,
  warnings = [],
}: {
  operationId: string
  operationName: string
  machine: CamMachineProfile
  targetBounds?: CamBounds | null
  cutter?: CamCutterDefinition | null
  toolDiameter?: number
  spindleRPM?: number
  warnings?: string[]
}): CamToolpathProgram {
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
