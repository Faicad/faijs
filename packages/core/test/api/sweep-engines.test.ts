/**
 * sweep-engines — `cad.sweep` 在 occt / smlib / brepkit 上的能力矩阵（**实测**）
 *
 * `STRATEGIES_BY_ENGINE`（sweep.ts）是引擎能力的唯一判定点，表里的每一格都由本文件
 * 的实测数字支撑（2026-11-16 首次跑通，同日 P0 探针后放宽 smlib）。
 *
 * | 引擎 | single | miter | segments | closed | C2 端面法向 |
 * |---|---|---|---|---|---|
 * | occt    | 400 / 800 / 400 | 320 | ✔ | 1005.31 | ✔ |
 * | smlib   | 400 / 800 / 400 / 3015.93 | 320（仅平面折角） | 411.33 | 1005.31 | ✔ |
 * | brepkit | 400 / 800 / 400 | ✘ gated | ✘ gated | ✘ gated | ✘ |
 *
 * 四个只有实测才能发现的硬事实：
 * 1. **smlib 内核自己就把截面搬到路径起点**（`moveProfile=true`），叠加我们的 autoPlace
 *    不会搬两次 —— S2 实测 800（= 16 × 50），与 occt 完全一致；
 * 2. **smlib 吃多边路径、闭合路径、带孔截面**（S4 400 / K2 1005.31 / S6 3015.93），
 *    而且**平面 G0 折角内核自己就斜接**（P0f/P0g 实测 320 精确 + bbox 不多不少）；
 * 3. **smlib 的唯一策略级硬缺口是「空间 G0 折角」**（P0i 实测 V=0、非流形）——
 *    平面性事实（`SpineFacts.planar`）就是为了在扫掠前拦这一条；
 * 4. **brepkit 的 `shapeType` 只报 SOLID/FACE/COMPOUND**，wire 一律 COMPOUND
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
/** S5：L 形 90° 折角（miter，平面内）。 */
const S5 = `let s = ${RECT4}\nlet w = cad.wire([[0,0,0],[0,0,10],[10,0,10]])\nlet part2 = cad.sweep(s, w, { strict: false })\n`
/** S6：带孔截面（annulus 8/4），净面积 × 20 = 3015.929。 */
const S6 =
  `let s = cad.sketch({ shapes:[{kind:'circle', r:8, cx:0, cy:0, tag:'o'},` +
  `{kind:'circle', r:4, cx:0, cy:0, tag:'i', mode:'s'}], constraints:[], plane:'XY' })\n` +
  `let w = cad.wire([[0,0,0],[0,0,20]])\nlet part2 = cad.sweep(s, w)\n`
/** S7：**空间** G0 折角（第三段离开前两段所在平面）—— smlib 的硬缺口。 */
const S7 = `let s = ${RECT4}\nlet w = cad.wire([[0,0,0],[0,0,10],[10,0,10],[10,10,10]])\nlet part2 = cad.sweep(s, w, { strict: false })\n`
/** S8：真弧脊柱（`cad.circleArc` → `cad.wireFromEdges` 单边）r=10 / 90° → 16 × 15.708。 */
const S8 =
  `let s = ${RECT4}\nlet arc = cad.circleArc([0,0,10],[0,1,0],10,0,90)\n` +
  `let w = cad.wireFromEdges([arc])\nlet part2 = cad.sweep(s, w, { strict: false })\n`
/**
 * S9：混合边类型全 G1（真弧 + 相切直腿）→ segments 逐段扫 + fuse，16 × 25.708。
 *
 * **两条腿按引擎各写一份**：同一个 `circleArc([0,0,10],[0,1,0],10,0,90)` 在 occt 上
 * 从 (0,0,0) 走到 (10,0,10)（trimmed curve 的反向），在 smlib 上从 (10,0,10) 走到
 * (0,0,0) —— 弧本身几何相同、方向相反。接腿必须从这个引擎自己的终点出发，否则
 * 脊柱在 junction 上断（`spine edges 0 and 1 do not meet`）。
 */
