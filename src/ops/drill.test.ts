/**
 * @vitest-environment node
 *
 * Drill operation comprehensive tests.
 *
 * Tests:
 * 1. cad.drill basic: drill a box → result has more vertices than original
 * 2. executeDrill coordinate transform: world-space position with partTransform → correct local position
 * 3. replay (load + drill) with partTransform → geometry actually changes
 * 4. replay (load + drill) without partTransform → geometry changes (position already in local)
 *
 * Run: npx vitest run src/ops/drill.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { createRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { HostPorts, EventSink, AssetResolver } from '../cad-runtime/ports'
import { fileBlobStore } from '../test/blob-store'
import { cad } from '../mesh'
import type { Shape } from '../mesh/types'
import type { CadStatement, PartScript } from '../lang/types'
import { executeStatement } from './dispatcher'
import type { BrepChainState } from '../brep/brep-chain'

// ── Test fixtures ──

let stlBuffer: ArrayBuffer

beforeAll(async () => {
  await initOcctWasm()

  // Load cube-10x5x5.stl (mesh fixture, from test/fixtures/)
  const stlPath = resolve(__dirname, '..', '..', 'test', 'fixtures', 'cube-10x5x5.stl')
  const stlData = readFileSync(stlPath)
  stlBuffer = stlData.buffer.slice(stlData.byteOffset, stlData.byteOffset + stlData.byteLength) as ArrayBuffer
}, 120000)

beforeEach(() => {
  fileBlobStore.clear()
})

// ── Test helpers ──

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
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
    feature: { kind: 'drill', label: op, createdBy: 'user' },
    ...extra,
  }
}

function makePartScript(statements: CadStatement[]): PartScript {
  return { source: { kind: 'load' }, params: [], statements }
}

async function runScript(
  statements: CadStatement[],
  mode: 'mesh' | 'auto' = 'auto',
  opts?: { partTransform?: { position: [number, number, number] } },
): Promise<ExecutionResult> {
  const runtime = createRuntime(createTestPorts(), mode)
  return runtime.replay(makePartScript(statements), opts)
}

function shapeVertexCount(s: Shape): number { return s.positions.length / 3 }

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

// ─────────────────────────────────────────────────────────────────────────────
// 1. cad.drill BASIC — drill a box, verify geometry changes
// ─────────────────────────────────────────────────────────────────────────────

describe('drill: cad.drill basic', () => {
  it('drill through-hole on box → result has more vertices than original', async () => {
    const box = cad.box({ size: 20 })
    const vertsBefore = shapeVertexCount(box)

    // Box is centered at origin, top face at Z=10
    const result = await cad.drill(box, {
      diameter: 5,
      type: 'through',
      position: [0, 0, 10],     // top center of box
      direction: [0, 0, -1],    // drill downward
      faceNormal: [0, 0, 1],
    })

    const vertsAfter = shapeVertexCount(result)
    expect(vertsAfter).toBeGreaterThan(vertsBefore)
  })

  it('drill blind hole on box → result has more vertices than original', async () => {
    const box = cad.box({ size: 20 })
    const vertsBefore = shapeVertexCount(box)

    const result = await cad.drill(box, {
      diameter: 5,
      depth: 5,                 // blind hole, 5mm deep
      type: 'blind',
      position: [0, 0, 10],     // top center of box
      direction: [0, 0, -1],
      faceNormal: [0, 0, 1],
    })

    const vertsAfter = shapeVertexCount(result)
    expect(vertsAfter).toBeGreaterThan(vertsBefore)
  })

  it('drill at wrong position (outside box) → result equals original (no CSG effect)', async () => {
    const box = cad.box({ size: 20 })
    const vertsBefore = shapeVertexCount(box)

    // Position far outside the box — drill tool won't intersect
    const result = await cad.drill(box, {
      diameter: 5,
      type: 'through',
      position: [1000, 1000, 1000],
      direction: [0, 0, -1],
      faceNormal: [0, 0, 1],
    })

    const vertsAfter = shapeVertexCount(result)
    // When drill doesn't intersect, CSG subtract returns the original shape
    // (manifold-3d handles non-intersecting subtract gracefully)
    expect(vertsAfter).toBe(vertsBefore)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. executeDrill COORDINATE TRANSFORM — partTransform world→local
// ─────────────────────────────────────────────────────────────────────────────

describe('drill: executeDrill coordinate transform with partTransform', () => {
  it('with partTransform: world position is converted to local, drill hits the box', async () => {
    // Create a box primitive (local coordinates, centered at origin)
    const box = cad.box({ size: 20 })
    const vertsBefore = shapeVertexCount(box)

    // Simulate: mesh is centered at origin in local space,
    // but mesh.position = [-10, -5, 0] in world space (centering offset)
    // User clicks at world [0, 0, 10] (top center of the box in world space)
    // Local position = world - offset = [0-(-10), 0-(-5), 10-0] = [10, 5, 10]
    //
    // But actually, for a box centered at origin with size 20:
    //   local bbox: [-10, -10, -10] to [10, 10, 10]
    //   top face at local Z=10
    // If partTransform.position = [-10, -5, 0] (centering offset),
    //   world top center = local [0, 0, 10] + offset = [-10, -5, 10]
    // User clicks at world [-10, -5, 10]
    // Local = world - offset = [0, 0, 10] ← correct, hits top face

    const partTransform = { position: [-10, -5, 0] as [number, number, number] }
    const worldClickPos: [number, number, number] = [-10, -5, 10] // world space click

    // Build OpContext for drill
    const stmt = makeStmt('part1_v0', 'drill', {
      diameter: 5,
      depth: 0,                  // through hole
      holeType: 'simple',
      direction: 'normal',
      position: worldClickPos,   // world space position
      faceNormal: [0, 0, 1],
      tolerance: 0.3,
    }, ['part0_v0'])

    // Mesh mode: brepChain has no kernel (mesh mode)
    const brepChain: BrepChainState = {
      solidCache: new Map(),
      kernel: null,
      partTransform,
    }

    const result = await executeStatement(
      stmt,
      [box],
      new Map(),
      undefined,
      brepChain,
      undefined,
      'mesh',
    )

    const vertsAfter = shapeVertexCount(result)
    expect(vertsAfter).toBeGreaterThan(vertsBefore)
  })

  it('without partTransform: position used as-is (local), drill hits the box', async () => {
    const box = cad.box({ size: 20 })
    const vertsBefore = shapeVertexCount(box)

    // No partTransform — position is already in local coordinates
    const stmt = makeStmt('part1_v0', 'drill', {
      diameter: 5,
      depth: 0,
      holeType: 'simple',
      direction: 'normal',
      position: [0, 0, 10] as [number, number, number],  // local space
      faceNormal: [0, 0, 1],
      tolerance: 0.3,
    }, ['part0_v0'])

    // Mesh mode: brepChain has no kernel
    const brepChain: BrepChainState = {
      solidCache: new Map(),
      kernel: null,
    }

    const result = await executeStatement(
      stmt,
      [box],
      new Map(),
      undefined,
      brepChain,
      undefined,
      'mesh',
    )

    const vertsAfter = shapeVertexCount(result)
    expect(vertsAfter).toBeGreaterThan(vertsBefore)
  })

  it('with partTransform: large offset, world position correctly converted to local', async () => {
    const box = cad.box({ size: 20 })
    const vertsBefore = shapeVertexCount(box)

    // Box centered at origin locally. partTransform offset = [100, 100, 0].
    // User clicks at world [100, 100, 10] → local [0, 0, 10] (top center).
    const partTransform = { position: [100, 100, 0] as [number, number, number] }
    const worldClickPos: [number, number, number] = [100, 100, 10]

    const stmt = makeStmt('part1_v0', 'drill', {
      diameter: 5,
      depth: 0,
      holeType: 'simple',
      direction: 'normal',
      position: worldClickPos,
      faceNormal: [0, 0, 1],
      tolerance: 0.3,
    }, ['part0_v0'])

    const brepChain: BrepChainState = {
      solidCache: new Map(),
      kernel: null,
      partTransform,
    }

    const result = await executeStatement(
      stmt,
      [box],
      new Map(),
      undefined,
      brepChain,
      undefined,
      'mesh',
    )

    const vertsAfter = shapeVertexCount(result)
    // With correct conversion: position becomes [0, 0, 10] → drill hits → verts increase
    expect(vertsAfter).toBeGreaterThan(vertsBefore)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. REPLAY (load + drill) WITH partTransform — end-to-end mesh path
// ─────────────────────────────────────────────────────────────────────────────

describe('drill: replay (load STL → drill) with partTransform', () => {
  it('load STL → drill with partTransform → geometry changes', async () => {
    const bufferKey = fileBlobStore.put(stlBuffer)

    // cube-10x5x5.stl is a 10×5×5 box. Let's find its bbox first.
    const box = await cad.load(stlBuffer, 'stl')
    const bb = computeBBox(box.positions)
    const center: [number, number, number] = [
      (bb.min[0] + bb.max[0]) / 2,
      (bb.min[1] + bb.max[1]) / 2,
      (bb.min[2] + bb.max[2]) / 2,
    ]
    // Top face Z = bb.max[2]
    const topZ = bb.max[2]

    // Simulate centering offset: mesh.position = [-center.x, -center.y, 0]
    const partTransform = { position: [-center[0], -center[1], 0] as [number, number, number] }

    // User clicks at world [0, 0, topZ] (top center in world after centering)
    // Local = world - offset = [center.x, center.y, topZ] ← correct top center in local
    const worldClickPos: [number, number, number] = [0, 0, topZ]

    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'load', { key: bufferKey, format: 'stl' }, [],
        { feature: { kind: 'load', label: 'load', createdBy: 'user' } }),
      makeStmt('part1_v0', 'drill', {
        diameter: 2,
        depth: 0,               // through hole
        holeType: 'simple',
        direction: 'normal',
        position: worldClickPos, // world space
        faceNormal: [0, 0, 1],
        tolerance: 0.3,
      }, ['part0_v0']),
    ]

    const result = await runScript(stmts, 'mesh', { partTransform })

    expect(result.failedAt).toBeUndefined()

    const drilledShape = result.outputs.get('part1_v0')
    expect(drilledShape, 'drilled shape must be in outputCache').toBeDefined()

    const vertsBefore = shapeVertexCount(box)
    const vertsAfter = shapeVertexCount(drilledShape!)
    expect(vertsAfter).toBeGreaterThan(vertsBefore)
  })

  it('load STL → drill WITHOUT partTransform (position in local) → geometry changes', async () => {
    const bufferKey = fileBlobStore.put(stlBuffer)

    const box = await cad.load(stlBuffer, 'stl')
    const bb = computeBBox(box.positions)
    const center: [number, number, number] = [
      (bb.min[0] + bb.max[0]) / 2,
      (bb.min[1] + bb.max[1]) / 2,
      (bb.min[2] + bb.max[2]) / 2,
    ]
    const topZ = bb.max[2]

    // No partTransform — position directly in local coordinates
    const localClickPos: [number, number, number] = [center[0], center[1], topZ]

    const stmts: CadStatement[] = [
      makeStmt('part0_v0', 'load', { key: bufferKey, format: 'stl' }, [],
        { feature: { kind: 'load', label: 'load', createdBy: 'user' } }),
      makeStmt('part1_v0', 'drill', {
        diameter: 2,
        depth: 0,
        holeType: 'simple',
        direction: 'normal',
        position: localClickPos, // local space
        faceNormal: [0, 0, 1],
        tolerance: 0.3,
      }, ['part0_v0']),
    ]

    const result = await runScript(stmts, 'mesh')

    expect(result.failedAt).toBeUndefined()

    const drilledShape = result.outputs.get('part1_v0')
    expect(drilledShape, 'drilled shape must be in outputCache').toBeDefined()

    const vertsBefore = shapeVertexCount(box)
    const vertsAfter = shapeVertexCount(drilledShape!)
    expect(vertsAfter).toBeGreaterThan(vertsBefore)
  })
})
