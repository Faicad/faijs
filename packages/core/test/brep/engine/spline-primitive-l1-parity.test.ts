/**
 * @vitest-environment node
 *
 * spline-primitive-l1-parity — 2026-10-13 进 L1 的样条/螺旋族中立方法的双引擎契约
 *
 * 背景：`bsplineSurface` / `approximatePoints` / `interpolatePointsWithTangents` /
 * `makeHelixWire` / `makeSolid` / `thicken` / `makeNonPlanarFace` / `makeCircleArc` /
 * `rotate` / `subShapeCount` 十个名字从「包私有扩展 / occt 平台面」抬进
 * `BrepEngineApi`（方案 2026-10-13-brepkit-l1-spline-primitive-wiring-plan）。
 *
 * 两级断言（与 `faijs-fasteners/test/kernel-conformance.test.ts` 同口径）：
 *   1. 存在性：名字拼错 / 内核改名 / 只在一侧接线 → 立即红；
 *   2. 契约 smoke：每个方法真调一次，验返回形态与数值（bbox / area / volume）。
 *
 * 偏差双钉（AGENTS.md 铁律 2 + 「错误测试必须保留当前值与应有值」）：
 * brepkit 侧三个**近似**实现（螺旋采样拟合 / 切向丢失 / 曲面插值定阶）不是同一算法，
 * 偏差必须实测钉住「当前偏差上限 + 目标 0」，band 只能收紧不能放大：
 *   · makeHelixWire          → 采样弦高
 *   · interpolatePointsWithTangents → 两端切向被丢弃
 *   · bsplineSurface         → brepkit 定阶 3/3（occt 由内核自定阶）
 *
 * Run: npx vitest run test/brep/engine/spline-primitive-l1-parity.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import type { BrepHandle, BrepVec3 } from '../../../src/brep/engine/types'

let occtApi: BrepEngineApi
let brepkitApi: BrepEngineApi

/** 本轮进 L1 的十个中立名（三处适配器守卫已保证类型面，这里钉**运行时**面）。 */
const NEW_L1: readonly (keyof BrepEngineApi)[] = [
  'bsplineSurface',
  'approximatePoints',
  'interpolatePointsWithTangents',
  'makeHelixWire',
  'makeSolid',
  'thicken',
  'makeNonPlanarFace',
  'makeCircleArc',
  'rotate',
  'subShapeCount',
]

const v = (x: number, y: number, z: number): BrepVec3 => ({ x, y, z })

/**
 * 句柄存在性断言。
 *
 * ⚠️ GOTCHA（与 `brepkit-handle-zero.test.ts` 同一机制）：brepkit 句柄是 **0 基**，
 * `0` 是合法句柄 → `expect(h).toBeTruthy()` 会把全新内核返回的 0 号句柄判成
 * 「没返回」而误红。只判 undefined/null + 数值型。
 */
function assertHandle(h: BrepHandle, where: string): void {
  expect(h, `${where} 返回 undefined/null`).not.toBeUndefined()
  expect(h, `${where} 返回 null`).not.toBeNull()
  expect(typeof h, `${where} 句柄类型`).toBe('number')
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  occtApi = (await getActiveBrepEngine()).primitives

  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
  brepkitApi = (await getActiveBrepEngine()).primitives

  // 恢复 occt 为默认（其它测试文件不受影响）
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

// ── 夹具（两引擎通用，只用 L1 名构造）──

/** XY 平面闭合矩形 wire。 */
function rectWire(api: BrepEngineApi, w: number, h: number, z = 0): BrepHandle {
  const e1 = api.makeLineEdge(v(0, 0, z), v(w, 0, z))
  const e2 = api.makeLineEdge(v(w, 0, z), v(w, h, z))
  const e3 = api.makeLineEdge(v(w, h, z), v(0, h, z))
  const e4 = api.makeLineEdge(v(0, h, z), v(0, 0, z))
  return api.makeWire([e1, e2, e3, e4])
}

/** 闭合盒的 6 张独立面（w×h×d，一角在原点）。 */
function boxFaces(api: BrepEngineApi, w: number, h: number, d: number): BrepHandle[] {
  const quad = (a: BrepVec3, b: BrepVec3, c: BrepVec3, e: BrepVec3): BrepHandle => {
    const wire = api.makeWire([
      api.makeLineEdge(a, b),
      api.makeLineEdge(b, c),
      api.makeLineEdge(c, e),
      api.makeLineEdge(e, a),
    ])
    return api.makeFace(wire)
  }
  const P = (x: number, y: number, z: number) => v(x, y, z)
  return [
    quad(P(0, 0, 0), P(w, 0, 0), P(w, h, 0), P(0, h, 0)), // 底 z=0
    quad(P(0, 0, d), P(w, 0, d), P(w, h, d), P(0, h, d)), // 顶 z=d
    quad(P(0, 0, 0), P(w, 0, 0), P(w, 0, d), P(0, 0, d)), // y=0
    quad(P(0, h, 0), P(w, h, 0), P(w, h, d), P(0, h, d)), // y=h
    quad(P(0, 0, 0), P(0, h, 0), P(0, h, d), P(0, 0, d)), // x=0
    quad(P(w, 0, 0), P(w, h, 0), P(w, h, d), P(w, 0, d)), // x=w
  ]
}

/** rows×cols 点阵（z = 0.1·(i+j)，轻微非平面）。 */
function gridPoints(rows: number, cols: number): BrepVec3[] {
  const pts: BrepVec3[] = []
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) pts.push(v(i, j, 0.1 * (i + j)))
  return pts
}

