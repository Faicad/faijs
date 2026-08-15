/**
 * @vitest-environment node
 *
 * SDF operation comprehensive tests.
 *
 * sdf is mesh-only (MESH_ONLY_OPS). Tests:
 * 1. Static chain break verification
 * 2. Mesh path: sdf with simple sphere code → valid mesh
 * 3. Various box/resolution/params combinations
 * 4. Error handling
 *
 * Run: npx vitest run src/ops/sdf.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { createRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { EventSink } from '../cad-runtime/ports'
import { createNodePorts } from '../node-host'
import { MESH_ONLY_OPS } from '../brep/brep-chain'
import { ensureTestFontLoader } from '../brep/text/fontTestHelper'
import type { Shape } from './types'
import type { CadStatement, FeatureKind, PartScript } from '../lang/types'

beforeAll(async () => {
  await initOcctWasm()
  ensureTestFontLoader()
}, 120000)

// ── Test helpers ──

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: 'brep-chain-broken', detail: { partId: string; op: string; reason: string }): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
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
    feature: { kind: featureKind ?? 'sdf', label: op, createdBy: 'user' },
  }
}

function makePartScript(statements: CadStatement[]): PartScript {
  return { source: { kind: 'load' }, params: [], statements }
}

async function runScript(
  statements: CadStatement[],
  mode: 'mesh' | 'auto' = 'mesh',
): Promise<ExecutionResult> {
  const ports = createNodePorts()
  ports.events = new TestEventSink()
  const runtime = createRuntime(ports, mode)
  return runtime.replay(makePartScript(statements))
}

function shapeVertexCount(s: Shape): number { return s.positions.length / 3 }
function shapeTriangleCount(s: Shape): number { return s.indices.length / 3 }

function getFinalOutput(result: ExecutionResult, statements: CadStatement[]): Shape {
  const nonMarker = statements.filter(s => !s.isMarker)
  const last = nonMarker[nonMarker.length - 1]
  const shape = result.outputs.get(last.id)
  if (!shape) throw new Error(`No output for terminal statement "${last.id}"`)
  return shape
}

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

// SDF code must define a `sdf(x, y, z)` function (per compileSdf contract)
const SPHERE_SDF = `function sdf(x, y, z) {
  return 10 - Math.sqrt(x*x + y*y + z*z)
}`
const BOX_MINUS_SPHERE = `function sdf(x, y, z) {
  const box = Math.max(Math.abs(x) - 10, Math.abs(y) - 10, Math.abs(z) - 10)
  const sx = x - 5
  const sphere = 8 - Math.sqrt(sx*sx + y*y + z*z)
  return Math.max(box, -sphere)
}`

// ─── Static determination ───

describe('sdf: static chain break', () => {
  it('sdf is in MESH_ONLY_OPS', () => {
    expect(MESH_ONLY_OPS.has('sdf')).toBe(true)
  })

  it('sdf breaks BREP chain in auto mode', async () => {
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }, [], 'primitive'),
      makeStmt('s2', 'sdf', {
        code: SPHERE_SDF,
        box: [[-15, -15, -15], [15, 15, 15]],
        resolution: 2,
      }, ['s1']),
    ]

    const ports = createNodePorts()
    const sink = ports.events as any
    const runtime = createRuntime(ports, 'auto')

    try {
      await runtime.replay(makePartScript(stmts))
    } catch {
      // May throw in node if SDF backend unavailable
    }

    // Chain break event should have been emitted
    expect(sink.events.length).toBeGreaterThan(0)
    expect(sink.events[0].event).toBe('brep-chain-broken')
    expect(sink.events[0].detail.op).toBe('sdf')
  })
})

// ─── Mesh path (with real geometry) ───

describe('sdf: mesh path execution', () => {
  it('simple sphere SDF → valid mesh', async () => {
    const stmts = [
      makeStmt('s1', 'sdf', {
        code: SPHERE_SDF,
        box: [[-15, -15, -15], [15, 15, 15]],
        resolution: 2,
      }),
    ]

    const result = await runScript(stmts, 'mesh')
    expect(result.failedAt).toBeUndefined()

    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(shapeTriangleCount(shape)).toBeGreaterThan(0)

    // bbox should be within the SDF box bounds
    const bb = computeBBox(shape.positions)
    expect(bb.min[0]).toBeGreaterThanOrEqual(-15)
    expect(bb.max[0]).toBeLessThanOrEqual(15)
  })

  it('box minus sphere SDF → valid mesh', async () => {
    const stmts = [
      makeStmt('s1', 'sdf', {
        code: BOX_MINUS_SPHERE,
        box: [[-20, -20, -20], [20, 20, 20]],
        resolution: 2,
      }),
    ]

    const result = await runScript(stmts, 'mesh')
    expect(result.failedAt).toBeUndefined()

    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
  })

  it('SDF with params → valid mesh', async () => {
    const stmts = [
      makeStmt('s1', 'sdf', {
        code: 'function sdf(x, y, z) { return radius - Math.sqrt(x*x + y*y + z*z) }',
        box: [[-20, -20, -20], [20, 20, 20]],
        resolution: 2,
        params: { radius: 10 },
      }),
    ]

    const result = await runScript(stmts, 'mesh')
    expect(result.failedAt).toBeUndefined()

    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
  })
})

describe('sdf: resolution variations', () => {
  it('lower resolution → fewer vertices', async () => {
    const stmtsLow = [
      makeStmt('s1', 'sdf', {
        code: SPHERE_SDF,
        box: [[-15, -15, -15], [15, 15, 15]],
        resolution: 5,
      }),
    ]
    const stmtsHigh = [
      makeStmt('s1', 'sdf', {
        code: SPHERE_SDF,
        box: [[-15, -15, -15], [15, 15, 15]],
        resolution: 2,
      }),
    ]

    const resultLow = await runScript(stmtsLow, 'mesh')
    const resultHigh = await runScript(stmtsHigh, 'mesh')

    const shapeLow = getFinalOutput(resultLow, stmtsLow)
    const shapeHigh = getFinalOutput(resultHigh, stmtsHigh)

    // Lower resolution (larger cell) → fewer vertices
    expect(shapeVertexCount(shapeLow)).toBeLessThanOrEqual(shapeVertexCount(shapeHigh))
  })
})

describe('sdf: box bounds verification', () => {
  it('SDF mesh stays within box bounds', async () => {
    const boxMin = [-10, -10, -10] as [number, number, number]
    const boxMax = [10, 10, 10] as [number, number, number]

    const stmts = [
      makeStmt('s1', 'sdf', {
        code: SPHERE_SDF,
        box: [boxMin, boxMax],
        resolution: 2,
      }),
    ]

    const result = await runScript(stmts, 'mesh')
    expect(result.failedAt).toBeUndefined()

    const shape = getFinalOutput(result, stmts)
    const bb = computeBBox(shape.positions)

    // All vertices should be within the box
    for (let i = 0; i < 3; i++) {
      expect(bb.min[i]).toBeGreaterThanOrEqual(boxMin[i] - 0.1)
      expect(bb.max[i]).toBeLessThanOrEqual(boxMax[i] + 0.1)
    }
  })
})
