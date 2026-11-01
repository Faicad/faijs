/**
 * CAM toolpath data model — ported from BREP.io `src/cam/CamToolpathDefinition.ts`.
 *
 * Coordinate convention: all positions in this module are **machine coordinates**
 * (+Z up, mm). The 3d_editor faijs scene is already +Z up, so the coordinate
 * conversion module is identity by default (design decision D4).
 */
import { normalizeCamMachineProfile } from './profile.js'
import type { CamMachineProfile } from './profile.js'

/** CAM_TOOLPATH_SCHEMA_VERSION — CAM toolpath constant (BREP.io port). */
export const CAM_TOOLPATH_SCHEMA_VERSION = 1

/** CamUnits — CAM toolpath type (BREP.io port). */
export type CamUnits = 'mm'
/** CamPoint3 — CAM toolpath type (BREP.io port). */
export type CamPoint3 = [number, number, number]
/** CamBounds — CAM toolpath type (BREP.io port). */
export type CamBounds = { min: CamPoint3; max: CamPoint3 }
/** CamSegmentKind — CAM toolpath type (BREP.io port). */
export type CamSegmentKind = 'rapid' | 'plunge' | 'cut' | 'link' | 'retract'
/** CamCutterKind — CAM toolpath type (BREP.io port). */
export type CamCutterKind = 'flat-endmill' | 'ball-endmill' | 'v-bit' | 'custom'

/** CamCutterDefinition — CAM toolpath type (BREP.io port). */
export type CamCutterDefinition = {
  id?: string
  kind: CamCutterKind
  diameter: number
  radius: number
  cuttingLength?: number
  overallLength?: number
  cornerRadius?: number
  includedAngleDeg?: number
  metadata?: Record<string, any>
}

/** CamCutterOrientation — CAM toolpath type (BREP.io port). */
export type CamCutterOrientation = {
  toolAxis: CamPoint3
  forward?: CamPoint3
  quaternion?: [number, number, number, number]
}

/** CamToolpathPoint — CAM toolpath type (BREP.io port). */
export type CamToolpathPoint = {
  position: CamPoint3
  orientation?: CamCutterOrientation
  metadata?: Record<string, any>
}

/** CamToolpathSegment — CAM toolpath type (BREP.io port). */
export type CamToolpathSegment = {
  id: string
  kind: CamSegmentKind
  startIndex: number
  endIndex: number
  orientation: CamCutterOrientation
  cutter?: CamCutterDefinition
  feedRate?: number
  spindleRPM?: number
  metadata?: Record<string, any>
}

/** CamToolpathPath — CAM toolpath type (BREP.io port). */
export type CamToolpathPath = {
  id: string
  operationId: string
  operationName: string
  points: CamToolpathPoint[]
  segments: CamToolpathSegment[]
  cutter: CamCutterDefinition
  defaultOrientation: CamCutterOrientation
  feedRate: number
  plungeRate: number
  spindleRPM: number
  metadata?: Record<string, any>
}

/** CamToolpathSummary — CAM toolpath type (BREP.io port). */
export type CamToolpathSummary = {
  targetCount: number
  triangleCount: number
  levelCount: number
  pathCount: number
  pointCount: number
  contactPointCount?: number
  safePointCount?: number
  segmentCount: number
  moveCount: number
  motionSegmentCount: number
  estimatedCutLength: number
  estimatedRapidLength: number
  warningCount: number
  outlinePointCount?: number
  offsetDistance?: number
}

/** CamToolpathProgram — CAM toolpath type (BREP.io port). */
export type CamToolpathProgram = {
  schemaVersion: typeof CAM_TOOLPATH_SCHEMA_VERSION
  operationId: string
  operationName: string
  units: CamUnits
  coordinateSystem: 'machine'
  generatedAt: string | null
  machine: CamMachineProfile
  bounds: CamBounds | null
  targetBounds: CamBounds | null
  safeZ: number
  cutter: CamCutterDefinition | null
  spindleRPM: number
  gcode: string
  paths: CamToolpathPath[]
  summary: CamToolpathSummary
  warnings: string[]
  metadata?: Record<string, any>
}

/** BuildLinearToolpathPathOptions — CAM toolpath type (BREP.io port). */
export type BuildLinearToolpathPathOptions = {
  id: string
  operationId: string
  operationName: string
  positions: CamPoint3[]
  cutter: CamCutterDefinition
  orientation?: CamCutterOrientation
  feedRate: number
  plungeRate: number
  spindleRPM: number
  segmentKind?: CamSegmentKind
  metadata?: Record<string, any>
}

/** roundCamCoord — CAM toolpath helper (BREP.io port).
 *
 *
 * @param value - the value value.
 * @returns number - computed result.
 */
export function roundCamCoord(value: number): number {
  const rounded = Math.round((Number(value) || 0) * 10000) / 10000
  return Object.is(rounded, -0) ? 0 : rounded
}

/** roundCamPoint — CAM toolpath helper (BREP.io port).
 *
 *
 * @param point - the point value.
 * @returns CamPoint3 - computed result.
 */