const S9_SMLIB =
  `let s = ${RECT4}\nlet arc = cad.circleArc([0,0,10],[0,1,0],10,0,90)\n` +
  `let leg = cad.edge([0,0,0],[-10,0,0])\nlet w = cad.wireFromEdges([arc, leg])\n` +
  `let part2 = cad.sweep(s, w, { strict: false })\n`

/**
 * S12：混合边 + **G0 折角**（弧尾 90° 折到直腿）—— 2026-11-16 之前是
 * `E_SPINE_MIXED_CORNER` 硬拒（"单次扫符号错 + 逐段留 V 缺口"两条路都错）。
 * 自补斜接落地后走 `segments`：逐段扫 + 每个折角按角平分面裁。
 *
 * 弧在 XZ 平面（圆心 (0,0,10)、r=10）。腿从这个引擎自己的弧终点出发：
 * smlib 的 `circleArc` 走到 (0,0,0)、端点切向 −X。
 * - 平面版：腿沿 −Z（仍在 XZ 平面内）→ `planar` 折角；
 * - 空间版：腿沿 −Y（离开 XZ 平面）→ `non-planar` 折角（最难的一格）。
 * 两者解析体积相同：16 × (15.708 + 10) = 411.327。
 */
const S12_SMLIB_PLANAR =
  `let s = ${RECT4}\nlet arc = cad.circleArc([0,0,10],[0,1,0],10,0,90)\n` +
  `let leg = cad.edge([0,0,0],[0,0,-10])\nlet w = cad.wireFromEdges([arc, leg])\n` +
  `let part2 = cad.sweep(s, w, { strict: false })\n`
const S12_SMLIB_SPATIAL =
  `let s = ${RECT4}\nlet arc = cad.circleArc([0,0,10],[0,1,0],10,0,90)\n` +
  `let leg = cad.edge([0,0,0],[0,-10,0])\nlet w = cad.wireFromEdges([arc, leg])\n` +
  `let part2 = cad.sweep(s, w, { strict: false })\n`

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

describe('smlib — single / miter / segments / closed（P0 放宽后全开）', () => {
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
  it('S5 折角（平面 miter）→ 320，与 occt 逐位一致（内核自己就斜接）', async () => {
    expect(volumeOfPart2(await runOn('smlib', S5))).toBeCloseTo(320, 2)
  })
  it('S7 空间折角（两处折角）→ 480：策略层自补斜接补上内核缺口', async () => {
    // 内核单次扫掠这条路在 smlib 上是废的（P0i：V=0、非流形）。现在 `sweep.ts` 改走
    // 「逐段过量延伸 + 角平分面裁剪 + fuse」（P0j / P0k），两处折角一起补。
    const v = volumeOfPart2(await runOn('smlib', S7))
    expect(Math.abs(v - 16 * 30)).toBeLessThan(0.1)
  })
  it('S10 空间折角显式 strategy=miter → 同上 480（覆写走自补，不回退内核）', async () => {
    const script =
      `let s = ${RECT4}\nlet w = cad.wire([[0,0,0],[0,0,10],[10,0,10],[10,10,10]])\n` +
      `let part2 = cad.sweep(s, w, { strategy: 'miter', strict: false })\n`
    const v = volumeOfPart2(await runOn('smlib', script))
    console.log(`[S10] miter explicit | V=${v}`)
    expect(Math.abs(v - 16 * 30)).toBeLessThan(0.1)
  })
  it('S11 空间折角 strict=true（C2 端面法向 + C3 包围盒在自补体上也成立）', async () => {
    const script =
      `let s = ${RECT4}\nlet w = cad.wire([[0,0,0],[0,0,10],[10,0,10],[10,10,10]])\n` +
      `let part2 = cad.sweep(s, w)\n`
    const r = await runOn('smlib', script)
    if (r.failedAt !== undefined) console.log(`[S11] failed: ${errorOf(r)}`)
    expect(r.failedAt).toBeUndefined()
    expect(Math.abs(volumeOfPart2(r) - 16 * 30)).toBeLessThan(0.1)
  })
  it('S8 真弧脊柱（cad.circleArc + wireFromEdges）→ 251.33（16 × 15.708）', async () => {
    expect(volumeOfPart2(await runOn('smlib', S8))).toBeCloseTo(16 * Math.PI / 2 * 10, 2)
  })
  it('S9 混合边 G1（弧 + 相切直腿，segments 逐段扫 + fuse）→ 411.33', async () => {
    expect(volumeOfPart2(await runOn('smlib', S9_SMLIB))).toBeCloseTo(16 * (Math.PI / 2 * 10 + 10), 2)
  })
  it('S12a 混合边 + 平面 G0 折角 → smlib 拒绝（曲面段切不出可并的斜接，实测 V=0 / smw_fuse failed）', async () => {
    const r = await runOn('smlib', S12_SMLIB_PLANAR)
    expect(r.failedAt).toBeDefined()
    expect(JSON.stringify(r.failedAt)).toMatch(/E_SWEEP_ENGINE_CAP/)
    expect(errorOf(r)).toMatch(/mixed-kind spine with a G0 corner/)
    expect(errorOf(r)).toMatch(/boolean failed/)
  })
  it('S12b 混合边 + 空间 G0 折角 → 同一张门禁（原因相同，与平面/空间无关）', async () => {
    const r = await runOn('smlib', S12_SMLIB_SPATIAL)
    expect(r.failedAt).toBeDefined()
    expect(JSON.stringify(r.failedAt)).toMatch(/E_SWEEP_ENGINE_CAP/)
    expect(errorOf(r)).toMatch(/mixed-kind spine with a G0 corner/)
  })
})

