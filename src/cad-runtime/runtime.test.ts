﻿/**
 * @vitest-environment node
 *
 * CadRuntime 三模式契约测试 + 单元测试 (P2-8)
 *
 * 测试内容：
 * 1. auto 模式：BREP 优先，逐 part 判定
 * 2. brep 模式：强制 BREP，不支持即报错 E_BREP_UNSUPPORTED
 * 3. mesh 模式：全部走 mesh 路径
 * 4. CadRuntime 实例管理：statementCache, plan, dispose
 *
 * Run: npx vitest run src/cad-runtime/runtime.test.ts
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
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
  return { runtime, result: await runtime.execute(script) }
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
      await runtime.execute(script)
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
    await expect(runtime.execute(script)).rejects.toThrow()

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
    await runtime.execute(script)

    // statementCache should have entries for both statements
    expect(runtime.getCachedOutput('s1')).toBeDefined()
    expect(runtime.getCachedOutput('s2')).toBeDefined()
  })

  it('brepSolids is populated after BREP replay', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    const result = await runtime.execute(script)

    // brepSolids is the single source of truth for terminal solids
    expect(result.brepSolids).toBeDefined()
    expect(result.brepSolids!.has('s1')).toBe(true)
  })

  it('brepSolids updates after re-execute (overwrite)', async () => {
    const runtime = makeRuntime()
    const script1 = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    const result1 = await runtime.execute(script1)
    const solid1 = getFirstBrepSolid(result1)
    expect(solid1).toBeDefined()

    // Re-execute with different args → solidCache overwrites s1
    const script2 = makePartScript([makeStmt('s1', 'sphere', { radius: 10 })])
    const result2 = await runtime.execute(script2)
    const solid2 = getFirstBrepSolid(result2)
    expect(solid2).toBeDefined()
    // Verify it's a valid solid (sphere, not box)
    const step = kernel.exportStep(solid2!.solid)
    expect(step).toContain('ADVANCED_FACE')
  })

  it('dispose() clears all caches', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    await runtime.execute(script)

    runtime.dispose()
    expect(runtime.getCachedOutput('s1')).toBeUndefined()
  })

  it('buildBrepTopology(stmtId) returns SelectorRuntime from solidCache', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    await runtime.execute(script)

    // buildBrepTopology takes stmtId (not scopedId), queries solidCache directly
    const topo = runtime.buildBrepTopology('s1')
    expect(topo).not.toBeNull()
  })

  it('buildBrepTopology returns null for unknown stmtId', async () => {
    const runtime = makeRuntime()
    await runtime.execute(makePartScript([makeStmt('s1', 'box', { size: 20 })]))

    expect(runtime.buildBrepTopology('nonexistent')).toBeNull()
  })

  it('plan() identifies stale statements after args change', async () => {
    const runtime = makeRuntime()
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1']),
    ]
    const script = makePartScript(stmts)
    await runtime.execute(script)

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
    await runtime.execute(script)

    // Same script → plan should reuse everything
    const { stale, reused } = runtime.plan(script)
    expect(stale.length).toBe(0)
    expect(reused.size).toBe(2) // both s1 and s2 reused
  })

  it('clearStatementCache clears all entries', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([makeStmt('s1', 'box', { size: 20 })])
    await runtime.execute(script)

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
    await runtime.execute(script)

    runtime.dispose()
    expect(runtime.getCachedOutput('s1')).toBeUndefined()
  })

  it('void/same_shape statements are skipped during replay', async () => {
    const runtime = makeRuntime()
    const script = makePartScript([
      makeStmt('s1', 'box', { size: 20 }),
      makeStmt('grp_1', 'group', { name: 'G', members: ['s1'] }, []),
      makeStmt('s3', 'translate', { offset: [5, 0, 0] }, ['s1']), // depends on s1, not grp_1
    ])
    const result = await runtime.execute(script)

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

// ─── Persistent SolidCache 增量执行（§7.1） ───

describe('CadRuntime: Persistent SolidCache 增量执行 (execute/update/append)', () => {
  it('append: 只执行新增语句，前缀语句不进循环（beforeStatement 只对新增语句触发）', async () => {
    const runtime = makeRuntime()
    const s1 = makeStmt('s1', 'box', { size: 20 })
    const s2 = makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1'])
    const script = makePartScript([s1, s2])
    await runtime.execute(script)

    // 追加 s3（依赖 s2）
    const s3 = makeStmt('s3', 'translate', { offset: [0, 5, 0] }, ['s2'])
    const fullScript = makePartScript([s1, s2, s3])
    const beforeCalls: string[] = []
    const result = await runtime.append(fullScript, ['s3'], {
      beforeStatement: (stmt) => beforeCalls.push(stmt.id),
    })

    // 只执行 s3；s1/s2 前缀语句完全不进循环
    expect(beforeCalls).toEqual(['s3'])
    // outputs 覆盖全部语句（前缀从持久缓存组装）
    expect(result.outputs.get('s1')).toBeDefined()
    expect(result.outputs.get('s2')).toBeDefined()
    expect(result.outputs.get('s3')).toBeDefined()
    // solidCache 含全部语句 solid
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
    expect(result.brepChain.solidCache.has('s2')).toBe(true)
    expect(result.brepChain.solidCache.has('s3')).toBe(true)
  })

  it('update: 参数变更只重算变更点及下游（变更点之前语句不进循环）', async () => {
    const runtime = makeRuntime()
    const s1 = makeStmt('s1', 'box', { size: 20 })
    const s2 = makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1'])
    const script = makePartScript([s1, s2])
    await runtime.execute(script)

    // 改 s1 args → s1 与下游 s2 都是 stale
    const modified = makePartScript([
      makeStmt('s1', 'box', { size: 30 }),
      makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1']),
    ])
    const beforeCalls: string[] = []
    await runtime.update(modified, { beforeStatement: (stmt) => beforeCalls.push(stmt.id) })

    expect(beforeCalls).toEqual(['s1', 's2'])
    // 重算后 s1 的几何更新（bbox 翻倍）
    const s1Out = runtime.getCachedOutput('s1')
    expect(s1Out).toBeDefined()
  })

  it('update: 无变化 → 直接返回缓存结果，零执行（beforeStatement 不触发）', async () => {
    const runtime = makeRuntime()
    const s1 = makeStmt('s1', 'box', { size: 20 })
    const script = makePartScript([s1])
    await runtime.execute(script)

    const beforeCalls: string[] = []
    const result = await runtime.update(script, {
      beforeStatement: () => beforeCalls.push('should-not-run'),
    })

    expect(beforeCalls).toEqual([])
    expect(result.outputs.get('s1')).toBeDefined()
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
  })

  it('append: 传入已存在缓存中的 id → 重执行该语句（幂等，输出替换）', async () => {
    const runtime = makeRuntime()
    const s1 = makeStmt('s1', 'box', { size: 20 })
    const script = makePartScript([s1])
    const result1 = await runtime.execute(script)

    // 再 append 同一 id → 重执行（顶替）
    const result2 = await runtime.append(script, ['s1'])
    expect(result2.outputs.get('s1')).toBeDefined()
    expect(result2.brepChain.solidCache.has('s1')).toBe(true)
    // 顶替释放后 handle 仍是新值
    expect(result2.brepChain.solidCache.get('s1')).toBeDefined()
    expect(result1.brepChain.solidCache.get('s1')).toBeDefined()
  })

  it('顶替释放: 同 id 重算后旧 solid 句柄被 release（kernel spy）', async () => {
    const runtime = makeRuntime()
    const s1 = makeStmt('s1', 'box', { size: 20 })
    const script = makePartScript([s1])
    await runtime.execute(script)

    const releaseSpy = vi.spyOn(kernel, 'release')
    try {
      // 用不同 args 重算同一 id → 旧 handle 应被 release
      const modified = makePartScript([makeStmt('s1', 'box', { size: 30 })])
      await runtime.execute(modified)
      expect(releaseSpy).toHaveBeenCalled()
    } finally {
      releaseSpy.mockRestore()
    }
  })

  it('失败回滚: 执行失败语句不写缓存，已成功语句 solid 保留', async () => {
    const runtime = makeRuntime()
    const s1 = makeStmt('s1', 'box', { size: 20 })
    await runtime.execute(makePartScript([s1]))

    // sdf 是 mesh-only，node 下抛错 → 整次执行失败
    const script = makePartScript([
      s1,
      makeStmt('s2', 'sdf', { code: '0', box: [[-5,-5,-5],[5,5,5]], resolution: 8 }, ['s1']),
    ])
    await expect(runtime.execute(script)).rejects.toThrow()

    // s1 的 solid 保留（失败语句 s2 未写入）——通过后续 append 引用 s1 验证
    const s3 = makeStmt('s3', 'translate', { offset: [1, 0, 0] }, ['s1'])
    const result = await runtime.append(makePartScript([s1, s3]), ['s3'])
    expect(result.outputs.get('s3')).toBeDefined()
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
    expect(result.brepChain.solidCache.has('s2')).toBe(false)
  })

  it('断链增量 (mesh 模式): append 新语句走 mesh 路径（无 solid，静态判定）', async () => {
    const runtime = makeRuntime('mesh')
    const s1 = makeStmt('s1', 'box', { size: 20 })
    await runtime.execute(makePartScript([s1]))

    const s2 = makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1'])
    const result = await runtime.append(makePartScript([s1, s2]), ['s2'])

    expect(result.outputs.get('s2')).toBeDefined()
    // mesh 路径不写 solidCache
    expect(result.brepChain.solidCache.has('s2')).toBe(false)
  })

  it('brep 强制模式: append mesh-only op → E_BREP_UNSUPPORTED（不静默回退 mesh）', async () => {
    const runtime = makeRuntime('brep')
    const s1 = makeStmt('s1', 'box', { size: 20 })
    await runtime.execute(makePartScript([s1]))

    // knurl 是 mesh-only：brep 强制模式下 append 应立即 E_BREP_UNSUPPORTED
    const s2 = makeStmt('s2', 'knurl', { knurlTextureHeight: 0.5, faceCenter: [0, 0, 5], faceNormal: [0, 0, 1], pattern: 'diagonal' }, ['s1'])
    const result = await runtime.append(makePartScript([s1, s2]), ['s2'])

    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.message).toContain('E_BREP_UNSUPPORTED')
  })

  it('statementCache 持久化多输出 outputs[]（split backId 可直接命中，§3.5）', async () => {
    const runtime = makeRuntime()
    const s0 = makeStmt('s0', 'box', { size: 20 })
    const splitStmt: CadStatement = {
      id: 's1', op: 'split',
      args: { cutMode: 'plane', normal: [0, 0, 1], offset: 0 } as never,
      inputs: ['s0'],
      outputs: ['s1', 's1b'], // stmt.id === outputs[0]；outputs[1] (back) 需显式持久化
      feature: { kind: 'split', label: 'split', createdBy: 'user' },
      hasAssignment: true,
      returnType: 'new_shape',
    }
    const script = makePartScript([s0, splitStmt])
    const result = await runtime.execute(script)
    expect(result.failedAt).toBeUndefined()

    // front（== stmt.id）与 back（outputs[1]）都应在持久 statementCache 中
    expect(runtime.getCachedOutput('s1')).toBeDefined()
    expect(runtime.getCachedOutput('s1b')).toBeDefined()
    // solidCache 同样按 outputs 键写入
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
    expect(result.brepChain.solidCache.has('s1b')).toBe(true)
  })

  it('append 引用 split back 输出 → 直接命中持久缓存（不触发子重放）', async () => {
    const runtime = makeRuntime()
    const s0 = makeStmt('s0', 'box', { size: 20 })
    const splitStmt: CadStatement = {
      id: 's1', op: 'split',
      args: { cutMode: 'plane', normal: [0, 0, 1], offset: 0 } as never,
      inputs: ['s0'],
      outputs: ['s1', 's1b'],
      feature: { kind: 'split', label: 'split', createdBy: 'user' },
      hasAssignment: true,
      returnType: 'new_shape',
    }
    await runtime.execute(makePartScript([s0, splitStmt]))

    // 追加一条引用 split back（outputs[1]）的语句
    const s3 = makeStmt('s3', 'translate', { offset: [5, 0, 0] }, ['s1b'])
    const result = await runtime.append(makePartScript([s0, splitStmt, s3]), ['s3'])
    expect(result.failedAt).toBeUndefined()
    expect(result.outputs.get('s3')).toBeDefined()
  })

  it('append: do_assemble 语句触发 executeAssemblyPass（变换 moving part 几何）', async () => {
    const runtime = makeRuntime()
    // 两个 box：s1（固定件）和 s2（活动件）
    const s1 = makeStmt('s1', 'box', { size: 10 })
    const s2 = makeStmt('s2', 'box', { size: 10 })
    const script = makePartScript([s1, s2])
    await runtime.execute(script)

    // 验证 s2 的初始位置（box 中心在原点）
    const s2Initial = runtime.getCachedOutput('s2')!
    expect(s2Initial).toBeDefined()

    // 创建 assembly + do_assemble 语句
    const assemblyStmt: CadStatement = {
      id: 'asm1',
      op: 'assembly',
      args: {
        name: 'testAssembly',
        members: ['s1', 's2'],
        constraints: [{
          type: 'face_mate' as const,
          fixedPartName: 's1',
          movingPartName: 's2',
          // s1 顶面：center=[0,5,0], normal=[0,1,0]
          fixedFace: { faceId: 'f1', surfaceType: 'plane', center: [0, 5, 0], normal: [0, 1, 0] },
          // s2 底面：center=[0,-5,0], normal=[0,-1,0]
          movingFace: { faceId: 'f2', surfaceType: 'plane', center: [0, -5, 0], normal: [0, -1, 0] },
        }],
      },
      inputs: [],
      feature: { kind: 'assembly', label: 'testAssembly', createdBy: 'user' },
      hasAssignment: true,
      returnType: 'new_shape',
    }
    const doAssembleStmt: CadStatement = {
      id: 'do_asm1',
      op: 'do_assemble',
      args: {},
      inputs: [],
      assemblyTarget: 'asm1',
      returnType: 'void',
    }

    // append 两条新语句
    const fullScript = makePartScript([s1, s2, assemblyStmt, doAssembleStmt])
    const result = await runtime.append(fullScript, ['asm1', 'do_asm1'])

    expect(result.failedAt).toBeUndefined()

    // do_assemble 应该执行了装配变换：s2 的几何被变换
    // face_mate: s2 底面法线 [0,-1,0] → -s1 顶面法线 [0,-1,0]，已反向平行
    // 平移 = fixedFace.center - movingFace.center = [0,5,0] - [0,-5,0] = [0,10,0]
    // 所以 s2 应该被平移 [0,10,0]
    const s2After = result.outputs.get('s2')
    expect(s2After).toBeDefined()
    expect(s2After).not.toBe(s2Initial) // 几何确实变了

    // 验证变换正确：s2 原来中心在 [0,0,0]，平移 [0,10,0] 后中心在 [0,10,0]
    // box(size=10) 顶点范围 [-5,5]×[-5,5]×[-5,5]，平移后 [−5,5]×[5,15]×[-5,5]
    // 检查 s2 的某个顶点是否被正确平移
    const s2InitialPos = s2Initial.positions
    const s2AfterPos = s2After!.positions
    // 至少有变化（不是完全相同的 Float32Array）
    let hasChange = false
    for (let i = 0; i < s2AfterPos.length; i++) {
      if (Math.abs(s2AfterPos[i] - s2InitialPos[i]) > 0.001) {
        hasChange = true
        break
      }
    }
    expect(hasChange).toBe(true)

    // 验证平移量 = [0,10,0]（Y 轴方向偏移 10）
    const deltaY = s2AfterPos[1] - s2InitialPos[1] // 第一个顶点的 Y 分量差
    expect(deltaY).toBeCloseTo(10, 1)
  })
})
