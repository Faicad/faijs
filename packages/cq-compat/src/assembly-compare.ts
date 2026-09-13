/**
 * Assembly STEP equivalence comparison.
 *
 * Four-level comparison:
 * 1. Assembly structure (leaf count, part names, hierarchy)
 * 2. Part pose (center of mass / bbox center in assembly coords)
 * 3. Part geometry (volume, topology — per-part, name-matched)
 * 4. Overall geometry (fuse all parts → boolean difference)
 *
 * Part names must match exactly (port verification scenario).
 */

import { readFileSync } from 'node:fs'
import {
  initOcctWasm,
  importAssemblyFromStep,
  collectLeafParts,
} from '@faicad/faijs-core'
import type { BrepEngineApi, BrepHandle, BrepBoundingBox, BrepVec3 } from '@faicad/faijs-core'
import type { AssemblyPartNode } from '@faicad/faijs-core'

/** Tolerance options. */
export interface AssemblyCompareOptions {
  linearTolerance?: number
  volumeRelativeTolerance?: number
  booleanVolumeTolerance?: number
  strictTopology?: boolean
  /**
   * Require part names to match between the two files (default true).
   * Set to false for files whose PRODUCT names are not under our control
   * (e.g. CadQuery/OCC references named "SOLID" vs our "shape_x") — parts are
   * then paired by index in sorted order. Structure still requires the same
   * leaf count, so the compound-vs-parts check remains intact.
   */
  matchNames?: boolean
  /**
   * Skip the fused (A∪B → cut) boolean-difference computation entirely
   * (default false). The fused cut is expensive on near-coincident B-spline
   * faces and the occt-wasm kernel can return inverted/garbage solids for it
   * (documented in fai_cq_gears analysis docs); per-part volume/CoM/bbox
   * checks remain the verdict. When true, `booleanDiff` is reported as
   * {aMinusB: NaN, bMinusA: NaN, match: true}.
   */
  skipFusedBoolean?: boolean
}

/** Per-part comparison result. */
export interface PartCompareResult {
  name: string
  found: boolean
  volume?: { a: number; b: number; match: boolean; diffPct: number }
  centerOfMass?: { a: BrepVec3; b: BrepVec3; match: boolean; maxDiff: number }
  bbox?: { a: BrepBoundingBox; b: BrepBoundingBox; match: boolean; maxDiff: number }
  topology?: {
    a: { faces: number; edges: number; vertices: number }
    b: { faces: number; edges: number; vertices: number }
    match: boolean
  }
  color?: { a: [number, number, number] | null; b: [number, number, number] | null; match: boolean }
}

/** Full assembly comparison result. */
export interface AssemblyCompareResult {
  fileA: string
  fileB: string
  equivalent: boolean
  structure: {
    leafCountA: number
    leafCountB: number
    namesA: string[]
    namesB: string[]
    match: boolean
    missingInB: string[]
    missingInA: string[]
  }
  parts: PartCompareResult[]
  overall: {
    volumeA: number
    volumeB: number
    volumeMatch: boolean
    volumeDiffPct: number
    bboxMatch: boolean
    bboxMaxDiff: number
    booleanDiff: { aMinusB: number; bMinusA: number; match: boolean }
  }
  details: string[]
}

const DEFAULT_OPTS: Required<AssemblyCompareOptions> = {
  linearTolerance: 1e-3,
  volumeRelativeTolerance: 1e-3,
  booleanVolumeTolerance: 1e-1,
  strictTopology: false,
  matchNames: true,
  skipFusedBoolean: false,
}

function vmax(a: BrepVec3, b: BrepVec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}

function bbmax(a: BrepBoundingBox, b: BrepBoundingBox): number {
  return Math.max(
    Math.abs(a.xmin - b.xmin), Math.abs(a.xmax - b.xmax),
    Math.abs(a.ymin - b.ymin), Math.abs(a.ymax - b.ymax),
    Math.abs(a.zmin - b.zmin), Math.abs(a.zmax - b.zmax),
  )
}

