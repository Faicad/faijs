/**
 * boolean/coincident-cut-guard-e2e — L3 贴面减除防护「内核级」验证（方案 2026-11-03 P2）。
 *
 * 与 `coincident-cut-guard.test.ts`（纯 bbox 数学）互补：这里走真实 BREP 内核，
 * 覆盖计划 §5 两条缺口：
 *  1. 双入口 —— `cad.subtract`（api/boolean.ts booleanBrep）与
 *     `cad.boolean('cut')`（api/boolean-op callBooleanOp）都接入防护；
 *  2. 非轴对齐 —— 斜置 tool（绕 z 旋转 45°）在 base 内 / 外 / 侵入的三态，
 *     外扩方向判定正确（仅 bbox 无交叠轴触发，侵入跳过）。
 *
 * 断言载体：执行成功（failedAt 为空）+ `ExecutionResult.infos` 中的
 * `coincident-cut guard` 提示（P1 提示规范化后挂进报告，可观测）。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { createNodePorts } from '../../src/node-host'
import { createEditorRuntime } from '../support/editor-ops'
import type { CadRuntime } from '../../src/cad-runtime/runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** base：100×100×10 居中 ⇒ z∈[-5,5]（板顶 z=5、板底 z=-5）。 */
const BASE_LINE = 'let base = cad.box(100 * MM, 100 * MM, 10 * MM, { centered: true, at: [0 * MM, 0 * MM, 0 * MM] })'

async function runCode(runtime: CadRuntime, code: string): Promise<{ ok: boolean; infos: string[]; error?: string }> {
  const result = await runtime.execute(code)
  if (result.failedAt) {
    return { ok: false, infos: result.infos ?? [], error: String(result.failedAt.message ?? result.failedAt) }
  }
  return { ok: true, infos: result.infos ?? [] }
}

function guardHits(infos: string[]): string[] {
  return infos.filter((m) => m.includes('coincident-cut guard'))
}

describe('L3 双入口（内核级）', () => {
  it('cad.subtract 入口：零体积 tool（底面贴 base 顶面）⇒ 触发防护并成功', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      const { ok, infos, error } = await runCode(runtime, [
        BASE_LINE,
        'let tool = cad.box(20 * MM, 20 * MM, 5 * MM, { centered: true, at: [0 * MM, 0 * MM, 7.5 * MM] })',
        'let out = cad.subtract(base, tool)',
      ].join('\n'))
      expect(error ?? 'no error').toBe('no error')
      expect(ok).toBe(true)
      const hits = guardHits(infos)
      expect(hits).toHaveLength(1)
      expect(hits[0]).toContain('subtract')
      expect(hits[0]).toContain('自动外扩')
    } finally {
      runtime.dispose()
    }
  })

  it('cad.boolean(\'cut\') 入口：零体积 tool ⇒ 触发防护并成功', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      const { ok, infos, error } = await runCode(runtime, [
        BASE_LINE,
        'let tool = cad.box(20 * MM, 20 * MM, 5 * MM, { centered: true, at: [0 * MM, 0 * MM, 7.5 * MM] })',
        'let out = cad.boolean([base], [tool], \'cut\')',
      ].join('\n'))
      expect(error ?? 'no error').toBe('no error')
      expect(ok).toBe(true)
      const hits = guardHits(infos)
      expect(hits).toHaveLength(1)
      expect(hits[0]).toContain('boolean(\'cut\')')
      expect(hits[0]).toContain('自动外扩')
    } finally {
      runtime.dispose()
    }
  })

  it('cad.boolean(\'cut\') 侵入 + 贴齐（tool 顶面贴 base 顶面）⇒ 不触发（合法贴齐不是零体积）', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      // tool z∈[3,5]：已侵入 base（交叠 z[3,5]），顶面 z=5 贴 base 顶面 5
      const { ok, infos, error } = await runCode(runtime, [
        BASE_LINE,
        'let tool = cad.box(20 * MM, 20 * MM, 2 * MM, { centered: true, at: [0 * MM, 0 * MM, 4 * MM] })',
        'let out = cad.boolean([base], [tool], \'cut\')',
      ].join('\n'))
      expect(error ?? 'no error').toBe('no error')
      expect(ok).toBe(true)
      expect(guardHits(infos)).toHaveLength(0)
    } finally {
      runtime.dispose()
    }
  })

  it('cad.boolean(\'cut\', { clearance: 0 }) 显式关闭 ⇒ 零体积贴面也不触发', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      const { ok, infos, error } = await runCode(runtime, [
        BASE_LINE,
        'let tool = cad.box(20 * MM, 20 * MM, 5 * MM, { centered: true, at: [0 * MM, 0 * MM, 7.5 * MM] })',
        'let out = cad.boolean([base], [tool], \'cut\', { clearance: 0 })',
      ].join('\n'))
      expect(error ?? 'no error').toBe('no error')
      expect(ok).toBe(true)
      expect(guardHits(infos)).toHaveLength(0)
    } finally {
      runtime.dispose()
    }
  })
})

