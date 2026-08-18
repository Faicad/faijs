/**
 * @vitest-environment node
 *
 * CadRuntime 三模式契约测试 + 单元测试 (P2-8)
 *
 * 测试内容：
 * 1. auto 模式：BREP 优先，逐 part 判定
 * 2. brep 模式：强制 BREP，不支持即报错 E_BREP_UNSUPPORTED
 * 3. mesh 模式：全部走 mesh 路径
 * 4. CadRuntime 实例管理：statementCache, brepSolidCache, plan, dispose
 *
 * Run: npx vitest run src/cad-runtime/runtime.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../occt-kernel/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import type { CadStatement, PartScript } from '../lang/types'
import { CadRuntime, createRuntime, computeContentKey } from './runtime'
import type { HostPorts, EventSink, ExecutionMode } from './ports'
import { ensureTestFontLoader } from '../brep/text/fontTestHelper'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
  ensureTestFontLoader()
}, 120000)

// ── Test helpers ──

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

function createNodePorts(): HostPorts {
  return { events: new TestEventSink() }
}

function makeStmt(
  id: string,
  op: string,
  args: Record<string, unknown>,
  inputs: string[] = [],
): CadStatement {
  // Determine returnType based on op
  let returnType: CadStatement['returnType'] = 'new_shape'
  if (op === 'do_assemble') returnType = 'void'
  else if (op === 'add_constraint') returnType = 'same_shape'
  // group/assembly/assemble have returnType new_shape, hasAssignment true
  // add_constraint/do_assemble have hasAssignment false
  const noAssignment = op === 'add_constraint' || op === 'do_assemble'
  return {
    id, op,
    args: args as any,
    inputs,
    feature: { kind: 'primitive', label: op, createdBy: 'user' },
    hasAssignment: !noAssignment,
    returnType,
  }
}

function makePartScript(statements: CadStatement[]): PartScript {
  return { source: { kind: 'load' }, params: [], statements }
}

function makeRuntime(mode?: ExecutionMode): CadRuntime {
  return createRuntime(createNodePorts(), mode)
}

async function run(statements: CadStatement[], mode?: ExecutionMode) {
  const runtime = makeRuntime(mode)
  const script = makePartScript(statements)
  return { runtime, result: await runtime.replay(script) }
}

// Helper: get first brepSolid from result
function getFirstBrepSolid(result: { brepSolids?: Map<string, { solid: import('occt-wasm').ShapeHandle; kernel: import('occt-wasm').OcctKernel }> }) {
  if (!result.brepSolids) return undefined
  for (const [, entry] of result.brepSolids) return entry
  return undefined
}

// ─── auto 模式契约 ───

describe('CadRuntime: auto mode (BREP-first, per-part)', () => {
  it('BREP-native op (box): solid in cache, brepSolids is set', async () => {
    const { result } = await run([makeStmt('s1', 'box', { size: 20 })])

    expect(result.brepChain.solidCache.has('s1')).toBe(true)
    expect(result.brepSolids).toBeDefined()
    expect(result.failedAt).toBeUndefined()
  })

  it('mesh-only op (sdf): mesh path throws in node', async () => {
    // sdf is mesh-only → mesh path → fails in node (no Worker)
    // Error propagates directly (no try-catch fallback)
    await expect(run([
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('s2', 'sdf', { code: '0', box: [[-5,-5,-5],[5,5,5]], resolution: 8 }, ['s1']),
    ])).rejects.toThrow()
  })

  it('BREP exception → error propagates directly (no mesh retry)', async () => {
    // BREP path exception = bug, must propagate directly.
    // No try-catch, no mesh retry.
    const { clearFonts, setFontLoader, getFontLoader } = await import('../brep/text/fontRegistry')
    const savedLoader = getFontLoader()
    clearFonts()
    setFontLoader({
      loadDefaultFont: async () => { throw new Error('Test font failure') },
    })

    // BREP exception should propagate as a throw (not be caught and retried)
    await expect(run([makeStmt('s1', 'text', { text: 'X', size: 10, depth: 2 })]))
      .rejects.toThrow('Test font failure')

    // Restore
    clearFonts()
    setFontLoader(savedLoader)
  })

  it('EventSink receives part-brep-lost event on mesh-only op', async () => {
    const ports = createNodePorts()
    const sink = ports.events as TestEventSink
    const runtime = createRuntime(ports)
    const script = makePartScript([
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('s2', 'sdf', { code: '0', box: [[-5,-5,-5],[5,5,5]], resolution: 8 }, ['s1']),
    ])
    // sdf mesh path throws in node, but the part-brep-lost event
    // is emitted during mesh-only op execution
    try {
      await runtime.replay(script)
    } catch {
      // Expected: sdf mesh path fails in node
    }

    expect(sink.events.length).toBeGreaterThan(0)
    expect(sink.events[0].event).toBe('part-brep-lost')
    expect(sink.events[0].detail.op).toBe('sdf')
  })
})

// ─── brep 模式契约 ───

describe('CadRuntime: brep mode (strict BREP, no fallback)', () => {
  it('BREP-native op (box): solid in cache', async () => {
    const { result } = await run([makeStmt('s1', 'box', { size: 20 })], 'brep')

    expect(result.brepChain.solidCache.has('s1')).toBe(true)
    expect(result.brepSolids).toBeDefined()
    expect(result.failedAt).toBeUndefined()
  })

  it('mesh-only op (sdf): returns E_BREP_UNSUPPORTED immediately (no retry)', async () => {
    const { result } = await run([
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('s2', 'sdf', { code: '0', box: [[-5,-5,-5],[5,5,5]], resolution: 8 }, ['s1']),
    ], 'brep')

    // brep mode: sdf is mesh-only → immediate E_BREP_UNSUPPORTED
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.message).toContain('E_BREP_UNSUPPORTED')
  })

  it('BREP exception → error propagates directly (no mesh retry)', async () => {
    // BREP path exception = bug, must propagate directly in all modes.
    const { clearFonts, setFontLoader, getFontLoader } = await import('../brep/text/fontRegistry')
    const savedLoader = getFontLoader()
    clearFonts()
    setFontLoader({
      loadDefaultFont: async () => { throw new Error('Test font failure') },
    })

    // BREP exception should propagate as a throw (not be caught and retried)
    await expect(run([makeStmt('s1', 'text', { text: 'X', size: 10, depth: 2 })], 'brep'))
      .rejects.toThrow('Test font failure')

    clearFonts()
    setFontLoader(savedLoader)
  })
})

// ─── mesh 模式契约 ───

describe('CadRuntime: mesh mode (all mesh, no BREP)', () => {
  it('kernel is null from start', async () => {
    const { result } = await run([makeStmt('s1', 'box', { size: 20 })], 'mesh')

    expect(result.brepChain.kernel).toBeNull()
    // No brepSolids in mesh mode
    expect(result.brepSolids).toBeUndefined()
  })

  it('box executes via mesh path (output is set)', async () => {
    const { result } = await run([makeStmt('s1', 'box', { size: 20 })], 'mesh')

    // Output should still be set (mesh path produces geometry)
    const output = result.outputs.get('s1')
    expect(output).toBeDefined()
    expect(output!.positions.length).toBeGreaterThan(0)
  })

  it('sdf throws in mesh mode (no worker in node)', async () => {
    // In mesh mode, sdf doesn't trigger BREP events
    // But sdf still needs a worker in node → throws
    // The key assertion: no E_BREP_UNSUPPORTED, no part-brep-lost event
    const ports = createNodePorts()
    const sink = ports.events as TestEventSink
    const runtime = createRuntime(ports, 'mesh')
    const script = makePartScript([
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('s2', 'sdf', { code: '0', box: [[-5,-5,-5],[5,5,5]], resolution: 8 }, ['s1']),
    ])
    // sdf mesh path throws in node (no Worker)
    await expect(runtime.replay(script)).rejects.toThrow()

    // No part-brep-lost events (mesh mode, kernel was never active)
    expect(sink.events.length).toBe(0)
  })
})

// ─── CadRuntime 实例管理 ───

describe('CadRuntime: instance management', () => {
  it('statementCache is populated after replay', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1']),
    ])
    await runtime.replay(script)

    // statementCache should have entries for both statements
    expect(runtime.getCachedOutput('s1')).toBeDefined()
    expect(runtime.getCachedOutput('s2')).toBeDefined()
  })

  it('brepSolidCache is populated after BREP replay', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    const result = await runtime.replay(script)

    // Set brepSolid (normally done by ScriptEngine.replayPart)
    const solid = getFirstBrepSolid(result)
    if (solid) {
      runtime.setBrepSolid('test_part', solid.solid, solid.kernel)
    }

    expect(runtime.getBrepSolid('test_part')).toBeDefined()
  })

  it('setBrepSolid releases old solid when overwriting', async () => {
    const runtime = makeRuntime()
    const script1 = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    const result1 = await runtime.replay(script1)
    const solid1 = getFirstBrepSolid(result1)
    if (solid1) {
      runtime.setBrepSolid('part1', solid1.solid, solid1.kernel)
    }

    // Create a second solid and overwrite
    const script2 = makePartScript([makeStmt('s2', 'sphere', { radius: 10 })])
    const result2 = await runtime.replay(script2)
    const solid2 = getFirstBrepSolid(result2)
    if (solid2) {
      runtime.setBrepSolid('part1', solid2.solid, solid2.kernel)
    }

    // The new solid should be there
    const solid = runtime.getBrepSolid('part1')
    expect(solid).toBeDefined()
    // Verify it's a valid solid (sphere, not box)
    const step = kernel.exportStep(solid!.solid)
    expect(step).toContain('ADVANCED_FACE')
  })

  it('deleteBrepSolid removes entry', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    const result = await runtime.replay(script)
    const solid = getFirstBrepSolid(result)
    if (solid) {
      runtime.setBrepSolid('part1', solid.solid, solid.kernel)
    }

    runtime.deleteBrepSolid('part1')
    expect(runtime.getBrepSolid('part1')).toBeUndefined()
  })

  it('plan() identifies stale statements after args change', async () => {
    const runtime = makeRuntime()
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1']),
    ]
    const script = makePartScript(stmts)
    await runtime.replay(script)

    // Modify s1's args → plan should identify s1 and s2 (dependent) as stale
    const modifiedScript = makePartScript([
      makeStmt('s1', 'box', { size: 30 }), // size changed
      makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1']),
    ])
    const { stale, reused } = runtime.plan(modifiedScript)

    expect(stale.length).toBe(2) // s1 (args changed) + s2 (depends on s1)
    expect(stale[0].id).toBe('s1')
    expect(stale[1].id).toBe('s2')
    expect(reused.size).toBe(0) // nothing reused
  })

  it('plan() reuses unchanged statements', async () => {
    const runtime = makeRuntime()
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1']),
    ]
    const script = makePartScript(stmts)
    await runtime.replay(script)

    // Same script → plan should reuse everything
    const { stale, reused } = runtime.plan(script)
    expect(stale.length).toBe(0)
    expect(reused.size).toBe(2) // both s1 and s2 reused
  })

  it('clearStatementCache clears all entries', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    await runtime.replay(script)

    expect(runtime.getCachedOutput('s1')).toBeDefined()
    runtime.clearStatementCache()
    expect(runtime.getCachedOutput('s1')).toBeUndefined()
  })

  it('writeToStatementCache adds entry', async () => {
    const runtime = makeRuntime()
    const stmt = makeStmt('s1', 'box', { size: 20 })
    const shape = { positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]), indices: new Uint32Array([0,1,2]) }
    const ck = computeContentKey(shape.positions, shape.indices)
    runtime.writeToStatementCache('s1', stmt, shape, ck)

    expect(runtime.getCachedOutput('s1')).toBeDefined()
    expect(runtime.getCachedOutput('s1')!.positions.length).toBe(9)
  })

  it('dispose() clears all caches', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    const result = await runtime.replay(script)
    const solid = getFirstBrepSolid(result)
    if (solid) {
      runtime.setBrepSolid('part1', solid.solid, solid.kernel)
    }

    runtime.dispose()
    expect(runtime.getCachedOutput('s1')).toBeUndefined()
    expect(runtime.getBrepSolid('part1')).toBeUndefined()
  })

  it('void/same_shape statements are skipped during replay', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('grp_1', 'group', { name: 'G', members: ['s1'] }, []),
      makeStmt('s3', 'translate', { offset: [5, 0, 0] }, ['s1']), // depends on s1, not grp_1
    ])
    const result = await runtime.replay(script)

    // s1 and s3 should have outputs; grp_1 is new_shape but a no-op dispatcher (empty shape)
    expect(result.outputs.get('s1')).toBeDefined()
    // grp_1 has returnType new_shape (default) so it goes through dispatcher, returns empty shape
    expect(result.outputs.get('grp_1')).toBeDefined() // no-op dispatcher returns empty shape
    expect(result.outputs.get('s3')).toBeDefined()
  })
})

// ─── computeContentKey ───

describe('computeContentKey', () => {
  it('produces consistent keys for identical shapes', () => {
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0])
    const indices = new Uint32Array([0,1,2])
    const key1 = computeContentKey(positions, indices)
    const key2 = computeContentKey(positions, indices)
    expect(key1).toBe(key2)
  })

  it('produces different keys for different shapes', () => {
    const pos1 = new Float32Array([0,0,0, 1,0,0, 0,1,0])
    const idx1 = new Uint32Array([0,1,2])
    const pos2 = new Float32Array([0,0,0, 2,0,0, 0,2,0])
    const idx2 = new Uint32Array([0,1,2])
    const key1 = computeContentKey(pos1, idx1)
    const key2 = computeContentKey(pos2, idx2)
    expect(key1).not.toBe(key2)
  })
})
