/**
 * @vitest-environment node
 *
 * 扫掠「丢体积 / 丢内腔」的**分层归因**（内核 vs 绑定层 vs faijs API，2026-11-16 实测）
 *
 * 为什么要有这个文件：此前把「曲面扫掠丢体积」笼统归给内核，导致方案方向偏离。真实原因是
 * 三层各有一份责任，且**可归因、可复现**。这里把每一层的行为钉成断言，防止结论再漂。
 *
 * 三层与本文件的对应：
 *   K1/K3 内核能力（OCCT 经 occt-wasm）—— 三维曲线扫掠是**完备**的
 *   K2    默认参数（`transitionMode: Transformed`）在 G0 折线脊柱上的「平移塌陷」
 *   K4    体积守卫的盲区（体积单指标抓不住浅折角的塌陷）
 *   K5    截面定位：`pipe` / `withContact` / `withCorrection` 各自到底做了什么
 *
 * 观测量：BREP 体积 + bbox + 面数。体积恒等式「等截面扫掠 = 截面积 × 脊柱长度」（Pappus）。
 *
 * 运行：npx vitest run test/api/sweep-kernel-behavior.test.ts
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

const R_SECTION = 6
const AREA = Math.PI * R_SECTION * R_SECTION
/** 弧 R10、90° 的弧长。 */
const ARC_LEN = (Math.PI / 2) * 10

/** 圆截面：XY 平面、法向 +Z、中心在原点（= 下面所有脊柱的起点）。 */
const SEC =
  `cad.sketch({ plane: 'XY', shapes: [{ kind: 'circle', r: ${R_SECTION}, cx: 0, cy: 0, tag: 's' }], constraints: [] })`

const n = (v: number): string => (Math.abs(v) < 1e-12 ? '0' : v.toFixed(7))

interface Measure {
  volume: number
  size: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  faces: number
}

/** 跑一段脚本，量 part2 的体积 / bbox / 面数。失败时返回错误消息。 */
async function measure(
  spine: string,
  stmt: (sec: string, sp: string) => string,
): Promise<Measure | { error: string }> {
  const code = `let sec = ${SEC}\nlet sp = ${spine}\n` + `${stmt('sec', 'sp')}\n`
  const r = await exec('brep', code)
  if (r.failedAt) return { error: String(r.failedAt.message ?? '') }
  const out = r.outputs.get(asPartName('part2')) as Shape | undefined
  if (!out) return { error: 'no part2 output' }
  const api = getBrepApi()
  const h = brepOf(out) as never
  const b = api.getBoundingBox(h)
  return {
    volume: api.getVolume(h),
    size: [b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin],
    min: [b.xmin, b.ymin, b.zmin],
    max: [b.xmax, b.ymax, b.zmax],
    faces: api.getSubShapes(h, 'face').length,
  }
}

function expectOk(m: Measure | { error: string }): Measure {
  if ('error' in m) throw new Error(`expected success, got: ${m.error.slice(0, 200)}`)
  return m
}

/** 弧 R10、90° 上的点（圆心 (0,-10,0)，0° → (0,0,0)，90° → (0,-10,-10) 由 axis 决定）。 */
function arcPoints(steps: number): string {
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = ((90 * i) / steps) * (Math.PI / 180)
    pts.push(`[0,${n(-10 + 10 * Math.cos(t))},${n(10 * Math.sin(t))}]`)
  }
  return `cad.wire([${pts.join(',')}])`
}

const ARC_1EDGE = 'cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE)])'
const ARC_2EDGES =
  'cad.wireFromEdges([' +
  'cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,45*DEGREE),' +
  'cad.circleArc([0,-10,0],[1,0,0],10,45*DEGREE,90*DEGREE)])'
/** 相切拼接：真弧 + 直腿（G1 连续，但边类型混合）。 */
const ARC_PLUS_LINE =
  'cad.wireFromEdges([' +
  'cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE),' +
  'cad.edge([0,-10,10],[0,-20,10])])'
/** 共线两段（G1 连续的最简多边 wire）。 */
const COLLINEAR_2 = 'cad.wire([[0,0,0],[0,0,10],[0,0,20]])'

