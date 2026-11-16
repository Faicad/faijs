/**
 * curve-ellipse-engines — `cad.ellipseEdge` / `cad.ellipseArc` 的双引擎契约（**实测**）
 *
 * 方案 A「几何可用、语义如实」（步骤 1，2026-11-17）钉住三件事：
 *
 * 1. **几何是唯一契约**：canonical 帧 = `u` 世界 +X 在椭圆面上的投影（`|n̂.x| ≥ 0.999` 退 +Y）、
 *    `v = n̂ × u`，点 `E(θ) = c + a·cosθ·u + b·sinθ·v`。两引擎给**同一条曲线**：
 *    端点落在契约帧的起止角点上、采样点落在椭圆上、弧长与解析积分一致。
 *    负跨度 = 顺时针（CW），参数起点仍是 `startAngle` 那一侧。
 * 2. **语义如实，不抹平**：occt 走原生 `gp_Elips` ⇒ `curveType` = `ellipse`（解析面）；
 *    smlib 走**精确有理二次 NURBS** ⇒ `curveType` = `bspline`（侧面 NURBS 面）。
 *    本文件**故意分别断言这两个值**：一旦有人为了"统一标签"让 occt 降级到 NURBS，
 *    这条断言会立刻失败 —— 这是本方案的护栏，不是待办。
 * 3. **实测出来的引擎差异**（写进断言而不是掩盖）：
 *    - occt 的**闭合椭圆** `curveLength` 偏粗（48.505863 vs 解析 48.442241，1.3e-3），
 *      而 4 段 90° 弧各自精确 —— 长跨度弧长积分是采样式的，误差随跨度增长；
 *      smlib 的闭合椭圆周长直接给到 48.442242（1e-8 级）。
 *    - smlib 的参数域是 `[0, nSeg]`（`nSeg = ceil(|跨度|/90°)`），occt 是 `[起角, 止角]`。
 *      **参数值不能当角度用**，本文件的取样一律按契约帧反算角度，不假定参数语义。
 *
 * Run: npx vitest run test/api/curve-ellipse-engines.test.ts
 */
import { describe, it, expect } from 'vitest'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId, getActiveBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { BrepHandle, BrepVec3 } from '../../src/brep/engine/types'
import { ellipseEdge, ellipseArc } from '../../src/api/curve-sketch'
import { dualOpMetaOf } from '../../src/define-op'

type Vec3 = [number, number, number]
type EngineName = 'occt' | 'smlib'

const ENGINES: EngineName[] = ['occt', 'smlib']
const DEG = Math.PI / 180

async function activate(engine: EngineName): Promise<void> {
  __resetEngineRegistriesForTests()
  if (engine === 'occt') await registerOcctBrepEngine()
  else await registerSmlibBrepEngine()
  expect(getActiveBrepEngineId()).toBe(engine)
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: engine },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}

/** 在内核上直调 op 并就地读句柄（不经过 runtime 的 topology 收集：smlib 的 getSubShapes(face) 仍 P1 未实现）。 */
async function withHandle<T>(engine: EngineName, build: () => unknown | Promise<unknown>, fn: (h: BrepHandle) => T): Promise<T> {
  await activate(engine)
  const shape = await build()
  return fn(brepOf(shape as never) as BrepHandle)
}

async function errorOfBinary(engine: EngineName, build: () => unknown | Promise<unknown>): Promise<string> {
  await activate(engine)
  try {
    await build()
    return ''
  } catch (e) {
    return String((e as Error)?.message ?? e)
  }
}

// ── 测试侧独立的 canonical 椭圆帧（**故意不复用 op/适配器里那份**：用例要当独立尺子）──
interface EllipseFrame {
  center: Vec3
  u: Vec3
  v: Vec3
  a: number
  b: number
  point(thetaRad: number): Vec3
  angleOf(p: Vec3): number
  residual(p: Vec3): number
}

