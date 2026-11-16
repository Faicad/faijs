/**
 * @vitest-environment node
 *
 * sweep-guard 验收：扫掠体积对账 + 旋转零厚度守卫（阶段 1，2026-11-14）
 *
 * 覆盖：
 * 1. sweep 直线脊柱（单段）→ 通过，体积 3200（8×8 × 50）；
 * 2. sweep 折线近似圆弧（16 段）→ 抛 E_SWEEP_VOLUME_MISMATCH（实测只给解析值的 2/π）；
 * 3. pipe 用 wire 截面（产壳）→ 守卫跳过，不误报；
 * 4. revolve 截面平面不含轴 → 抛 E_REVOLVE_ZERO_THICKNESS；
 * 5. revolve 截面在含轴平面（XZ 绕 Z）→ 通过，体积满足 Pappus（200 × 2π×5 = 6283.19）。
 *
 * 依据：`test/probe-case8-pipe-gap.ts` 的实测表 + `src/api/internal/sweep-guard.ts` 文件头。
 *
 * Run: npx vitest run test/api/sweep-revolve-guard.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

function volumeOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

/** 8×8 方形截面（XY 平面、居中于原点）——扫掠截面共用。 */
const SQUARE_8 =
  `let part0 = cad.profile({ contours: [{"segments":[` +
  `{"kind":"line","x1":-4,"y1":-4,"x2":4,"y2":-4},` +
  `{"kind":"line","x1":4,"y1":-4,"x2":4,"y2":4},` +
  `{"kind":"line","x1":4,"y1":4,"x2":-4,"y2":4},` +
  `{"kind":"line","x1":-4,"y1":4,"x2":-4,"y2":-4}],"closed":true}] })\n`

/** 10×20 矩形截面，先画在 XY 再绕 X 转 90° 落到 XZ 平面（含 Z 轴）——revolve 正例共用。
 *  转后：x = 半径（0..10）→ 世界 X；原 y（0..20）→ 世界 Z。
 *  注：`cad.profile` 只吃 `contours`（无 plane 参数），跨平面必须靠 rotate 搬运。 */
const RECT_XZ =
  `let part0 = cad.profile({ contours: [{"segments":[` +
  `{"kind":"line","x1":0,"y1":0,"x2":10,"y2":0},` +
  `{"kind":"line","x1":10,"y1":0,"x2":10,"y2":20},` +
  `{"kind":"line","x1":10,"y1":20,"x2":0,"y2":20},` +
  `{"kind":"line","x1":0,"y1":20,"x2":0,"y2":0}],"closed":true}] })\n` +
  `let part0x = cad.rotate_euler(part0, { angles: [90 * DEGREE, 0 * DEGREE, 0 * DEGREE] })\n`

/** R10、90° 圆弧的 16 段折线（起点原点、起始切向 +Z）。 */
function polylineArc(segments: number): string {
  const pts: string[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (Math.PI / 2) * (i / segments)
    pts.push(`[0,${(10 * Math.sin(t)).toFixed(6)},${(10 * (1 - Math.cos(t))).toFixed(6)}]`)
  }
  return pts.join(',')
}

