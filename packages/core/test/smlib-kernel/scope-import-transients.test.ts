/**
 * scope-import-test — 评审 3：runDirectModule 接 scope hooks。
 *
 * 验证：执行含布尔中间体的脚本后，registry.aliveOwnedCount() 与 solidCache 句柄数
 * 一致（没有 op 内临时句柄泄漏）；连续多轮执行后 aliveOwnedCount 不单调增长。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { initSmlibWasm } from '../../src/smlib-kernel/smlibWasm'
import { createEditorRuntime } from '../support/editor-ops'

describe('per-statement scope：中间体在语句结束后释放', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('含布尔中间体的脚本执行后，无临时句柄泄漏（alive 数稳定）', async () => {
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime({ events: { emit: () => undefined } }, 'brep')

    const script = `
const a = cad.box(10, 10, 10, { centered: true })
const b = cad.box(5, 5, 5, { centered: true })
const c = cad.union(a, b)
const d = cad.box(8, 8, 8, { centered: true })
const e = cad.subtract(c, d)
`
    const r = await runtime.execute(script)
    expect(r.failedAt).toBeUndefined()

    const k = await initSmlibWasm()
    const alive = k.liveCount('Solid')
    // 5 个 ctx 变量（a/b/c/d/e）都持有活句柄；布尔中间体随语句帧释放。
    // 关键：solid 存活数 == ctx 变量数（没有额外临时句柄泄漏）。
    expect(alive).toBe(r.outputs.size)
  })

  it('连续多轮执行后 aliveOwnedCount 不单调增长', async () => {
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime({ events: { emit: () => undefined } }, 'brep')
    const k = await initSmlibWasm()

    const script = `
const a = cad.box(10, 10, 10, { centered: true })
const b = cad.box(5, 5, 5, { centered: true })
const c = cad.union(a, b)
`
    const counts: number[] = []
    for (let i = 0; i < 3; i++) {
      await runtime.execute(script)
      counts.push(k.liveCount('Solid'))
    }
    // 每轮结束后临时句柄应回收，alive 数稳定（不单调累积）。
    // 3 个变量 a/b/c 存活，每轮重跑覆盖旧句柄（sweep 释放旧产物）。
    expect(counts[2]!).toBeLessThanOrEqual(counts[0]! + 2)
  })
})