export function roundCamPoint(point: CamPoint3): CamPoint3 {
  return [roundCamCoord(point[0]), roundCamCoord(point[1]), roundCamCoord(point[2])]
}

/** normalizeCamOrientation — CAM toolpath helper (BREP.io port).
 *
 *
 * @param orientation - the orientation value.
 * @returns CamCutterOrientation - computed result.
 */
export function normalizeCamOrientation(orientation: Partial<CamCutterOrientation> | null | undefined): CamCutterOrientation {
  const rawAxis = Array.isArray(orientation?.toolAxis) ? orientation?.toolAxis : [0, 0, -1]
  const axis = normalizeVector3(rawAxis as CamPoint3, [0, 0, -1])
  const out: CamCutterOrientation = { toolAxis: axis }
  if (Array.isArray(orientation?.forward)) {
    out.forward = normalizeVector3(orientation.forward as CamPoint3, [1, 0, 0])
  }
  if (Array.isArray(orientation?.quaternion) && orientation.quaternion.length >= 4) {
    out.quaternion = [
      roundCamCoord(Number(orientation.quaternion[0]) || 0),
      roundCamCoord(Number(orientation.quaternion[1]) || 0),
      roundCamCoord(Number(orientation.quaternion[2]) || 0),
      roundCamCoord(Number(orientation.quaternion[3]) || 1),
    ]
  }
  return out
}

/** makeFlatEndMillCutter — CAM toolpath helper (BREP.io port).
 *
 *
 * @param options - the options value.
 * @returns CamCutterDefinition - computed result.
 */
export function makeFlatEndMillCutter(options: {
  diameter: number
  cuttingLength?: number
  overallLength?: number
  id?: string
}): CamCutterDefinition {
  const { diameter, cuttingLength, overallLength, id } = options
  const safeDiameter = Math.max(1e-7, Math.abs(Number(diameter) || 0))
  const out: CamCutterDefinition = {
    id,
    kind: 'flat-endmill',
    diameter: roundCamCoord(safeDiameter),
    radius: roundCamCoord(safeDiameter * 0.5),
  }
  if (Number.isFinite(Number(cuttingLength))) out.cuttingLength = roundCamCoord(Number(cuttingLength))
  if (Number.isFinite(Number(overallLength))) out.overallLength = roundCamCoord(Number(overallLength))
  return out
}

/** makeBallEndMillCutter — CAM toolpath helper (BREP.io port).
 *
 *
 * @param options - the options value.
 * @returns CamCutterDefinition - computed result.
 */
export function makeBallEndMillCutter(options: {
  diameter: number
  cuttingLength?: number
  overallLength?: number
  id?: string
}): CamCutterDefinition {
  const { diameter, cuttingLength, overallLength, id } = options
  const safeDiameter = Math.max(1e-7, Math.abs(Number(diameter) || 0))
  const out: CamCutterDefinition = {
    id,
    kind: 'ball-endmill',
    diameter: roundCamCoord(safeDiameter),
    radius: roundCamCoord(safeDiameter * 0.5),
  }
  if (Number.isFinite(Number(cuttingLength))) out.cuttingLength = roundCamCoord(Number(cuttingLength))
  if (Number.isFinite(Number(overallLength))) out.overallLength = roundCamCoord(Number(overallLength))
  return out
}

/** buildLinearToolpathPath — CAM toolpath helper (BREP.io port).
 *
 *
 * @param options - the options value.
 * @returns CamToolpathPath - computed result.
 */
export function buildLinearToolpathPath(options: BuildLinearToolpathPathOptions): CamToolpathPath {
  const orientation = normalizeCamOrientation(options.orientation)
  const points = (options.positions || []).map((position) => ({
    position: roundCamPoint(position),
    orientation,
  }))
  const segmentKind = options.segmentKind || 'cut'
  const segments: CamToolpathSegment[] = []
  for (let index = 0; index + 1 < points.length; index += 1) {
    segments.push({
      id: `${options.id}-S${index + 1}`,
      kind: segmentKind,
      startIndex: index,
      endIndex: index + 1,
      orientation,
      cutter: options.cutter,
      feedRate: options.feedRate,
      spindleRPM: options.spindleRPM,
    })
  }
  return {
    id: options.id,
    operationId: options.operationId,
    operationName: options.operationName,
    points,
    segments,
    cutter: options.cutter,
    defaultOrientation: orientation,
    feedRate: options.feedRate,
    plungeRate: options.plungeRate,
    spindleRPM: options.spindleRPM,
    metadata: options.metadata,
  }
}

/** makeEmptyCamToolpathProgram — CAM toolpath helper (BREP.io port).
 *
 *
 * @param options - the options value.
 * @returns CamToolpathProgram - computed result.
 */
