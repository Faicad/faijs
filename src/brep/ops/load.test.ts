/**
 * @vitest-environment node
 *
 * loadBrep + executeLoad unit tests.
 *
 * Tests the BREP-native STEP import path:
 * - loadBrep: imports STEP bytes via kernel.importStep → solid + display mesh
 * - executeLoad: BREP mode caches solid in brepChain.solidCache;
 *   mesh mode falls back to cad.load
 *
 * Run: npx vitest run src/brep/ops/load.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initOcctWasm, getKernel } from '../../occt-kernel/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import type { Shape } from './types'
import type { CadStatement, FeatureKind, PartScript } from '../../lang/types'
import { loadBrep } from '../brep-ops'
import { createRuntime, type ExecutionResult } from '../../cad-runtime/runtime'
import type { HostPorts, EventSink, AssetResolver } from '../../cad-runtime/ports'

let kernel: OcctKernel
let stepBuffer: ArrayBuffer      // test-model.step (2 solids)
let boxBossBuffer: ArrayBuffer   // box_boss.step (1 solid)

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
  // Load test-model.step (2 solids) for multi-solid tests
  const stepPath = resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'test-model.step')
  const data = readFileSync(stepPath)
  stepBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  // Load box_boss.step (1 solid) for single-solid regression tests (§8)
  const boxBossPath = resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'box_boss.step')
  const boxBossData = readFileSync(boxBossPath)
  boxBossBuffer = boxBossData.buffer.slice(boxBossData.byteOffset, boxBossData.byteOffset + boxBossData.byteLength) as ArrayBuffer
}, 120000)

// ── Test helpers ──

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: 'brep-chain-broken', detail: { partId: string; op: string; reason: string }): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

/**
 * Test AssetResolver — resolves by key via fileBlobStore.
 * Enables headless load({ key: bufferKey }) without browser model-store.
 */