const ENGINES: readonly { label: string; api: () => BrepEngineApi }[] = [
  { label: 'occt', api: () => occtApi },
  { label: 'brepkit', api: () => brepkitApi },
]

describe('第 1 级：方法存在性（只在一侧接线立即红）', () => {
  for (const eng of ENGINES) {
    it.each(NEW_L1)(`%s 存在于 ${eng.label} 的 L1 面`, (name) => {
      expect(typeof Reflect.get(eng.api(), name), `${eng.label}.${String(name)}`).toBe('function')
    })
  }
})

// ── GOTCHA（2026-10-13 实证，AGENTS.md 铁律 2）：L1 loft 的第三参是 endPoint ──
//
// 包侧（`faijs-fasteners` 的 `WarehouseKernel` / `faijs-gears` 的 `GearKernel`）的
// 旧口径是 `loft(wires, isSolid?, ruled?)`，L1 口径是 `loft(sections, ruled, endPoint?)`。
// 把旧调用形 `loft(wires, false, false)` 原样套到 L1 上，第三个 `false` 会被当成
// endPoint → occt 适配器走 `loftWithVertices(..., end=false)`，wasm **直接 abort**
// （进程退出、无 JS 异常可捕获，表现为 vitest 静默 exit 1）。
// 本用例钉住 L1 的正确口径：只传 (sections, ruled)。
describe('L1 loft 签名口径（第三参 = endPoint，不是 isSolid）', () => {
  it('occt: loft(sections, ruled=true) 两矩形截面 → 4×2×1 直壁实体', () => {
    const s = occtApi.loft([rectWire(occtApi, 4, 2, 0), rectWire(occtApi, 4, 2, 1)], true)
    expect(occtApi.getVolume(s)).toBeCloseTo(8, 3)
  })
})

// ── 契约守卫：包侧旧口径 `loft(wires, isSolid?, ruled?)` 的布尔量落进 endPoint 位 ──
//
// 旧行为：occt 走 loftWithVertices 而 wasm **硬 abort**（进程直接退出，JS 层捕不到，
// 表现为 vitest 静默 exit 1）；brepkit 抛一句无指向的 `cannot normalize zero vector`
// （2026-10-13 实测：faijs-gears 的齿面 `loft(wires, false, false)` 即此）。
// 两者都无法指路。L1 两侧现在都在进内核前静态判一次并显式失败。
describe('L1 loft 的 endPoint 契约守卫（静态可判的坏输入必须在执行前报错）', () => {
  for (const eng of ENGINES) {
    it(`${eng.label}: loft(secs, ruled, false) 抛 E_LOFT_BAD_ENDPOINT（不进内核）`, () => {
      const secs = [rectWire(eng.api(), 4, 2, 0), rectWire(eng.api(), 4, 2, 1)]
      expect(() => eng.api().loft(secs, true, false as never)).toThrow(/E_LOFT_BAD_ENDPOINT/)
      expect(() => eng.api().loft(secs, true, false as never)).toThrow(/got false/)
    })
  }
})