const PIPE = (s: string, p: string): string => `let part2 = cad.pipe(${s}, ${p}, { volumeTolerance: 0.99 })`
const SWEEP_DEFAULT = (s: string, p: string): string =>
  `let part2 = cad.sweepAdvanced(${s}, ${p}, { volumeTolerance: 0.99 })`
const sweepWith = (opts: string) => (s: string, p: string): string =>
  `let part2 = cad.sweepAdvanced(${s}, ${p}, { ${opts}, volumeTolerance: 0.99 })`

describe('K1 内核能力：G1 连续脊柱，所有入口都精确（OCCT 对三维曲线扫掠是完备的）', () => {
  it('K1a. 单段真弧：pipe / sweepAdvanced 默认 / frenet 全部 = 面积 × 弧长', async () => {
    await useOcct()
    const analytic = AREA * ARC_LEN
    for (const [label, stmt] of [
      ['pipe', PIPE],
      ['sweepAdvanced {}', SWEEP_DEFAULT],
      ['frenet', sweepWith(`frenet: true`)],
      ['orientation:frenet', sweepWith(`orientation: 'frenet'`)],
      ['orientation:fixed', sweepWith(`orientation: 'fixed'`)],
    ] as [string, (s: string, p: string) => string][]) {
      const m = expectOk(await measure(ARC_1EDGE, stmt))
      expect(Math.abs(m.volume - analytic) / analytic, `${label} on a single arc`).toBeLessThan(1e-3)
      // 真弧的产物是标准圆环：z 从 -16 到 0（-10-6 .. 0），y 从 -10 到 6。
      expect(m.size[0]).toBeCloseTo(12, 1)
      expect(m.size[1]).toBeCloseTo(16, 1)
      expect(m.size[2]).toBeCloseTo(16, 1)
    }
  })

  it('K1b. 同一条弧切成 2 段（G1 接缝）→ 仍然精确（多边 wire 本身不是问题）', async () => {
    await useOcct()
    const analytic = AREA * ARC_LEN
    const m = expectOk(await measure(ARC_2EDGES, PIPE))
    expect(Math.abs(m.volume - analytic) / analytic).toBeLessThan(1e-3)
    // 面数从 3 涨到 4：接缝被各扫一段，但几何依旧正确。
    expect(m.faces).toBeGreaterThanOrEqual(4)
  })

  it('K1c. 相切「真弧 + 直腿」（G1、边类型混合）→ 精确（推翻「相切多段丢 85.5%」的旧结论）', async () => {
    await useOcct()
    const analytic = AREA * (ARC_LEN + 10)
    const m = expectOk(await measure(ARC_PLUS_LINE, PIPE))
    expect(Math.abs(m.volume - analytic) / analytic).toBeLessThan(1e-3)
    // 直腿确实扫到了：y 到 -20（弧终点 -10 再走 10），管半径 6 → y 最小 -20。
    expect(m.size[1]).toBeCloseTo(26, 1)
  })

  it('K1d. 共线两段（最简多边 wire）→ 精确', async () => {
    await useOcct()
    const m = expectOk(await measure(COLLINEAR_2, PIPE))
    expect(m.volume).toBeCloseTo(AREA * 20, 0)
    expect(m.size[2]).toBeCloseTo(20, 1)
  })

  it('K1e. 带孔 face 内核原生接受（内腔不丢）—— 交叉引用 sweep-hollow-pipe F1', async () => {
    await useOcct()
    const ring =
      `cad.sketch({ plane: 'XY', shapes: [` +
      `{ kind: 'circle', r: 8, cx: 0, cy: 0, tag: 'o' },` +
      `{ kind: 'circle', r: 4, cx: 0, cy: 0, tag: 'i', mode: 's' }], constraints: [] })`
    const code =
      `let sec = ${ring}\nlet sp = cad.wire([[0,0,0],[0,0,20]])\n` +
      `let part2 = cad.pipe(sec, sp, { volumeTolerance: 0.99 })\n`
    const r = await exec('brep', code)
    expect(r.failedAt).toBeFalsy()
    const out = r.outputs.get(asPartName('part2')) as Shape
    const v = getBrepApi().getVolume(brepOf(out) as never)
    // 净面积 × 长度；若丢内腔则会等于外圆面积 × 长度（4021 vs 3016）。
    expect(v).toBeCloseTo(Math.PI * (64 - 16) * 20, 0)
  })
})

