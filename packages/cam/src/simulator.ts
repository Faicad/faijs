/**
 * Toolpath playback primitives — ported from BREP.io `src/cam/CamToolpathSimulator.ts`.
 *
 * Only the pure data parts move into faijs: `flattenCamToolpathProgram` turns a
 * toolpath program into a flat segment list with cumulative distances (used by
 * host-side progress calculation and stats). The three.js rendering class
 * (`CamToolpathSimulator`) stays in the host rendering layer — 3d_editor
 * renders machine-coordinate toolpaths directly in its +Z-up scene, so the
 * BREP.io `machinePointToSceneVector` [x,z,y] swap is not needed here.
 */
import type { CamCutterDefinition, CamCutterOrientation, CamPoint3, CamToolpathProgram, CamToolpathSegment } from './types.js'

/** CAM_TOOLPATH_SIMULATOR_GROUP_NAME — CAM toolpath constant (BREP.io port). */
export const CAM_TOOLPATH_SIMULATOR_GROUP_NAME = '__CAM_TOOLPATH_SIMULATOR__'
/** CAM_TOOLPATH_TOOL_HEAD_NAME — CAM toolpath constant (BREP.io port). */
export const CAM_TOOLPATH_TOOL_HEAD_NAME = '__CAM_TOOLPATH_TOOL_HEAD__'

/** SimSegment — CAM toolpath type (BREP.io port). */
export type SimSegment = {
  index: number
  pathId: string
  segmentId: string
  kind: string
  start: CamPoint3
  end: CamPoint3
  length: number
  startDistance: number
  endDistance: number
  cutter: CamCutterDefinition | null
  orientation: CamCutterOrientation | null
}

/** AnyRecord — CAM toolpath type (BREP.io port). */
export type AnyRecord = Record<string, any>

function finiteNumber(value: any, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function pointDistance(a: CamPoint3, b: CamPoint3) {
  return Math.hypot(
    finiteNumber(b?.[0], 0) - finiteNumber(a?.[0], 0),
    finiteNumber(b?.[1], 0) - finiteNumber(a?.[1], 0),
    finiteNumber(b?.[2], 0) - finiteNumber(a?.[2], 0),
  )
}

function segmentCutter(path: AnyRecord, segment: CamToolpathSegment): CamCutterDefinition | null {
  return (segment?.cutter || path?.cutter || null) as CamCutterDefinition | null
}

function segmentOrientation(path: AnyRecord, segment: CamToolpathSegment): CamCutterOrientation | null {
  return (segment?.orientation || path?.defaultOrientation || null) as CamCutterOrientation | null
}

/** flattenCamToolpathProgram — CAM toolpath helper (BREP.io port).
 *
 *
 * @param program - the program value.
 * @returns SimSegment[] - computed result.
 */
export function flattenCamToolpathProgram(program: CamToolpathProgram | null | undefined): SimSegment[] {
  const out: SimSegment[] = []
  let distance = 0
  for (const path of Array.isArray(program?.paths) ? program.paths : []) {
    const points = Array.isArray(path?.points) ? path.points : []
    for (const segment of Array.isArray(path?.segments) ? path.segments : []) {
      const start = points[segment.startIndex]?.position
      const end = points[segment.endIndex]?.position
      if (!Array.isArray(start) || !Array.isArray(end)) continue
      const length = pointDistance(start, end)
      if (!(length > 1e-9)) continue
      out.push({
        index: out.length,
        pathId: String(path.id || ''),
        segmentId: String(segment.id || ''),
        kind: String(segment.kind || 'cut'),
        start,
        end,
        length,
        startDistance: distance,
        endDistance: distance + length,
        cutter: segmentCutter(path, segment),
        orientation: segmentOrientation(path, segment),
      })
      distance += length
    }
  }
  return out
}