describe('L3 非轴对齐方向判定三态（斜置 tool 绕 z 旋转 45°，bbox 粗筛仍正确）', () => {
  it('态 1：斜置 tool 完全在 base 内 ⇒ 零命中（合法侵入）', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      // tool 20×20×5 centered at [0,0,0]（z∈[-2.5,2.5]）绕 z 转 45°：完全在 base 内
      const { ok, infos, error } = await runCode(runtime, [
        BASE_LINE,
        'let tool = cad.rotate(cad.box(20 * MM, 20 * MM, 5 * MM, { centered: true, at: [0 * MM, 0 * MM, 0 * MM] }), 45, { axis: [0 * MM, 0 * MM, 1] })',
        'let out = cad.boolean([base], [tool], \'cut\')',
      ].join('\n'))
      expect(error ?? 'no error').toBe('no error')
      expect(ok).toBe(true)
      expect(guardHits(infos)).toHaveLength(0)
    } finally {
      runtime.dispose()
    }
  })

  it('态 2：斜置 tool 在 base 外、底面贴 base 顶面 ⇒ z-min 侧外扩触发', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      // tool 中心 z=7.5 ⇒ 未旋转时 zmin=5 恰贴 base 顶面；绕 z 转 45° 不改变 z 范围
      // （z 半高仍 2.5），bbox 在 z 轴零交叠 ⇒ 判定贴面，外扩 z-min。
      const { ok, infos, error } = await runCode(runtime, [
        BASE_LINE,
        'let tool = cad.rotate(cad.box(20 * MM, 20 * MM, 5 * MM, { centered: true, at: [0 * MM, 0 * MM, 7.5 * MM] }), 45, { axis: [0 * MM, 0 * MM, 1] })',
        'let out = cad.boolean([base], [tool], \'cut\')',
      ].join('\n'))
      expect(error ?? 'no error').toBe('no error')
      expect(ok).toBe(true)
      const hits = guardHits(infos)
      expect(hits).toHaveLength(1)
    } finally {
      runtime.dispose()
    }
  })

  it('态 3：斜置 tool 侵入 base（bbox 有交叠）⇒ 零命中（粗筛跳过，非轴对齐面交由内核）', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      // tool 中心 z=6 ⇒ z∈[3.5,8.5] 侵入 base（交叠 z[3.5,5]）；绕 z 转 45° 后 bbox 有
      // 正体积交叠 ⇒ 判定「已侵入」跳过（外扩对已侵入者是噪音，与轴对齐同规则）。
      const { ok, infos, error } = await runCode(runtime, [
        BASE_LINE,
        'let tool = cad.rotate(cad.box(20 * MM, 20 * MM, 5 * MM, { centered: true, at: [0 * MM, 0 * MM, 6 * MM] }), 45, { axis: [0 * MM, 0 * MM, 1] })',
        'let out = cad.boolean([base], [tool], \'cut\')',
      ].join('\n'))
      expect(error ?? 'no error').toBe('no error')
      expect(ok).toBe(true)
      expect(guardHits(infos)).toHaveLength(0)
    } finally {
      runtime.dispose()
    }
  })
})