describe('K2 默认参数：G0 折线脊柱在 transitionMode=Transformed 下退化为「平移塌陷」', () => {
  /** 折线近似同一条弧（4 段）。 */
  const POLY_4 = arcPoints(4)
  const L90 = 'cad.wire([[0,0,0],[0,0,10],[0,-10,10]])'

  it('K2a. 折线脊柱：所有入口给出**同一个**体积 = 面积 × 路径在原始截面法向(+Z)的净位移', async () => {
    await useOcct()
    const dz = 10 // 弧的 z 从 0 到 10
    const translationVolume = AREA * dz
    for (const [label, stmt] of [
      ['pipe', PIPE],
      ['sweepAdvanced {}', SWEEP_DEFAULT],
      ['frenet:true', sweepWith(`frenet: true`)],
      ['orientation:frenet', sweepWith(`orientation: 'frenet'`)],
      ['orientation:fixed', sweepWith(`orientation: 'fixed'`)],
      ['fixedUp,+Z', sweepWith(`orientation: 'fixedUp', up: [0,0,1]`)],
    ] as [string, (s: string, p: string) => string][]) {
      const m = expectOk(await measure(POLY_4, stmt))
      expect(Math.abs(m.volume - translationVolume) / translationVolume, `${label} translation model`).toBeLessThan(
        2e-3,
      )
    }
  })

  it('K2b. 判别「截面没转」靠 bbox：产物 z 跨度 = 路径 z 跨度（没有管半径 ±6 的展开）', async () => {
    await useOcct()
    const m = expectOk(await measure(POLY_4, PIPE))
    // 路径 z ∈ [0,10]；正确扫掠应到 z ∈ [-6,16]（跨度 22）。实测跨度 10 ⇒ 截面全程水平。
    expect(m.size[2]).toBeCloseTo(10, 1)
    expect(m.size[1]).toBeCloseTo(22, 1)
    // 面数随段数增长 ⇒ 不是「只扫第一段」，而是「逐段扫、但每段截面都不旋转」。
    const finer = expectOk(await measure(arcPoints(16), PIPE))
    expect(finer.faces).toBeGreaterThan(m.faces)
    expect(finer.size[2]).toBeCloseTo(10, 1)
    expect(finer.volume).toBeCloseTo(m.volume, 0)
  })

  it('K2c. 90° 折角同样塌陷：体积 = 面积 × 首段长度（第二段垂直于原法向，贡献 0）', async () => {
    await useOcct()
    const m = expectOk(await measure(L90, PIPE))
    expect(m.volume).toBeCloseTo(AREA * 10, 0)
    expect(m.size[2]).toBeCloseTo(10, 1)
  })
})

describe('K3 转角过渡才是折线扫掠的正解（内核本来就会做斜接）', () => {
  const corner = (deg: number): string => {
    const t = (deg * Math.PI) / 180
    return `cad.wire([[0,0,0],[0,0,10],[0,${n(-10 * Math.sin(t))},${n(10 + 10 * Math.cos(t))}]])`
  }

  it('K3a. 45° 折角 + rightCorner（斜接）→ 体积 = 面积 × 路径长（精确）', async () => {
    await useOcct()
    const m = expectOk(await measure(corner(45), sweepWith(`orientation: 'frenet', transitionMode: 'rightCorner'`)))
    expect(m.volume).toBeCloseTo(AREA * 20, 0)
    // 斜接后 bbox 才展开到管半径：z 跨度 21.3，而默认参数只有 17.07。
    expect(m.size[2]).toBeGreaterThan(20)
  })

  it('K3b. 45° 折角 + roundCorner（圆角）→ 接近解析值（0.997），bbox 同样展开', async () => {
    await useOcct()
    const m = expectOk(await measure(corner(45), sweepWith(`orientation: 'frenet', transitionMode: 'roundCorner'`)))
    expect(Math.abs(m.volume - AREA * 20) / (AREA * 20)).toBeLessThan(5e-3)
  })

  it('K3c. 显式 transformed = 默认行为（塌陷）；证明差别在过渡模式而不在朝向模式', async () => {
    await useOcct()
    const t = expectOk(await measure(corner(45), sweepWith(`orientation: 'frenet', transitionMode: 'transformed'`)))
    expect(t.volume).toBeCloseTo(AREA * 17.0710678, 0)
  })

  it('K3d. 折线 16 段 + roundCorner → 内核抛 Geom_RectangularTrimmedSurface（圆角在密集锐角上不成立）', async () => {
    await useOcct()
    const m = await measure(arcPoints(16), sweepWith(`orientation: 'frenet', transitionMode: 'roundCorner'`))
    expect('error' in m).toBe(true)
    expect(String((m as { error: string }).error)).toMatch(/Geom_/)
  })
})

