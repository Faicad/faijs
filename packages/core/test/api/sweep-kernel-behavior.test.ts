/**
 * @vitest-environment node
 *
 * 扫掠「丢体积 / 丢内腔」的**分层归因**（内核 vs 绑定层 vs faijs API，2026-11-16 实测）
 *
 * 为什么要有这个文件：此前把「曲面扫掠丢体积」笼统归给内核，导致方案方向偏离。真实原因是
 * 三层各有一份责任，且**可归因、可复现**。这里把每一层的行为钉成断言，防止结论再漂。
 *
 * 分层与本文件的对应：
 *   K1    内核能力（OCCT 经 occt-wasm）—— 单段曲线 / 同类型多边 wire 是**完备**的；
 *         混合边类型（真弧 + 直腿、G1 连续）在 `MakePipe`（`mode:'simple'`）下仍按
 *         A×(弧长 − 腿长) 出错（K1c，绑定层缺陷），`sweepAdvanced` 默认路径精确。
 *   K2    `transitionMode: 'transformed'`（旧默认）在 G0 折线脊柱上的「平移塌陷」；
 *         2026-11-16 起 `sweepAdvanced` 缺省按脊柱事实自动斜接，塌陷只在显式指定时出现。
 *   K3    转角过渡：`rightCorner`（斜接）才是折线的正解，`roundCorner` 在密集锐角上崩
 *   K4    体积守卫的盲区（体积单指标抓不住浅折角的塌陷）—— 这就是 C2（端面法向 1°）的由来
 *   K5    截面定位：`pipe` / `withContact` / `withCorrection` 各自到底做了什么
 *   K6    斜接 × 落位 的二维矩阵：落位后 0.9996，未落位 0.9425；逐段 union 只有 0.88
 *   K7    union 是健康的：共面接缝并得干净；旧「吞实体」是 180° 折返脊柱的假象（B ⊂ A）
 *
 * 观测量：BREP 体积 + bbox + 面数。体积恒等式「等截面扫掠 = 截面积 × 脊柱长度」（Pappus）。
 *
 * ⚠ 无法固化成断言的已知崩溃（2026-11-16 实测，四个独立进程各崩一次）：把 17 点圆弧采样交给
 * `cad.interpolateWithTangents` 造脊柱再扫掠，occt-wasm 的 worker 直接退出（不是抛错，
 * 是 wasm 进程死），`pipe` / `sweepAdvanced` / 带落位三种入口同样崩；同一批点交给
 * `cad.approximatePoints` 则 1.0000 精确。会杀进程的用例不能进测试套件，这里只留记录：
 * 任何「先把折线拟合成样条再扫」的路径都必须先验证脊柱曲率，且优先用 `approximatePoints`。
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
import { analyzeSpine } from '../../src/api/internal/spine-analysis'

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
/** 共线两段（G1 连续的最简多边 wire）。 */
const COLLINEAR_2 = 'cad.wire([[0,0,0],[0,0,10],[0,0,20]])'

const PIPE = (s: string, p: string): string => `let part2 = cad.pipe(${s}, ${p}, { volumeTolerance: 0.99 })`
const SWEEP_DEFAULT = (s: string, p: string): string =>
  `let part2 = cad.sweepAdvanced(${s}, ${p}, { volumeTolerance: 0.99 })`
const sweepWith = (opts: string) => (s: string, p: string): string =>
  `let part2 = cad.sweepAdvanced(${s}, ${p}, { ${opts}, volumeTolerance: 0.99 })`
/**
 * 纯几何测量：体积容差放宽到 99% 且 `strict:false`（C2/C3 降为通知），
 * 只为了把「塌陷体到底多少体积」量出来，不让判据提前打断。
 * 判据本身的行为在 `sweep-guard.test.ts` 里单独钉。
 */
