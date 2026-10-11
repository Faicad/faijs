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
import { initOcctWasm } from '@faicad/faijs'
import type { OcctKernel, ShapeHandle, BrepBoundingBox, BrepVec3 } from '@faicad/faijs'

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
  /**
   * P7/D3: pose comparison mode. Default 'bitwise' (exact placement match).
   * 'canonical-pose' = the two files are two LEGAL solutions of an
   * underdetermined constraint set (solver DOF diagnostic said dof > 0): the
   * placement difference along the free twist is not a defect. B is pre-aligned
   * to A by scanning the twist about `canonicalFreeAxis` (through B's COM) to
   * the minimal-difference angle before the rotation-sensitive metrics (bbox,
   * boolean diff); invariants (topology / volume / COM) stay bitwise — they are
   * unchanged by that rotation anyway.
   */
  poseMode?: 'bitwise' | 'canonical-pose'
  /**
   * Free twist axis (world direction, any nonzero length — normalized
   * internally). Required when poseMode is 'canonical-pose'; ignored otherwise.
   * Feed the solver's underdetermined free direction here.
   */
  canonicalFreeAxis?: BrepVec3
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
  /**
   * P7/D3 audit fields (present only when poseMode is 'canonical-pose'):
   * the aligned twist angle (deg) applied to B and the resulting minimal
   * bbox diff. Makes every canonical-channel relaxation visible in reports —
   * no silent loosening.
   */
  canonicalPose?: { twistAngleDeg: number; alignedBboxDiff: number }
}