function topoStats(kernel: BrepEngineApi, shape: BrepHandle) {
  return {
    faces: kernel.getSubShapes(shape, 'face').length,
    edges: kernel.getSubShapes(shape, 'edge').length,
    vertices: kernel.getSubShapes(shape, 'vertex').length,
  }
}

function fuseAll(kernel: BrepEngineApi, shapes: BrepHandle[]): BrepHandle | null {
  if (shapes.length === 0) return null
  let acc = shapes[0]
  for (let i = 1; i < shapes.length; i++) {
    const fused = kernel.fuse(acc, shapes[i])
    if (i > 1) kernel.release(acc)
    acc = fused
  }
  return acc
}

/**
 * Compare two assembly STEP files for equivalence.
 *
 * @param fileA - Path to reference STEP.
 * @param fileB - Path to candidate STEP.
 * @param options - Comparison tolerances.
 * @returns Detailed per-level comparison result.
 */
export async function compareAssemblyFiles(
  fileA: string,
  fileB: string,
  options: AssemblyCompareOptions = {},
): Promise<AssemblyCompareResult> {
  const opts = { ...DEFAULT_OPTS, ...options }
  const details: string[] = []

  const kernel = await initOcctWasm()

  const bufA = readFileSync(fileA)
  const bufB = readFileSync(fileB)
  // readFileSync returns pooled Buffers for small files: buf.buffer is the
  // whole pool with garbage beyond byteLength, which corrupts STEP imports
  // of files < ~4KB. Pass exact copies.
  const exact = (buf: Buffer): ArrayBuffer =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const nodesA = await importAssemblyFromStep(exact(bufA))
  const nodesB = await importAssemblyFromStep(exact(bufB))
  const leavesA = collectLeafParts(nodesA).filter(n => n.shapeHandle !== null)
  const leavesB = collectLeafParts(nodesB).filter(n => n.shapeHandle !== null)

  // ── Level 1: Structure ──
  const namesA = leavesA.map(n => n.name).sort()
  const namesB = leavesB.map(n => n.name).sort()
  const missingInB = namesA.filter(n => !namesB.includes(n))
  const missingInA = namesB.filter(n => !namesA.includes(n))
  const namesMatch = opts.matchNames && missingInB.length === 0 && missingInA.length === 0
  const structureMatch = leavesA.length === leavesB.length && (!opts.matchNames || namesMatch)
  details.push(`structure: ${leavesA.length} vs ${leavesB.length} leaves, names match=${structureMatch} (matchNames=${opts.matchNames})`)
  if (missingInB.length) details.push(`  missing in B: ${missingInB.join(', ')}`)
  if (missingInA.length) details.push(`  missing in A: ${missingInA.join(', ')}`)

  // ── Level 2 & 3: Per-part pose + geometry ──
  const partResults: PartCompareResult[] = []
  // With matchNames: pair parts by name. Without (reference files use foreign
  // PRODUCT names): pair by index in sorted order (safe for single-part files;
  // the leaf-count equality above still guards the compound-vs-parts case).
  const sortedA = [...leavesA].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const sortedB = [...leavesB].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const mapB: Map<string, AssemblyPartNode> = opts.matchNames
    ? new Map(leavesB.map(n => [n.name, n]))
    : new Map(sortedB.map((n, i) => [String(i), n]))
  const partKey = (leaf: AssemblyPartNode, index: number): string =>
    opts.matchNames ? leaf.name : String(index)

  for (let i = 0; i < sortedA.length; i++) {
    const leafA = sortedA[i]
    const leafB = mapB.get(partKey(leafA, i))
    if (!leafB) {
      partResults.push({ name: leafA.name, found: false })
      continue
    }
    const shapeA = leafA.shapeHandle! as unknown as BrepHandle
    const shapeB = leafB.shapeHandle! as unknown as BrepHandle

    const volA = kernel.getVolume(shapeA)
    const volB = kernel.getVolume(shapeB)
    const volDiffPct = volA > 0 ? (Math.abs(volA - volB) / volA) * 100 : 0
    const volMatch = volDiffPct <= opts.volumeRelativeTolerance * 100

    const comA = kernel.getCenterOfMass(shapeA)
    const comB = kernel.getCenterOfMass(shapeB)
    const comDiff = vmax(comA, comB)
    const comMatch = comDiff <= opts.linearTolerance

    const bbA = kernel.getBoundingBox(shapeA)
    const bbB = kernel.getBoundingBox(shapeB)
    const bbDiff = bbmax(bbA, bbB)
    const bbMatch = bbDiff <= opts.linearTolerance

    const topA = topoStats(kernel, shapeA)
    const topB = topoStats(kernel, shapeB)
    const topoMatch = opts.strictTopology
      ? topA.faces === topB.faces && topA.edges === topB.edges && topA.vertices === topB.vertices
      : true

    const colA = leafA.color
    const colB = leafB.color
    const colMatch = Boolean((!colA && !colB) || (colA && colB &&
      Math.abs(colA[0] - colB[0]) < 0.01 &&
      Math.abs(colA[1] - colB[1]) < 0.01 &&
      Math.abs(colA[2] - colB[2]) < 0.01))

    partResults.push({
      name: leafA.name,
      found: true,
      volume: { a: volA, b: volB, match: volMatch, diffPct: volDiffPct },
      centerOfMass: { a: comA, b: comB, match: comMatch, maxDiff: comDiff },
      bbox: { a: bbA, b: bbB, match: bbMatch, maxDiff: bbDiff },
      topology: { a: topA, b: topB, match: topoMatch },
      color: { a: colA, b: colB, match: colMatch },
    })

    details.push(`part "${leafA.name}": vol ${volA.toFixed(1)} vs ${volB.toFixed(1)} (${volDiffPct.toFixed(3)}%), com diff=${comDiff.toExponential(2)}, bbox diff=${bbDiff.toExponential(2)}, color=${colMatch}`)
  }

  // ── Level 4: Overall fused geometry ──
  const shapesA = leavesA.map(n => n.shapeHandle! as unknown as BrepHandle)
  const shapesB = leavesB.map(n => n.shapeHandle! as unknown as BrepHandle)
  const fusedA = fuseAll(kernel, shapesA)
  const fusedB = fuseAll(kernel, shapesB)

  let overallVolumeA = 0, overallVolumeB = 0, overallVolMatch = false, overallVolDiffPct = 0
  let overallBboxMatch = false, overallBboxDiff = 0
  let boolAB = 0, boolBA = 0, boolMatch = false

  if (fusedA && fusedB) {
    overallVolumeA = kernel.getVolume(fusedA)
    overallVolumeB = kernel.getVolume(fusedB)
    overallVolDiffPct = overallVolumeA > 0 ? (Math.abs(overallVolumeA - overallVolumeB) / overallVolumeA) * 100 : 0
    overallVolMatch = overallVolDiffPct <= opts.volumeRelativeTolerance * 100

    const fbbA = kernel.getBoundingBox(fusedA)
    const fbbB = kernel.getBoundingBox(fusedB)
    overallBboxDiff = bbmax(fbbA, fbbB)
    overallBboxMatch = overallBboxDiff <= opts.linearTolerance

    if (opts.skipFusedBoolean) {
      boolAB = NaN
      boolBA = NaN
      boolMatch = true
    } else {
      const cutAB = kernel.cut(fusedA, fusedB)
      const cutBA = kernel.cut(fusedB, fusedA)
      boolAB = kernel.getVolume(cutAB)
      boolBA = kernel.getVolume(cutBA)
      boolMatch = boolAB <= opts.booleanVolumeTolerance && boolBA <= opts.booleanVolumeTolerance
      kernel.release(cutAB)
      kernel.release(cutBA)
    }
  }

  details.push(`overall: vol ${overallVolumeA.toFixed(1)} vs ${overallVolumeB.toFixed(1)} (${overallVolDiffPct.toFixed(3)}%), bbox diff=${overallBboxDiff.toExponential(2)}, bool A-B=${boolAB.toExponential(2)}, B-A=${boolBA.toExponential(2)}`)

  // Cleanup
  if (fusedA) kernel.release(fusedA)
  if (fusedB) kernel.release(fusedB)
  // Note: leaf shapeHandles are owned by the assembly tree, not released here

  const partsAllMatch = partResults.every(p =>
    p.found && p.volume?.match && p.centerOfMass?.match && p.bbox?.match && p.topology?.match && p.color?.match
  )
  const equivalent = structureMatch && partsAllMatch && overallVolMatch && overallBboxMatch && boolMatch

  return {
    fileA,
    fileB,
    equivalent,
    structure: {
      leafCountA: leavesA.length,
      leafCountB: leavesB.length,
      namesA,
      namesB,
      match: structureMatch,
      missingInB,
      missingInA,
    },
    parts: partResults,
    overall: {
      volumeA: overallVolumeA,
      volumeB: overallVolumeB,
      volumeMatch: overallVolMatch,
      volumeDiffPct: overallVolDiffPct,
      bboxMatch: overallBboxMatch,
      bboxMaxDiff: overallBboxDiff,
      booleanDiff: { aMinusB: boolAB, bMinusA: boolBA, match: boolMatch },
    },
    details,
  }
}

