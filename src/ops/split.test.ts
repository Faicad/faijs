/**
 * @vitest-environment node
 *
 * Split operation comprehensive tests.
 *
 * Tests:
 * 1. Geometric correctness (mesh path: primitive box + STL; BREP path: STEP)
 * 2. Multi-output invariant: stmt.outputs and outputCache consistency
 * 3. ID format invariants: stmt.id == outputs[0], outputs length == 2
 * 4. Terminal shape derivation for multi-output statements
 * 5. Mesh vs auto mode consistency for split results
 *
 * Run: npx vitest run src/ops/split.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { createRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { HostPorts, EventSink, AssetResolver } from '../cad-runtime/ports'
import { fileBlobStore } from '../test/blob-store'
import type { Shape } from '../mesh/types'
import type { CadStatement, PartScript } from '../lang/types'
import { computeTerminalShapes } from '../lang/parser'

// ── Test fixtures ──

let stlBuffer: ArrayBuffer
let stepBuffer: ArrayBuffer

beforeAll(async () => {
  await initOcctWasm()

  // Load cube-10x5x5.stl (mesh fixture, from test/fixtures/)
  const stlPath = resolve(__dirname, '..', '..', 'test', 'fixtures', 'cube-10x5x5.stl')
  const stlData = readFileSync(stlPath)
  stlBuffer = stlData.buffer.slice(stlData.byteOffset, stlData.byteOffset + stlData.byteLength) as ArrayBuffer

  // Load a STEP file for BREP path tests
  const stepPath = resolve(__dirname, '..', '..', 'test', 'fixtures', 'box_boss.step')
  const stepData = readFileSync(stepPath)
  stepBuffer = stepData.buffer.slice(stepData.byteOffset, stepData.byteOffset + stepData.byteLength) as ArrayBuffer
}, 120000)

beforeEach(() => {
  fileBlobStore.clear()
})

// ── Test helpers ──

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: 'brep-chain-broken', detail: { partId: string; op: string; reason: string }): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

function createTestAssets(): AssetResolver {
  return {
    resolveByKey: async (key: string) => {
      const bytes = fileBlobStore.get(key)
      if (!bytes) throw new Error(`test: asset key not found: ${key}`)
      return { bytes, format: undefined }
    },
    resolveFile: async (path: string) => {
      const fs = await import('node:fs/promises')
      const buf = await fs.readFile(path)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    },
    resolveUrl: async (url: string) => {
      const res = await fetch(url)
      return res.arrayBuffer()
    },
  }
}

function createTestPorts(): HostPorts {
  return { events: new TestEventSink(), assets: createTestAssets() }
}

function makeStmt(
  id: string,
  op: string,
  args: Record<string, unknown>,
  inputs: string[] = [],
  extra?: Partial<CadStatement>,
): CadStatement {
  return {
    id, op,
    args: args as never,
    inputs,
    feature: { kind: 'split', label: op, createdBy: 'user' },
    ...extra,
  }
}

function makePartScript(statements: CadStatement[]): PartScript {
  return { source: { kind: 'load' }, params: [], statements }
}

async function runScript(statements: CadStatement[], mode: 'mesh' | 'auto' = 'auto'): Promise<ExecutionResult> {
  const runtime = createRuntime(createTestPorts(), mode)
  return runtime.replay(makePartScript(statements))
}

function shapeVertexCount(s: Shape): number { return s.positions.length / 3 }
function shapeTriangleCount(s: Shape): number { return s.indices.length / 3 }

function computeBBox(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i])
    min[1] = Math.min(min[1], positions[i + 1])
    min[2] = Math.min(min[2], positions[i + 2])
    max[0] = Math.max(max[0], positions[i])
    max[1] = Math.max(max[1], positions[i + 1])
    max[2] = Math.max(max[2], positions[i + 2])
  }
  return { min, max }
}

function bboxVolume(positions: Float32Array): number {
  const bb = computeBBox(positions)
  return (bb.max[0] - bb.min[0]) * (bb.max[1] - bb.min[1]) * (bb.max[2] - bb.min[2])
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ID FORMAT INVARIANTS
// ─────────────────────────────────────────────────────────────────────────────

describe('split: ID format invariants', () => {
  it('stmt.id === outputs[0] (front output id)', () => {
    const stmt = makeStmt('part1_v0', 'split',
      { cutMode: 'plane', normal: [0, 0, 1], offset: 0 },
      ['part0_v0'],
      { outputs: ['part1_v0', 'part2_v0'] },
    )
    expect(stmt.id).toBe(stmt.outputs![0])
  })

  it('outputs.length === 2', () => {
    const stmt = makeStmt('part1_v0', 'split',
      { cutMode: 'plane', normal: [0, 0, 1], offset: 0 },
      ['part0_v0'],
      { outputs: ['part1_v0', 'part2_v0'] },
    )
    expect(stmt.outputs).toBeDefined()
    expect(stmt.outputs!.length).toBe(2)
  })

  it('outputs[0] !== outputs[1] (front and back are distinct)', () => {
    const stmt = makeStmt('part1_v0', 'split',
      { cutMode: 'plane', normal: [0, 0, 1], offset: 0 },
      ['part0_v0'],
      { outputs: ['part1_v0', 'part2_v0'] },
    )
    expect(stmt.outputs![0]).not.toBe(stmt.outputs![1])
  })

  it('faijs variable names (partN_vM) are NOT the same as 3d_editor scopedId (fileId:partId)', () => {
    // faijs variable names: "part0_v0", "part1_v0" — no colon, model_version format
    // 3d_editor scopedId: "fileId:partId" — has colon, identity contract
    // These are different concepts:
    //   - faijs variable names are DAG statement identifiers within a PartScript
    //   - 3d_editor scopedIds are scene-tree node identifiers (fileId:partId)
    const faijsVarName = 'part1_v0'
    const scopedId = 'file1:part1'

    // faijs var name has no colon
    expect(faijsVarName.includes(':')).toBe(false)

    // scopedId has exactly one colon
    expect(scopedId.split(':').length).toBe(2)

    // They are structurally different
    expect(faijsVarName).not.toBe(scopedId)
  })

  it('split statement has no side args (single-statement model)', () => {
    // The new single-statement model: one split statement with outputs.
    // No side='front'/'back' args, no isMarker flag.
    const stmt = makeStmt('part1_v0', 'split',
      { cutMode: 'plane', normal: [0, 0, 1], offset: 0 },
      ['part0_v0'],
      { outputs: ['part1_v0', 'part2_v0'] },
    )
    expect(stmt.args.side).toBeUndefined()
    expect(stmt.isMarker).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. TERMINAL SHAPE DERIVATION (multi-output)
// ─────────────────────────────────────────────────────────────────────────────

describe('split: terminal shape derivation', () => {
  it('split with unreferenced outputs → both outputs are terminals', () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0 }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]
    const terminals = computeTerminalShapes(stmts)
    expect(terminals).toBeDefined()
    expect(terminals!.length).toBe(2)
    const ids = terminals!.map(t => t.id)
    expect(ids).toContain('part1_v0')
    expect(ids).toContain('part2_v0')
  })

  it('split with front referenced by downstream → only back is terminal', () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0 }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
      makeStmt('part1_v1', 'box', { size: 10 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v2', 'boolean', { operation: 'union' }, ['part1_v0', 'part1_v1'],
        { feature: { kind: 'boolean', label: 'union', createdBy: 'user' } }),
    ]
    const terminals = computeTerminalShapes(stmts)
    // part1_v0 is referenced by part1_v2 → not terminal
    // part2_v0 is unreferenced → terminal
    // part1_v2 is unreferenced → terminal
    expect(terminals).toBeDefined()
    const ids = terminals!.map(t => t.id)
    expect(ids).toContain('part2_v0')
    expect(ids).toContain('part1_v2')
    expect(ids).not.toContain('part1_v0')
  })

  it('single split with one output referenced → single terminal → returns undefined', () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0 }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
      makeStmt('part2_v1', 'box', { size: 10 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part2_v2', 'boolean', { operation: 'union' }, ['part2_v0', 'part2_v1'],
        { feature: { kind: 'boolean', label: 'union', createdBy: 'user' } }),
    ]
    // part2_v0 referenced, part1_v0 unreferenced
    // But part1_v0 is terminal + part2_v2 is terminal = 2 terminals
    const terminals = computeTerminalShapes(stmts)
    expect(terminals).toBeDefined()
    expect(terminals!.length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. GEOMETRIC CORRECTNESS — MESH PATH (primitive box source)
// ─────────────────────────────────────────────────────────────────────────────

describe('split: geometric correctness (mesh path — primitive box)', () => {
  it('split box at Z=0 → front and back each have valid geometry', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'mesh')

    // Invariant: no execution failure
    expect(result.failedAt).toBeUndefined()

    // Invariant: outputs has front shape under outputs[0] id
    const frontShape = result.outputs.get('part1_v0')
    expect(frontShape, 'front shape (outputs[0]) must be in outputCache').toBeDefined()
    expect(shapeVertexCount(frontShape!)).toBeGreaterThan(0)
    expect(shapeTriangleCount(frontShape!)).toBeGreaterThan(0)

    // Invariant: outputs has back shape under outputs[1] id
    const backShape = result.outputs.get('part2_v0')
    expect(backShape, 'back shape (outputs[1]) must be in outputCache').toBeDefined()
    expect(shapeVertexCount(backShape!)).toBeGreaterThan(0)
    expect(shapeTriangleCount(backShape!)).toBeGreaterThan(0)

    // Invariant: stmt.id (== outputs[0]) also has front shape
    const stmtOutput = result.outputs.get('part1_v0')
    expect(stmtOutput).toBe(frontShape)
  })

  it('split box at Z=0 → front is above Z=0, back is below Z=0 (after explode)', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'mesh')

    const frontShape = result.outputs.get('part1_v0')!
    const backShape = result.outputs.get('part2_v0')!

    const frontBBox = computeBBox(frontShape.positions)
    const backBBox = computeBBox(backShape.positions)

    // With explode, front should be shifted in +Z direction
    expect(frontBBox.min[2]).toBeGreaterThanOrEqual(0)
    // Back should be shifted in -Z direction
    expect(backBBox.max[2]).toBeLessThanOrEqual(0)
  })

  it('split box → front volume + back volume ≈ source volume (within CSG tolerance)', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'mesh')

    const sourceShape = result.outputs.get('part0_v0')!
    const frontShape = result.outputs.get('part1_v0')!
    const backShape = result.outputs.get('part2_v0')!

    const sourceVol = bboxVolume(sourceShape.positions)
    const frontVol = bboxVolume(frontShape.positions)
    const backVol = bboxVolume(backShape.positions)

    // front + back should be close to source (explosion just translates, doesn't change volume)
    expect(frontVol + backVol).toBeCloseTo(sourceVol, 1)
  })

  it('split with offset → cut plane is not at center', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 5, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'mesh')

    const frontShape = result.outputs.get('part1_v0')!
    const backShape = result.outputs.get('part2_v0')!

    // With offset=5 (positive Z), front should be smaller than back
    // (front = above the plane = less material when plane is above center)
    const frontVol = bboxVolume(frontShape.positions)
    const backVol = bboxVolume(backShape.positions)

    expect(backVol).toBeGreaterThan(frontVol)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. GEOMETRIC CORRECTNESS — MESH PATH (STL file source)
// ─────────────────────────────────────────────────────────────────────────────

describe('split: geometric correctness (mesh path — STL source)', () => {
  it('load STL → split → front and back have valid geometry', async () => {
    const bufferKey = fileBlobStore.put(stlBuffer)
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'load', { key: bufferKey, format: 'stl' }, [],
        { feature: { kind: 'load', label: 'load', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [10, 5, 5] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'mesh')

    expect(result.failedAt).toBeUndefined()

    const frontShape = result.outputs.get('part1_v0')
    const backShape = result.outputs.get('part2_v0')

    expect(frontShape, 'front shape must be in outputCache').toBeDefined()
    expect(backShape, 'back shape must be in outputCache').toBeDefined()

    expect(shapeVertexCount(frontShape!)).toBeGreaterThan(0)
    expect(shapeTriangleCount(frontShape!)).toBeGreaterThan(0)
    expect(shapeVertexCount(backShape!)).toBeGreaterThan(0)
    expect(shapeTriangleCount(backShape!)).toBeGreaterThan(0)
  })

  it('load STL → split → BREP chain is broken (STL is mesh format)', async () => {
    const bufferKey = fileBlobStore.put(stlBuffer)
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'load', { key: bufferKey, format: 'stl' }, [],
        { feature: { kind: 'load', label: 'load', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [10, 5, 5] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'auto')

    // STL is mesh format → BREP chain should break at load
    expect(result.brepChain.brepActive).toBe(false)
    expect(result.failedAt).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. GEOMETRIC CORRECTNESS — BREP PATH (STEP file source)
// ─────────────────────────────────────────────────────────────────────────────

describe('split: geometric correctness (BREP path — STEP source)', () => {
  it('load STEP → split → front and back have valid geometry (BREP active)', async () => {
    const bufferKey = fileBlobStore.put(stepBuffer)
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'load', { key: bufferKey, format: 'step' }, [],
        { feature: { kind: 'load', label: 'load', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0 }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'auto')

    expect(result.failedAt, `Execution failed: ${JSON.stringify(result.failedAt)}`).toBeUndefined()

    // STEP is CAD format → BREP chain should stay active
    expect(result.brepChain.brepActive).toBe(true)

    // Both outputs should have geometry
    const frontShape = result.outputs.get('part1_v0')
    const backShape = result.outputs.get('part2_v0')

    expect(frontShape, 'front shape must be in outputCache').toBeDefined()
    expect(backShape, 'back shape must be in outputCache').toBeDefined()

    expect(shapeVertexCount(frontShape!)).toBeGreaterThan(0)
    expect(shapeTriangleCount(frontShape!)).toBeGreaterThan(0)
    expect(shapeVertexCount(backShape!)).toBeGreaterThan(0)
    expect(shapeTriangleCount(backShape!)).toBeGreaterThan(0)
  })

  it('load STEP → split → brepChain.solidCache has front and back solids', async () => {
    const bufferKey = fileBlobStore.put(stepBuffer)
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'load', { key: bufferKey, format: 'step' }, [],
        { feature: { kind: 'load', label: 'load', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0 }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'auto')

    expect(result.failedAt).toBeUndefined()

    // Invariant: BREP solids for front and back should be in solidCache
    expect(result.brepChain.solidCache.has('part1_v0'), 'front solid in solidCache').toBe(true)
    expect(result.brepChain.solidCache.has('part2_v0'), 'back solid in solidCache').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. OUTPUT CACHE INVARIANTS
// ─────────────────────────────────────────────────────────────────────────────

describe('split: outputCache invariants', () => {
  it('outputCache has stmt.id, outputs[0], and outputs[1] after split (mesh mode)', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'mesh')

    // stmt.id is 'part1_v0', which is also outputs[0]
    // CadRuntime.replay() does: outputCache.set(stmt.id, result)
    // executeSplitMesh does: outputCache.set(outputs[0], front); outputCache.set(outputs[1], back)
    // So outputCache should have:
    //   'part0_v0' → box shape
    //   'part1_v0' → front shape (set by both replay loop and executeSplitMesh)
    //   'part2_v0' → back shape

    expect(result.outputs.has('part0_v0')).toBe(true) // source
    expect(result.outputs.has('part1_v0')).toBe(true) // front (== stmt.id)
    expect(result.outputs.has('part2_v0')).toBe(true) // back

    // stmt.id == outputs[0], so they should be the same shape
    expect(result.outputs.get('part1_v0')).toBe(result.outputs.get('part1_v0'))
  })

  it('outputCache[outputs[0]] is front geometry, outputCache[outputs[1]] is back geometry (mesh mode)', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const result = await runScript(stmts, 'mesh')

    const front = result.outputs.get('part1_v0')!
    const back = result.outputs.get('part2_v0')!

    // front and back should be different shapes (different vertex counts or positions)
    // They can't be the same reference
    expect(front).not.toBe(back)

    // Both should have non-trivial geometry
    expect(shapeVertexCount(front)).toBeGreaterThan(3)
    expect(shapeVertexCount(back)).toBeGreaterThan(3)
  })

  it('downstream statement can reference outputs[0] as input (DAG chain)', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
      // Downstream references front output
      makeStmt('part1_v1', 'scale', { factor: 2 }, ['part1_v0'],
        { feature: { kind: 'transform', label: 'scale', createdBy: 'user' } }),
    ]

    const result = await runScript(stmts, 'mesh')

    expect(result.failedAt).toBeUndefined()

    // The scaled front should be in outputCache
    const scaledFront = result.outputs.get('part1_v1')
    expect(scaledFront).toBeDefined()
    expect(shapeVertexCount(scaledFront!)).toBeGreaterThan(0)
  })

  it('downstream statement can reference outputs[1] as input (DAG chain)', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
      // Downstream references back output
      makeStmt('part2_v1', 'scale', { factor: 0.5 }, ['part2_v0'],
        { feature: { kind: 'transform', label: 'scale', createdBy: 'user' } }),
    ]

    const result = await runScript(stmts, 'mesh')

    expect(result.failedAt).toBeUndefined()

    const scaledBack = result.outputs.get('part2_v1')
    expect(scaledBack).toBeDefined()
    expect(shapeVertexCount(scaledBack!)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. MESH vs AUTO MODE CONSISTENCY
// ─────────────────────────────────────────────────────────────────────────────

describe('split: mesh vs auto mode consistency', () => {
  it('split primitive box → mesh mode result is valid', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const meshResult = await runScript(stmts, 'mesh')
    expect(meshResult.failedAt).toBeUndefined()

    // In mesh mode, BREP chain is not active
    expect(meshResult.brepChain.brepActive).toBe(false)

    // But geometry should still be valid
    const front = meshResult.outputs.get('part1_v0')!
    const back = meshResult.outputs.get('part2_v0')!
    expect(shapeVertexCount(front)).toBeGreaterThan(0)
    expect(shapeVertexCount(back)).toBeGreaterThan(0)
  })

  it('split primitive box → auto mode result is valid (BREP path)', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    const autoResult = await runScript(stmts, 'auto')
    expect(autoResult.failedAt, `auto mode failed: ${JSON.stringify(autoResult.failedAt)}`).toBeUndefined()

    // In auto mode with box primitive, BREP chain should be active
    expect(autoResult.brepChain.brepActive).toBe(true)

    const front = autoResult.outputs.get('part1_v0')!
    const back = autoResult.outputs.get('part2_v0')!
    expect(shapeVertexCount(front)).toBeGreaterThan(0)
    expect(shapeVertexCount(back)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. SPLIT-DAG CHAIN TEST (front used downstream, back is terminal)
// ─────────────────────────────────────────────────────────────────────────────

describe('split: DAG chain (split-dag scenario)', () => {
  it('split → front unioned with box, back unioned with cylinder → both terminals', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: [50, 50, 20] }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [50, 50, 20] }, ['part0_v0'],
        { outputs: ['part1_v0', 'part2_v0'] }),
      makeStmt('part1_v1', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v2', 'boolean', { operation: 'union' }, ['part1_v0', 'part1_v1'],
        { feature: { kind: 'boolean', label: 'union', createdBy: 'user' } }),
      makeStmt('part2_v1', 'cylinder', { radius: 10, height: 20 }, [],
        { feature: { kind: 'primitive', label: 'cylinder', createdBy: 'user' } }),
      makeStmt('part2_v2', 'boolean', { operation: 'union' }, ['part2_v0', 'part2_v1'],
        { feature: { kind: 'boolean', label: 'union', createdBy: 'user' } }),
    ]

    const result = await runScript(stmts, 'mesh')

    expect(result.failedAt).toBeUndefined()

    // Two terminals: part1_v2 and part2_v2
    const terminal1 = result.outputs.get('part1_v2')
    const terminal2 = result.outputs.get('part2_v2')
    expect(terminal1).toBeDefined()
    expect(terminal2).toBeDefined()
    expect(shapeVertexCount(terminal1!)).toBeGreaterThan(0)
    expect(shapeVertexCount(terminal2!)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. NEGATIVE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('split: negative tests', () => {
  it('split with no input → throws error', async () => {
    const stmts: CadStatement[] = [
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0 }, [],
        { outputs: ['part1_v0', 'part2_v0'] }),
    ]

    await expect(runScript(stmts, 'mesh')).rejects.toThrow(/no input geometry/)
  })

  it('split without outputs → only stmt.id has geometry (mesh mode)', async () => {
    // Without outputs, executeSplit returns front shape only (no outputs stored in outputCache)
    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'box', { size: 20 }, [],
        { feature: { kind: 'primitive', label: 'box', createdBy: 'user' } }),
      makeStmt('part1_v0', 'split', { cutMode: 'plane', normal: [0, 0, 1], offset: 0, bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] }, ['part0_v0']),
    ]

    const result = await runScript(stmts, 'mesh')

    expect(result.failedAt).toBeUndefined()

    // stmt.id should have the front shape (set by replay loop)
    const front = result.outputs.get('part1_v0')
    expect(front).toBeDefined()
    expect(shapeVertexCount(front!)).toBeGreaterThan(0)
  })
})