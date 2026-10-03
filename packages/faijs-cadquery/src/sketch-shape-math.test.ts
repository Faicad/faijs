/**
 * 形状坐标数学的 **CadQuery 语义锚点**。
 *
 * 2026-10-03 去重：regularPolygon / slot / trapezoid / arc(c,r,a,da) / spline 的坐标
 * 计算全部改由库面提供（`regularPolygonVertices` / `slotOutline` / `trapezoidCorners` /
 * `arcPoints` / `clampedUniformKnots`），本层只做 CadQuery 语法适配（句柄、tag、
 * 选择器、mode、度→弧度）。去重**不许改变几何**，所以这里把 CadQuery 语义钉成锚点：
 * 顶点集合、bbox、弧中点、样条端点。换实现而几何漂了，这里会立刻红。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import {
  sketchCreate, sketchRegularPolygon, sketchSlot, sketchTrapezoid, sketchArc, sketchSegment,
  sketchSpline, sketchEdges, sketchDispose, type Sketch,
} from './index'

beforeAll(async () => {
  await setupNativeKernel()
})

type Pt = [number, number]

/**
 * 量化到 1e-9 网格，并顺手把 `-0` 归一成 `0`。
 *
 * 为什么必须做：形状顶点是 `cos/sin` 的产物，`Math.cos(Math.PI / 2)` 是 6.1e-17 而不是 0，
 * 于是同一个"0"会以 `+1.2e-16` / `-6.1e-17` 两种符号出现 —— 既让 `toFixed` 打出
 * `-0.000000`，也让"先按 x 再按 y"的排序被末位 ULP 决定而不是被几何决定。
 * 锚点要钉的是**形状**，不是浮点末位。
 */
function q(v: number): number {
  const r = Math.round(v * 1e9) / 1e9
  return r === 0 ? 0 : r
}

