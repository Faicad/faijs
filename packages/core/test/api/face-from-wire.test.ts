/**
 * @vitest-environment node
 *
 * cad.faceFromWire — 平面 wire → face（E2b，中立 op：L1 makeFace 两引擎 dialect）
 *
 * 覆盖（方案 2026-11-14 §E2b + §2.1）：
 * 1. 平面闭合 wire → face（isFace；extrude → 长方体，§2.1 ② 可消费）；
 * 2. 含孔：outer + hole wire → extrude 体积 = (外 - 孔) × 高；
 * 3. GOTCHA：与 nonPlanarFace 的职责分界——非平面闭合 wire 上 faceFromWire
 *    拒绝、nonPlanarFace（MakeFilling）接受；
 * 4. §2.1 golden case（矩形→成面→拉伸）：三步 terminals {rect} → {face} → {box}，
 *    每步类型断言 isWire / isFace / getShapeType==='solid'；`rect.keep()` 变体
 *    终端恒含 rect——三类统一契约（可显示/可消费/消费即消失）的验收测试。
 *
 * Run: npx vitest run test/api/face-from-wire.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm, getOcctKernel } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import { asPartName } from '../../src/identity'
import { isFace, isWire } from '../../src/api/shape-type'
import { faceFromWire } from '../../src/api/face-from-wire'
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

const volumeOf = (s: Shape): number => Math.abs(getBrepApi().getVolume(brepOf(s) as never))

/** 10×6 矩形闭合 wire（z=0）。 */
const RECT = `const rect = cad.wire([[0,0,0],[10,0,0],[10,6,0],[0,6,0]], { closed: true })\n`

describe('cad.faceFromWire — 平面 wire → face（E2b，中立 op）', () => {
  it('平面闭合 wire → face（isFace、有网格可显示）', async () => {
    const s = await shapeOf(RECT + `const face = cad.faceFromWire(rect)\n`, 'face')
    // 有网格收养（fromBrep(solidToShape(...))——最终产物不空白）
    expect(s.positions.length).toBeGreaterThan(0)
    expect(s.indices.length).toBeGreaterThan(0)
    expect(isFace(s)).toBe(true)
  })

  it('下游 extrude 消费：face → 长方体（volume = 60×5；§2.1 ② 可消费）', async () => {
    const s = await shapeOf(
      RECT + `const face = cad.faceFromWire(rect)\nconst box = cad.extrude(face, 5)\n`,
      'box',
    )
    expect(getOcctKernel().getShapeType(brepOf(s) as never)).toBe('solid')
    expect(volumeOf(s)).toBeCloseTo(10 * 6 * 5, 3)
  })

  it('含孔：outer 10×6 + hole 4×2 → extrude 体积 = (60-8)×5', async () => {
    const code =
      RECT +
      `const hole = cad.wire([[3,2,0],[7,2,0],[7,4,0],[3,4,0]], { closed: true })\n` +
      `const face = cad.faceFromWire(rect, [hole])\n` +
      `const box = cad.extrude(face, 5)\n`
    const s = await shapeOf(code, 'box')
    expect(isFace(await shapeOf(code, 'face'))).toBe(true)
    expect(volumeOf(s)).toBeCloseTo((10 * 6 - 4 * 2) * 5, 3)
  })

  it('GOTCHA：非平面闭合 wire 上 faceFromWire 拒绝（平面限定），nonPlanarFace 接受（职责分界）', async () => {
    // 四点不共面（z 抬起 5）的闭合 wire
    const NON_PLANAR =
      `const np = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,5]], { closed: true })\n`
    const failed = await exec(NON_PLANAR + `const face = cad.faceFromWire(np)\n`)
    expect(failed.failedAt).toBeDefined()
    // occt 实测（探针钉死）：非平面 wire 在内核 makeFace 即失败
    // （CONSTRUCTION_FAILED），不进 surfaceType 守卫；E_FACE_FROM_WIRE_NOT_PLANAR
    // 覆盖的是 makeFace 接受非平面 wire 的方言路径（brepkit makeFaceFromWire）。
    // 两条路都 fail-fast——平面限定契约在任一引擎上都不是静默降级。
    expect(JSON.stringify(failed.failedAt)).toMatch(/CONSTRUCTION_FAILED|E_FACE_FROM_WIRE_NOT_PLANAR/)
    // 同一 wire 走 nonPlanarFace（MakeFilling，occt-only）成功——分界是 op 职责不是能力缺口
    const ok = await exec(NON_PLANAR + `const face = cad.nonPlanarFace(np)\n`)
    expect(ok.failedAt).toBeUndefined()
  })

  it('TS 级直连：入参无 BREP 句柄 → E_FACE_FROM_WIRE_NO_BREP', async () => {
    await expect(faceFromWire({} as never)).rejects.toThrow(/E_FACE_FROM_WIRE_NO_BREP/)
  })
})

describe('§2.1 golden case — 矩形→成面→拉伸（三类统一契约验收）', () => {
  const step1 = RECT
  const step2 = RECT + `const face = cad.faceFromWire(rect)\n`
  const step3 = step2 + `const box = cad.extrude(face, 5)\n`

  const terminalsOf = (r: ExecutionResult): string[] => r.terminals.map((t) => String(t.id)).sort()

  it('第 1 步：只画矩形 → terminals = {rect}（wire 可显示：线框网格）', async () => {
    const r = await exec(step1)
    expect(r.failedAt).toBeUndefined()
    expect(terminalsOf(r)).toEqual(['rect'])
    const s = r.outputs.get(asPartName('rect')) as Shape
    // ① 可显示（wire 口径）：无三角载荷（positions/indices 结构存在但空数组，
    // isShapeLike 候选命中），线框经 BREP 槽 wireframe 通道渲染——brepOf 必须有句柄
    expect('positions' in s).toBe(true)
    expect('indices' in s).toBe(true)
    expect(brepOf(s)).toBeDefined()
    expect(isWire(s)).toBe(true)
  })

  it('第 2 步：成面 → terminals = {face}（rect 被 R5 默认消费，矩形线框消失）', async () => {
    const r = await exec(step2)
    expect(terminalsOf(r)).toEqual(['face'])
    const s = r.outputs.get(asPartName('face')) as Shape
    expect(isFace(s)).toBe(true)
    expect(s.positions.length).toBeGreaterThan(0)
  })

  it('第 3 步：拉伸 → terminals = {box}（face 被消费，矩形面消失；getShapeType solid）', async () => {
    const r = await exec(step3)
    expect(terminalsOf(r)).toEqual(['box'])
    const s = r.outputs.get(asPartName('box')) as Shape
    expect(getOcctKernel().getShapeType(brepOf(s) as never)).toBe('solid')
    expect(volumeOf(s)).toBeCloseTo(10 * 6 * 5, 3)
  })

  it('keep() 变体：rect.keep() 后三步终端恒含 rect（R1 唯一显式保留路径）', async () => {
    const code = RECT + `rect.keep()\n` + `const face = cad.faceFromWire(rect)\n` + `const box = cad.extrude(face, 5)\n`
    const r = await exec(code)
    expect(terminalsOf(r)).toEqual(['box', 'rect'])
  })
})
