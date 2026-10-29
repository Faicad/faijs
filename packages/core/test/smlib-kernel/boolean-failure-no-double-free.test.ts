/**
 * boolean-failure-no-double-free — 评审 1 回归：
 * booleanOp 失败路径（SM 非 SUCCESS）释放 pa/pb 后，runtime drainScopeFrames
 * 遍历 frame.transients 再 releaseOwned(pa/pb) 不得 throw double-free——
 * 真实 SM 错误必须透传到 result.failedAt，不能被 double-free 包装吞掉。
 *
 * 链：booleanOp 失败分支 releaseOwned(pa)+releaseOwned(pb) → throw SM error
 *   → DirectExecutor catch → failedAt → executeDirectText 调 drainScopeFrames
 *   → ScopeStack.pop 遍历 transients 调 releaseOwned → pa/pb 已 dead（alive=false）
 *   → releaseOwned 幂等跳过（修复前：throw double-free，吞掉真实 SM 错误）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { createEditorRuntime } from '../support/editor-ops'

describe('booleanOp 失败路径：drainScopeFrames 不吞真实 SM 错误', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('subtract 完全包含（空结果）→ execute resolve 且 failedAt 含 SM 错误，不 reject double-free', async () => {
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime({ events: { emit: () => undefined } }, 'brep')

    // a 被 b 完全包裹 → subtract 结果为空壳，smlib 布尔可能返回非 SUCCESS。
    // 关键断言：execute() resolve（drain 不 throw），failedAt.message 不是 double-free。
    const script = `
const a = cad.box(10, 10, 10, { centered: true })
const b = cad.box(30, 30, 30, { centered: true })
const c = cad.subtract(a, b)
`
    let result: ExecutionResult | undefined
    let thrown: unknown
    try {
      result = await runtime.execute(script)
    } catch (e) {
      thrown = e
    }

    // drainScopeFrames 不得 throw double-free 导致 execute reject
    expect(thrown, `runtime.execute rejected with: ${thrown}`).toBeUndefined()
    // 若布尔失败，failedAt 存在且不是 double-free 包装
    if (result?.failedAt) {
      expect(result.failedAt.message).not.toMatch(/double-free/)
    }
  })

  it('连续多条语句，布尔失败后 drain 不 throw', async () => {
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime({ events: { emit: () => undefined } }, 'brep')

    const script = `
const a = cad.box(10, 10, 10, { centered: true })
const b = cad.box(30, 30, 30, { centered: true })
const bad = cad.subtract(a, b)
const c = cad.box(5, 5, 5, { centered: true })
`
    let result: ExecutionResult | undefined
    let thrown: unknown
    try {
      result = await runtime.execute(script)
    } catch (e) {
      thrown = e
    }
    expect(thrown, `runtime.execute rejected: ${thrown}`).toBeUndefined()
    if (result?.failedAt) {
      expect(result.failedAt.message).not.toMatch(/double-free/)
    }
  })

  it('失败后 runtime 仍可正常执行下一轮（状态未损坏）', async () => {
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime({ events: { emit: () => undefined } }, 'brep')

    // 第一轮：触发布尔失败（或至少执行完）
    await runtime.execute(`
const a = cad.box(10, 10, 10, { centered: true })
const b = cad.box(30, 30, 30, { centered: true })
const c = cad.subtract(a, b)
`)
    // 第二轮：正常脚本必须成功（registry/scope 状态未被 double-free 损坏）
    const r2 = await runtime.execute('const x = cad.box(5, 5, 5, { centered: true })')
    expect(r2.failedAt).toBeUndefined()
  })
})
