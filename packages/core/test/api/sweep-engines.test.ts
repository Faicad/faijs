/**
 * sweep-engines — `cad.sweep` 在 occt / smlib / brepkit 上的能力矩阵（**实测**）
 *
 * `STRATEGIES_BY_ENGINE`（sweep.ts）是引擎能力的唯一判定点，表里的每一格都由本文件
 * 的实测数字支撑（2026-11-16 首次跑通）。任何一格被改，必须先改这里的用例。
 *
 * | 引擎 | single | miter | segments | closed | C2 端面法向 |
 * |---|---|---|---|---|---|
 * | occt    | 400 / 800 / 400 | 320 | ✔ | 1005.31 | ✔ |
 * | smlib   | 400 / 800 / 400 / 3015.93 | ✘ gated | ✘ gated | 1005.31（内核级） | ✘ |
 * | brepkit | 400 / 800 / 400 | ✘ gated | ✘ gated | ✘ gated | ✘ |
 *
 * 三个只有实测才能发现的硬事实：
 * 1. **smlib 内核自己就把截面搬到路径起点**（`moveProfile=true`），叠加我们的 autoPlace
 *    不会搬两次 —— S2 实测 800（= 16 × 50），与 occt 完全一致；
 * 2. **smlib 吃多边路径、闭合路径、带孔截面**（S4 400 / K2 1005.31 / S6 3015.93）；
 *    它缺的是转角过渡与 op 级真弧脊柱（`cad.circleArc` 只有 occt 实现）；
 * 3. **brepkit 的 `shapeType` 只报 SOLID/FACE/COMPOUND**，wire 一律 COMPOUND
 *    （brepkitKernel.ts:1478）⇒ 脊柱判据必须用结构判（有边且无面），按类型字符串判
 *    会把 brepkit 上所有合法脊柱误杀成 `E_SWEEP_SPINE_NOT_WIRE`。
 */
