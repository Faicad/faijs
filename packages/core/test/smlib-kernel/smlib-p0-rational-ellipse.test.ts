/**
 * smlib-kernel/smlib-p0-rational-ellipse — P0 探针：smlib 能否承载「精确有理二次 NURBS」
 *
 * 背景：椭圆族（`cad.ellipseEdge` / `cad.ellipseArc`）当前 `engines: ['occt']`，因为
 * smlib 没有解析椭圆构造原语。备选方案：把椭圆弧写成**精确有理二次 NURBS**（圆的一段
 * 弧用权重 `(1, cos α, 1)`，椭圆取圆的仿射像 —— 权重在仿射变换下不变），经 L1
 * `makeBSplineEdge(poles, weights, knots, multiplicities, 2)` 落到引擎。
 *
 * 落地前必须回答三件事（本探针的 A / B / C 三段）：
 *   A. 内核是否**真的按有理求值**（而不是把权重丢掉、退化成分段抛物线）
 *   B. `curveType` 报什么 —— 报 `ellipse` 则语义不降级；报 `bspline` 则所有 `kind:'arc'`
 *      特化（analyzeSpine.fitArc、sweep 的同圆续弧、半径查询）全部失效
 *   C. 产物能不能当下游输入（wire / sweep 脊柱 / boolean 操作数）
 *
 * 判据设计：A/B 段用**测试侧独立手算**的有理 Bezier 公式当尺子（不复用内核求值），
 * 并在「权重被丢弃」的对照值上做显式反向断言 —— 若内核无视权重，P(0.5) 会落到
 * (0.75, 0.75)（模长 1.0607）而不是 (√2/2, √2/2)（模长 1）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { resetSmlibWasm } from '../../src/smlib-kernel/smlibWasm'
import { createOcctPrimitives } from '../../src/occt-kernel/occt-primitives'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'

let p!: SmlibPrimitives

beforeAll(async () => {
  p = await createSmlibPrimitives()
})

afterAll(() => {
  disposeSmlib()
  resetSmlibWasm()
})

type Vec3 = { x: number; y: number; z: number }
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
/** 90° 弧（半角 45°）的中段权重：cos 45°。 */
const W45 = Math.SQRT1_2

/** 单段有理二次 Bezier（3 极点、knots [0,1] 各满重 3）。 */
function ratQuad(p0: Vec3, p1: Vec3, p2: Vec3, w1 = W45): BrepHandle {
  return p.makeBSplineEdge(
    [p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z],
    [1, w1, 1],
    [0, 1],
    [3, 3],
    2,
  )
}

/** 两段 90° 拼成 180°（接缝 C0：degree 2 ⇒ 重数 2）。 */
function ratQuadChain(points: [Vec3, Vec3, Vec3, Vec3, Vec3], w1 = W45): BrepHandle {
  const poles: number[] = []
  for (const q of points) poles.push(q.x, q.y, q.z)
  return p.makeBSplineEdge(poles, [1, w1, 1, w1, 1], [0, 1, 2], [3, 2, 3], 2)
}

/** 独立尺子：有理二次 Bezier 的 De Boor 直式（权重 w1 只作用在中间极点）。 */
function ratBezierAt(t: number, p0: Vec3, p1: Vec3, p2: Vec3, w1: number): Vec3 {
  const a = (1 - t) * (1 - t)
  const b = 2 * t * (1 - t) * w1
  const c = t * t
  const s = a + b + c
  return v3(
    (a * p0.x + b * p1.x + c * p2.x) / s,
    (a * p0.y + b * p1.y + c * p2.y) / s,
    (a * p0.z + b * p1.z + c * p2.z) / s,
  )
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** Simpson 数值积分（测试侧的椭圆弧长尺子，n 取偶数）。 */
function simpson(f: (x: number) => number, lo: number, hi: number, n = 2000): number {
  const h = (hi - lo) / n
  let s = f(lo) + f(hi)
  for (let i = 1; i < n; i++) s += f(lo + i * h) * (i % 2 === 0 ? 2 : 4)
  return (s * h) / 3
}

/** 椭圆弧长（参数 θ 从 t0 到 t1，半轴 a/b）：∫ sqrt(a²sin²θ + b²cos²θ)。 */
const ellipseArcLen = (a: number, b: number, t0: number, t1: number): number =>
  simpson((th) => Math.hypot(a * Math.sin(th), b * Math.cos(th)), t0, t1)

const SAMPLE_T = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]

function pointAt(h: BrepHandle, t: number): Vec3 {
  return p.curvePointAtParam(h, t) as unknown as Vec3
}