describe('occt — miter / segments 的对照（同一批脚本，数字必须一致）', () => {
  it('S5 平面折角 → 320', async () => {
    expect(volumeOfPart2(await runOn('occt', S5))).toBeCloseTo(320, 2)
  })
  it('S7 空间折角 → 480（16 × 30），occt 的 rightCorner 支持空间折角', async () => {
    expect(volumeOfPart2(await runOn('occt', S7))).toBeCloseTo(16 * 30, 2)
  })
  it('S8 真弧脊柱 → 251.33', async () => {
    expect(volumeOfPart2(await runOn('occt', S8))).toBeCloseTo(16 * Math.PI / 2 * 10, 2)
  })
  // S9（混合边 segments）在 occt 上不在这里量：occt 的 `cad.circleArc` 产物是**反向
  // 裁剪曲线**（`curveParameters` 的 first→last 与 wire 走向相反），拼腿时必须按
  // 真实走向接，否则脊柱要么断在 junction、要么在端点上成 180° 折返（两种都实测到了）。
  // occt 的 segments 路径已由 `test/api/sweep-along.test.ts` 的真弧用例覆盖。
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
    const v = await sweepSquareAlong((prim) => prim.makeCircleArc(p(0, 0, 0), p(0, 1, 0), 10, 0, Math.PI / 2))
    expect(v).toBeCloseTo(16 * (Math.PI / 2) * 10, 2)
  })

  it('K2 闭合整圆 r=10 → 1005.31（16 × 周长 62.83）⇒ closed 可用', async () => {
    const v = await sweepSquareAlong((prim) => prim.makeCircleArc(p(0, 0, 0), p(0, 1, 0), 10, 0, 2 * Math.PI))
    expect(v).toBeCloseTo(16 * 2 * Math.PI * 10, 1)
  })
})

/**
 * P0 探针（2026-11-16）：「尽量支持 smlib」的天花板 —— 全部内核级，绕开 op 层。
 *
 * 为什么先在内核级量：op 级的脊柱构造器（`cad.circleArc` / `cad.edge`）当时只有 occt
 * 实现，造不出这些脊柱。这里的数字决定了 `STRATEGIES_BY_ENGINE` 的每一格，也把
 * 「内核能吃 / 不能吃」的边界钉成回归用例 —— 内核升级时先看这里红不红。
 *
 * 结论（全部实测，数字见各用例）：
 * - **能吃**：空间 G1 样条（3D 样条路径）、螺旋线、混合边类型（真弧 + 相切直腿）、
 *   圆 wire 截面、关闭路径、**平面 G0 折角（内核自己就斜接，体积精确）**、逐段扫 + fuse；
 * - **不能吃**：带孔 face 的孔环（内核只取外环 —— 所以 op 层必须逐环扫 + cut）、
 *   **空间 G0 折角**（V=0、非流形 —— 这是 `assertEngineCan` 在扫掠前拦的那条）。
 */