const RAW = (opts: string) => (s: string, p: string): string =>
  `let part2 = cad.sweepAdvanced(${s}, ${p}, { ${opts}, volumeTolerance: 0.99, strict: false })`

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

  it('K1c. 混合边类型（真弧 + 直腿、真 G1）：MakePipe 路径不可能对，sweepFull / sweepAlong 精确', async () => {
    await useOcct()
    // 弧的自然走向是 (0,-10,10) → (0,-20,0)，末端切向 -Z；直腿沿 -Z 续接 ⇒ 真 G1、无折返。
    const spine = (len: number): string =>
      `cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE),cad.edge([0,-20,0],[0,-20,${-len}])])`
    const analytic = (len: number): number => AREA * (ARC_LEN + len)

    // MakePipe（`mode:'simple'`）在这类脊柱上怎么给都不对：曾经测到 V = A×(弧长 − 腿长)，
    // 换一种截面位置又变成别的错值 —— 所以 `cad.pipe` 现在**扫之前**就按脊柱事实拒绝
    // （见 sweep-hollow-pipe P2g2），不再让体积守卫事后猜。
    for (const len of [5, 10]) {
      const m = expectOk(await measure(spine(len), RAW(`mode: 'simple'`)))
      expect(Math.abs(m.volume - analytic(len)) / analytic(len), `MakePipe len=${len}`).toBeGreaterThan(0.1)
    }
    const viaPipe = await measure(spine(10), PIPE)
    expect('error' in viaPipe).toBe(true)
    expect(String((viaPipe as { error: string }).error)).toMatch(/cannot be swept by MakePipe|mixes edge kinds/)

    // 另一条错值（同一条脊柱、同一入口，只差截面落位）：sweepFull 在**未落位**时给出
    // A×(弧长 − 腿长) —— 这才是「混合边类型丢体积」的真正来历，错的是落位不是内核。
    const unplaced = expectOk(await measure(spine(10), SWEEP_DEFAULT))
    expect(unplaced.volume / AREA).toBeCloseTo(ARC_LEN - 10, 1)

    // 正确值：sweepAlong（先落位再扫）精确，且 bbox 含整条腿。
    const seg = expectOk(await measure(spine(10), (s2, p2) => `let part2 = cad.sweepAlong(${s2}, ${p2}, { volumeTolerance: 0.99 })`))
    expect(seg.volume / analytic(10)).toBeCloseTo(1, 3)
    expect(seg.size[2]).toBeCloseTo(26, 0)
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

describe('K2 transitionMode=transformed：G0 折线脊柱退化为「平移塌陷」（显式指定才出现）', () => {
  /** 折线近似同一条弧（4 段）。 */
  const POLY_4 = arcPoints(4)
  const L90 = 'cad.wire([[0,0,0],[0,0,10],[0,-10,10]])'
  /** 每一段：显式 transformed。 */
  const TRANSFORMED = `transitionMode: 'transformed'`

  it('K2a. 显式 transformed：所有朝向模式给出**同一个**体积 = 面积 × 路径在原始截面法向(+Z)的净位移', async () => {
    await useOcct()
    const dz = 10 // 弧的 z 从 0 到 10
    const translationVolume = AREA * dz
    for (const [label, stmt] of [
      ['sweepAdvanced +transformed', RAW(TRANSFORMED)],
      ['+frenet:true', RAW(`${TRANSFORMED}, frenet: true`)],
      ['+orientation:frenet', RAW(`${TRANSFORMED}, orientation: 'frenet'`)],
      ['+orientation:fixed', RAW(`${TRANSFORMED}, orientation: 'fixed'`)],
      ['+fixedUp,+Z', RAW(`${TRANSFORMED}, orientation: 'fixedUp', up: [0,0,1]`)],
    ] as [string, (s: string, p: string) => string][]) {
      const m = expectOk(await measure(POLY_4, stmt))
      expect(Math.abs(m.volume - translationVolume) / translationVolume, `${label} translation model`).toBeLessThan(
        2e-3,
      )
    }
    // 对照：不指定 transitionMode（= auto）时自动斜接。同一脊柱在**落位后**才精确
    // （未落位仍有 4.3% 偏差，见 K6b —— 斜接的前提是管心压在路径上）。
    const auto = expectOk(
      await measure(POLY_4, (s2, p2) => `let part2 = cad.sweepAlong(${s2}, ${p2}, { volumeTolerance: 0.99 })`),
    )
    // 0.9936 而不是 1.0000：POLY_4 是 4 段弦，弦长比弧长本身短 0.64%，属期望内。
    expect(auto.volume / (AREA * ARC_LEN)).toBeCloseTo(0.9936, 3)
  })

  it('K2b. 判别「截面没转」靠 bbox：产物 z 跨度 = 路径 z 跨度（没有管半径 ±6 的展开）', async () => {
    await useOcct()
    const m = expectOk(await measure(POLY_4, RAW(TRANSFORMED)))
    // 路径 z ∈ [0,10]；正确扫掠应到 z ∈ [-6,16]（跨度 22）。实测跨度 10 ⇒ 截面全程水平。
    expect(m.size[2]).toBeCloseTo(10, 1)
    expect(m.size[1]).toBeCloseTo(22, 1)
    // 面数随段数增长 ⇒ 不是「只扫第一段」，而是「逐段扫、但每段截面都不旋转」。
    const finer = expectOk(await measure(arcPoints(16), RAW(TRANSFORMED)))
    expect(finer.faces).toBeGreaterThan(m.faces)
    expect(finer.size[2]).toBeCloseTo(10, 1)
    expect(finer.volume).toBeCloseTo(m.volume, 0)
  })

  it('K2c. 90° 折角同样塌陷：体积 = 面积 × 首段长度（第二段垂直于原法向，贡献 0）', async () => {
    await useOcct()
    const m = expectOk(await measure(L90, RAW(TRANSFORMED)))
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
    const t = expectOk(await measure(corner(45), RAW(`orientation: 'frenet', transitionMode: 'transformed'`)))
    expect(t.volume).toBeCloseTo(AREA * 17.0710678, 0)
  })

  it('K3d. 折线 16 段 + roundCorner → 内核抛 Geom_RectangularTrimmedSurface（圆角在密集锐角上不成立）', async () => {
    await useOcct()
    const m = await measure(arcPoints(16), sweepWith(`orientation: 'frenet', transitionMode: 'roundCorner'`))
    expect('error' in m).toBe(true)
    expect(String((m as { error: string }).error)).toMatch(/Geom_/)
  })
})

describe('K4 体积守卫的盲区：浅折角塌陷在 5% 阈值内 —— 这正是 C2（端面法向）存在的理由', () => {
  const TRANSFORMED = `transitionMode: 'transformed'`

  it('K4a. 15° 折角 + transformed：体积只偏 1.70%（C1 放行），C2 端面法向直接抛 E_SWEEP_CAP_NORMAL', async () => {
    await useOcct()
    const t = (15 * Math.PI) / 180
    const zEnd = 10 + 10 * Math.cos(t)
    const spine = `cad.wire([[0,0,0],[0,0,10],[0,${n(-10 * Math.sin(t))},${n(zEnd)}]])`
    const analytic = AREA * 20
    // (a) 纯几何：体积只偏 1.70%，C1（5%）抓不住 —— 这就是盲区本身。
    const raw = expectOk(await measure(spine, RAW(TRANSFORMED)))
    expect(Math.abs(raw.volume - analytic) / analytic).toBeLessThan(0.05)
    expect(Math.abs(raw.volume - analytic) / analytic).toBeCloseTo(0.017, 2)
    // bbox z 跨度 == 路径 z 跨度：没有管半径展开 ⇒ 截面没旋转 ⇒ 产物是「压扁的平移体」。
    expect(raw.size[2]).toBeCloseTo(zEnd, 1)
    // (b) 默认判据下必须**拒**：C2 用 1° 的端面法向把它抓出来。
    const r = await exec(
      'brep',
      `let sec = ${SEC}\nlet sp = ${spine}\nlet part2 = cad.sweepAdvanced(sec, sp, { ${TRANSFORMED} })\n`,
    )
    expect(r.failedAt).toBeTruthy()
    expect(r.failedAt?.code).toBe('E_SWEEP_CAP_NORMAL')
    expect(String(r.failedAt?.message ?? '')).toMatch(/cap does not face the spine tangent/)
  })

  it('K4b. 30° / 45° / 90° 折角 + transformed：体积偏离 6.7% / 14.6% / 50%，默认判据一律拒', async () => {
    await useOcct()
    for (const [deg, rel] of [
      [30, 0.067],
      [45, 0.1464],
      [90, 0.5],
    ] as [number, number][]) {
      const t = (deg * Math.PI) / 180
      const spine = `cad.wire([[0,0,0],[0,0,10],[0,${n(-10 * Math.sin(t))},${n(10 + 10 * Math.cos(t))}]])`
      const m = expectOk(await measure(spine, RAW(TRANSFORMED)))
      const observed = Math.abs(m.volume - AREA * 20) / (AREA * 20)
      expect(observed, `${deg}° volume deviation`).toBeCloseTo(rel, 2)
      const r = await exec(
        'brep',
        `let sec = ${SEC}\nlet sp = ${spine}\nlet part2 = cad.sweepAdvanced(sec, sp, { ${TRANSFORMED} })\n`,
      )
      expect(r.failedAt, `${deg}° must be rejected`).toBeTruthy()
    }
  })

  it('K4c. 同一条 15° 折角脊柱，不指定 transitionMode（auto）→ 自动斜接，体积精确、C2 通过', async () => {
    await useOcct()
    const t = (15 * Math.PI) / 180
    const spine = `cad.wire([[0,0,0],[0,0,10],[0,${n(-10 * Math.sin(t))},${n(10 + 10 * Math.cos(t))}]])`
    const m = expectOk(await measure(spine, SWEEP_DEFAULT))
    expect(m.volume / (AREA * 20)).toBeCloseTo(1, 2)
    // 斜接后 bbox 才展开到管半径。
    expect(m.size[2]).toBeGreaterThan(10 + 10 * Math.cos(t))
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
    const tf = expectOk(await measure(L90, RAW(`orientation: 'frenet', transitionMode: 'transformed'`)))
    expect(tf.volume).toBeCloseTo(AREA * 10, 0)
  })

  it('K6b. 折线 + rightCorner：截面落位与否差 5–6 个百分点（0.9425→0.9996）；落位后接近解析值', async () => {
    await useOcct()
    const placed = `orientation: 'frenet', transitionMode: 'rightCorner', withContact: true, withCorrection: true`
    const bare = `orientation: 'frenet', transitionMode: 'rightCorner'`
    for (const [steps, bareRatio, placedRatio] of [
      [4, 0.9569, 0.9936],
      [16, 0.9425, 0.9996],
    ] as [number, number, number][]) {
      const spine = arcPoints(steps)
      const u = expectOk(await measure(spine, sweepWith(bare)))
      const p2 = expectOk(await measure(spine, sweepWith(placed)))
      expect(u.volume / (AREA * ARC_LEN), `unplaced poly${steps}`).toBeCloseTo(bareRatio, 3)
      expect(p2.volume / (AREA * ARC_LEN), `placed poly${steps}`).toBeCloseTo(placedRatio, 3)
    }
  })

  it('K6c. 多拐角折线 + roundCorner：内核直接失败（Geom_RectangularTrimmedSurface）', async () => {
    await useOcct()
    const m = await measure(arcPoints(4), sweepWith(`orientation: 'frenet', transitionMode: 'roundCorner'`))
    expect('error' in m).toBe(true)
    expect(String((m as { error: string }).error)).toMatch(/Geom_/)
  })

  it('K6d. 同一折线：强制 segments = 0.88–0.90（接缝留 V 形缺口），auto 选 miter = 0.99+', async () => {
    await useOcct()
    for (const [steps, segRatio, miterRatio] of [
      [4, 0.8968, 0.9936],
      [16, 0.8801, 0.9996],
    ] as [number, number, number][]) {
      const spine = arcPoints(steps)
      const seg = expectOk(
        await measure(spine, (s2, p2) => `let part2 = cad.sweepAlong(${s2}, ${p2}, { strategy: 'segments', volumeTolerance: 0.99 })`),
      )
      const auto = expectOk(
        await measure(spine, (s2, p2) => `let part2 = cad.sweepAlong(${s2}, ${p2}, { volumeTolerance: 0.99 })`),
      )
      // 逐段圆管在折角只并到 0.88–0.90：这就是策略层不能拿 segments 处理折角的原因。
      expect(seg.volume / (AREA * ARC_LEN), `forced segments poly${steps}`).toBeCloseTo(segRatio, 3)
      // auto 走斜接，几乎等于解析值。
      expect(auto.volume / (AREA * ARC_LEN), `auto poly${steps}`).toBeCloseTo(miterRatio, 3)
      expect(auto.volume).toBeGreaterThan(seg.volume)
    }
  })
})

describe('K7 union 在扫掠实体上是健康的：共面接缝并得干净，「少一块」是 180° 折返（B ⊂ A）', () => {
  const pipeA = (pts: string): string =>
    `cad.sweepAlong(sec, cad.wire(${pts}), { volumeTolerance: 0.99 })`

  it('K7a. 共面同向接缝（0→10 与 10→20 沿 +Z）：union = 两块相加，接缝面被并掉', async () => {
    await useOcct()
    const code =
      `let sec = ${SEC}\n` +
      `let a = ${pipeA('[[0,0,0],[0,0,10]]')}\n` +
      `let b = ${pipeA('[[0,0,10],[0,0,20]]')}\n` +
      `let part2 = cad.union(a, b)\n`
    const r = await exec('brep', code)
    expect(r.failedAt).toBeFalsy()
    const api = getBrepApi()
    const h = brepOf(r.outputs.get(asPartName('part2')) as Shape) as never
    expect(api.getVolume(h)).toBeCloseTo(AREA * 20, 0)
    expect(api.getSubShapes(h, 'face').length).toBe(4)
  })

  it('K7b. 折返脊柱（10→0）：intersect = B 全部 ⇒ B 完全落在 A 内，union = A 是**正确**结果', async () => {
    await useOcct()
    const head = `let sec = ${SEC}\n` + `let a = ${pipeA('[[0,0,0],[0,0,10]]')}\n` + `let b = ${pipeA('[[0,0,10],[0,0,0]]')}\n`
    for (const [tag, call] of [['union', 'cad.union(a, b)'], ['intersect', 'cad.intersect(a, b)']] as [string, string][]) {
      const r = await exec('brep', head + `let part2 = ${call}\n`)
      expect(r.failedAt).toBeFalsy()
      const api = getBrepApi()
      const h = brepOf(r.outputs.get(asPartName('part2')) as Shape) as never
      // 两者都等于单块：折返的直腿整条落在第一段管里，不存在「丢了一个实体」。
      expect(api.getVolume(h), tag).toBeCloseTo(AREA * 10, 0)
    }
  })

  it('K7c. 正交相交（+Z 段与 +Y 段共端点）：union 严格落在 (max, sum) 之间 = 重叠被减一次', async () => {
    await useOcct()
    const code =
      `let sec = ${SEC}\n` +
      `let a = ${pipeA('[[0,0,0],[0,0,10]]')}\n` +
      `let b = ${pipeA('[[0,0,10],[0,10,10]]')}\n` +
      `let part2 = cad.union(a, b)\n`
    const r = await exec('brep', code)
    expect(r.failedAt).toBeFalsy()
    const api = getBrepApi()
    const h = brepOf(r.outputs.get(asPartName('part2')) as Shape) as never
    const v = api.getVolume(h)
    expect(v).toBeGreaterThan(AREA * 10)
    expect(v).toBeLessThan(AREA * 20)
    expect(api.getSubShapes(h, 'face').length).toBe(6)
  })
})

describe('K8 闭合脊柱（探针）：内核能否一次扫出环面', () => {
  // 真圆 R10（起点 (10,0,0)、切向 +Y），矩形截面 6×6 已放在起点、法向 +Y。
  // 解析：体积 = 36 × 2πR = 2261.95，bbox = 32×32×6。
  const SPINE = 'cad.wireFromEdges([cad.circleArc([0,0,0],[0,0,1],10,0*DEGREE,360*DEGREE)])'
  const SEC_AT_START =
    `cad.sketchOnPlane({ contours: [{ segments: [` +
    `{ kind: 'line', x1: 0, y1: -3, x2: 6, y2: -3 },` +
    `{ kind: 'line', x1: 6, y1: -3, x2: 6, y2: 3 },` +
    `{ kind: 'line', x1: 6, y1: 3, x2: 0, y2: 3 },` +
    `{ kind: 'line', x1: 0, y1: 3, x2: 0, y2: -3 }] }],` +
    `plane: { origin: [10,0,0], normal: [0,1,0], xAxis: [0,0,1] } })`

  it('K8a. sweepAdvanced 一次扫闭合脊柱：体积 = 面积 × 周长（若成立 ⇒ closed 可实现）', async () => {
    await useOcct()
    const code = `let sec = ${SEC_AT_START}\nlet sp = ${SPINE}\nlet part2 = cad.sweepAdvanced(sec, sp, { orientation: 'frenet' })\n`
    const r = await exec('brep', code)
    if (r.failedAt) {
      // eslint-disable-next-line no-console
      console.log(`K8a closed spine failed: ${String(r.failedAt.message).slice(0, 160)}`)
      expect(r.failedAt).toBeTruthy()
      return
    }
    const api = getBrepApi()
    const h = brepOf(r.outputs.get(asPartName('part2')) as Shape) as never
    const b = api.getBoundingBox(h)
    // eslint-disable-next-line no-console
    console.log(
      `K8a closed sweep: vol=${api.getVolume(h).toFixed(2)} (analytic ${(36 * 2 * Math.PI * 10).toFixed(2)}) ` +
        `bbox=${(b.xmax - b.xmin).toFixed(2)}x${(b.ymax - b.ymin).toFixed(2)}x${(b.zmax - b.zmin).toFixed(2)}`,
    )
    expect(api.getVolume(h)).toBeCloseTo(36 * 2 * Math.PI * 10, -1)
    // 截面放在 (10,0,0)、法向 +Y、局部 +X → 世界 +Z：径向跨 7…13，轴向 z 跨 0…6。
    expect(b.xmax - b.xmin).toBeCloseTo(26, 0)
    expect(b.zmax - b.zmin).toBeCloseTo(6, 0)
  }, 120000)
})

describe('K9 脊柱事实是只读的：先 analyzeSpine 再 sweepFull 必须照样成功', () => {
  // 这条用例的来历（2026-11-16）：`sweep-hollow-pipe` F2b 曾报 `sweepFull: operation failed`，
  // 当时归因于「读过边数据之后内核会失败」的绑定层缺陷。真实根因是那条测试的弧角度写错
  // （`0°..90°` 实际落在 +Z→-Y），造出的是**断裂** wire —— 断开的脊柱上 sweepFull 本来就该失败。
  // 这里钉两件事：脊柱真相连时分析不影响扫掠；分析结果本身与解析值一致。
  const SPINE =
    'cad.wireFromEdges([' +
    'cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE),' + // (0,-10,10) → (0,-20,0)，末端切向 -Z
    'cad.edge([0,-20,0],[0,-20,-10])])' // 沿 -Z 相切续接 ⇒ 真 G1

  it('K9. analyzeSpine 后再 sweepAdvanced：必须成功且体积 = 面积 × 长度', async () => {
    await useOcct()
    const r1 = await exec('brep', `let sp = ${SPINE}\n`)
    expect(r1.failedAt).toBeFalsy()
    const spine = brepOf(r1.outputs.get(asPartName('sp')) as Shape) as never

    // ① 先做完整的只读分析（curveType / curveParameters / 端点 / 数值切向 / getLength / 弧半径）。
    const f = analyzeSpine(getBrepApi(), spine as never)
    expect(f.edges).toHaveLength(2)
    expect(f.mixed).toBe(true)
    expect(f.corners).toHaveLength(0) // 真相连且相切 ⇒ 没有 G0 折角
    expect(f.gaps).toHaveLength(0)
    expect(f.totalLength).toBeCloseTo(ARC_LEN + 10, 6)
    expect(f.edges[0]!.kind).toBe('arc')
    // 半径由「起点数值切向 + 到中点的弦」反解，精度受切向差分步长限制（实测 10.0019）。
    expect(f.edges[0]!.radius!).toBeCloseTo(10, 2)

    // ② 同一个进程里再扫这条脊柱（analyzeSpine 用的是借用句柄，不该留下副作用）。
    // 截面画在原点、脊柱从 (0,-10,10) 起 ⇒ 必须开 autoPlace 才有意义（否则是落位问题，见 K1c）。
    const m = expectOk(await measure(SPINE, RAW(`autoPlace: true`)))
    expect(m.volume / (AREA * (ARC_LEN + 10))).toBeCloseTo(1, 3)
  })
})