describe('P0-A 有理是否真被求值（等权重圆，半径 1、90° 弧）', () => {
  // 圆 x²+y²=1 的一段 90° 弧：(1,0) → (0,1)，切线交点 (1,1)，中间权重 cos45°。
  const P0 = v3(1, 0, 0)
  const P1 = v3(1, 1, 0)
  const P2 = v3(0, 1, 0)

  it('A1. 7 个采样点与手算有理 Bezier 逐点一致（1e-9）', () => {
    const e = ratQuad(P0, P1, P2)
    for (const t of SAMPLE_T) {
      const got = pointAt(e, t)
      const want = ratBezierAt(t, P0, P1, P2, W45)
      expect(dist(got, want), `t=${t} kernel=${JSON.stringify(got)} ruler=${JSON.stringify(want)}`).toBeLessThan(1e-9)
    }
  })

  it('A2. 权重被真按有理求值：|P(0.5)| = 1（若权重被丢弃会是 1.0607 的对照值）', () => {
    const e = ratQuad(P0, P1, P2)
    const mid = pointAt(e, 0.5)
    const mod = Math.hypot(mid.x, mid.y)
    expect(mod).toBeCloseTo(1, 9)
    // 反向断言：非有理二次 Bezier 在 t=0.5 落在 (0.75,0.75)、模长 1.06066 ⇒ 必须明显不同
    expect(Math.abs(mod - Math.hypot(0.75, 0.75))).toBeGreaterThan(0.05)
  })

  it('A3. 弧长 = π/2（这是有理表示带来的「真圆」判据，抛物线近似做不到）', () => {
    const e = ratQuad(P0, P1, P2)
    expect(p.curveLength(e)).toBeCloseTo(Math.PI / 2, 6)
    expect(p.curveIsClosed(e)).toBe(false)
  })

  it('A4. 对照：把权重全填 1（退化成非有理二次）⇒ 弧长明显偏离 π/2', () => {
    const e = ratQuad(P0, P1, P2, 1)
    const len = p.curveLength(e)
    // 非有理二次 Bezier 的 t=0.5 点在 (0.75,0.75)，整条曲线不是圆弧
    expect(Math.abs(len - Math.PI / 2)).toBeGreaterThan(0.05)
    console.log(`[P0-A4] weights=1 对照弧长=${len.toFixed(6)}（真圆为 ${(Math.PI / 2).toFixed(6)}）`)
  })
})

describe('P0-B 椭圆弧（圆的仿射像，a=10 / b=5）与 curveType 归类', () => {
  const A = 10
  const B = 5
  const P0 = v3(A, 0, 0)
  const P1 = v3(A, B, 0)
  const P2 = v3(0, B, 0)

  it('B1. 采样点满足 (x/a)² + (y/b)² = 1（1e-9）—— 权重不正确定不出来', () => {
    const e = ratQuad(P0, P1, P2)
    for (const t of SAMPLE_T) {
      const q = pointAt(e, t)
      const val = (q.x / A) ** 2 + (q.y / B) ** 2
      expect(Math.abs(val - 1), `t=${t} value=${val}`).toBeLessThan(1e-9)
    }
  })

  it('B2. 弧长 = 数值积分的四分之一椭圆周长（1e-6）', () => {
    const e = ratQuad(P0, P1, P2)
    const analytic = ellipseArcLen(A, B, 0, Math.PI / 2)
    expect(p.curveLength(e)).toBeCloseTo(analytic, 6)
    console.log(`[P0-B2] quarter ellipse len=${p.curveLength(e).toFixed(9)} analytic=${analytic.toFixed(9)}`)
  })

  it('B3. curveType 归类（记录型判据）：圆段 / 椭圆段各报什么', () => {
    const circle = ratQuad(v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0))
    const ellipse = ratQuad(P0, P1, P2)
    const tc = p.curveType(circle)
    const te = p.curveType(ellipse)
    console.log(`[P0-B3] curveType: rational-circle=${tc} rational-ellipse=${te}`)
    // 归类至少不能是 line/other —— 那是比 bspline 更坏的信号（说明度/权重被彻底误解）
    for (const t of [tc, te]) expect(['circle', 'ellipse', 'bspline']).toContain(t)
    // 记录结论：判成 ellipse ⇒ 语义不降级（方案 A 几乎无代价）；判成 bspline ⇒ 走 A + L1 识别层
    console.log(`[P0-B3] verdict: ${te === 'ellipse' ? 'semantics-preserved' : 'bspline-degrades-kind-arc'}`)
  })

  it('B4. curveParameters 的域（记录型）：单段应给 [0,1]', () => {
    const e = ratQuad(P0, P1, P2)
    const pr = p.curveParameters(e)
    console.log(`[P0-B4] params=[${pr.first}, ${pr.last}]`)
    expect(pr.first).toBeCloseTo(0, 9)
    expect(pr.last).toBeCloseTo(1, 9)
  })
})