describe('K4 体积守卫的盲区：浅折角的塌陷在 5% 阈值内会被静默放行', () => {
  it('K4a. 15° 折角：体积只偏 1.70%（< 5% 放行），但截面全程未旋转 —— 几何是错的', async () => {
    await useOcct()
    const t = (15 * Math.PI) / 180
    const zEnd = 10 + 10 * Math.cos(t)
    const spine = `cad.wire([[0,0,0],[0,0,10],[0,${n(-10 * Math.sin(t))},${n(zEnd)}]])`
    // 不传 volumeTolerance ⇒ 走默认 5% 守卫；这里必须**成功**（放行），正是问题所在。
    const r = await exec('brep', `let sec = ${SEC}\nlet sp = ${spine}\nlet part2 = cad.sweepAdvanced(sec, sp)\n`)
    expect(r.failedAt).toBeFalsy()
    const m = await measure(spine, SWEEP_DEFAULT)
    const got = expectOk(m)
    const analytic = AREA * 20
    expect(Math.abs(got.volume - analytic) / analytic).toBeLessThan(0.05)
    // 但 bbox z 跨度 == 路径 z 跨度：没有任何管半径展开 ⇒ 截面没旋转 ⇒ 产物是「压扁的平移体」。
    expect(got.size[2]).toBeCloseTo(zEnd, 1)
  })

  it('K4b. 30° / 45° / 90° 折角：偏离 6.7% / 14.6% / 50%，守卫才拦得住', async () => {
    await useOcct()
    for (const [deg, rel] of [
      [30, 0.067],
      [45, 0.1464],
      [90, 0.5],
    ] as [number, number][]) {
      const t = (deg * Math.PI) / 180
      const spine = `cad.wire([[0,0,0],[0,0,10],[0,${n(-10 * Math.sin(t))},${n(10 + 10 * Math.cos(t))}]])`
      const m = expectOk(await measure(spine, SWEEP_DEFAULT))
      const observed = Math.abs(m.volume - AREA * 20) / (AREA * 20)
      expect(observed).toBeCloseTo(rel, 2)
    }
  })
})