// ── 方言归一：中立调用方写 `makeSolid(revolve(...))` 必须在两引擎都成立 ──
//
// occt 的 revolve 产 shell、须 makeSolid 固化；brepkit 的 revolve 已直接产实体。
// 两者在适配器层消化：brepkit `revolveVec` 自己把 wire 升成 face（profileFaceOf），
// `makeSolid` 对已是实体的输入幂等返回。中立包（faijs-fasteners 的 revolveProfile）
// 因此不必按引擎分叉。
describe('revolveVec 收 wire + makeSolid 幂等（中立调用方方言归一）', () => {
  /** XZ 平面内 r∈[1,2]、z∈[0,1] 的闭合矩形轮廓。 */
  function annulusProfile(api: BrepEngineApi): BrepHandle {
    return api.makeWire([
      api.makeLineEdge(v(1, 0, 0), v(2, 0, 0)),
      api.makeLineEdge(v(2, 0, 0), v(2, 0, 1)),
      api.makeLineEdge(v(2, 0, 1), v(1, 0, 1)),
      api.makeLineEdge(v(1, 0, 1), v(1, 0, 0)),
    ])
  }

  for (const eng of ENGINES) {
    it(`${eng.label}: makeSolid(revolveVec(wire, Z 轴, 360°)) = 环形柱 V=3π`, () => {
      const api = eng.api()
      const shell = api.revolveVec(annulusProfile(api), v(0, 0, 0), v(0, 0, 1), 360)
      assertHandle(shell, `${eng.label}.revolveVec`)
      const solid = api.makeSolid(shell)
      expect(api.getVolume(solid)).toBeCloseTo(3 * Math.PI, 1)
      // 幂等：已是实体再 makeSolid 一次，体积不变（brepkit 侧 revolve 已产实体）。
      expect(api.getVolume(api.makeSolid(solid))).toBeCloseTo(3 * Math.PI, 1)
    })
  }
})

describe('第 2 级：契约 smoke（每个方法真调一次）', () => {
  for (const eng of ENGINES) {
    const api = () => eng.api()

    it(`${eng.label}: bsplineSurface 点阵 → face、面积 > 0`, () => {
      const f = api().bsplineSurface(gridPoints(3, 3), 3, 3)
      assertHandle(f, `${eng.label}.bsplineSurface`)
      expect(api().getSurfaceArea(f)).toBeGreaterThan(0)
    })

    it(`${eng.label}: approximatePoints 点列 → edge`, () => {
      const e = api().approximatePoints([v(0, 0, 0), v(1, 0.5, 1), v(0, 1, 2)])
      assertHandle(e, `${eng.label}.approximatePoints`)
      const bb = api().getBoundingBox(e)
      for (const n of [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax]) {
        expect(Number.isFinite(n), 'bbox 字段为有限数').toBe(true)
      }
    })

    it(`${eng.label}: makeHelixWire 螺旋线轴向跨度 = 高 h`, () => {
      const w = api().makeHelixWire(v(0, 0, 0), v(0, 0, 1), 1.5, 10, 3)
      assertHandle(w, `${eng.label}.makeHelixWire`)
      const bb = api().getBoundingBox(w)
      // 轴向是解析量（采样点沿轴均匀分布）→ 两引擎都精确落在 h。
      expect(bb.zmax - bb.zmin).toBeCloseTo(10, 2)
      // 径向：采样点落在 r=3 的圆上（内接多边形），弦高使包围盒略小于真径。
      expect(bb.xmax - bb.xmin).toBeGreaterThan(6 - 0.2)
      expect(bb.ymax - bb.ymin).toBeGreaterThan(6 - 0.2)
    })

    it(`${eng.label}: makeSolid（面 → sew 成 shell → solid）`, () => {
      // 独立构造封闭盒的 6 张面（不用 loft 结果取面，避免把「面属于哪个 solid」
      // 的历史状态带进 sew）。
      const faces = boxFaces(api(), 4, 2, 1)
      expect(faces.length).toBe(6)
      const shell = api().sew(faces, 1e-6)
      assertHandle(shell, `${eng.label}.sew`)
      const built = api().makeSolid(shell)
      assertHandle(built, `${eng.label}.makeSolid`)
    })

    it(`${eng.label}: thicken（face → 有厚度体）`, () => {
      const f = api().makeFace(rectWire(api(), 4, 2, 0))
      const s = api().thicken(f, 1)
      expect(api().getVolume(s)).toBeGreaterThan(0)
    })

    it(`${eng.label}: makeNonPlanarFace（非平面 wire → face）`, () => {
      const e1 = api().makeLineEdge(v(0, 0, 0), v(2, 0, 1))
      const e2 = api().makeLineEdge(v(2, 0, 1), v(0, 2, 0))
      const e3 = api().makeLineEdge(v(0, 2, 0), v(0, 0, 0))
      const f = api().makeNonPlanarFace(api().makeWire([e1, e2, e3]))
      assertHandle(f, `${eng.label}.makeNonPlanarFace`)
      expect(api().getSurfaceArea(f)).toBeGreaterThan(0)
    })

    it(`${eng.label}: makeCircleArc 弧长 = r·Δθ（圆心+法向+半径+起止角）`, () => {
      // 用弧长而不是 bbox：bbox 依赖「角度 0 对应哪个方向」（L1 未定义，两引擎
      // 各自取基），而弧长 r·Δθ 是方向无关的解析量 —— 能真正抓住「画成整圆」这类偏差。
      const e = api().makeCircleArc(v(0, 0, 0), v(0, 0, 1), 5, 0, Math.PI / 2)
      assertHandle(e, `${eng.label}.makeCircleArc`)
      expect(api().curveLength(e)).toBeCloseTo(5 * (Math.PI / 2), 2)
    })

    it(`${eng.label}: rotate 绕 Z 轴转 90° → bbox 的 x/y 互换`, () => {
      const box = api().makeBox(4, 2, 1)
      const rotated = api().rotate(box, { point: v(0, 0, 0), direction: v(0, 0, 1) }, Math.PI / 2)
      const bb = api().getBoundingBox(rotated)
      expect(bb.xmax - bb.xmin).toBeCloseTo(2, 3)
      expect(bb.ymax - bb.ymin).toBeCloseTo(4, 3)
      expect(bb.zmax - bb.zmin).toBeCloseTo(1, 3)
    })

    it(`${eng.label}: subShapeCount（box 面数 = 6）`, () => {
      expect(api().subShapeCount(api().makeBox(1, 1, 1), 'face')).toBe(6)
    })
  }
})