describe('P0-C 两段拼 180° + 下游可用性（wire / sweep / boolean）', () => {
  const A = 10
  const B = 5
  // (a,0) → (a,b) → (0,b) → (-a,b) → (-a,0)
  const chain: [Vec3, Vec3, Vec3, Vec3, Vec3] = [
    v3(A, 0, 0),
    v3(A, B, 0),
    v3(0, B, 0),
    v3(-A, B, 0),
    v3(-A, 0, 0),
  ]

  it('C1. 两段拼合的 180° 椭圆：域 [0,2]、端点与接缝点几何精确', () => {
    const e = ratQuadChain(chain)
    const pr = p.curveParameters(e)
    console.log(`[P0-C1] chained params=[${pr.first}, ${pr.last}]`)
    expect(pr.first).toBeCloseTo(0, 9)
    expect(pr.last).toBeCloseTo(2, 9)
    expect(dist(pointAt(e, 0), chain[0])).toBeLessThan(1e-9)
    // 接缝点 = 第一段终点 (0,b)
    const joint = pointAt(e, pr.last / 2)
    expect(Math.abs(joint.x)).toBeLessThan(1e-9)
    expect(joint.y).toBeCloseTo(B, 9)
    console.log(`[P0-C1] joint=${JSON.stringify(joint)}`)
  })

  it('C2. 拼合弧长 = 半椭圆周长（数值积分，1e-6）', () => {
    const e = ratQuadChain(chain)
    const analytic = ellipseArcLen(A, B, 0, Math.PI)
    expect(p.curveLength(e)).toBeCloseTo(analytic, 6)
    console.log(`[P0-C2] half ellipse len=${p.curveLength(e).toFixed(9)} analytic=${analytic.toFixed(9)}`)
  })

  it('C3. 当脊柱扫掠：r=1 圆截面 → 体积 = 面积 × 弧长（相对误差 ≤ 2%）', () => {
    // 四分之一椭圆弧当脊柱（smlib 的 sweepAlongPlanarPath 要求平面路径）
    const spineEdge = ratQuad(v3(A, 0, 0), v3(A, B, 0), v3(0, B, 0))
    const spine = p.makeWire([spineEdge])
    const profileEdge = p.makeCircleEdge(v3(0, 0, 0), v3(0, 0, 1), 1)
    const profile = p.makeFace(p.makeWire([profileEdge]))
    const solid = p.sweep(profile, spine)
    const len = p.curveLength(spineEdge)
    const analytic = Math.PI * len
    const v = p.getVolume(solid)
    console.log(`[P0-C3] swept volume=${v.toFixed(6)} analytic=${analytic.toFixed(6)} ratio=${(v / analytic).toFixed(9)}`)
    expect(p.isSolid(solid)).toBe(true)
    expect(Math.abs(v - analytic) / analytic).toBeLessThan(0.02)
  })

  it('C4. 当 boolean 操作数：sweep 体与 box 求 cut 不炸、体积合理', () => {
    const spineEdge = ratQuad(v3(A, 0, 0), v3(A, B, 0), v3(0, B, 0))
    const spine = p.makeWire([spineEdge])
    const profile = p.makeFace(p.makeWire([p.makeCircleEdge(v3(0, 0, 0), v3(0, 0, 1), 1)]))
    const tube = p.sweep(profile, spine)
    // 一个明显包住管子的盒子，做「盒 − 管」，结果必须在 (0, box) 之间且小于 box
    const box = p.makeBox(30, 30, 30)
    const boxV = p.getVolume(box)
    const result = p.cut(box, tube)
    const rv = p.getVolume(result)
    console.log(`[P0-C4] box=${boxV.toFixed(3)} cut=${rv.toFixed(3)} removed=${(boxV - rv).toFixed(3)}`)
    expect(rv).toBeGreaterThan(0)
    expect(rv).toBeLessThan(boxV)
  })

  it('C5. 记录型：sweep 产物的侧面曲面类型（解析面 vs NURBS 面）', () => {
    const spineEdge = ratQuad(v3(A, 0, 0), v3(A, B, 0), v3(0, B, 0))
    const spine = p.makeWire([spineEdge])
    const profile = p.makeFace(p.makeWire([p.makeCircleEdge(v3(0, 0, 0), v3(0, 0, 1), 1)]))
    const solid = p.sweep(profile, spine)
    const faces = p.getSubShapes(solid, 'face')
    const tally: Record<string, number> = {}
    for (const f of faces) {
      const t = p.surfaceType(f as unknown as BrepHandle)
      tally[t] = (tally[t] ?? 0) + 1
    }
    console.log(`[P0-C5] swept faces=${faces.length} surfaceTypes=${JSON.stringify(tally)}`)
    expect(faces.length).toBeGreaterThan(1)
  })
})