describe('K5 截面定位：pipe / withContact / withCorrection 各自到底做了什么', () => {
  /** 截面在原点 XY 平面（法向 +Z），脊柱从 (0,0,90) 起沿 +Y 走 50：既不在起点、法向也不对。 */
  const SP = 'cad.wire([[0,0,90],[0,50,90]])'
  const expected = AREA * 50

  it('K5a. pipe（MakePipe）不做任何搬移 → 体积对不上，被守卫拦下', async () => {
    await useOcct()
    const m = await measure(SP, PIPE)
    expect('error' in m).toBe(true)
    expect(String((m as { error: string }).error)).toMatch(/swept volume does not match/i)
  })

  it('K5b. withContact 单独：只平移不相对于脊柱转正 → 仍被拦（不是"自动定位"开关）', async () => {
    await useOcct()
    const m = await measure(SP, sweepWith(`withContact: true`))
    expect('error' in m).toBe(true)
  })

  it('K5c. withCorrection 单独：只旋转不平移 → 体积对，但管留在原点（位置错）', async () => {
    await useOcct()
    const m = expectOk(await measure(SP, sweepWith(`withCorrection: true`)))
    expect(m.volume).toBeCloseTo(expected, 0)
    // 截面被转成法向 +Y，但没搬：管跨 y ∈ [-50, 0]，z ∈ [-6, 6]。
    expect(m.min[1]).toBeCloseTo(-50, 0)
    expect(m.max[1]).toBeCloseTo(0, 0)
    expect(m.max[2]).toBeCloseTo(6, 0)
  })

  it('K5d. withContact + withCorrection 合用：才真正搬到脊柱起点且转正（唯一正解）', async () => {
    await useOcct()
    const m = expectOk(await measure(SP, sweepWith(`withContact: true, withCorrection: true`)))
    expect(m.volume).toBeCloseTo(expected, 0)
    expect(m.min[1]).toBeCloseTo(0, 0)
    expect(m.max[1]).toBeCloseTo(50, 0)
    expect(m.min[2]).toBeCloseTo(90, 0)
    expect(m.max[2]).toBeCloseTo(102, 0)
  })
})


describe('K6 多拐角折线：rightCorner 是唯一可用的一调用解，roundCorner 在密集锐角上崩', () => {
  const L90 = 'cad.wire([[0,0,0],[0,0,10],[0,-10,10]])'

  it('K6a. 单拐角 90° + rightCorner = 精确（1.0000）；transformed 只有 0.5', async () => {
    await useOcct()
    const rc = expectOk(await measure(L90, sweepWith(`orientation: 'frenet', transitionMode: 'rightCorner'`)))
    expect(rc.volume).toBeCloseTo(AREA * 20, 0)
    const tf = expectOk(await measure(L90, sweepWith(`orientation: 'frenet', transitionMode: 'transformed'`)))
    expect(tf.volume).toBeCloseTo(AREA * 10, 0)
  })

  it('K6b. 多拐角折线 + rightCorner：0.94–0.96（远好于默认 0.64，但不是解析值）', async () => {
    await useOcct()
    for (const [steps, low, high] of [
      [4, 0.94, 0.97],
      [16, 0.93, 0.96],
    ] as [number, number, number][]) {
      const m = expectOk(await measure(arcPoints(steps), sweepWith(`orientation: 'frenet', transitionMode: 'rightCorner'`)))
      expect(m.volume / (AREA * ARC_LEN)).toBeGreaterThan(low)
      expect(m.volume / (AREA * ARC_LEN)).toBeLessThan(high)
    }
  })

  it('K6c. 多拐角折线 + roundCorner：内核直接失败（Geom_RectangularTrimmedSurface）', async () => {
    await useOcct()
    const m = await measure(arcPoints(4), sweepWith(`orientation: 'frenet', transitionMode: 'roundCorner'`))
    expect('error' in m).toBe(true)
    expect(String((m as { error: string }).error)).toMatch(/Geom_/)
  })

  it('K6d. 结论性对照：同一折线上 pipeAlong（逐段 union）反而少于 rightCorner 一次斜接', async () => {
    await useOcct()
    const spine = arcPoints(4)
    const pa = expectOk(await measure(spine, (s, p) => `let part2 = cad.pipeAlong(${s}, ${p}, { volumeTolerance: 0.99 })`))
    const rc = expectOk(await measure(spine, sweepWith(`orientation: 'frenet', transitionMode: 'rightCorner'`)))
    expect(pa.volume).toBeLessThan(rc.volume)
  })
})