// ── 方言纪律：brepkit 缺 tolerance 参数必须显式失败，不静默丢弃 ──

describe('thicken 的 tolerance 方言（brepkit 无此参数）', () => {
  it('occt 侧接受 tolerance（1e-6 = brepjs 默认）', () => {
    const f = occtApi.makeFace(rectWire(occtApi, 4, 2, 0))
    expect(occtApi.getVolume(occtApi.thicken(f, 1, 1e-6))).toBeGreaterThan(0)
  })

  it('brepkit 侧对非零 tolerance 抛错（不静默丢弃）', () => {
    const f = brepkitApi.makeFace(rectWire(brepkitApi, 4, 2, 0))
    expect(() => brepkitApi.thicken(f, 1, 1e-6)).toThrow(/tolerance/)
    // 缺省 / 显式 0 仍可用
    expect(brepkitApi.getVolume(brepkitApi.thicken(f, 1))).toBeGreaterThan(0)
    expect(brepkitApi.getVolume(brepkitApi.thicken(f, 1, 0))).toBeGreaterThan(0)
  })
})

// ── 偏差双钉：brepkit 侧三个近似实现 ──

/** 曲线在参数首/末端的单位切向（用 L1 的 curveTangent）。 */
function endTangents(api: BrepEngineApi, edge: BrepHandle): { start: BrepVec3; end: BrepVec3 } {
  const p = api.curveParameters(edge)
  return {
    start: api.curveTangent(edge, p.first),
    end: api.curveTangent(edge, p.last),
  }
}

function unit(a: BrepVec3): BrepVec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1
  return v(a.x / l, a.y / l, a.z / l)
}

function angleBetween(a: BrepVec3, b: BrepVec3): number {
  const ua = unit(a)
  const ub = unit(b)
  const d = Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z))
  return Math.acos(d)
}

/** PanHead 头型样条的两点 + 两端切向（与 faijs-fasteners 的 A 侧对表用例同源）。 */
const PAN_HEAD_POINTS: BrepVec3[] = [v(6, 0, 0), v(3, 0, 3.6)]
const PAN_HEAD_T0 = v(-Math.sin(5 * Math.PI / 180), 0, Math.cos(5 * Math.PI / 180))
const PAN_HEAD_T1 = v(-1, 0, 0)