/** 所有边的端点去重后作为顶点集合（顺序无关）。 */
function vertexSet(s: Sketch): Pt[] {
  const k = getKernel()
  const seen = new Map<string, Pt>()
  for (const e of sketchEdges(s).selected) {
    const { first, last } = k.curveParameters(e as ShapeHandle)
    for (const t of [first, last]) {
      const p = k.curvePointAtParam(e as ShapeHandle, t)
      const pt: Pt = [q(p.x), q(p.y)]
      seen.set(`${pt[0]},${pt[1]}`, pt)
    }
  }
  return [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** 一条边的中点（参数中点，不是弦中点）。 */
function edgeMid(e: ShapeHandle): Pt {
  const k = getKernel()
  const { first, last } = k.curveParameters(e)
  const p = k.curvePointAtParam(e, (first + last) / 2)
  return [p.x, p.y]
}

/** 期望的顶点集合 → 排序后拼成可比较的字符串。 */
const fmt = (pts: Pt[]): string =>
  pts.map(([x, y]): Pt => [q(x), q(y)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([x, y]) => `(${x.toFixed(6)},${y.toFixed(6)})`)
    .join(' ')

describe('regularPolygon — 首顶点在 +Y、顺时针（CadQuery 语义）', () => {
  it('r=2 正方形是菱形（顶点在 ±Y / ±X 上）', () => {
    const s = sketchRegularPolygon(sketchCreate(), 2, 4)
    expect(fmt(vertexSet(s))).toBe(fmt([[0, 2], [2, 0], [0, -2], [-2, 0]]))
    sketchDispose(s)
  })

  it('r=2 六边形：顶点在 ±Y 与 (±√3, ±1)', () => {
    const r3 = Math.sqrt(3)
    const s = sketchRegularPolygon(sketchCreate(), 2, 6)
    expect(fmt(vertexSet(s))).toBe(fmt([
      [0, 2], [r3, 1], [r3, -1], [0, -2], [-r3, -1], [-r3, 1],
    ]))
    sketchDispose(s)
  })
})

describe('slot — w 是直边长度、h 是槽宽（总长 = w + h、总高 = h）', () => {
  it('slot(4,2)：四个切点在 (±2, ±1)', () => {
    const s = sketchSlot(sketchCreate(), 4, 2)
    expect(fmt(vertexSet(s))).toBe(fmt([[-2, 1], [2, 1], [2, -1], [-2, -1]]))
    sketchDispose(s)
  })
})

describe('trapezoid — a1/a2 是左右底角（度）', () => {
  it('trapezoid(4,2,45,90)：右腰垂直、左腰 45°', () => {
    const s = sketchTrapezoid(sketchCreate(), 4, 2, 45, 90)
    // t1 = h/tan45 = 2 → 左上角 x = -2+2 = 0；t2 = h/tan90 = 0 → 右上角 x = 2
    expect(fmt(vertexSet(s))).toBe(fmt([[-2, -1], [2, -1], [2, 1], [0, 1]]))
    sketchDispose(s)
  })

  it('trapezoid(4,2,45)：a2 缺省 = a1，顶边退化成一点（三角形）', () => {
    const s = sketchTrapezoid(sketchCreate(), 4, 2, 45)
    expect(fmt(vertexSet(s))).toBe(fmt([[-2, -1], [2, -1], [0, 1]]))
    sketchDispose(s)
  })
})

describe('arc(c, r, a, da) — 度制起点/扫掠', () => {
  it('圆心 (1,1) r=2，从 0° 扫 90°：两端点 + 弧中点在 45°', () => {
    const s = sketchArc(sketchCreate(), [1, 1], 2, 0, 90)
    const edges = sketchEdges(s).selected
    expect(edges).toHaveLength(1)
    const e = edges[0] as ShapeHandle
    const cr = Math.SQRT1_2 * 2
    expect(edgeMid(e)[0]).toBeCloseTo(1 + cr, 9)
    expect(edgeMid(e)[1]).toBeCloseTo(1 + cr, 9)
    // 负数对照：90° 弧的参数跨度是 π/2，不是 2π —— 这是"整圆"判据的前提。
    const k = getKernel()
    const { first, last } = k.curveParameters(e)
    expect(last - first).toBeCloseTo(Math.PI / 2, 6)
    sketchDispose(s)
  })

  it('|da| ≥ 360 → 整圆（一个 circle 边，参数跨度正好一整周）', () => {
    const s = sketchArc(sketchCreate(), [0, 0], 3, 0, 360)
    const edges = sketchEdges(s).selected
    expect(edges).toHaveLength(1)
    const k = getKernel()
    const e = edges[0] as ShapeHandle
    expect(k.curveType(e)).toBe('circle')
    const { first, last } = k.curveParameters(e)
    // 判"整圆"的判据就是跨度：劣弧/半圆的跨度会明显更小（见上一个用例的对照）。
    expect(last - first).toBeCloseTo(2 * Math.PI, 6)
    const p0 = k.curvePointAtParam(e, first)
    const p1 = k.curvePointAtParam(e, last)
    // 首末点重合（闭合）且都落在半径 3 上 —— 防"跨度够了但半径错了"。
    expect(Math.hypot(p0.x, p0.y)).toBeCloseTo(3, 9)
    expect(Math.hypot(p1.x, p1.y)).toBeCloseTo(3, 9)
    expect(p1.x).toBeCloseTo(p0.x, 9)
    expect(p1.y).toBeCloseTo(p0.y, 9)
    sketchDispose(s)
  })
})

describe('spline — 钳位均匀节点（端点插值在首末点）', () => {
  it('端点贴住首末控制点（节点向量换域不移动曲线）', () => {
    const pts: Pt[] = [[0, 0], [1, 2], [3, -1], [5, 1]]
    let s = sketchCreate()
    s = sketchSpline(s, pts)
    const e = sketchEdges(s).selected[0] as ShapeHandle
    const k = getKernel()
    const { first, last } = k.curveParameters(e)
    const p0 = k.curvePointAtParam(e, first)
    const p1 = k.curvePointAtParam(e, last)
    expect(p0.x).toBeCloseTo(0, 9)
    expect(p0.y).toBeCloseTo(0, 9)
    expect(p1.x).toBeCloseTo(5, 9)
    expect(p1.y).toBeCloseTo(1, 9)
    sketchDispose(s)
  })
})

describe('segment — 角度重载（度制）', () => {
  it('segment(2, 90) 从当前端点向上 2', () => {
    let s = sketchCreate()
    s = sketchSegment(s, [1, 1], [3, 1])
    s = sketchSegment(s, 2, 90)
    expect(fmt(vertexSet(s))).toBe(fmt([[1, 1], [3, 1], [3, 3]]))
    sketchDispose(s)
  })
})