function frameOf(center: Vec3, normal: Vec3, a: number, b: number): EllipseFrame {
  const len = Math.hypot(normal[0], normal[1], normal[2])
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len]
  const ref: Vec3 = Math.abs(n[0]) < 0.999 ? [1, 0, 0] : [0, 1, 0]
  const d = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2]
  const proj: Vec3 = [ref[0] - n[0] * d, ref[1] - n[1] * d, ref[2] - n[2] * d]
  const pl = Math.hypot(proj[0], proj[1], proj[2])
  const u: Vec3 = [proj[0] / pl, proj[1] / pl, proj[2] / pl]
  const v: Vec3 = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ]
  const point = (thetaRad: number): Vec3 => {
    const cs = Math.cos(thetaRad)
    const sn = Math.sin(thetaRad)
    return [
      center[0] + a * cs * u[0] + b * sn * v[0],
      center[1] + a * cs * u[1] + b * sn * v[1],
      center[2] + a * cs * u[2] + b * sn * v[2],
    ]
  }
  const local = (p: Vec3): [number, number] => {
    const dx = [p[0] - center[0], p[1] - center[1], p[2] - center[2]]
    return [(dx[0] * u[0] + dx[1] * u[1] + dx[2] * u[2]) / a, (dx[0] * v[0] + dx[1] * v[1] + dx[2] * v[2]) / b]
  }
  return {
    center,
    u,
    v,
    a,
    b,
    point,
    angleOf: (p) => {
      const [x, y] = local(p)
      return Math.atan2(y, x)
    },
    residual: (p) => {
      const [x, y] = local(p)
      return Math.abs(x * x + y * y - 1)
    },
  }
}

/** 椭圆弧长解析值（Simpson 积分，测试侧的独立尺子）。 */
function arcLen(a: number, b: number, t0: number, t1: number): number {
  const n = 4000
  const h = (t1 - t0) / n
  const f = (t: number): number => Math.hypot(a * Math.sin(t), b * Math.cos(t))
  let sum = f(t0) + f(t1)
  for (let i = 1; i < n; i++) sum += f(t0 + i * h) * (i % 2 === 0 ? 2 : 4)
  return Math.abs((h / 3) * sum)
}

const dist = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
const fmt = (p: Vec3): string => `(${p.map((x) => x.toFixed(6)).join(',')})`
const toVec = (p: BrepVec3): Vec3 => [p.x, p.y, p.z]

/**
 * 按 `shapeOrientation` 解释走向的两端：CW 弧在 occt 上是 REVERSED 边（内核只沿参数递增扫，
 * 方向靠边朝向表达），此时「起点」是参数 `last` 一侧。消费者要判断走向就看这个，不看参数大小。
 */
function directedEnds(h: BrepHandle): [Vec3, Vec3] {
  const api = getBrepApi()
  const pr = api.curveParameters(h)
  const pFirst = toVec(api.curvePointAtParam(h, pr.first))
  const pLast = toVec(api.curvePointAtParam(h, pr.last))
  // smlib 的 `shapeOrientation` 仍是 P1 未实现：它的 CW 弧是**真实的反向参数化**（参数 first
  // 侧就是起点），所以拿不到朝向时按参数顺序解，正是对的。
  let reversed = false
  try {
    reversed = api.shapeOrientation(h) === 'reversed'
  } catch {
    reversed = false
  }
  return reversed ? [pLast, pFirst] : [pFirst, pLast]
}

interface ArcCase {
  label: string
  center: Vec3
  normal: Vec3
  a: number
  b: number
  a0: number
  a1: number
}

/** 覆盖三个轴向、CCW/CW、跨 180°、以及 a = b（退化到圆）的情形。 */
const ARC_CASES: ArcCase[] = [
  { label: 'n=+Z 0..90', center: [0, 0, 0], normal: [0, 0, 1], a: 10, b: 5, a0: 0, a1: 90 },
  { label: 'n=+Z 180..45（CW −135°）', center: [0, 0, 0], normal: [0, 0, 1], a: 10, b: 5, a0: 180, a1: 45 },
  { label: 'n=+Y 0..30（倾斜法向、非对称）', center: [0, 0, 10], normal: [0, 1, 0], a: 10, b: 5, a0: 0, a1: 30 },
  { label: 'n=+X 0..90（退用 +Y 基准）', center: [0, -10, 0], normal: [1, 0, 0], a: 10, b: 5, a0: 0, a1: 90 },
  { label: 'n=(1,1,1) 20..200（跨 180°）', center: [1, 2, 3], normal: [1, 1, 1], a: 4, b: 2, a0: 20, a1: 200 },
  { label: 'n=+Z a=b=10 0..90（退化成圆）', center: [3, -4, 5], normal: [0, 0, 1], a: 10, b: 10, a0: 0, a1: 90 },
]