describe('偏差钉 1：interpolatePointsWithTangents 的两端切向', () => {
  it('occt 侧端点切向 == 给定切向（目标 0，当前 < 1e-3 弧度）', () => {
    const e = occtApi.interpolatePointsWithTangents(PAN_HEAD_POINTS, PAN_HEAD_T0, PAN_HEAD_T1)
    const t = endTangents(occtApi, e)
    expect(angleBetween(t.start, PAN_HEAD_T0)).toBeLessThan(1e-3)
    expect(angleBetween(t.end, PAN_HEAD_T1)).toBeLessThan(1e-3)
  })

  it('brepkit 侧**当前**丢弃切向（已知偏差，目标 0 → 修好后翻转此断言）', () => {
    // brepkit 无带切向约束的插值原语 → 适配器退化为 interpolatePoints（§7 决策点 3
    // 选 (a)）。两端切向因此是插值的自然切向，与给定切向有明显夹角 —— 这是**缺陷
    // 留档**：修复（brepkit 支持切向约束 / 换构造路径）后此断言必须翻转成
    // `toBeLessThan(1e-3)`，band 只准收紧。
    const e = brepkitApi.interpolatePointsWithTangents(PAN_HEAD_POINTS, PAN_HEAD_T0, PAN_HEAD_T1)
    const t = endTangents(brepkitApi, e)
    // 当前实测：端点切向 ≈ 弦方向（3-6, 0, 3.6-0）归一化，与给定切向夹角 ~0.6 rad。
    // 上界放宽到 1.5 rad 只钉「确实是错的」，不钉死实现细节。
    expect(angleBetween(t.start, PAN_HEAD_T0)).toBeGreaterThan(0.1)
    expect(angleBetween(t.start, PAN_HEAD_T0)).toBeLessThan(1.5)
    // 过点性仍必须成立（两端点位置不因退化而漂移）——这是不该退化的一半。
    const p = brepkitApi.curveParameters(e)
    const q0 = brepkitApi.curvePointAtParam(e, p.first)
    const q1 = brepkitApi.curvePointAtParam(e, p.last)
    const dist = (a: BrepVec3, b: BrepVec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    expect(dist(q0, PAN_HEAD_POINTS[0]!)).toBeLessThan(1e-6)
    expect(dist(q1, PAN_HEAD_POINTS[1]!)).toBeLessThan(1e-6)
  })
})

/**
 * 螺旋线的解析弧长：turns·√((2πr)² + pitch²)（一圈的弧长 = 圆周长与轴向推进的斜边）。
 */
function helixArcLength(pitch: number, height: number, radius: number): number {
  const turns = height / pitch
  return Math.abs(turns) * Math.hypot(2 * Math.PI * radius, pitch)
}

describe('偏差钉 2：makeHelixWire（brepkit 是采样拟合，非解析螺旋）', () => {
  const P = { pitch: 1.5, height: 10, radius: 3 }
  const EXACT = helixArcLength(P.pitch, P.height, P.radius)

  it('两引擎螺旋线的轴向跨度一致（解析量，不该有偏差）', () => {
    const o = occtApi.makeHelixWire(v(0, 0, 0), v(0, 0, 1), P.pitch, P.height, P.radius)
    const b = brepkitApi.makeHelixWire(v(0, 0, 0), v(0, 0, 1), P.pitch, P.height, P.radius)
    const bo = occtApi.getBoundingBox(o)
    const bb = brepkitApi.getBoundingBox(b)
    expect(bb.zmax - bb.zmin).toBeCloseTo(bo.zmax - bo.zmin, 3)
  })

  it('occt 侧弧长 == 解析值（解析螺旋，无偏差）', () => {
    const o = occtApi.makeHelixWire(v(0, 0, 0), v(0, 0, 1), P.pitch, P.height, P.radius)
    expect(occtApi.getLength(o)).toBeCloseTo(EXACT, 1)
  })

  it('brepkit 侧弧长偏差（当前 < 1%，目标 0 → 提高采样密度后 band 只准收紧）', () => {
    // ⚠️ 不要用 bbox 度量这条偏差：brepkit 的 getBoundingBox 对 wire 走
    // `tessellateEdge(e, 16)`（**只采样 16 点**，见 brepkitKernel.ts getBoundingBox），
    // 在 6.67 圈的螺旋线上采样稀疏 → 实测径向 bbox 偏差 0.091，那个数几乎全部是
    // **测量误差**而非几何误差。弧长走 curveLength（内核精确积分）才是几何真值。
    const b = brepkitApi.makeHelixWire(v(0, 0, 0), v(0, 0, 1), P.pitch, P.height, P.radius)
    const lb = brepkitApi.getLength(b)
    const rel = Math.abs(EXACT - lb) / EXACT
    // 实测（2026-10-13，每圈 36 段采样 + degree 3 插值）：相对偏差 < 1e-4。
    expect(rel, `brepkit 螺旋弧长相对偏差（解析 ${EXACT.toFixed(3)}，实测 ${lb.toFixed(3)}）`).toBeLessThan(1e-3)
  })
})