export function makeEmptyCamToolpathProgram(options: {
  operationId?: string
  operationName?: string
  machine?: CamMachineProfile | null
  targetBounds?: CamBounds | null
  safeZ?: number | null
  cutter?: CamCutterDefinition | null
  spindleRPM?: number
  warnings?: string[]
} = {}): CamToolpathProgram {
  const {
    operationId = 'CAM-PROGRAM',
    operationName = 'CAM Program',
    machine = null as CamMachineProfile | null,
    targetBounds = null,
    safeZ = null,
    cutter = null,
    spindleRPM = 0,
    warnings = [],
  } = options
  const normalizedMachine = normalizeCamMachineProfile(machine)
  return {
    schemaVersion: CAM_TOOLPATH_SCHEMA_VERSION,
    operationId,
    operationName,
    units: 'mm',
    coordinateSystem: 'machine',
    generatedAt: new Date().toISOString(),
    machine: normalizedMachine,
    bounds: null,
    targetBounds,
    safeZ: roundCamCoord(Number.isFinite(Number(safeZ)) ? Number(safeZ) : normalizedMachine.safeParkZ),
    cutter,
    spindleRPM: roundCamCoord(spindleRPM),
    gcode: '',
    paths: [],
    summary: {
      targetCount: 0,
      triangleCount: 0,
      levelCount: 0,
      pathCount: 0,
      pointCount: 0,
      segmentCount: 0,
      moveCount: 0,
      motionSegmentCount: 0,
      estimatedCutLength: 0,
      estimatedRapidLength: 0,
      warningCount: warnings.length,
    },
    warnings,
  }
}

/** summarizeCamToolpathProgram — CAM toolpath helper (BREP.io port).
 *
 *
 * @param options - the options value.
 * @returns CamToolpathSummary - computed result.
 */
export function summarizeCamToolpathProgram(options: {
  paths: CamToolpathPath[]
  targetCount?: number
  triangleCount?: number
  levelCount?: number
  warningCount?: number
  outlinePointCount?: number
  offsetDistance?: number
}): CamToolpathSummary {
  const {
    paths,
    targetCount = 0,
    triangleCount = 0,
    levelCount = paths.length,
    warningCount = 0,
    outlinePointCount,
    offsetDistance,
  } = options
  const cutLength = paths.reduce((sum, path) => {
    return sum + path.segments.reduce((segmentSum, segment) => {
      if (segment.kind !== 'cut') return segmentSum
      const start = path.points[segment.startIndex]?.position
      const end = path.points[segment.endIndex]?.position
      return segmentSum + (start && end ? pointDistance(start, end) : 0)
    }, 0)
  }, 0)
  const rapidLength = paths.reduce((sum, path) => {
    return sum + path.segments.reduce((segmentSum, segment) => {
      if (segment.kind === 'cut') return segmentSum
      const start = path.points[segment.startIndex]?.position
      const end = path.points[segment.endIndex]?.position
      return segmentSum + (start && end ? pointDistance(start, end) : 0)
    }, 0)
  }, 0)
  const pointCount = paths.reduce((sum, path) => sum + path.points.length, 0)
  const safePointCount = paths.reduce((sum, path) => (
    sum + path.points.filter((point) => point.metadata?.safe === true).length
  ), 0)
  const hasSafePointMetadata = paths.some((path) => path.points.some((point) => point.metadata?.safe === true))
  const segmentCount = paths.reduce((sum, path) => sum + path.segments.length, 0)
  const summary: CamToolpathSummary = {
    targetCount,
    triangleCount,
    levelCount,
    pathCount: paths.length,
    pointCount,
    segmentCount,
    moveCount: segmentCount,
    motionSegmentCount: segmentCount,
    estimatedCutLength: roundCamCoord(cutLength),
    estimatedRapidLength: roundCamCoord(rapidLength),
    warningCount,
  }
  if (hasSafePointMetadata) {
    summary.safePointCount = safePointCount
    summary.contactPointCount = pointCount - safePointCount
  }
  if (outlinePointCount != null) summary.outlinePointCount = outlinePointCount
  if (offsetDistance != null) summary.offsetDistance = roundCamCoord(offsetDistance)
  return summary
}

/** unionCamBounds — CAM toolpath helper (BREP.io port).
 *
 *
 * @param boundsList - the boundsList value.
 * @returns { min: CamPoint3; max: CamPoint3; } | null - computed result.
 */
export function unionCamBounds(boundsList: CamBounds[]): { min: CamPoint3; max: CamPoint3; } | null {
  if (!boundsList.length) return null
  const min: CamPoint3 = [Infinity, Infinity, Infinity]
  const max: CamPoint3 = [-Infinity, -Infinity, -Infinity]
  for (const bounds of boundsList) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis])
      max[axis] = Math.max(max[axis], bounds.max[axis])
    }
  }
  return {
    min: roundCamPoint(min),
    max: roundCamPoint(max),
  }
}

function normalizeVector3(value: CamPoint3, fallback: CamPoint3): CamPoint3 {
  const x = Number(value[0])
  const y = Number(value[1])
  const z = Number(value[2])
  const length = Math.hypot(x, y, z)
  if (!(length > 1e-12)) return roundCamPoint(fallback)
  return [roundCamCoord(x / length), roundCamCoord(y / length), roundCamCoord(z / length)]
}

function pointDistance(a: CamPoint3, b: CamPoint3) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}