describe('cad.ellipseArc — 两端点落在契约帧的起止角点（含 CW）、采样点在椭圆上', () => {
  for (const ec of ENGINES) {
    for (const c of ARC_CASES) {
      it(`${ec} · ${c.label}`, async () => {
        // 以长半轴为尺度定容差：1e-7 相对 ⇒ a=10 时 1e-6。
        const tol = 1e-7 * Math.max(c.a, c.b)
        const fr = frameOf(c.center, c.normal, c.a, c.b)
        const got = await withHandle(ec, () => ellipseArc(c.center, c.normal, c.a, c.b, c.a0, c.a1), (h) => {
          const api = getBrepApi()
          const pr = api.curveParameters(h)
          const samples = [0.13, 0.37, 0.62, 0.88].map((f) => api.curvePointAtParam(h, pr.first + (pr.last - pr.first) * f))
          const ends = directedEnds(h)
          return {
            first: ends[0],
            last: ends[1],
            samples: samples.map(toVec),
            length: api.curveLength(h),
            type: api.curveType(h),
            params: pr,
          }
        })
        const p0 = fr.point(c.a0 * DEG)
        const p1 = fr.point(c.a1 * DEG)
        expect(dist(got.first, p0), `first=${fmt(got.first)} want=${fmt(p0)} params=[${got.params.first},${got.params.last}]`).toBeLessThan(tol)
        expect(dist(got.last, p1), `last=${fmt(got.last)} want=${fmt(p1)}`).toBeLessThan(tol)
        for (const s of got.samples) expect(fr.residual(s), `sample ${fmt(s)} off-ellipse`).toBeLessThan(1e-9)
        // 弧长：occt 的弧长积分是采样式（实测 90° 弧 4.6e-6 相对），smlib 精确。
        const analytic = arcLen(c.a, c.b, c.a0 * DEG, c.a1 * DEG)
        expect(Math.abs(got.length - analytic) / analytic, `len=${got.length} analytic=${analytic}`).toBeLessThan(1e-4)
      })
    }
  }
})

describe('语义如实：椭圆弧的 curveType 各报内核事实（这条是「不许 occt 降级」的护栏）', () => {
  const CASES: Array<[EngineName, string]> = [['occt', 'ellipse'], ['smlib', 'bspline']]
  for (const [ec, want] of CASES) {
    it(`${ec} · curveType = ${want}`, async () => {
      const got = await withHandle(ec, () => ellipseArc([0, 0, 0], [0, 0, 1], 10, 5, 0, 90), (h) => getBrepApi().curveType(h))
      expect(got).toBe(want)
    })
  }

  it('occt · 倾斜法向的轴基对齐（绕 n̂ 旋转）之后仍然是解析 ellipse，没被降级成 bspline', async () => {
    // n=+Y 时内核的 XDirection 落在 +Z：适配器靠一次刚性旋转把轴基转到契约帧上。
    // 若哪天改成"用 NURBS 重建"来对齐，这条会立刻失败。
    const got = await withHandle('occt', () => ellipseArc([0, 0, 10], [0, 1, 0], 10, 5, 0, 30), (h) => getBrepApi().curveType(h))
    expect(got).toBe('ellipse')
  })
})