describe('sweep-guard · 扫掠体积对账', () => {
  it('A1. 直线脊柱（两点，单段）→ 体积 8×8×50 = 3200，守卫放行', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${SQUARE_8}let part1 = cad.wire([[0,0,0],[0,0,50]])\nlet part2 = cad.sweep(part0, part1)\n`,
      'part2',
    )
    expect(Math.abs(volumeOf(s) - 3200)).toBeLessThan(3200 * 0.005)
  })

  it('A2. 折线脊柱（16 段近似 90° 圆弧）+ 强制 single → E_SWEEP_VOLUME_MISMATCH', async () => {
    await useOcct()
    // 2026-11-16 起 `cad.sweep` 会按脊柱事实自动选 miter（折角精确），所以「一次扫掠丢体积」
    // 这条内核事实要靠 `strategy:'single'` 显式复现，否则守卫再也不会有机会说话。
    const result = await exec(
      'brep',
      `${SQUARE_8}let part1 = cad.wire([${polylineArc(16)}])\n` +
        `let part2 = cad.sweep(part0, part1, { strategy: 'single', strict: false })\n`,
    )
    expect(result.failedAt).toBeTruthy()
    expect(String(result.failedAt?.message ?? '')).toMatch(/swept volume does not match/i)
    // 错误信息必须点出脊柱形态，否则使用者无法自救
    expect(String(result.failedAt?.message ?? '')).toMatch(/polyline spine/i)
  })

  it('A2b. 同一折线脊柱走默认（auto → miter）→ 体积 = 面积 × 折线长，守卫放行', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${SQUARE_8}let part1 = cad.wire([${polylineArc(16)}])\nlet part2 = cad.sweep(part0, part1)\n`,
      'part2',
    )
    // 64 × 90° 弧长 15.708（16 段折线弦长和 15.703，差 0.03%）——miter 在折角上保体积。
    expect(Math.abs(volumeOf(s) - 64 * (10 * Math.PI) / 2)).toBeLessThan(64 * (10 * Math.PI) / 2 * 0.01)
  })

  it('A3. wire/edge 截面（整圆）→ 包成 wire 后产实体；C1 按环面积对账并通过', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.circleArc([0,0,0],[0,1,0],2,0,360)\n` +
        `let part1 = cad.wire([[0,0,0],[0,20,0]])\nlet part2 = cad.sweep(part0, part1)\n`,
      'part2',
    )
    // 2026-11-16：edge 截面先包成闭合 wire 再扫 ⇒ 实体（不再是 `MakePipe` 的壳），
    // 所以 C1 这次是真的在算：πr² × 20 = 251.33，守卫必须放行而不是误报。
    expect(String(getBrepApi().shapeType(brepOf(s) as never)).toLowerCase()).toMatch(/solid/i)
    expect(Math.abs(volumeOf(s) - Math.PI * 4 * 20)).toBeLessThan(Math.PI * 4 * 20 * 0.02)
  })

  it('A4. 守卫前提：`getLength` 对真弧 wire 量的是弧长（15.708）而非弦长（14.142）', async () => {
    await useOcct()
    const k = getBrepApi() as unknown as {
      makeArcEdge: (a: unknown, b: unknown, c: unknown) => unknown
      makeWire: (edges: unknown[]) => unknown
      getLength: (h: unknown) => number
    }
    // 三点圆弧：(0,0,0) → 45° → (0,10,10)，圆心 (0,-10,0)、R10
    const spine = k.makeWire([
      k.makeArcEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 7.0711, z: 2.9289 }, { x: 0, y: 10, z: 10 }),
    ])
    const arcLength = k.getLength(spine)
    expect(arcLength).toBeCloseTo((10 * Math.PI) / 2, 2)
    // 弦长是 14.142：若量成弦长，守卫会把正确的真弧件误判成 10% 偏差
    expect(arcLength).toBeGreaterThan(15.5)
  })

  it('A4b. 脚本层真弧脊柱（wireFromEdges 单边 circleArc）→ 体积 64 × 15.708 = 1005.31，守卫放行', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${SQUARE_8}let part1 = cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE)])\n` +
        `let part2 = cad.sweep(part0, part1)\n`,
      'part2',
    )
    const expected = (64 * (10 * Math.PI)) / 2
    expect(Math.abs(volumeOf(s) - expected)).toBeLessThan(expected * 0.005)
  })

  it('A5. 折线脊柱（40 段密采样）→ 默认 miter 精确，2/π 偏差不再出现', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${SQUARE_8}let part1 = cad.wire([${polylineArc(40)}])\nlet part2 = cad.sweep(part0, part1)\n`,
      'part2',
    )
    const expected = (64 * (10 * Math.PI)) / 2
    expect(Math.abs(volumeOf(s) - expected)).toBeLessThan(expected * 0.01)
  })
})

describe('sweep-guard · 旋转零厚度', () => {
  it('B1. 截面在 XY（不含轴）、绕 Z 转 180° → E_REVOLVE_ZERO_THICKNESS', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      `${SQUARE_8}let part1 = cad.revolve(part0, { axis: [0,0,1], at: [0,0,0], angle: 3.141592653589793 })\n`,
    )
    expect(result.failedAt).toBeTruthy()
    expect(String(result.failedAt?.message ?? '')).toMatch(/zero-thickness/i)
    expect(String(result.failedAt?.message ?? '')).toMatch(/CONTAINS the axis/i)
  })

  it('B2. 截面在 XZ（含轴）、绕 Z 转 2π → 体积 Pappus 200 × 2π×5 = 6283.19', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${RECT_XZ}let part1 = cad.revolve(part0x, { axis: [0,0,1], at: [0,0,0], angle: 6.283185307179586 })\n`,
      'part1',
    )
    const expected = 200 * 2 * Math.PI * 5
    expect(Math.abs(volumeOf(s) - expected)).toBeLessThan(expected * 0.005)
  })
})