// ── 对称探针：同一组有理二次控制点交给 occt，验证「双引擎走同一条 NURBS 路线」是否对称 ──
describe('P0-OCCT 对称探针（同一组控制点、同一个手算尺子）', () => {
  let o!: BrepEngineApi
  let k!: Awaited<ReturnType<typeof initOcctWasm>>
  const A = 10
  const B = 5

  beforeAll(async () => {
    o = await createOcctPrimitives()
    // raw 内核句柄：occt 适配器里 `asShape = (h) => h as unknown as ShapeHandle` 只是类型转换，
    // 所以可以直接把 raw 句柄喂回 raw 求值函数（与 occt-primitives 内部同一口径）。
    k = await initOcctWasm()
  })

  const ratQuadO = (p0: Vec3, p1: Vec3, p2: Vec3, w1 = W45): BrepHandle =>
    o.makeBSplineEdge([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], [1, w1, 1], [0, 1], [3, 3], 2)

  it('O1. occt 上同样精确：7 点对拍 1e-9、|P(0.5)|=1、圆段弧长 π/2', () => {
    const e = ratQuadO(v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0))
    for (const t of SAMPLE_T) {
      const got = o.curvePointAtParam(e, t) as unknown as Vec3
      expect(dist(got, ratBezierAt(t, v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0), W45)), `t=${t}`).toBeLessThan(1e-9)
    }
    const mid = o.curvePointAtParam(e, 0.5) as unknown as Vec3
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(1, 9)
    expect(o.curveLength(e)).toBeCloseTo(Math.PI / 2, 6)
  })

  it('O2. curveType 归类（记录型）：有理二次 vs 原生 makeEllipseArc（降级前后的基准）', () => {
    const rational = ratQuadO(v3(A, 0, 0), v3(A, B, 0), v3(0, B, 0))
    const native = k.makeEllipseArc(v3(0, 0, 0) as never, v3(0, 0, 1) as never, A, B, 0, Math.PI / 2)
    const tr = o.curveType(rational)
    const tn = String(k.curveType(native as never))
    console.log(`[P0-O2] curveType: rational=${tr} native-makeEllipseArc=${tn}`)
    for (const t of [tr, tn]) expect(['circle', 'ellipse', 'bspline']).toContain(t)
    // 这是「降级前」的语义基准：occt 原生椭圆弧必须报 ellipse
    expect(tn).toBe('ellipse')
  })

  it('O3. 有理二次弧长 vs 原生解析弧长：smlib 1e-9 级、occt 约 5e-6 相对（曲线长度积分容差）', () => {
    const rational = ratQuadO(v3(A, 0, 0), v3(A, B, 0), v3(0, B, 0))
    const native = k.makeEllipseArc(v3(0, 0, 0) as never, v3(0, 0, 1) as never, A, B, 0, Math.PI / 2)
    const lr = o.curveLength(rational)
    const ln = Number(k.curveLength(native as never))
    const analytic = ellipseArcLen(A, B, 0, Math.PI / 2)
    const rel = Math.abs(lr - ln) / ln
    console.log(
      `[P0-O3] len rational=${lr.toFixed(9)} native=${ln.toFixed(9)} analytic=${analytic.toFixed(9)} ` +
        `rel(rational vs native)=${rel.toExponential(3)}`,
    )
    // 探针结论：occt 上「有理二次 + curveLength」的相对偏差约 4.6e-6（点几何仍是 1e-9 级 ——
    // O1 已验），是长度积分容差而不是曲线本身错。⇒ 下游用「面积 × 长度」当判据时，
    // 椭圆族必须把容差放到 1e-4 级，或直接与原生 makeEllipseArc 的长度对拍。
    expect(rel).toBeLessThan(1e-4)
    expect(Math.abs(lr - analytic) / analytic).toBeLessThan(1e-4)
  })
})
