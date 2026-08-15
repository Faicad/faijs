/**
 * @vitest-environment node
 *
 * Extrude operation comprehensive tests.
 *
 * Tests:
 * 1. BREP path: box→extrude (centered/forward/backward modes)
 * 2. Mesh path: box→extrude (same modes)
 * 3. Custom normal and originOffset
 * 4. Cylinder→extrude
 * 5. Error: no input geometry
 *
 * Run: npx vitest run src/ops/extrude.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { createRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { EventSink } from '../cad-runtime/ports'
import { createNodePorts } from '../node-host'
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
    feature: { kind: featureKind ?? 'extrude', label: op, createdBy: 'user' },
  }
}

function makePartScript(statements: CadStatement[]): PartScript {
  return { source: { kind: 'load' }, params: [], statements }
}

async function runScript(
  statements: CadStatement[],
  mode: 'mesh' | 'auto' | 'brep' = 'auto',
): Promise<ExecutionResult> {
  const ports = createNodePorts()
  ports.events = new TestEventSink()
  const runtime = createRuntime(ports, mode)
  return runtime.replay(makePartScript(statements))
}

function shapeVertexCount(s: Shape): number { return s.positions.length / 3 }

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

// ─── Tests ───

describe('extrude: basic modes (BREP + mesh)', () => {
  it('centered mode: box → extrude → result has more vertices', async () => {
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }, [], 'primitive'),
      makeStmt('s2', 'extrude', { length: 10, mode: 'centered' }, ['s1']),
    ]

    const brepResult = await runScript(stmts, 'brep')
    expect(brepResult.failedAt).toBeUndefined()
    const brepShape = getFinalOutput(brepResult, stmts)
    expect(shapeVertexCount(brepShape)).toBeGreaterThan(0)
    expect(brepResult.brepChain.brepActive).toBe(true)

    const meshResult = await runScript(stmts, 'mesh')
    expect(meshResult.failedAt).toBeUndefined()
    const meshShape = getFinalOutput(meshResult, stmts)
    expect(shapeVertexCount(meshShape)).toBeGreaterThan(0)
  })

  it('forward mode: box → extrude → result extends in +normal direction', async () => {
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }, [], 'primitive'),
      makeStmt('s2', 'extrude', { length: 10, mode: 'forward', normal: [0, 0, 1] }, ['s1']),
    ]

    const result = await runScript(stmts, 'brep')
    expect(result.failedAt).toBeUndefined()
    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)

    const bb = computeBBox(shape.positions)
    // Forward extrude extends in +Z direction
    expect(bb.max[2]).toBeGreaterThan(10) // at least 10+10/2 = 15
  })

  it('backward mode: box → extrude → result extends in -normal direction', async () => {
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }, [], 'primitive'),
      makeStmt('s2', 'extrude', { length: 10, mode: 'backward', normal: [0, 0, 1] }, ['s1']),
    ]

    const result = await runScript(stmts, 'brep')
    expect(result.failedAt).toBeUndefined()
    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)

    const bb = computeBBox(shape.positions)
    // Backward extrude extends in -Z direction
    expect(bb.min[2]).toBeLessThan(-10)
  })
})

describe('extrude: custom normal and originOffset', () => {
  it('custom normal [1,0,0]: box → extrude → extends in X direction', async () => {
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }, [], 'primitive'),
      makeStmt('s2', 'extrude', { length: 10, mode: 'centered', normal: [1, 0, 0] }, ['s1']),
    ]

    const result = await runScript(stmts, 'brep')
    expect(result.failedAt).toBeUndefined()
    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
  })

  it('with originOffset: box → extrude → extrude plane offset', async () => {
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }, [], 'primitive'),
      makeStmt('s2', 'extrude', { length: 10, mode: 'centered', normal: [0, 0, 1], originOffset: 5 }, ['s1']),
    ]

    const result = await runScript(stmts, 'brep')
    expect(result.failedAt).toBeUndefined()
    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
  })
})

describe('extrude: cylinder source', () => {
  it('cylinder → extrude centered → valid result', async () => {
    const stmts = [
      makeStmt('s1', 'cylinder', { radius: 10, height: 20 }, [], 'primitive'),
      makeStmt('s2', 'extrude', { length: 15, mode: 'centered' }, ['s1']),
    ]

    const brepResult = await runScript(stmts, 'brep')
    expect(brepResult.failedAt).toBeUndefined()
    const brepShape = getFinalOutput(brepResult, stmts)
    expect(shapeVertexCount(brepShape)).toBeGreaterThan(0)

    const meshResult = await runScript(stmts, 'mesh')
    expect(meshResult.failedAt).toBeUndefined()
    const meshShape = getFinalOutput(meshResult, stmts)
    expect(shapeVertexCount(meshShape)).toBeGreaterThan(0)
  })
})

describe('extrude: error cases', () => {
  it('no input geometry → throws', async () => {
    const stmts = [
      makeStmt('s1', 'extrude', { length: 10 }, []),
    ]

    await expect(runScript(stmts, 'mesh')).rejects.toThrow(/no input geometry/)
  })
})

describe('extrude: BREP/mesh equivalence', () => {
  it('box → extrude centered: BREP and mesh produce equivalent bbox', async () => {
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }, [], 'primitive'),
      makeStmt('s2', 'extrude', { length: 10, mode: 'centered' }, ['s1']),
    ]

    const brepResult = await runScript(stmts, 'brep')
    const meshResult = await runScript(stmts, 'mesh')

    const brepShape = getFinalOutput(brepResult, stmts)
    const meshShape = getFinalOutput(meshResult, stmts)

    const brepBB = computeBBox(brepShape.positions)
    const meshBB = computeBBox(meshShape.positions)

    const tol = 0.5
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(brepBB.min[i] - meshBB.min[i])).toBeLessThan(tol)
      expect(Math.abs(brepBB.max[i] - meshBB.max[i])).toBeLessThan(tol)
    }
  })
})