describe('cad.ellipseEdge — 闭合椭圆：采样点在椭圆上、周长与轴跨一致', () => {
  for (const ec of ENGINES) {
    it(`${ec} · closed / 采样 / 周长`, async () => {
      const c: Vec3 = [1, -2, 3]
      const fr = frameOf(c, [0, 0, 1], 10, 5)
      const got = await withHandle(ec, () => ellipseEdge(c, [0, 0, 1], 10, 5), (h) => {
        const api = getBrepApi()
        const pr = api.curveParameters(h)
        const closed = api.curveIsClosed(h)
        const samples = Array.from({ length: 16 }, (_, i) =>
          toVec(api.curvePointAtParam(h, pr.first + ((pr.last - pr.first) * i) / 16)),
        )
        return { closed, samples, length: api.curveLength(h), type: api.curveType(h) }
      })
      expect(got.closed).toBe(true)
      for (const s of got.samples) expect(fr.residual(s), `sample ${fmt(s)} off-ellipse`).toBeLessThan(1e-9)
      const analytic = 4 * arcLen(10, 5, 0, Math.PI / 2)
      // 实测：smlib 48.442242（≈解析值）；occt 48.505863（1.3e-3 偏高，闭合曲线长跨度长度
      // 积分是采样式的）。这条容差**照实记录**引擎差异，不是放过 bug：几何本身 1e-9 级。
      const tol = ec === 'occt' ? 5e-3 : 1e-5
      expect(Math.abs(got.length - analytic) / analytic, `len=${got.length} analytic=${analytic}`).toBeLessThan(tol)
      expect(got.type).toBe(ec === 'occt' ? 'ellipse' : 'bspline')
    })
  }
})

describe('跨引擎对拍：比采样几何与弧长，不比类型标签', () => {
  for (const c of ARC_CASES) {
    it(`${c.label}：两引擎端点/弧长同值（1e-4 相对）`, async () => {
      // 逐个引擎读（`activate` 会重置全局注册表，不能并发）。
      const reads: Array<{ first: Vec3; last: Vec3; length: number }> = []
      for (const ec of ENGINES) {
        reads.push(
          await withHandle(ec, () => ellipseArc(c.center, c.normal, c.a, c.b, c.a0, c.a1), (h) => {
            const api = getBrepApi()
            const ends = directedEnds(h)
            return {
              first: ends[0],
              last: ends[1],
              length: api.curveLength(h),
            }
          }),
        )
      }
      const [oc, sm] = reads
      expect(dist(oc!.first, sm!.first)).toBeLessThan(1e-6 * Math.max(c.a, c.b, 1))
      expect(dist(oc!.last, sm!.last)).toBeLessThan(1e-6 * Math.max(c.a, c.b, 1))
      expect(Math.abs(oc!.length - sm!.length) / sm!.length, `occt=${oc!.length} smlib=${sm!.length}`).toBeLessThan(1e-4)
    })
  }
})

describe('op 层参数校验：跨度与半径的错误码（两引擎一致，且都在内核之前抛出）', () => {
  for (const ec of ENGINES) {
    it(`${ec} · 跨度 = 0 → E_ELLIPSEARC_ZERO_SPAN`, async () => {
      expect(await errorOfBinary(ec, () => ellipseArc([0, 0, 0], [0, 0, 1], 10, 5, 30, 30))).toMatch(/E_ELLIPSEARC_ZERO_SPAN/)
    })
    it(`${ec} · 跨度 > 360° → E_ELLIPSEARC_SPAN`, async () => {
      expect(await errorOfBinary(ec, () => ellipseArc([0, 0, 0], [0, 0, 1], 10, 5, 0, 400))).toMatch(/E_ELLIPSEARC_SPAN/)
    })
    it(`${ec} · minor > major → E_ELLIPSEEDGE_BAD_RADII`, async () => {
      expect(await errorOfBinary(ec, () => ellipseEdge([0, 0, 0], [0, 0, 1], 5, 10))).toMatch(/E_ELLIPSEEDGE_BAD_RADII/)
    })
    it(`${ec} · 跨度 = −360° 边界（|跨度| 恰为 360 应放行）`, async () => {
      const len = await withHandle(ec, () => ellipseArc([0, 0, 0], [0, 0, 1], 10, 5, 0, -360), (h) => getBrepApi().curveLength(h))
      const analytic = 4 * arcLen(10, 5, 0, Math.PI / 2)
      const tol = ec === 'occt' ? 5e-3 : 1e-5
      expect(Math.abs(len - analytic) / analytic).toBeLessThan(tol)
    })
  }
})

describe('op 声明：engines 已开到 occt + smlib（不再 occt-only）', () => {
  it('ellipseEdge / ellipseArc 的 engines', () => {
    expect(dualOpMetaOf(ellipseEdge)!.engines).toEqual(['occt', 'smlib'])
    expect(dualOpMetaOf(ellipseArc)!.engines).toEqual(['occt', 'smlib'])
  })
})
