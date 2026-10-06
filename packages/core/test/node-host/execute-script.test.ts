/**
 * executeScript（B6，2026-10-06）——一等「代码字符串 → 产物」执行 API 的契约测试。
 *
 * GOTCHA（计划 B4 实测）：Host 装配缺失会被下游误读成「faijs 的能力缺口」——
 * 不注册 OCCT BREP 引擎时布尔回退 mesh 路径尚可用，但 BREP 链报
 * `BREP engine API not available`。executeScript 内部完成完整装配
 * （node ports + libLoader + registerOcctBrepEngine），调用方零装配。
 * 本测试断言：① 单文件代码字符串直接拿 terminals；② 失败给 failedAt 结构化
 * 结果而不是 throw；③ BREP 链布尔 op 在 executeScript 下可用（证明装配完整）。
 */

import { describe, it, expect } from 'vitest'
import { executeScript } from '../../src/node-host/execute-script'

describe('executeScript (B6)', () => {
  it('代码字符串 → 终端产物（零装配）', async () => {
    const r = await executeScript(`let p = cad.box(10, 10, 5)`)
    expect(r.failedAt).toBeUndefined()
    expect(r.terminals.length).toBeGreaterThan(0)
  }, 120_000)

  it('BREP 链布尔可用——证明内部装配完整（B4 坑不复发）', async () => {
    const r = await executeScript(`
      let a = cad.box(10, 10, 10)
      let b = cad.box(5, 5, 5)
      let c = cad.union(a, b)
    `, { mode: 'brep' })
    expect(r.failedAt).toBeUndefined()
    expect(r.terminals.length).toBeGreaterThan(0)
  }, 120_000)

  it('执行失败返回结构化 failedAt，不抛异常', async () => {
    const r = await executeScript(`let p = cad.nopeOp(1)`)
    expect(r.failedAt).toBeDefined()
    expect(r.terminals).toEqual([])
  }, 120_000)
})
