/**
 * @vitest-environment node
 *
 * cad.wireFromEdges — 边列表 → wire（E2，中立 op：L1 makeWire 两引擎同实现）
 *
 * 覆盖（方案 2026-11-14 §E2）：
 * 1. 直线 + 圆弧混合组装：3 条边 → wire（isWire、总长 = 各边长之和）；
 * 2. `closed` 三态：缺省（开链合法）/ true + 闭合链（通过）/ true + 开链
 *    （E_WIRE_FROM_EDGES_NOT_CLOSED）；
 * 3. 错误码：E_WIRE_FROM_EDGES_TOO_FEW（空列表）/ E_WIRE_FROM_EDGES_NO_BREP
 *    （入参无 BREP 句柄）——TS 级直连（单条边自 2026-11-14 起合法，不再算 TOO_FEW）；
 * 4. 下游 sweep 消费：wireFromEdges 产物作 spine，扫掠体 volume>0
 *    （1D 产物可消费契约，§2.1 ②）。
 *
 * 输入来源：`cad.edge`（平台 op engines:['occt']，本测试全程 occt）与
 * `cad.circleArc`（同）。
 *
 * Run: npx vitest run test/api/wire-from-edges.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import { asPartName } from '../../src/identity'
import { isWire } from '../../src/api/shape-type'
import { wireFromEdges } from '../../src/api/wire-from-edges'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), 'brep' as ExecutionMode, {
    cad: createApiNamespaceWithEditorOps(),
  }).execute(code)
}

async function shapeOf(code: string, part: string): Promise<Shape> {
  const result = await exec(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

const lengthOf = (s: Shape): number => getBrepApi().getLength(brepOf(s) as never)

/** 直线 (0,0)→(0,20)，半圆弧接 (0,36)，样条接 (40,40) 的开放混合链（3 边）。 */
const MIXED_CHAIN =
  `const e1 = cad.edge([0,0,0], [10,0,0])\n` +
  `const e2 = cad.edge([10,0,0], [10,10,0])\n` +
  `const a = cad.circleArc([5,10,0], [0,0,1], 5, 0, 90)\n`

describe('cad.wireFromEdges — 边列表 → wire（E2，中立 op）', () => {
  it('直线+圆弧混合组装：3 边 → wire（isWire、长度 = 10+10+2π·5/4）', async () => {
    const s = await shapeOf(MIXED_CHAIN + `const part0 = cad.wireFromEdges([e1, e2, a])\n`, 'part0')
    // 1D 曲线形态（fromBrepCurve 收养）
    expect((s as { kind?: string }).kind).toBe('curve')
    // isWire：occt 原生类型判定（平台 op TS 直连）
    expect(isWire(s)).toBe(true)
    expect(lengthOf(s)).toBeCloseTo(10 + 10 + (2 * Math.PI * 5) / 4, 3)
  })

  it('closed 缺省：开链合法（默认 false，与 cad.wire 口径一致）', async () => {
    const s = await shapeOf(MIXED_CHAIN + `const part0 = cad.wireFromEdges([e1, e2, a])\n`, 'part0')
    expect(isWire(s)).toBe(true)
    // 开链：curveIsClosed 为 false
    expect(getBrepApi().curveIsClosed(brepOf(s) as never)).toBe(false)
  })

  it('closed: true + 闭合链（矩形 4 边）→ 通过（等价库层 wireLoop 语义）', async () => {
    const code =
      `const r1 = cad.edge([0,0,0], [10,0,0])\n` +
      `const r2 = cad.edge([10,0,0], [10,6,0])\n` +
      `const r3 = cad.edge([10,6,0], [0,6,0])\n` +
      `const r4 = cad.edge([0,6,0], [0,0,0])\n` +
      `const part0 = cad.wireFromEdges([r1, r2, r3, r4], { closed: true })\n`
    const s = await shapeOf(code, 'part0')
    expect(isWire(s)).toBe(true)
    expect(getBrepApi().curveIsClosed(brepOf(s) as never)).toBe(true)
    expect(lengthOf(s)).toBeCloseTo(2 * (10 + 6), 3)
  })

  it('closed: true + 开链 → E_WIRE_FROM_EDGES_NOT_CLOSED（执行前拒绝，不进内核深错）', async () => {
    const result = await exec(MIXED_CHAIN + `const part0 = cad.wireFromEdges([e1, e2, a], { closed: true })\n`)
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_WIRE_FROM_EDGES_NOT_CLOSED/)
  })

  it('TS 级直连：空列表 → E_WIRE_FROM_EDGES_TOO_FEW', async () => {
    await expect(wireFromEdges([] as never[])).rejects.toThrow(/E_WIRE_FROM_EDGES_TOO_FEW/)
  })

  it('TS 级直连：单条边合法（2026-11-14 起下限放宽到 1），无 BREP 才报错', async () => {
    await expect(wireFromEdges([{} as never])).rejects.toThrow(/E_WIRE_FROM_EDGES_NO_BREP/)
  })

  it('TS 级直连：入参无 BREP 句柄 → E_WIRE_FROM_EDGES_NO_BREP', async () => {
    await expect(wireFromEdges([{} as never, {} as never])).rejects.toThrow(/E_WIRE_FROM_EDGES_NO_BREP/)
  })

  it('下游 sweep 消费：wireFromEdges 产物作 spine → 扫掠体 volume>0（§2.1 ② 可消费）', async () => {
    const code =
      `const section = cad.profile({ contours: [{ segments: [\n` +
      `  { kind: 'line', x1: -2, y1: -2, x2: 2, y2: -2 },\n` +
      `  { kind: 'line', x1: 2, y1: -2, x2: 2, y2: 2 },\n` +
      `  { kind: 'line', x1: 2, y1: 2, x2: -2, y2: 2 },\n` +
      `  { kind: 'line', x1: -2, y1: 2, x2: -2, y2: -2 },\n` +
      `] }] })\n` +
      `const s1 = cad.edge([0,0,0], [0,0,25])\n` +
      `const s2 = cad.edge([0,0,25], [0,0,50])\n` +
      `const part0 = cad.wireFromEdges([s1, s2])\n` +
      `const part1 = cad.sweep(section, part0)\n`
    const s = await shapeOf(code, 'part1')
    const volume = Math.abs(getBrepApi().getVolume(brepOf(s) as never))
    // 截面 4×4、脊柱总长 50（共线两段直边）
    expect(volume).toBeGreaterThan(700)
  })
})