const DEFAULT_OPTIONS: Required<Pick<CompareOptions, 'linearTolerance' | 'volumeRelativeTolerance' | 'booleanVolumeTolerance' | 'strictTopology'>> = {
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

function getTopologyStats(kernel: OcctKernel, shape: ShapeHandle): TopologyStats {
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
  // readFileSync returns pooled Buffers for small files: buf.buffer is the
  // whole 8KB pool (with garbage beyond byteLength), which makes importStep
  // fail on every STEP < ~4KB (e.g. single-sphere files). Pass an exact copy.
  const exact = (buf: Buffer): ArrayBuffer =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const shapeA = kernel.importStep(exact(bufA))
  let shapeB = kernel.importStep(exact(bufB))

  // P7/D3: canonical-pose pre-alignment. Two legal solutions of an
  // underdetermined constraint set differ only by the twist about the free
  // axis; scan that twist to the minimal-difference angle before the
  // rotation-sensitive metrics. Invariants (topology/volume/COM) are unchanged
  // by a rotation about the axis through B's COM, so computing them before or
  // after this alignment is equivalent — do it before, once.
  let canonicalTwistAngle: number | undefined
  if (opts.poseMode === 'canonical-pose') {
    if (!opts.canonicalFreeAxis) {
      throw new Error("poseMode 'canonical-pose' requires canonicalFreeAxis (the solver's underdetermined free direction)")
    }
    const ux = opts.canonicalFreeAxis.x
    const uy = opts.canonicalFreeAxis.y
    const uz = opts.canonicalFreeAxis.z
    const len = Math.hypot(ux, uy, uz)
    if (!(len > 0)) throw new Error('canonicalFreeAxis must be a nonzero direction')
    const axis: BrepVec3 = { x: ux / len, y: uy / len, z: uz / len }
    const comB = kernel.getCenterOfMass(shapeB)
    const pivot: [number, number, number] = [comB.x, comB.y, comB.z]
    const diffAt = (deg: number): number => {
      // Rotate B about axis through its COM by deg, then bbox-diff vs A.
      const a = (deg * Math.PI) / 180
      const c = Math.cos(a)
      const s = Math.sin(a)
      const t = 1 - c
      // Rodrigues rotation matrix (row-major 3x3)
      const r00 = c + axis.x * axis.x * t
      const r01 = axis.x * axis.y * t - axis.z * s
      const r02 = axis.x * axis.z * t + axis.y * s
      const r10 = axis.y * axis.x * t + axis.z * s
      const r11 = c + axis.y * axis.y * t
      const r12 = axis.y * axis.z * t - axis.x * s
      const r20 = axis.z * axis.x * t - axis.y * s
      const r21 = axis.z * axis.y * t + axis.x * s
      const r22 = c + axis.z * axis.z * t
      // T(pivot)·R·T(-pivot) folded into the 3x4 row-major form OCCT accepts
      const tx = pivot[0] - (r00 * pivot[0] + r01 * pivot[1] + r02 * pivot[2])
      const ty = pivot[1] - (r10 * pivot[0] + r11 * pivot[1] + r12 * pivot[2])
      const tz = pivot[2] - (r20 * pivot[0] + r21 * pivot[1] + r22 * pivot[2])
      const rotated = kernel.transform(shapeB, [r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz])
      const diff = bboxMaxDiff(bboxA0, kernel.getBoundingBox(rotated))
      kernel.release(rotated)
      return diff
    }
    const bboxA0 = kernel.getBoundingBox(shapeA)
    // Coarse 2° grid, then golden-section refine within ±2° of the best cell.
    let bestDeg = 0
    let bestDiff = diffAt(0)
    for (let deg = 2; deg < 360; deg += 2) {
      const d = diffAt(deg)
      if (d < bestDiff) {
        bestDiff = d
        bestDeg = deg
      }
    }
    let lo = bestDeg - 2
    let hi = bestDeg + 2
    for (let i = 0; i < 40; i++) {
      const m1 = lo + (hi - lo) * 0.382
      const m2 = lo + (hi - lo) * 0.618
      if (diffAt(m1) < diffAt(m2)) hi = m2
      else lo = m1
    }
    canonicalTwistAngle = (lo + hi) / 2
    // Re-import B and apply the final alignment (avoids deep-copying handles):
    // transform in place once and keep the aligned handle for all metrics.
    const a = (canonicalTwistAngle * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const t = 1 - c
    const axis2 = axis
    const r00 = c + axis2.x * axis2.x * t
    const r01 = axis2.x * axis2.y * t - axis2.z * s
    const r02 = axis2.x * axis2.z * t + axis2.y * s
    const r10 = axis2.y * axis2.x * t + axis2.z * s
    const r11 = c + axis2.y * axis2.y * t
    const r12 = axis2.y * axis2.z * t - axis2.x * s
    const r20 = axis2.z * axis2.x * t - axis2.y * s
    const r21 = axis2.z * axis2.y * t + axis2.x * s
    const r22 = c + axis2.z * axis2.z * t
    const tx = pivot[0] - (r00 * pivot[0] + r01 * pivot[1] + r02 * pivot[2])
    const ty = pivot[1] - (r10 * pivot[0] + r11 * pivot[1] + r12 * pivot[2])
    const tz = pivot[2] - (r20 * pivot[0] + r21 * pivot[1] + r22 * pivot[2])
    const aligned = kernel.transform(shapeB, [r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz])
    kernel.release(shapeB)
    shapeB = aligned
    details.push(`canonical-pose: twist about (${axis.x.toFixed(4)},${axis.y.toFixed(4)},${axis.z.toFixed(4)}) aligned at ${canonicalTwistAngle.toFixed(3)}°`)
  }

  // 1. Bounding box
  const bboxA = kernel.getBoundingBox(shapeA)
  const bboxB = kernel.getBoundingBox(shapeB)
  const bboxDiff = bboxMaxDiff(bboxA, bboxB)
  const bboxMatch = bboxDiff <= opts.linearTolerance
  details.push(`bbox diff: ${bboxDiff.toExponential(3)} mm (tol ${opts.linearTolerance})`)

  // 2. Topology (needed to decide whether volume/COM/boolean are meaningful)
  const topoA = getTopologyStats(kernel, shapeA)
  const topoB = getTopologyStats(kernel, shapeB)
  const topoMatch = topologyMatch(topoA, topoB, opts.strictTopology)
  details.push(`topology: A(f=${topoA.faces},e=${topoA.edges},v=${topoA.vertices},s=${topoA.solids}) B(f=${topoB.faces},e=${topoB.edges},v=${topoB.vertices},s=${topoB.solids})`)

  // 3. Volume / COM / boolean difference: only meaningful when BOTH shapes
  // contain solids or faces (e.g. `siblings(..., "Vertex", ...)` yields a
  // pure edges compound; BRepGProp volume / BRepAlgoAPI_Cut throw on those).
  const hasMass =
    (topoA.solids > 0 || topoA.faces > 0) && (topoB.solids > 0 || topoB.faces > 0)
  let volA = 0
  let volB = 0
  let volDiff = 0
  let volPct = 0
  let volMatch = true
  let comA: BrepVec3 = { x: 0, y: 0, z: 0 }
  let comB: BrepVec3 = { x: 0, y: 0, z: 0 }
  let comDiff = 0
  let comMatch = true
  let volAB = 0
  let volBA = 0
  let boolMatch = true
  if (hasMass) {
    volA = kernel.getVolume(shapeA)
    volB = kernel.getVolume(shapeB)
    volDiff = Math.abs(volA - volB)
    volPct = volA > 0 ? (volDiff / volA) * 100 : 0
    volMatch = volPct <= opts.volumeRelativeTolerance * 100
    details.push(`volume diff: ${volDiff.toExponential(3)} mm³ (${volPct.toFixed(4)}%, tol ${opts.volumeRelativeTolerance * 100}%)`)

    comA = kernel.getCenterOfMass(shapeA)
    comB = kernel.getCenterOfMass(shapeB)
    comDiff = comMaxDiff(comA, comB)
    comMatch = comDiff <= opts.linearTolerance
    details.push(`center-of-mass diff: ${comDiff.toExponential(3)} mm (tol ${opts.linearTolerance})`)

    const aMinusB = kernel.cut(shapeA, shapeB)
    const bMinusA = kernel.cut(shapeB, shapeA)
    volAB = kernel.getVolume(aMinusB)
    volBA = kernel.getVolume(bMinusA)
    boolMatch = volAB <= opts.booleanVolumeTolerance && volBA <= opts.booleanVolumeTolerance
    details.push(`boolean diff: A-B=${volAB.toExponential(3)} mm³, B-A=${volBA.toExponential(3)} mm³ (tol ${opts.booleanVolumeTolerance})`)
    kernel.release(aMinusB)
    kernel.release(bMinusA)
  } else {
    details.push('volume/COM/boolean: skipped (no solid or face topology in either shape)')
  }

  // Cleanup
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
    ...(canonicalTwistAngle !== undefined
      ? { canonicalPose: { twistAngleDeg: canonicalTwistAngle, alignedBboxDiff: bboxDiff } }
      : {}),
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
