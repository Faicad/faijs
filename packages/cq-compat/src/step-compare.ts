/**
 * STEP file equivalence comparison using BREP geometry.
 *
 * Compares two STEP files across five dimensions:
 * 1. Bounding box
 * 2. Volume
 * 3. Center of mass
 * 4. Topology statistics (face/edge/vertex/solid counts)
 * 5. Boolean difference (A-B and B-A volumes)
 *
 * Usage:
 *   const result = await compareStepFiles('a.step', 'b.step')
 *   console.log(result.equivalent)
 */

import { readFileSync } from 'node:fs'
import { initOcctWasm } from '@faicad/faijs-core'
import type { BrepEngineApi, BrepHandle, BrepBoundingBox, BrepVec3 } from '@faicad/faijs-core'

/** Tolerance options for comparison. */
export interface CompareOptions {
  /** Absolute tolerance for bbox / center-of-mass coordinates (mm). Default 1e-4. */
  linearTolerance?: number
  /** Relative tolerance for volume comparison (0.001 = 0.1%). Default 1e-4. */
  volumeRelativeTolerance?: number
  /** Absolute tolerance for boolean difference volume (mm³). Default 1e-3. */
  booleanVolumeTolerance?: number
  /** Whether to require topology counts to match exactly. Default true. */
  strictTopology?: boolean
}

/** Per-metric comparison result. */
export interface MetricResult<T> {
  a: T
  b: T
  match: boolean
}

/** Topology statistics for a shape. */
export interface TopologyStats {
  faces: number
  edges: number
  vertices: number
  solids: number
}

/** Full comparison result. */
export interface StepCompareResult {
  fileA: string
  fileB: string
  equivalent: boolean
  bbox: MetricResult<BrepBoundingBox> & { maxDiff: number }
  volume: MetricResult<number> & { diff: number; diffPct: number }
  centerOfMass: MetricResult<BrepVec3> & { maxDiff: number }
  topology: MetricResult<TopologyStats>
  booleanDiff: {
    aMinusB: { volume: number; nonEmpty: boolean }
    bMinusA: { volume: number; nonEmpty: boolean }
    match: boolean
  }
  details: string[]
}

const DEFAULT_OPTIONS: Required<CompareOptions> = {
  linearTolerance: 1e-4,
  volumeRelativeTolerance: 1e-4,
  booleanVolumeTolerance: 1e-3,
  strictTopology: true,
}

function bboxMaxDiff(a: BrepBoundingBox, b: BrepBoundingBox): number {
  return Math.max(
    Math.abs(a.xmin - b.xmin), Math.abs(a.xmax - b.xmax),
    Math.abs(a.ymin - b.ymin), Math.abs(a.ymax - b.ymax),
    Math.abs(a.zmin - b.zmin), Math.abs(a.zmax - b.zmax),
  )
}

function comMaxDiff(a: BrepVec3, b: BrepVec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}

function getTopologyStats(kernel: BrepEngineApi, shape: BrepHandle): TopologyStats {
  return {
    faces: kernel.getSubShapes(shape, 'face').length,
    edges: kernel.getSubShapes(shape, 'edge').length,
    vertices: kernel.getSubShapes(shape, 'vertex').length,
    solids: kernel.getSubShapes(shape, 'solid').length,
  }
}

function topologyMatch(a: TopologyStats, b: TopologyStats, strict: boolean): boolean {
  if (strict) {
    return a.faces === b.faces && a.edges === b.edges && a.vertices === b.vertices && a.solids === b.solids
  }
  return a.solids === b.solids
}

/**
 * Compare two STEP files for geometric equivalence.
 *
 * @param fileA - Path to the first STEP file.
 * @param fileB - Path to the second STEP file.
 * @param options - Comparison tolerances.
 * @returns Detailed comparison result with per-metric match status.
 */