describe('K7 已发现的独立缺陷：G1 相切的两个扫掠实体 union 会丢掉一个（OPEN）', () => {
  it('K7. 当前错误值 = 只剩弧（1776.5）；应有正确值 ≈ 弧+直腿（2907.5 减重叠）', async () => {
    await useOcct()
    const code =
      `let sec = ${SEC}\n` +
      `let a = cad.pipeAlong(sec, cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE)]), { volumeTolerance: 0.99 })\n` +
      `let b = cad.pipeAlong(sec, cad.wireFromEdges([cad.edge([0,-10,10],[0,-20,10])]), { volumeTolerance: 0.99 })\n` +
      `let part2 = cad.union(a, b)\n`
    const r = await exec('brep', code)
    expect(r.failedAt).toBeFalsy()
    const out = r.outputs.get(asPartName('part2')) as Shape
    const api = getBrepApi()
    const h = brepOf(out) as never
    const v = api.getVolume(h)
    const arcOnly = AREA * ARC_LEN
    const sumOfParts = arcOnly + AREA * 10
    // ── 当前错误值：union 结果 == 只有弧（直腿被吞）。
    expect(v).toBeCloseTo(arcOnly, 0)
    expect(api.getSubShapes(h, 'face').length).toBe(3)
    // ── 应有正确值：两个实体都保留（严格小于简单相加，因为相切段有重叠，但远大于只看弧）。
    // 修复后这里必须翻转成 `toBeGreaterThan(arcOnly * 1.2)` 之类的下界。
    expect(v).toBeLessThan(sumOfParts)
    expect(sumOfParts - v).toBeGreaterThan(AREA * 5)
  })

  it('K7b. 对照：不相交的两个实体 union 正常（体积相加、6 面）—— 排除 getVolume 的 compound 处理', async () => {
    await useOcct()
    const code =
      `let sec = ${SEC}\n` +
      `let a = cad.pipeAlong(sec, cad.wire([[0,0,0],[0,0,10]]), { volumeTolerance: 0.99 })\n` +
      `let b = cad.pipeAlong(sec, cad.wire([[0,100,0],[0,100,10]]), { volumeTolerance: 0.99 })\n` +
      `let part2 = cad.union(a, b)\n`
    const r = await exec('brep', code)
    expect(r.failedAt).toBeFalsy()
    const api = getBrepApi()
    const h = brepOf(r.outputs.get(asPartName('part2')) as Shape) as never
    expect(api.getVolume(h)).toBeCloseTo(AREA * 20, 0)
    expect(api.getSubShapes(h, 'face').length).toBe(6)
  })
})

describe('DIAG4（临时）：插值样条脊柱（密采样折线的平滑化）能否一次扫掠精确', () => {
  it('D4. interpolateWithTangents 过 16 点 → wire → 一次 sweep，体积 vs 面积×弧长', async () => {
    await useOcct()
    const pts: string[] = []
    for (let i = 0; i <= 16; i++) {
      const t = ((90 * i) / 16) * (Math.PI / 180)
      pts.push(`[0,${n(-10 + 10 * Math.cos(t))},${n(10 * Math.sin(t))}]`)
    }
    const ptsArr = pts.join(',')
    for (const [tag, spine] of [
      ['polyline', `cad.wire([${ptsArr}])`],
      ['spline', `cad.wireFromEdges([cad.interpolateWithTangents([${ptsArr}], [0,0,1], [0,1,0])])`],
      ['approx', `cad.wireFromEdges([cad.approximatePoints([${ptsArr}])])`],
    ] as [string, string][]) {
      for (const opts of [
        `{ orientation: 'frenet', withContact: true, withCorrection: true`,
        `{ orientation: 'frenet', transitionMode: 'rightCorner', withContact: true, withCorrection: true`,
      ]) {
        const m = await measure(spine, (s2, p2) => `let part2 = cad.sweepAdvanced(${s2}, ${p2}, ${opts}, volumeTolerance: 0.99 })`)
        const label = `${tag} ${opts.includes('rightCorner') ? 'miter' : 'plain'}`
        if ('error' in m) {
          // eslint-disable-next-line no-console
          console.log(`D4 ${label}: ERR ${m.error.slice(0, 110)}`)
        } else {
          // eslint-disable-next-line no-console
          console.log(
            `D4 ${label}: vol=${m.volume.toFixed(2)} ratio=${(m.volume / (AREA * ARC_LEN)).toFixed(4)} faces=${m.faces} size=${m.size.map((v) => v.toFixed(1)).join('x')}`,
          )
        }
      }
    }
    expect(true).toBe(true)
  }, 300000)
})