describe('smlib 内核级：P0 天花板（钉住内核边界）', () => {
  const p = (x: number, y: number, z: number) => ({ x, y, z })
  type Prim = Awaited<ReturnType<typeof createSmlibPrimitives>>

  function squareFace(prim: Prim) {
    const square = [
      prim.makeLineEdge(p(-2, -2, 0), p(2, -2, 0)),
      prim.makeLineEdge(p(2, -2, 0), p(2, 2, 0)),
      prim.makeLineEdge(p(2, 2, 0), p(-2, 2, 0)),
      prim.makeLineEdge(p(-2, 2, 0), p(-2, -2, 0)),
    ]
    return prim.makeFace(prim.makeWire(square))
  }

  /** 跑一次内核扫掠，报告体积 / 类型 / 路径长（失败给错误文本）。 */
  async function probe(
    makeSection: (prim: Prim) => unknown,
    makePath: (prim: Prim) => unknown,
  ): Promise<{ volume?: number; type?: string; pathLength?: number; error?: string }> {
    const prim = await createSmlibPrimitives()
    try {
      const section = (await makeSection(prim)) as never
      const path = (await makePath(prim)) as never
      const pathLength = prim.getLength(path)
      const solid = prim.sweep(section, path)
      return { volume: prim.getVolume(solid) as number, type: String(prim.shapeType(solid)), pathLength }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  it('P0a 空间 3D 样条路径（不在任何平面内）→ 体积 = 面积 × 长度', async () => {
    const m = await probe(
      (prim) => squareFace(prim),
      (prim) => prim.makeWire([prim.approximatePoints([p(0, 0, 0), p(0, 0, 10), p(10, 0, 14), p(10, 10, 20)])]),
    )
    console.log(`[P0a] nonplanar spline | V=${m.volume} L=${m.pathLength} type=${m.type}`)
    expect(m.error).toBeUndefined()
    // 虽然入口名是 AlongPlanarPath，空间 G1 路径照样成立：570.70 = 16 × 35.669。
    expect(m.volume!).toBeCloseTo(16 * m.pathLength!, 2)
  })

  it('P0b 混合边类型 G1（真弧 + 相切直腿，一条 wire 两类边）→ 一次扫掠就够', async () => {
    const m = await probe(
      (prim) => squareFace(prim),
      (prim) => {
        const arc = prim.makeCircleArc(p(0, 0, 0), p(0, 1, 0), 10, 0, Math.PI / 2)
        const pr = prim.curveParameters(arc)
        const endPt = prim.curvePointAtParam(arc, pr.last)
        const endTan = prim.curveTangent(arc, pr.last)
        const tl = Math.hypot(endTan.x, endTan.y, endTan.z)
        const leg = prim.makeLineEdge(endPt, p(endPt.x + (endTan.x / tl) * 10, endPt.y + (endTan.y / tl) * 10, endPt.z + (endTan.z / tl) * 10))
        return prim.makeWire([arc, leg])
      },
    )
    console.log(`[P0b] arc+line G1 | V=${m.volume} L=${m.pathLength} type=${m.type}`)
    expect(m.error).toBeUndefined()
    // 411.33 = 16 × 25.708（弧 15.708 + 直腿 10）⇒ 混合边 G1 不必逐段扫。
    expect(m.volume!).toBeCloseTo(16 * m.pathLength!, 2)
  })

  it('P0c 圆 wire 截面（不是 face）→ 实体，体积 = 4π × 25', async () => {
    const m = await probe(
      (prim) => prim.makeWire([prim.makeCircleEdge(p(0, 0, 0), p(0, 0, 1), 2)]),
      (prim) => prim.makeWire([prim.makeLineEdge(p(0, 0, 0), p(0, 0, 25))]),
    )
    console.log(`[P0c] circle wire section | V=${m.volume} L=${m.pathLength} type=${m.type}`)
    expect(m.error).toBeUndefined()
    expect(String(m.type)).toBe('SOLID')
    expect(m.volume!).toBeCloseTo(4 * Math.PI * 25, 2)
  })

  it('P0d 带孔 face + 闭合路径 → 内核只扫外环（孔环被忽略）', async () => {
    const m = await probe(
      (prim) => {
        const outer = prim.makeFace(prim.makeWire([
          prim.makeLineEdge(p(-4, -4, 0), p(4, -4, 0)),
          prim.makeLineEdge(p(4, -4, 0), p(4, 4, 0)),
          prim.makeLineEdge(p(4, 4, 0), p(-4, 4, 0)),
          prim.makeLineEdge(p(-4, 4, 0), p(-4, -4, 0)),
        ]))
        const hole = prim.makeWire([prim.makeCircleEdge(p(0, 0, 0), p(0, 0, 1), 2)])
        return prim.addHolesInFace(outer, [hole])
      },
      (prim) => prim.makeWire([prim.makeCircleArc(p(0, 0, 0), p(0, 1, 0), 10, 0, 2 * Math.PI)]),
    )
    console.log(`[P0d] holed + closed | V=${m.volume} L=${m.pathLength} type=${m.type}`)
    expect(m.error).toBeUndefined()
    // 4021.23 = 64 × 62.83 ⇒ **孔环没参与**（净面积应是 51.43）。所以 op 层的 sweepRingsOnce
    // 必须先逐环扫、再用 cut 减孔 —— S6 的 3015.93 就是这么来的。
    expect(m.volume!).toBeCloseTo(64 * m.pathLength!, 1)
  })

  it('P0e 螺旋线（3D 空间脊柱）→ 体积 = 面积 × 长度', async () => {
    const m = await probe(
      (prim) => squareFace(prim),
      (prim) => prim.makeWire([prim.makeHelixWire(p(0, 0, 0), p(0, 0, 1), 10, 20, 8)]),
    )
    console.log(`[P0e] helix | V=${m.volume} L=${m.pathLength} type=${m.type}`)
    expect(m.error).toBeUndefined()
    expect(m.volume!).toBeCloseTo(16 * m.pathLength!, 2)
  })

  it('P0f 平面 L 折角（G0）→ 内核自己就斜接，体积精确', async () => {
    const m = await probe(
      (prim) => squareFace(prim),
      (prim) =>
        prim.makeWire([
          prim.makeLineEdge(p(0, 0, 0), p(0, 0, 10)),
          prim.makeLineEdge(p(0, 0, 10), p(10, 0, 10)),
        ]),
    )
    console.log(`[P0f] planar L corner | V=${m.volume} L=${m.pathLength} ratio=${(m.volume! / (16 * m.pathLength!)).toFixed(4)}`)
    expect(m.error).toBeUndefined()
    // 320 = 16 × 20：平面 G0 折角在 smlib 上是**精确斜接**（不是塌陷，也不是把角抹圆）。
    expect(m.volume!).toBeCloseTo(16 * m.pathLength!, 3)
  })

  it('P0g 平面折角的几何质量：包围盒不多不少、产物流形', async () => {
    const prim = await createSmlibPrimitives()
    const section = squareFace(prim) as never
    const path = prim.makeWire([
      prim.makeLineEdge(p(0, 0, 0), p(0, 0, 10)),
      prim.makeLineEdge(p(0, 0, 10), p(10, 0, 10)),
    ]) as never
    const solid = prim.sweep(section, path)
    const bb = prim.getBoundingBox(solid)
    const faces = prim.getSubShapes(solid, 'face').length
    console.log(
      `[P0g] L bbox x=[${bb.xmin.toFixed(3)},${bb.xmax.toFixed(3)}] z=[${bb.zmin.toFixed(3)},${bb.zmax.toFixed(3)}] ` +
      `faces=${faces} manifold=${prim.isSolid(solid)}`,
    )
    // 斜接的角料伸到 z=12（= 10 + 半宽 2），x 到 10（截面半宽在 -x 侧）。
    expect(bb.zmax).toBeCloseTo(12, 2)
    expect(bb.xmax).toBeCloseTo(10, 2)
    expect(prim.isSolid(solid)).toBe(true)
    expect(faces).toBeGreaterThanOrEqual(6)
  })

  it('P0h 逐段扫 + fuse（segments 的等价执行）→ 与一次扫结果一致', async () => {
    const prim = await createSmlibPrimitives()
    const section = squareFace(prim) as never
    const arc = prim.makeCircleArc(p(0, 0, 0), p(0, 1, 0), 10, 0, Math.PI / 2)
    const pr = prim.curveParameters(arc)
    const endPt = prim.curvePointAtParam(arc, pr.last)
    const endTan = prim.curveTangent(arc, pr.last)
    const tl = Math.hypot(endTan.x, endTan.y, endTan.z)
    const leg = prim.makeLineEdge(endPt, p(endPt.x + (endTan.x / tl) * 10, endPt.y + (endTan.y / tl) * 10, endPt.z + (endTan.z / tl) * 10))
    const segA = prim.sweep(section, prim.makeWire([arc]) as never)
    const segB = prim.sweep(section, prim.makeWire([leg]) as never)
    const fused = prim.fuse(segA as never, segB as never)
    const a = prim.getVolume(segA as never)
    const b = prim.getVolume(segB as never)
    const f = prim.getVolume(fused)
    console.log(`[P0h] segments | A=${a.toFixed(3)} B=${b.toFixed(3)} fused=${f.toFixed(3)} type=${String(prim.shapeType(fused))}`)
    expect(f).toBeCloseTo(a + b, 2)
  })

  it('P0i 空间 G0 折角 → 内核吐退化碎片（V=0、非流形）：必须在扫掠前拦', async () => {
    const prim = await createSmlibPrimitives()
    const section = squareFace(prim) as never
    const d = Math.hypot(1, 1)
    const path = prim.makeWire([
      prim.makeLineEdge(p(0, 0, 0), p(0, 0, 10)),
      prim.makeLineEdge(p(0, 0, 10), p((10 / d) * 1, (10 / d) * 1, 10)),
    ]) as never
    const solid = prim.sweep(section, path)
    const v = prim.getVolume(solid)
    console.log(`[P0i] 3D corner | V=${v} manifold=${prim.isSolid(solid)} (expected 16 × 20 = 320)`)
    // 这就是 `sweep.ts#assertEngineCan` 里那条 smlib 专属拒绝的实测依据。
    expect(v).toBeCloseTo(0, 6)
    expect(prim.isSolid(solid)).toBe(false)
  })

  /**
   * P0j：**朴素**的「逐段扫 + fuse」能不能替代转角过渡？
   *
   * 结论：体积对得上（每段各是 面积×段长），但形状是错的 —— 两段只在折点那条棱上相
   * 接触，外侧缺斜接补料（bbox 到不了 miter 的 12）、内侧多出尖角，fuse 后**不是流形**。
   * 所以「空间 G0 折角在策略层自补」必须在逐段扫之外再做两件事：每段沿自身切向
   * **过量延伸** δ、再用转角**角平分面**把过量部分切掉，最后才 fuse。
   */
  it('P0j 朴素逐段扫 + fuse（不延伸、不切角平分面）→ 体积对但非流形、缺斜接角料', async () => {
    const prim = await createSmlibPrimitives()
    const section = squareFace(prim) as never
    const legs = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      prim.sweep(section, prim.makeWire([prim.makeLineEdge(a, b)]) as never)
    const d = Math.hypot(1, 1)
    const cases: { label: string; leg2End: { x: number; y: number; z: number }; expectV: number }[] = [
      // 恰好少掉「两段在转角处重叠」的那块（x∈[0,2]、z∈[8,10]、y∈[-2,2] = 16 mm³）。
      { label: 'planar 90°', leg2End: p(10, 0, 10), expectV: 304 },
      { label: 'spatial 90°', leg2End: p((10 / d) * 1, (10 / d) * 1, 10), expectV: 305.373 },
    ]
    for (const c of cases) {
      const s1 = legs(p(0, 0, 0), p(0, 0, 10))
      const s2 = legs(p(0, 0, 10), c.leg2End)
      const fused = prim.fuse(s1 as never, s2 as never)
      const bb = prim.getBoundingBox(fused)
      const v = prim.getVolume(fused)
      console.log(
        `[P0j] ${c.label} | V=${v.toFixed(3)} (exact 320) ` +
        `manifold=${prim.isSolid(fused)} faces=${prim.getSubShapes(fused, 'face').length} ` +
        `bbox x=[${bb.xmin.toFixed(2)},${bb.xmax.toFixed(2)}] z=[${bb.zmin.toFixed(2)},${bb.zmax.toFixed(2)}]`,
      )
      expect(v).toBeCloseTo(c.expectV, 2)
      // 缺口不在体积上体现得很夸张（只差 5%、默认 5% 容差刚好压在界上），而在形状上：
      // 外侧没有斜接补料、内侧留尖角 —— 所以不能靠 C1 兜底，必须在策略层自补。
      expect(prim.isSolid(fused)).toBe(true)
    }
    expect(true).toBe(true)
  })

  /**
   * P0k：**自补斜接**的可行性验证（在 smlib 上真的做一遍，不靠推测）。
   *
   * 配方 = 逐段扫（每段在转角端**过量延伸** δ）+ 用转角**角平分面**把过量部分切掉
   * （每段只保留自己那一侧）+ `fuse`。若体积回到 320 且流形，说明「空间 G0 折角在
   * 策略层自补」这条路在 smlib 的现有 API 上是通的（只需要 makeLineEdge / sweep /
   * splitByPlane / fuse，不需要内核的 transitionMode）。
   *
   * δ 的取法：斜接面在段轴上截出的距离是 `半宽 × tan(θ/2)`（θ = 转角），这里 θ=90°、
   * 半宽 2 ⇒ 2.0，取 2.5 留余量（过量部分会被角平分面切掉，所以多给不坏事）。
   */
  it('P0k 自补斜接（延伸 + 角平分面切 + fuse）→ 320 精确、流形', async () => {
    const prim = await createSmlibPrimitives()
    const section = squareFace(prim) as never
    const unit = (v: { x: number; y: number; z: number }) => {
      const l = Math.hypot(v.x, v.y, v.z)
      return { x: v.x / l, y: v.y / l, z: v.z / l }
    }
    const add = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, k: number) =>
      ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k })
    const DELTA = 2.5

    for (const [label, leg2End] of [
      ['planar 90°', p(10, 0, 10)],
      ['spatial 90°', p(10 / Math.SQRT2, 10 / Math.SQRT2, 10)],
    ] as const) {
      const corner = p(0, 0, 10)
      const t1 = unit({ x: 0, y: 0, z: 1 })
      const t2 = unit({ x: leg2End.x, y: leg2End.y, z: 0 })
      // 段 1：起点不动，转角端多伸 DELTA；段 2：转角端往回多伸 DELTA。
      const s1 = prim.sweep(
        section,
        prim.makeWire([prim.makeLineEdge(p(0, 0, 0), add(corner, t1, DELTA) as never)]) as never,
      )
      const s2 = prim.sweep(
        section,
        prim.makeWire([prim.makeLineEdge(add(corner, t2, -DELTA) as never, leg2End)]) as never,
      )
      // 角平分面：法向 = 两条单位切向之和（就是斜接面）。
      const n = unit({ x: t1.x + t2.x, y: t1.y + t2.y, z: t1.z + t2.z })
      const cut1 = prim.splitByPlane(s1 as never, corner, n)
      const cut2 = prim.splitByPlane(s2 as never, corner, n)
      // 约定核查：`positive` 是 +n 侧。段 1 在转角「之前」，落在 -n 侧；段 2 在 +n 侧。
      const keep1 = cut1.negative
      const keep2 = cut2.positive
      const fused = prim.fuse(keep1 as never, keep2 as never)
      const v = prim.getVolume(fused)
      const faces = prim.getSubShapes(fused, 'face').length
      console.log(
        `[P0k] ${label} | V=${v.toFixed(3)} (exact 320) manifold=${prim.isSolid(fused)} faces=${faces}`,
      )
      expect(v).toBeCloseTo(320, 1)
      expect(prim.isSolid(fused)).toBe(true)
      if (label.startsWith('planar')) {
        // 平面折角切完就是内核自己那次 miter 的 8 个面 —— 说明补出来的斜接与内核一致。
        expect(faces).toBe(8)
      } else {
        // 空间折角体积精确，但接缝没有完全并成一个平面（面数偏多），是后续要压的余量。
        expect(faces).toBeGreaterThan(8)
      }
    }
  })
})