function createTestAssets(): AssetResolver {
  return {
    resolveByKey: async (key: string) => {
      const { fileBlobStore } = await import('../../runtime/blob-store')
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

function createNodePorts(): HostPorts {
  return { events: new TestEventSink(), assets: createTestAssets() }
}

function makeStmt(
  id: string,
  op: string,
  args: Record<string, unknown>,
  inputs: string[] = [],
  featureKind?: FeatureKind,
): CadStatement {
  return {
    id, op,
    args: args as any,
    inputs,
    feature: { kind: featureKind ?? 'load', label: op, createdBy: 'user' },
  }
}

function shapeVertexCount(s: Shape): number { return s.positions.length / 3 }
function shapeTriangleCount(s: Shape): number { return s.indices.length / 3 }

function makePartScript(statements: CadStatement[], partId = 'test_part'): PartScript {
  return { partId, source: { kind: 'load' }, params: [], statements }
}

async function runScript(statements: CadStatement[]): Promise<ExecutionResult> {
  const runtime = createRuntime(createNodePorts())
  return runtime.replay(makePartScript(statements))
}

// ─── loadBrep ───

describe('loadBrep', () => {
  it('should import test-model.step (2 solids) as a Compound with 2 solid sub-shapes (not fused)', () => {
    const { solid, shape } = loadBrep(kernel, stepBuffer)

    // Solid should be defined
    expect(solid).toBeDefined()

    // Multi-solid STEP returns Compound (not fused) — I5: no merge
    const solidCount = kernel.getSubShapes(solid, 'solid').length
    expect(solidCount).toBe(2) // NOT 1 (would mean fused)

    // Shape should be a valid triangulated mesh
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(shapeTriangleCount(shape)).toBeGreaterThan(0)

    kernel.release(solid)
  })

  it('should produce a solid that exports as ADVANCED_FACE STEP', () => {
    const { solid } = loadBrep(kernel, stepBuffer)
    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    kernel.release(solid)
  })

  it('should throw on invalid buffer (not a STEP file)', () => {
    const invalidBuffer = new TextEncoder().encode('this is not a STEP file').buffer as ArrayBuffer
    expect(() => loadBrep(kernel, invalidBuffer)).toThrow()
  })
})

// ─── loadBrep: box_boss.step (single solid, §8 regression) ───

describe('loadBrep: box_boss.step (single solid)', () => {
  it('should import as a real Solid (unwrapped from Compound), isValid=true', () => {
    // §8.3-3: single solid should unwrap to solids[0] (real Solid, not Compound)
    const { solid, shape } = loadBrep(kernel, boxBossBuffer)

    expect(solid).toBeDefined()

    // Unwrapped real Solid — isValid returns true (unlike Compound wrapper)
    expect(kernel.isValid(solid)).toBe(true)

    // Exactly 1 solid sub-shape
    const solidCount = kernel.getSubShapes(solid, 'solid').length
    expect(solidCount).toBe(1)

    // Shape should be a valid triangulated mesh
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(shapeTriangleCount(shape)).toBeGreaterThan(0)

    kernel.release(solid)
  })

  it('should export as ADVANCED_FACE STEP (non-triangulated)', () => {
    const { solid } = loadBrep(kernel, boxBossBuffer)
    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    kernel.release(solid)
  })
})

// ─── executeLoad (BREP mode, via CadRuntime) ───

describe('executeLoad: BREP mode (via CadRuntime)', () => {
  it('should import STEP and cache solid in brepChain.solidCache', async () => {
    const { fileBlobStore } = await import('../../runtime/blob-store')
    const bufferKey = fileBlobStore.put(stepBuffer)
    const stmt = makeStmt('s1', 'load', { key: bufferKey, format: 'step' })

    const result = await runScript([stmt])

    // Should produce a valid display mesh
    const shape = result.outputs.get('s1')!
    expect(shape).toBeDefined()
    expect(shapeTriangleCount(shape)).toBeGreaterThan(0)

    // BREP chain should stay active
    expect(result.brepChain.brepActive).toBe(true)

    // Solid should be cached
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
    const solid = result.brepChain.solidCache.get('s1')!
    const solidCount = kernel.getSubShapes(solid, 'solid').length
    expect(solidCount).toBeGreaterThanOrEqual(1)

    // STEP export should contain ADVANCED_FACE
    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')

    fileBlobStore.release(bufferKey)
  })

  it('should throw when STEP data is invalid (no mesh fallback)', async () => {
    const { fileBlobStore } = await import('../../runtime/blob-store')
    const invalidBuffer = new TextEncoder().encode('invalid step data').buffer as ArrayBuffer
    const bufferKey = fileBlobStore.put(invalidBuffer)

    try {
      const stmt = makeStmt('s1', 'load', { key: bufferKey, format: 'step' })
      // format: 'step' → isCadFormat returns true → BREP path is tried
      // BREP path fails (invalid STEP data) → error propagates directly (no mesh fallback)
      await expect(runScript([stmt])).rejects.toThrow()
    } finally {
      fileBlobStore.release(bufferKey)
    }
  })
})

// ─── executeLoad → drill chain (BREP mode, via CadRuntime) ───

describe('executeLoad → drill: BREP chain propagation (via CadRuntime)', () => {
  it('should allow drilling on an imported STEP solid', async () => {
    const { fileBlobStore } = await import('../../runtime/blob-store')
    const bufferKey = fileBlobStore.put(stepBuffer)

    // Get bounding box from loaded solid to determine drill position
    const { solid: loadedSolid } = loadBrep(kernel, stepBuffer)
    const bb = kernel.getBoundingBox(loadedSolid, false)
    const centerX = (bb.xmin + bb.xmax) / 2
    const centerY = (bb.ymin + bb.ymax) / 2
    const maxZ = bb.zmax
    kernel.release(loadedSolid)

    const stmts = [
      makeStmt('s1', 'load', { key: bufferKey, format: 'step' }),
      makeStmt('s2', 'drill', {
        diameter: 2, depth: 0,
        position: [centerX, centerY, maxZ],
        direction: 'normal', faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
    ]
    const result = await runScript(stmts)

    // BREP chain should stay active
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s2')).toBe(true)

    // Output mesh should be valid
    const drillShape = result.outputs.get('s2')!
    expect(shapeVertexCount(drillShape)).toBeGreaterThan(0)

    // STEP export should contain ADVANCED_FACE
    const drilledSolid = result.brepChain.solidCache.get('s2')!
    const step = kernel.exportStep(drilledSolid)
    expect(step).toContain('ADVANCED_FACE')

    fileBlobStore.release(bufferKey)
  })

  it('box_boss.step: load + drill should keep BREP chain active and export ADVANCED_FACE', async () => {
    const { fileBlobStore } = await import('../../runtime/blob-store')
    const bufferKey = fileBlobStore.put(boxBossBuffer)

    // Get bounding box from loaded solid
    const { solid: loadedSolid } = loadBrep(kernel, boxBossBuffer)
    const bb = kernel.getBoundingBox(loadedSolid, false)
    const centerX = (bb.xmin + bb.xmax) / 2
    const centerY = (bb.ymin + bb.ymax) / 2
    const maxZ = bb.zmax
    kernel.release(loadedSolid)

    const stmts = [
      makeStmt('s1', 'load', { key: bufferKey, format: 'step' }),
      makeStmt('s2', 'drill', {
        diameter: 2, depth: 0,
        position: [centerX, centerY, maxZ],
        direction: 'normal', faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
    ]
    const result = await runScript(stmts)

    // BREP chain should stay active (box_boss is a valid single solid)
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s2')).toBe(true)

    // The loaded solid should be a real Solid (unwrapped), isValid=true
    const solid = result.brepChain.solidCache.get('s1')!
    expect(kernel.isValid(solid)).toBe(true)

    // Output mesh should be valid
    const drillShape = result.outputs.get('s2')!
    expect(shapeVertexCount(drillShape)).toBeGreaterThan(0)

    // STEP export should contain ADVANCED_FACE
    const drilledSolid = result.brepChain.solidCache.get('s2')!
    const step = kernel.exportStep(drilledSolid)
    expect(step).toContain('ADVANCED_FACE')

    fileBlobStore.release(bufferKey)
  })
})