import { describe, it, expect } from 'vitest'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { createSmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { createEditorRuntime } from '../support/editor-ops'

function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

type EngineName = 'occt' | 'smlib' | 'brepkit'

async function runOn(engine: EngineName, script: string): Promise<ExecutionResult> {
  __resetEngineRegistriesForTests()
  if (engine === 'occt') await registerOcctBrepEngine()
  else if (engine === 'smlib') await registerSmlibBrepEngine()
  else await registerBrepkitBrepEngine()
  expect(getActiveBrepEngineId()).toBe(engine)
  return createEditorRuntime(createNodePorts(), 'brep').execute(script)
}

/** `part2` 的体积（op 抛错时返回错误文本）。 */
function volumeOfPart2(result: ExecutionResult): number {
  expect(result.failedAt, `unexpected failure: ${String(result.failedAt?.message ?? '')}`).toBeUndefined()
  const entry = result.brepSolids?.get(asPartName('part2'))
  expect(entry).toBeDefined()
  return entry!.kernel.getVolume(entry!.solid) as number
}

function errorOf(result: ExecutionResult): string {
  return String(result.failedAt?.message ?? '')
}

const RECT4 = `cad.sketch({ shapes:[{kind:'rect', cx:0, cy:0, w:4, d:4}], constraints:[], plane:'XY' })`

/** S1：直线 25，截面在起点。 */
const S1 = `let s = ${RECT4}\nlet w = cad.wire([[0,0,0],[0,0,25]])\nlet part2 = cad.sweep(s, w)\n`
/** S2：截面在 z=0、脊柱在 z=90..140 —— autoPlace 必须搬上去（16 × 50 = 800）。 */
const S2 = `let s = ${RECT4}\nlet w = cad.wire([[0,0,90],[0,0,140]])\nlet part2 = cad.sweep(s, w)\n`
/** S4：两段共线（同类 G1）多边路径。 */
const S4 = `let s = ${RECT4}\nlet w = cad.wire([[0,0,0],[0,0,10],[0,0,25]])\nlet part2 = cad.sweep(s, w)\n`
/** S5：L 形 90° 折角（miter）—— 只在 occt 上可执行。 */
const S5 = `let s = ${RECT4}\nlet w = cad.wire([[0,0,0],[0,0,10],[10,0,10]])\nlet part2 = cad.sweep(s, w, { strict: false })\n`
/** S6：带孔截面（annulus 8/4），净面积 × 20 = 3015.929。 */
const S6 =
  `let s = cad.sketch({ shapes:[{kind:'circle', r:8, cx:0, cy:0, tag:'o'},` +
  `{kind:'circle', r:4, cx:0, cy:0, tag:'i', mode:'s'}], constraints:[], plane:'XY' })\n` +
  `let w = cad.wire([[0,0,0],[0,0,20]])\nlet part2 = cad.sweep(s, w)\n`

describe('occt — 全策略', () => {
  it('S1 直线路径 → 400（16 × 25）', async () => {
    expect(volumeOfPart2(await runOn('occt', S1))).toBeCloseTo(400, 3)
  })
  it('S2 autoPlace 把远端截面搬上脊柱起点 → 800（16 × 50）', async () => {
    expect(volumeOfPart2(await runOn('occt', S2))).toBeCloseTo(800, 3)
  })
  it('S4 两段共线多边（同类 G1）→ 400', async () => {
    expect(volumeOfPart2(await runOn('occt', S4))).toBeCloseTo(400, 3)
  })
  it('S5 L 形折角 miter → 320（16 × 路径长 20）', async () => {
    expect(volumeOfPart2(await runOn('occt', S5))).toBeCloseTo(320, 2)
  })
  it('S6 带孔截面 → 3015.93（净面积 π(64−16) × 20）', async () => {
    expect(volumeOfPart2(await runOn('occt', S6))).toBeCloseTo(Math.PI * 48 * 20, 2)
  })
})

describe('smlib — single（含 autoPlace / 多边 / 带孔截面）', () => {
  it('S1 直线路径 → 400，与 occt 逐位一致', async () => {
    expect(volumeOfPart2(await runOn('smlib', S1))).toBeCloseTo(400, 3)
  })
  it('S2 autoPlace：内核自身 moveProfile 叠加后不搬两次 → 800', async () => {
    expect(volumeOfPart2(await runOn('smlib', S2))).toBeCloseTo(800, 3)
  })
  it('S4 多边同类 G1 路径（一条 wire 两个边）→ 400', async () => {
    expect(volumeOfPart2(await runOn('smlib', S4))).toBeCloseTo(400, 3)
  })
  it('S6 带孔截面：逐环扫 + cut 在 smlib 上成立 → 3015.93', async () => {
    expect(volumeOfPart2(await runOn('smlib', S6))).toBeCloseTo(Math.PI * 48 * 20, 2)
  })
  it('S5 折角 → E_SWEEP_ENGINE_CAP（内核无转角过渡），消息点明 smlib 缺什么', async () => {
    const r = await runOn('smlib', S5)
    expect(r.failedAt).toBeTruthy()
    expect(JSON.stringify(r.failedAt)).toMatch(/E_SWEEP_ENGINE_CAP/)
    expect(errorOf(r)).toMatch(/cannot run strategy 'miter'/)
    expect(errorOf(r)).toMatch(/SmApiCreateSweepAlongPlanarPath/)
    expect(errorOf(r)).toMatch(/Fix: run this model on occt/)
  })
})

describe('brepkit — single（旧引擎，未来放弃）', () => {
  it('S1 直线路径 → 400（脊柱结构判据修好后才成立）', async () => {
    expect(volumeOfPart2(await runOn('brepkit', S1))).toBeCloseTo(400, 3)
  })
  it('S2 autoPlace → 800', async () => {
    expect(volumeOfPart2(await runOn('brepkit', S2))).toBeCloseTo(800, 3)
  })
  it('S4 两段共线多边 → 400', async () => {
    expect(volumeOfPart2(await runOn('brepkit', S4))).toBeCloseTo(400, 3)
  })
  it('S5 折角 → E_SWEEP_ENGINE_CAP（NURBS 拟合成一条曲线，折角被光滑掉）', async () => {
    const r = await runOn('brepkit', S5)
    expect(r.failedAt).toBeTruthy()
    expect(JSON.stringify(r.failedAt)).toMatch(/E_SWEEP_ENGINE_CAP/)
    expect(errorOf(r)).toMatch(/cannot run strategy 'miter'/)
    expect(errorOf(r)).toMatch(/rmf \+ smooth/)
  })
  it('S6 带孔截面 → 钉住旧引擎缺陷：体积对但净面积读数失真，C1 误报', async () => {
    // 实测（2026-11-16）：扫出的实体体积 = 3015.93（正确），但 C1 的期望值算成
    // 「16.00 × 20 = 320」——brepkit 对带孔 face 的 getSurfaceArea 读不出净面积
    // （读到 16，真值 150.8）。brepkit 是即将放弃的旧内核，不修；用例钉住现状，
    // 删 brepkit 时连同本用例一起删。
    const r = await runOn('brepkit', S6)
    expect(r.failedAt).toBeTruthy()
    expect(errorOf(r)).toMatch(/swept volume does not match/i)
    expect(errorOf(r)).toMatch(/actual 3015\.9/)
  })
})

/**
 * 内核级探针：`cad.circleArc` 只有 occt 实现（`E_BREP_UNSUPPORTED`），op 级造不出真弧 /
 * 闭合脊柱，所以「smlib 的 sweep 本身吃不吃弧、吃不吃闭合」只能直接问内核。
 * 结论：都吃 —— 缺口在脊柱构造的引擎覆盖，不在扫掠。
 */
describe('smlib 内核级：真弧 / 闭合路径', () => {
  const p = (x: number, y: number, z: number) => ({ x, y, z })

  async function sweepSquareAlong(
    makePath: (prim: Awaited<ReturnType<typeof createSmlibPrimitives>>) => unknown,
  ): Promise<number> {
    const prim = await createSmlibPrimitives()
    const square = [
      prim.makeLineEdge(p(-2, -2, 0), p(2, -2, 0)),
      prim.makeLineEdge(p(2, -2, 0), p(2, 2, 0)),
      prim.makeLineEdge(p(2, 2, 0), p(-2, 2, 0)),
      prim.makeLineEdge(p(-2, 2, 0), p(-2, -2, 0)),
    ]
    const face = prim.makeFace(prim.makeWire(square))
    const path = prim.makeWire([makePath(prim) as never])
    const solid = prim.sweep(face, path)
    return prim.getVolume(solid) as number
  }

  it('K1 平面真弧 r=10 / 90° → 251.33（16 × 弧长 15.708）', async () => {
    const v = await sweepSquareAlong((prim) => prim.makeCircleArc(p(0, 0, 0), p(0, 1, 0), 10, 0, 90))
    expect(v).toBeCloseTo(16 * (Math.PI / 2) * 10, 2)
  })

  it('K2 闭合整圆 r=10 → 1005.31（16 × 周长 62.83）⇒ closed 可用', async () => {
    const v = await sweepSquareAlong((prim) => prim.makeCircleArc(p(0, 0, 0), p(0, 1, 0), 10, 0, 360))
    expect(v).toBeCloseTo(16 * 2 * Math.PI * 10, 1)
  })
})