/**
 * Print a human-readable assembly comparison report.
 * @param result - Comparison result from compareAssemblyFiles.
 */
export function printAssemblyReport(result: AssemblyCompareResult): void {
  console.log(`\n=== Assembly Comparison: ${result.fileA} vs ${result.fileB} ===`)
  console.log(`Overall: ${result.equivalent ? '✓ EQUIVALENT' : '✗ DIFFERENT'}\n`)

  console.log('── Level 1: Structure ──')
  console.log(`  Leaves: ${result.structure.leafCountA} vs ${result.structure.leafCountB} — ${result.structure.match ? '✓' : '✗'}`)
  console.log(`  Names A: [${result.structure.namesA.join(', ')}]`)
  console.log(`  Names B: [${result.structure.namesB.join(', ')}]`)
  if (result.structure.missingInB.length) console.log(`  ✗ Missing in B: ${result.structure.missingInB.join(', ')}`)
  if (result.structure.missingInA.length) console.log(`  ✗ Missing in A: ${result.structure.missingInA.join(', ')}`)

  console.log('\n── Level 2 & 3: Per-part pose + geometry ──')
  for (const p of result.parts) {
    if (!p.found) {
      console.log(`  ✗ "${p.name}": not found in B`)
      continue
    }
    const ok = p.volume?.match && p.centerOfMass?.match && p.bbox?.match && p.color?.match
    console.log(`  ${ok ? '✓' : '✗'} "${p.name}": vol ${p.volume?.a.toFixed(1)} vs ${p.volume?.b.toFixed(1)} (${p.volume?.diffPct.toFixed(3)}%), com diff=${p.centerOfMass?.maxDiff.toExponential(2)}, bbox diff=${p.bbox?.maxDiff.toExponential(2)}, color=${p.color?.match ? '✓' : '✗'}`)
  }

  console.log('\n── Level 4: Overall fused geometry ──')
  console.log(`  Volume: ${result.overall.volumeA.toFixed(1)} vs ${result.overall.volumeB.toFixed(1)} (${result.overall.volumeDiffPct.toFixed(3)}%) — ${result.overall.volumeMatch ? '✓' : '✗'}`)
  console.log(`  BBox diff: ${result.overall.bboxMaxDiff.toExponential(2)} — ${result.overall.bboxMatch ? '✓' : '✗'}`)
  console.log(`  Boolean A-B: ${result.overall.booleanDiff.aMinusB.toExponential(2)} mm³`)
  console.log(`  Boolean B-A: ${result.overall.booleanDiff.bMinusA.toExponential(2)} mm³ — ${result.overall.booleanDiff.match ? '✓' : '✗'}`)
  console.log('')
}