export async function compareStepFiles(
  fileA: string,
  fileB: string,
  options: CompareOptions = {},
): Promise<StepCompareResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const details: string[] = []

  const kernel = await initOcctWasm()

  const bufA = readFileSync(fileA)
  const bufB = readFileSync(fileB)
  const shapeA = kernel.importStep(bufA.buffer as ArrayBuffer)
  const shapeB = kernel.importStep(bufB.buffer as ArrayBuffer)

  // 1. Bounding box
  const bboxA = kernel.getBoundingBox(shapeA)
  const bboxB = kernel.getBoundingBox(shapeB)
  const bboxDiff = bboxMaxDiff(bboxA, bboxB)
  const bboxMatch = bboxDiff <= opts.linearTolerance
  details.push(`bbox diff: ${bboxDiff.toExponential(3)} mm (tol ${opts.linearTolerance})`)

  // 2. Volume
  const volA = kernel.getVolume(shapeA)
  const volB = kernel.getVolume(shapeB)
  const volDiff = Math.abs(volA - volB)
  const volPct = volA > 0 ? (volDiff / volA) * 100 : 0
  const volMatch = volPct <= opts.volumeRelativeTolerance * 100
  details.push(`volume diff: ${volDiff.toExponential(3)} mm³ (${volPct.toFixed(4)}%, tol ${opts.volumeRelativeTolerance * 100}%)`)

  // 3. Center of mass
  const comA = kernel.getCenterOfMass(shapeA)
  const comB = kernel.getCenterOfMass(shapeB)
  const comDiff = comMaxDiff(comA, comB)
  const comMatch = comDiff <= opts.linearTolerance
  details.push(`center-of-mass diff: ${comDiff.toExponential(3)} mm (tol ${opts.linearTolerance})`)

  // 4. Topology
  const topoA = getTopologyStats(kernel, shapeA)
  const topoB = getTopologyStats(kernel, shapeB)
  const topoMatch = topologyMatch(topoA, topoB, opts.strictTopology)
  details.push(`topology: A(f=${topoA.faces},e=${topoA.edges},v=${topoA.vertices},s=${topoA.solids}) B(f=${topoB.faces},e=${topoB.edges},v=${topoB.vertices},s=${topoB.solids})`)

  // 5. Boolean difference
  const aMinusB = kernel.cut(shapeA, shapeB)
  const bMinusA = kernel.cut(shapeB, shapeA)
  const volAB = kernel.getVolume(aMinusB)
  const volBA = kernel.getVolume(bMinusA)
  const boolMatch = volAB <= opts.booleanVolumeTolerance && volBA <= opts.booleanVolumeTolerance
  details.push(`boolean diff: A-B=${volAB.toExponential(3)} mm³, B-A=${volBA.toExponential(3)} mm³ (tol ${opts.booleanVolumeTolerance})`)

  // Cleanup
  kernel.release(aMinusB)
  kernel.release(bMinusA)
  kernel.release(shapeA)
  kernel.release(shapeB)

  const equivalent = bboxMatch && volMatch && comMatch && topoMatch && boolMatch

  return {
    fileA,
    fileB,
    equivalent,
    bbox: { a: bboxA, b: bboxB, match: bboxMatch, maxDiff: bboxDiff },
    volume: { a: volA, b: volB, match: volMatch, diff: volDiff, diffPct: volPct },
    centerOfMass: { a: comA, b: comB, match: comMatch, maxDiff: comDiff },
    topology: { a: topoA, b: topoB, match: topoMatch },
    booleanDiff: {
      aMinusB: { volume: volAB, nonEmpty: volAB > opts.booleanVolumeTolerance },
      bMinusA: { volume: volBA, nonEmpty: volBA > opts.booleanVolumeTolerance },
      match: boolMatch,
    },
    details,
  }
}

/**
 * Print a human-readable comparison report to stdout.
 * @param result - The comparison result from compareStepFiles.
 */
export function printCompareReport(result: StepCompareResult): void {
  console.log(`\n=== STEP Comparison: ${result.fileA} vs ${result.fileB} ===`)
  console.log(`Overall: ${result.equivalent ? '✓ EQUIVALENT' : '✗ DIFFERENT'}\n`)
  for (const d of result.details) {
    console.log(`  ${d}`)
  }
  console.log('')
  if (!result.equivalent) {
    if (!result.bbox.match) console.log('  ✗ Bounding box mismatch')
    if (!result.volume.match) console.log('  ✗ Volume mismatch')
    if (!result.centerOfMass.match) console.log('  ✗ Center of mass mismatch')
    if (!result.topology.match) console.log('  ✗ Topology mismatch')
    if (!result.booleanDiff.match) console.log('  ✗ Boolean difference non-empty')
  }
}
