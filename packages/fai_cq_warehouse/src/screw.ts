// Copyright 2026 Faicad. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * screw.ts — 螺钉 12 类（W5）—— 上游 `cq_warehouse.fastener.Screw` 基类 + 12 个子类的逐位复刻。
 *
 * 装配流（`fastener.py:1513 make_head` + `:176 __init__`）：
 * ```
 *   head = revolve(head_profile) ∩ extrude(head_plan)      # 有 recess 时先 cut 再交
 *          ∪ revolve(flange_profile)                       # HexHeadWithFlange 才有
 *   cq_object = head.translate((0,0,-length_offset)) ∪ shank.translate((0,0,-length))
 *   shank = circle(min_radius).extrude(thread_length)（simple）或 shank.fuse(thread)
 * ```
 * `SetScrew` 走 `custom_make`：无头、全杆长、`cylinder − 六角沉孔`。
 *
 * 几何坐标：轮廓画在 XZ 平面（局部 x → 世界 X＝半径、局部 y → 世界 +Z），
 * `revolveProfile` 绕 Z 轴 360°。杆部 z ∈ [−length, −length_offset]，
 * 头部 z ∈ [−length_offset, −length_offset + head_height)。
 *
 * 逐位复刻的三个关键事实（A 侧实测见 `scripts/probe-screw-head-profiles.py`，
 * 回归锁在 `src/screw.test.ts`；分析见
 * `docs/analysis/2026-09-14-cq-warehouse-screw-probe.md`）：
 *
 * 1. **`vertices(">X")` / `edges(">Z").vertices(">X")` 用的是 `Edge.Center()`**，
 *    而圆弧的 `Edge.Center()` 是**圆弧质心而非圆心**——见 {@link edgeCenter}。
 * 2. **`CheeseHeadScrew` 的 `k / cos(degrees(5))` 单位怪癖**：`math.degrees(5)`
 *    的结果（286.4789）被当**弧度**喂给 `cos`，故长度为负；与 `5-90 = -85°`
 *    方向叠加后实测等效于「沿 5° 内倾母线向上」。直接照抄公式即得正确几何。
 * 3. **`fillet2D` 的圆弧邻边必须走圆心连线的精确解**：`t = r/tan(θ/2)` 只对
 *    「两直线角」精确，用在「圆弧-直线」角上会把切点放到**弧外**
 *    （RCOS 实测 `|p1 − 圆心| = 12.00099 ≠ rf = 12`，误差 2.0e-3）——见
 *    {@link filletAt}。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import {
  arcEdge,
  bboxOf,
  cut,
  cylinderBetween,
  extrudeFace,
  fuse,
  interpolateEdgeWithTangents,
  intersect,
  lineEdge,
  planarFace,
  polygonWire,
  radiusArcMidpoint,
  revolveProfile,
  translate as translateShape,
  wireFromEdges,
} from './primitives'
import {
  clearanceHoleDiameters,
  isolateFastenerType,
  SCREW_TABLES,
  screwTypes,
  type ParamRow,
  type ScrewClassName,
} from './params'
import { defaultHeadRecess, recessCutter, type RecessSpec } from './recess'
import { isoThread, isoThreadDimensions, type Hand } from './thread'
import { decodeImperialSize, polygonDiagonal } from './nut'

/** XZ 平面轮廓点：局部 (x, y)，revolve 后局部 x→世界半径、局部 y→世界 +Z。 */
interface Pt {
  x: number
  y: number
}

const DEG = Math.PI / 180
const TWO_PI = 2 * Math.PI

/** 旋转轴（Z 轴）——上游 `Workplane("XZ").revolve()` 的隐式轴。 */
const AXIS_Z = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }

/** `num(row)`：参数行取数（gen-data 已在生成期求值，运行期只做类型收窄）。 */
function num(row: ParamRow, key: string, where: string): number {
  const v = row[key]
  if (typeof v !== 'number')
    throw new Error(`${where}: screw_data["${key}"] is not numeric (got ${JSON.stringify(v)})`)
  return v
}

// ── 2D 轮廓构造原语（复刻 cq Workplane XZ 语义） ────────────────────────────

/**
 * 上游 `polarLine(start, angle)`：从 start 沿 angle 度方向画一条线。
 * 角度 0 = 局部 +x，逆时针为正。**长度允许为负**（CheeseHead 的 `degrees(5)`
 * 单位怪癖就产生负长度，见文件头说明）——照抄公式即正确。
 * @param start - 起点。
 * @param angleDeg - 方向角（度）。
 * @param length - 长度（可负）。
 * @returns 终点。
 */
function polarLineEnd(start: Pt, angleDeg: number, length: number): Pt {
  return {
    x: start.x + length * Math.cos(angleDeg * DEG),
    y: start.y + length * Math.sin(angleDeg * DEG),
  }
}

/**
 * 复刻 cq `radiusArc(end, radius)` 的符号语义：radius 的符号选择凹凸方向
 * （正半径 = 劣弧一侧，负半径 = 优弧一侧），与 `radiusArcMidpoint` 的
 * sagitta 符号规则一致。
 * @param start - 弧起点。
 * @param end - 弧终点。
 * @param radius - 带符号半径。
 * @returns 弧中点（供 `arcEdge` 使用）。
 */
function radiusArcMid(start: Pt, end: Pt, radius: number): Pt {
  return radiusArcMidpoint(start, end, radius)
}

/**
 * XZ 平面轮廓段——上游 cq `Workplane` 的 `hLineTo` / `vLineTo` / `lineTo` /
 * `polarLine` / `radiusArc` / `spline` 一一对应。每段自带起点，段序即上游绘制序；
 * 末段若未回到 `(0,0)` 则由 {@link revolveXZProfile} 补一条闭合边（对应上游 `.close()`）。
 *
 * 把起点也存进来的原因：`fillet2D` 要在顶点处**裁剪相邻两边**，裁剪圆弧时需要
 * (起点, 弧中点, 终点) 三点定圆。
 */
type Seg =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'arc'; a: Pt; mid: Pt; b: Pt }
  | { kind: 'spline'; a: Pt; b: Pt; t0: BrepVec3; t1: BrepVec3 }

/** 直线段（`hLineTo` / `vLineTo` / `lineTo` / `polarLine` 的产物）。 */
function line(a: Pt, b: Pt): Seg {
  return { kind: 'line', a, b }
}

/** 圆弧段（`radiusArc(end, radius)`：mid 按 cq sagitta 语义由 {@link radiusArcMid} 算）。 */
function arcSeg(a: Pt, b: Pt, radius: number): Seg {
  return { kind: 'arc', a, mid: radiusArcMid(a, b, radius), b }
}

/** 插值样条段（`spline([p], tangents=[t0,t1], includeCurrent=True)`）。 */
function splineSeg(a: Pt, b: Pt, t0: BrepVec3, t1: BrepVec3): Seg {
  return { kind: 'spline', a, b, t0, t1 }
}

/** 二维单位向量。 */
function unit(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y)
  return { x: v.x / l, y: v.y / l }
}

/** 归一化到 [0, 2π)。 */
function norm2pi(x: number): number {
  return ((x % TWO_PI) + TWO_PI) % TWO_PI
}

/** 圆弧段的有向张角（沿 a→mid→b 行进，可正可负）。 */
function arcSweep(s: { a: Pt; mid: Pt; b: Pt }, c: Pt): number {
  const t0 = Math.atan2(s.a.y - c.y, s.a.x - c.x)
  const t1 = Math.atan2(s.b.y - c.y, s.b.x - c.x)
  const tm = Math.atan2(s.mid.y - c.y, s.mid.x - c.x)
  let d = norm2pi(t1 - t0)
  if (norm2pi(tm - t0) > d) d -= TWO_PI
  return d
}

/** 圆弧段的圆心（三点外接圆）。 */
function arcCenter(s: { a: Pt; mid: Pt; b: Pt }): Pt {
  const { a, mid: m, b } = s
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y))
  const sa = a.x * a.x + a.y * a.y
  const sm = m.x * m.x + m.y * m.y
  const sb = b.x * b.x + b.y * b.y
  return {
    x: (sa * (m.y - b.y) + sm * (b.y - a.y) + sb * (a.y - m.y)) / d,
    y: (sa * (b.x - m.x) + sm * (a.x - b.x) + sb * (m.x - a.x)) / d,
  }
}

/** 圆弧在 p 处的单位切向，方向取「朝 ref 一侧」。 */
function arcTangentAt(p: Pt, c: Pt, ref: Pt): Pt {
  const v = { x: p.x - c.x, y: p.y - c.y }
  const t = { x: -v.y, y: v.x }
  const towards = { x: ref.x - p.x, y: ref.y - p.y }
  const sgn = t.x * towards.x + t.y * towards.y >= 0 ? 1 : -1
  return unit({ x: sgn * t.x, y: sgn * t.y })
}

/** 段在终点处的行进单位切向。 */
function tangentAtEnd(s: Seg): Pt {
  if (s.kind === 'line') return unit({ x: s.b.x - s.a.x, y: s.b.y - s.a.y })
  if (s.kind === 'spline')
    throw new Error('fillet2D: spline edge tangent unsupported（上游无此用例）')
  const back = arcTangentAt(s.b, arcCenter(s), s.mid)
  return { x: -back.x, y: -back.y }
}

/** 段在起点处的行进单位切向。 */
function tangentAtStart(s: Seg): Pt {
  if (s.kind === 'line') return unit({ x: s.b.x - s.a.x, y: s.b.y - s.a.y })
  if (s.kind === 'spline')
    throw new Error('fillet2D: spline edge tangent unsupported（上游无此用例）')
  return arcTangentAt(s.a, arcCenter(s), s.mid)
}

/** 段的可裁剪长度（直线 = 弦长；圆弧 = 弧长；spline 只报弦长——上游从不裁它）。 */
function segLength(s: Seg): number {
  if (s.kind !== 'arc') return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)
  const c = arcCenter(s)
  return Math.abs(arcSweep(s, c)) * Math.hypot(s.a.x - c.x, s.a.y - c.y)
}

/**
 * `Edge.Center()`——cq 方向选择器 `>Z` / `>X` 的排序键用的就是它，即边的**质心**
 * （圆弧给的是圆弧质心，**不是圆心**——把圆心当质心是复刻 cq 选择器最容易踩的坑，
 * 会让 RCOS 的 `edges(">Z")` 选错边）。直线 = 中点。
 *
 * 圆弧质心到圆心的距离 = `2R·sin(Δ/2)/Δ`（Δ 为有向张角），方向取弧中点角。
 * @param s - 轮廓段。
 * @returns 该边的质心（XZ 平面）。
 */
function edgeCenter(s: Seg): Pt {
  if (s.kind !== 'arc') return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
  const c = arcCenter(s)
  const r = Math.hypot(s.a.x - c.x, s.a.y - c.y)
  const d = arcSweep(s, c)
  const amp = (2 * r * Math.sin(Math.abs(d) / 2)) / Math.abs(d)
  const t0 = Math.atan2(s.a.y - c.y, s.a.x - c.x)
  return { x: c.x + amp * Math.cos(t0 + d / 2), y: c.y + amp * Math.sin(t0 + d / 2) }
}

/** 圆上 A→B 的弧中点（绕行方向由 origMid 指示，origMid 须在原弧上）。 */
function subArcMid(c: Pt, r: number, a: Pt, b: Pt, origMid: Pt): Pt {
  const d = arcSweep({ a, mid: origMid, b }, c)
  const t0 = Math.atan2(a.y - c.y, a.x - c.x)
  const am = t0 + d / 2
  return { x: c.x + r * Math.cos(am), y: c.y + r * Math.sin(am) }
}

/** 圆角几何：两侧切点 + 弧中点（喂给 `arcEdge`）。 */
interface FilletGeom {
  p1: Pt
  p2: Pt
  mid: Pt
}

/** 段上两点（须都在该段上）之间的行进距离：直线 = 弦长，圆弧 = 弧长。 */
function distAlong(s: Seg, from: Pt, to: Pt): number {
  if (s.kind !== 'arc') return Math.hypot(to.x - from.x, to.y - from.y)
  const c = arcCenter(s)
  const rad = Math.hypot(s.a.x - c.x, s.a.y - c.y)
  const a0 = Math.atan2(from.y - c.y, from.x - c.x)
  const a1 = Math.atan2(to.y - c.y, to.x - c.x)
  let d = a1 - a0
  while (d > Math.PI) d -= TWO_PI
  while (d < -Math.PI) d += TWO_PI
  return Math.abs(d) * rad
}

/**
 * `Wire.fillet2D(radius, vertices)` 的单顶点复刻（**精确解**）。
 *
 * 圆角圆心 C 由「到入边距离 = r」与「到出边距离 = r」两条约束确定：
 * - 直线边：`(C − a)·n = r`（n 取料内侧单位法向，由初始猜测点定侧）；
 * - 圆弧边：`|C − Q| = R ∓ r`（Q 圆心；圆角落在圆内取 `R−r`、圆外取 `R+r`），
 *   切点 = `Q + R·unit(C − Q)`（内切/外切同式）。
 *
 * 两直线角退化为经典 `t = r/tan(θ/2)`（与旧实现逐位等价，已对 CounterSunk /
 * SocketHeadCap 等用例验证）。
 *
 * ⚠️ **圆弧邻边绝不能当直线截**：把 `t = r/tan(θ/2)` 当弦长去截弧会得到弧外的点
 * （RCOS 的「圆弧-直线」角会偏 1e-3，实测 `|p1 − Q| = 12.00099 ≠ rf`）。圆弧邻边
 * 必须走「圆心连线」的精确解，否则 STEP 回归锁直接红。
 * @param prev - 入边（角点 = `prev.b`）。
 * @param next - 出边（起点 = 角点）。
 * @param r - 圆角半径。
 * @returns 切点 P1（在 prev 上）/ P2（在 next 上）与圆角弧中点。
 * @throws 半径超过任一边可用长度、或与邻边无相容解时（响亮失败）。
 */
function filletAt(prev: Seg, next: Seg, r: number): FilletGeom {
  const corner = prev.b
  const inDir = tangentAtEnd(prev)
  const outDir = tangentAtStart(next)
  const u1 = { x: -inDir.x, y: -inDir.y }
  const cosT = u1.x * outDir.x + u1.y * outDir.y
  const theta = Math.acos(Math.max(-1, Math.min(1, cosT)))
  const bis = unit({ x: u1.x + outDir.x, y: u1.y + outDir.y })
  /** 圆心 → 圆角弧中点 = 圆上离角点最近的点。 */
  const midNear = (ctr: Pt): Pt => {
    const v = unit({ x: corner.x - ctr.x, y: corner.y - ctr.y })
    return { x: ctr.x + v.x * r, y: ctr.y + v.y * r }
  }
  const availIn = segLength(prev)
  const availOut = segLength(next)

  // ① 两直线角：经典闭式（精确）
  if (prev.kind === 'line' && next.kind === 'line') {
    const t = r / Math.tan(theta / 2)
    if (t > availIn || t > availOut)
      throw new Error(`fillet2D: radius ${r} too large for corner edges (${availIn}, ${availOut})`)
    return {
      p1: { x: corner.x + u1.x * t, y: corner.y + u1.y * t },
      p2: { x: corner.x + outDir.x * t, y: corner.y + outDir.y * t },
      mid: midNear({ x: corner.x + bis.x * (r / Math.sin(theta / 2)), y: corner.y + bis.y * (r / Math.sin(theta / 2)) }),
    }
  }
  if (prev.kind === 'spline' || next.kind === 'spline')
    throw new Error('fillet2D: 不支持裁剪样条边（上游无此用例）')

  // ② 直线 + 圆弧角：直线边参数化 C = a + s·d + r·n，代入圆弧约束解 s 的二次式
  const lineIsPrev = prev.kind === 'line'
  const ln = lineIsPrev ? (prev as Extract<Seg, { kind: 'line' }>) : (next as Extract<Seg, { kind: 'line' }>)
  const arc = lineIsPrev ? (next as Extract<Seg, { kind: 'arc' }>) : (prev as Extract<Seg, { kind: 'arc' }>)
  const ld = unit({ x: ln.b.x - ln.a.x, y: ln.b.y - ln.a.y })
  const ctr0d = r / Math.sin(theta / 2)
  const guess = { x: corner.x + bis.x * ctr0d, y: corner.y + bis.y * ctr0d }
  // 料内侧法向：取使初始猜测点落在 +n 侧的那个法向
  const nRaw = { x: -ld.y, y: ld.x }
  const sgn = (guess.x - ln.a.x) * nRaw.x + (guess.y - ln.a.y) * nRaw.y >= 0 ? 1 : -1
  const n = { x: sgn * nRaw.x, y: sgn * nRaw.y }
  const Q = arcCenter(arc)
  const R = Math.hypot(arc.a.x - Q.x, arc.a.y - Q.y)
  const Rc = Math.hypot(guess.x - Q.x, guess.y - Q.y) < R ? R - r : R + r
  const w = { x: ln.a.x + r * n.x - Q.x, y: ln.a.y + r * n.y - Q.y }
  const wd = w.x * ld.x + w.y * ld.y
  const c0 = w.x * w.x + w.y * w.y - Rc * Rc
  const disc = wd * wd - c0
  if (disc < 0) throw new Error(`fillet2D: radius ${r} 与该角不相容（无解）`)
  const root = Math.sqrt(disc)
  const cand = [
    { x: ln.a.x + (-wd + root) * ld.x, y: ln.a.y + (-wd + root) * ld.y },
    { x: ln.a.x + (-wd - root) * ld.x, y: ln.a.y + (-wd - root) * ld.y },
  ]
  const linePt = cand.reduce((best, p) =>
    Math.abs((p.x - corner.x) * ld.x + (p.y - corner.y) * ld.y) <
    Math.abs((best.x - corner.x) * ld.x + (best.y - corner.y) * ld.y)
      ? p
      : best,
  )
  const ctr = { x: linePt.x + r * n.x, y: linePt.y + r * n.y }
  const au = unit({ x: ctr.x - Q.x, y: ctr.y - Q.y })
  const arcPt = { x: Q.x + R * au.x, y: Q.y + R * au.y }
  const p1 = lineIsPrev ? linePt : arcPt
  const p2 = lineIsPrev ? arcPt : linePt
  if (distAlong(prev, corner, p1) > availIn || distAlong(next, corner, p2) > availOut)
    throw new Error(`fillet2D: radius ${r} too large for corner edges (${availIn}, ${availOut})`)
  return { p1, p2, mid: midNear(ctr) }
}

/** 把段截到新终点 p（p 须在该段上；圆弧重算中点）。 */
function trimEnd(s: Seg, p: Pt): Seg {
  if (s.kind === 'line') return { kind: 'line', a: s.a, b: p }
  if (s.kind === 'spline') throw new Error('fillet2D: 不支持裁剪样条边（上游无此用例）')
  const c = arcCenter(s)
  const r = Math.hypot(s.a.x - c.x, s.a.y - c.y)
  return { kind: 'arc', a: s.a, mid: subArcMid(c, r, s.a, p, s.mid), b: p }
}

/** 把段截到新起点 p（p 须在该段上；圆弧重算中点）。 */
function trimStart(s: Seg, p: Pt): Seg {
  if (s.kind === 'line') return { kind: 'line', a: p, b: s.b }
  if (s.kind === 'spline') throw new Error('fillet2D: 不支持裁剪样条边（上游无此用例）')
  const c = arcCenter(s)
  const r = Math.hypot(s.a.x - c.x, s.a.y - c.y)
  return { kind: 'arc', a: p, mid: subArcMid(c, r, p, s.b, s.mid), b: s.b }
}

/**
 * 在指定**角点**（= `segs[i].b`）处倒半径 r 的圆角，返回新段序列
 * （相邻边已按切点裁剪，圆角弧插在两者之间）。
 * @param segs - 原始段序列。
 * @param corners - 角点索引（= 该角点所属段的索引 i，裁的是 i 与 i+1）。
 * @param r - 圆角半径。
 * @returns 倒角后的段序列。
 */
function filletSegs(segs: Seg[], corners: number[], r: number): Seg[] {
  const out = segs.slice()
  // 降序处理：splice 只会影响更大的下标，先做大的可保持小下标仍指向原段
  for (const i of [...corners].sort((x, y) => y - x)) {
    const prev = out[i]
    const next = out[i + 1]
    if (!prev || !next) throw new Error(`fillet2D: corner index ${i} out of range`)
    const g = filletAt(prev, next, r)
    out[i] = trimEnd(prev, g.p1)
    out[i + 1] = trimStart(next, g.p2)
    out.splice(i + 1, 0, { kind: 'arc', a: g.p1, mid: g.mid, b: g.p2 })
  }
  return out
}

/**
 * `vertices(">X")`：轮廓上**全部** x 取最大值的顶点（cq 返回列表，可能多于一个——
 * ButtonHeadWithCollar 的 `(dc/2,c)` 与 `(dc/2,0)` 就同时中选）。
 * @param segs - 轮廓段序列。
 * @returns 角点索引列表（角点 = `segs[i].b`）。
 */
function maxXCornerIndices(segs: Seg[]): number[] {
  const mx = Math.max(...segs.map((s) => s.b.x))
  return segs.map((s, i) => (Math.abs(s.b.x - mx) <= 1e-9 ? i : -1)).filter((i) => i >= 0)
}

/**
 * `edges(">Z").vertices(">X")`（CheeseHead / CounterSunk / SocketHeadCap / RCOS 的
 * 圆角落点）：先按 `Edge.Center()` 的 z 取最大 z 的边，再取这些边端点里 x 最大的
 * **顶点**，最后把该顶点映射回「以它为终点的段索引」。
 * @param segs - 轮廓段序列。
 * @returns 角点索引列表。
 */
function topEdgeMaxXCornerIndices(segs: Seg[]): number[] {
  const zs = segs.map((s) => edgeCenter(s).y)
  const mz = Math.max(...zs)
  const cand: Pt[] = []
  for (let i = 0; i < segs.length; i++)
    if (Math.abs(zs[i]! - mz) <= 1e-9) cand.push(segs[i]!.a, segs[i]!.b)
  const mx = Math.max(...cand.map((p) => p.x))
  const verts = cand.filter((p) => Math.abs(p.x - mx) <= 1e-9)
  return [
    ...new Set(
      segs
        .map((s, i) =>
          verts.some((p) => Math.abs(p.x - s.b.x) <= 1e-9 && Math.abs(p.y - s.b.y) <= 1e-9)
            ? i
            : -1,
        )
        .filter((i) => i >= 0),
    ),
  ]
}

/** XZ 轮廓点 → 世界坐标（局部 x → 世界 X＝半径、局部 y → 世界 +Z）。 */
function v3(p: Pt): BrepVec3 {
  return { x: p.x, y: 0, z: p.y }
}

/**
 * 轮廓**顶点**的最大 z（= 上游 `profile.vertices(">Z").val().Z`）。
 *
 * ⚠️ 只取段端点，**不含弧中点**：cq 的 `vertices()` 返回的是真顶点。这个值会被用作
 * 沉孔切割器的落位高度与 plan 挤出高度，多算一点就会整体偏移几何。
 * @param segs - 轮廓段序列。
 * @returns 顶点最大 z。
 */
function profileMaxZ(segs: Seg[]): number {
  let m = -Infinity
  for (const s of segs) m = Math.max(m, s.a.y, s.b.y)
  return m
}

/**
 * 轮廓**顶点**的最大 x（= 上游 `profile.vertices(">X").val().X`，同上只取端点）。
 * @param segs - 轮廓段序列。
 * @returns 顶点最大 x。
 */
function profileMaxX(segs: Seg[]): number {
  let m = -Infinity
  for (const s of segs) m = Math.max(m, s.a.x, s.b.x)
  return m
}

/**
 * XZ 轮廓段序列 → 封闭 wire → 绕 Z 轴旋转成**实体**。
 *
 * 末段若未回到起点则补一条闭合边（上游 `.close()`）。
 * @param segs - 轮廓段序列。
 * @returns 旋转实体（经 {@link revolveProfile} 保证是 solid 而非 shell）。
 */
function revolveXZProfile(segs: Seg[]): BrepHandle {
  const edges: BrepHandle[] = []
  for (const s of segs) {
    if (s.kind === 'line') edges.push(lineEdge(v3(s.a), v3(s.b)))
    else if (s.kind === 'arc') edges.push(arcEdge(v3(s.a), v3(s.mid), v3(s.b)))
    else edges.push(interpolateEdgeWithTangents([v3(s.a), v3(s.b)], s.t0, s.t1))
  }
  const first = segs[0]
  const last = segs[segs.length - 1]
  if (first && last && Math.hypot(last.b.x - first.a.x, last.b.y - first.a.y) > 1e-9)
    edges.push(lineEdge(v3(last.b), v3(first.a)))
  return revolveProfile(planarFace(wireFromEdges(edges)), AXIS_Z, TWO_PI)
}

/** 默认 oversized plan：3·maxR 方形（上游 `make_head` 的 `rect(3*max_head_radius, …)`）。 */
function rectPlanWire(half: number): BrepHandle {
  return polygonWire([
    { x: -half, y: -half, z: 0 },
    { x: half, y: -half, z: 0 },
    { x: half, y: half, z: 0 },
    { x: -half, y: half, z: 0 },
  ])
}

/** plan 点序列 → wire → 面沿 +Z 挤出 `height`。 */
function extrudePlanSolid(planWire: BrepHandle, height: number): BrepHandle {
  return extrudeFace(planarFace(planWire), height)
}

/**
 * 正六边形平面顶点列（`cq.Workplane("XY").polygon(6, e)`：首顶点在 +X，
 * `e` 是外接圆直径——cq 的 `polygon(n, diameter)` 内部取 `radius = diameter/2`，
 * 实测 HexHead `polygon(6, polygon_diagonal(10))` 顶点半径 = `e/2` = 5.773503）。
 * @param circumDiameter - 外接圆直径（= `polygonDiagonal(widthAcrossFlats, 6)`）。
 * @returns 6 个顶点（z=0）。
 */
function hexPlanPoints(circumDiameter: number): BrepVec3[] {
  const r = circumDiameter / 2
  const pts: BrepVec3[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), z: 0 })
  }
  return pts
}

/**
 * 指定 z 区间内的正六棱柱（SetScrew 的六角沉孔）。
 * @param circumDiameter - 外接圆直径。
 * @param zFrom - 起始高度（mm）。
 * @param zTo - 结束高度（mm）。
 * @returns 六棱柱实体（`zTo < zFrom` 时自动反向）。
 */
function hexPrism(circumDiameter: number, zFrom: number, zTo: number): BrepHandle {
  const solid = extrudeFace(planarFace(polygonWire(hexPlanPoints(circumDiameter))), zTo - zFrom)
  return translateShape(solid, 0, 0, Math.min(zFrom, zTo))
}

// ── Screw 基类复刻 ───────────────────────────────────────────────────────────

/** 12 类共享的构造参数（上游 `Screw.__init__` 签名，fastener.py:176）。 */
export interface ScrewParams {
  /** 尺寸串，如 `M6-1`（公制）或 `1/4-20`（英制）。 */
  size: string
  /** 头下到螺纹端的总长（mm；`length_offset` 会把头高计入）。 */
  length: number
  /** 类型标识，如 `iso4762`。 */
  fastener_type: string
  /** 螺纹旋向，默认 `right`。 */
  hand?: Hand
  /** 上游语义：True = 杆部光轴不建螺纹几何。 */
  simple?: boolean
  /** 六角头类的扳手空间（默认 6，跨直径）。 */
  socket_clearance?: number
}

/** `Screw.__init__` 的派生量集合（上游同名属性/方法）。 */
export interface ScrewResult {
  /** 螺钉实体；`custom_make` 未产出几何时为 null。 */
  handle: BrepHandle | null
  screwClass: ScrewClassName
  size: string
  threadSize: string
  isMetric: boolean
  threadDiameter: number
  threadPitch: number
  length: number
  fastenerType: string
  hand: Hand
  simple: boolean
  screwData: ParamRow
  headHeight: number
  headDiameter: number
  maxThreadLength: number
  threadLength: number
  socketClearance: number
  /** `countersink_profile` 的顶点最大 z（上游 `min_hole_depth` 的 `head_offset`）。 */
  headOffset: number | null
  /** `min_hole_depth(counter_sunk=True)`：`length + head_offset − length_offset`。 */
  minHoleDepth: number | null
  /** `min_hole_depth(counter_sunk=False)`：`length − length_offset`。 */
  minHoleDepthStraight: number
  info: string
}

/** 解析后的 screw_data + 基本量（传给各子类钩子）。 */
interface ScrewData {
  /** 该规格的参数行（已 isolate 到具体 fastener_type、维度名已去前缀）。 */
  data: ParamRow
  /** 完整尺寸串（clearance 表按 `M6` 前缀查）。 */
  threadSize: string
  threadDiameter: number
  threadPitch: number
  length: number
  simple: boolean
  hand: Hand
  socketClearance: number
}

/** 每个子类的头型钩子集（对应上游 `method_exists` 判定）。 */
interface HeadHooks {
  /** `head_profile`：XZ 平面封闭轮廓段序列。 */
  profile?: (d: ScrewData) => Seg[]
  /** `head_plan`：XY 平面 plan 轮廓点列（绕 Z 的封闭截面），如六角头。 */
  plan?: (d: ScrewData) => BrepVec3[]
  /** `head_recess`：沉孔槽规格（plan wire + depth + taper）。 */
  recess?: (d: ScrewData) => RecessSpec
  /** `flange_profile`：法兰轮廓（XZ 平面段序列）。 */
  flange?: (d: ScrewData) => Seg[]
  /** `length_offset`：沉头类把头高计入总长。 */
  lengthOffset?: (d: ScrewData) => number
  /** `countersink_profile`：沉孔切割器轮廓（`null` = 无，如 SetScrew）。 */
  countersink?: (d: ScrewData) => Seg[] | null
  /** `custom_make` 分支：SetScrew 无头全杆装配。 */
  custom?: (d: ScrewData) => { handle: BrepHandle | null; threadLength: number }
}

// ── 12 类头型轮廓：逐位复刻 ─────────────────────────────────────────────────

/** 全部螺钉类名（= `SCREW_TABLES` 的键，按声明序；测试与比对脚本共用）。 */
export const SCREW_CLASSES: readonly ScrewClassName[] = Object.keys(
  SCREW_TABLES,
) as ScrewClassName[]

/**
 * `countersink_profile` 的默认实现（`fastener.py:378`）：
 * `rect(width/2, k, centered=False)`，`width = clearance_hole_diameter − d + dk`。
 * @param d - 解析后的 screw_data。
 * @param fit - `Close` / `Normal` / `Loose`。
 * @returns XZ 轮廓段序列（(0,0)→(w,0)→(w,k)→(0,k)→(0,0)）。
 */
function defaultCountersink(d: ScrewData, fit = 'Normal'): Seg[] {
  const clr = clearanceHoleDiameters(d.threadSize.split('-')[0]!)
  const dia = clr[fit]
  if (dia === undefined)
    throw new Error(`countersink_profile: ${fit} invalid, must be one of ${Object.keys(clr).join(', ')}`)
  const width = dia - d.threadDiameter + num(d.data, 'dk', 'default_countersink_profile')
  const k = num(d.data, 'k', 'default_countersink_profile')
  const o = { x: 0, y: 0 }
  return [
    line(o, { x: width / 2, y: 0 }),
    line({ x: width / 2, y: 0 }, { x: width / 2, y: k }),
    line({ x: width / 2, y: k }, { x: 0, y: k }),
    line({ x: 0, y: k }, o),
  ]
}

/** 各类的钩子定义表（`method_exists` 判定的显式化）。 */
const SCREW_DEFS: Record<ScrewClassName, HeadHooks> = {
  // 圆头（hex 沉孔）：vLineTo(k) → hLineTo(dl/2) → radiusArc((dk/2,0), rf) → hLineTo(0)
  ButtonHeadScrew: {
    profile: (d) => {
      const o = { x: 0, y: 0 }
      const p1 = { x: 0, y: num(d.data, 'k', 'ButtonHeadScrew') }
      const p2 = { x: num(d.data, 'dl', 'ButtonHeadScrew') / 2, y: p1.y }
      const p3 = { x: num(d.data, 'dk', 'ButtonHeadScrew') / 2, y: 0 }
      return [line(o, p1), line(p1, p2), arcSeg(p2, p3, num(d.data, 'rf', 'ButtonHeadScrew')), line(p3, o)]
    },
    recess: (d) => defaultHeadRecess(d.data),
    countersink: (d) => defaultCountersink(d),
  },

  // 带台肩圆头：fillet2D(0.45c) 落在 `vertices(">X")` 的两个顶点上
  ButtonHeadWithCollarScrew: {
    profile: (d) => {
      const o = { x: 0, y: 0 }
      const k = num(d.data, 'k', 'ButtonHeadWithCollarScrew')
      const dl = num(d.data, 'dl', 'ButtonHeadWithCollarScrew')
      const dk = num(d.data, 'dk', 'ButtonHeadWithCollarScrew')
      const dc = num(d.data, 'dc', 'ButtonHeadWithCollarScrew')
      const c = num(d.data, 'c', 'ButtonHeadWithCollarScrew')
      const rf = num(d.data, 'rf', 'ButtonHeadWithCollarScrew')
      const segs = [
        line(o, { x: 0, y: k }),
        line({ x: 0, y: k }, { x: dl / 2, y: k }),
        arcSeg({ x: dl / 2, y: k }, { x: dk / 2, y: c }, rf),
        line({ x: dk / 2, y: c }, { x: dc / 2, y: c }),
        line({ x: dc / 2, y: c }, { x: dc / 2, y: 0 }),
        line({ x: dc / 2, y: 0 }, o),
      ]
      return filletSegs(segs, maxXCornerIndices(segs), 0.45 * c)
    },
    recess: (d) => defaultHeadRecess(d.data),
    // 上游覆写：`width = clearance − d + dc`
    countersink: (d) => {
      const clr = clearanceHoleDiameters(d.threadSize.split('-')[0]!)
      const dia = clr['Normal']
      if (dia === undefined) throw new Error('countersink_profile: Normal clearance missing')
      const dc = num(d.data, 'dc', 'ButtonHeadWithCollarScrew')
      const k = num(d.data, 'k', 'ButtonHeadWithCollarScrew')
      const w = dia - d.threadDiameter + dc
      const o = { x: 0, y: 0 }
      return [
        line(o, { x: w / 2, y: 0 }),
        line({ x: w / 2, y: 0 }, { x: w / 2, y: k }),
        line({ x: w / 2, y: k }, { x: 0, y: k }),
        line({ x: 0, y: k }, o),
      ]
    },
  },

  // 圆柱头（slot / T 沉孔）：5° 收顶 + `polarLine` 单位怪癖（见文件头）
  CheeseHeadScrew: {
    profile: (d) => {
      const k = num(d.data, 'k', 'CheeseHeadScrew')
      const dk = num(d.data, 'dk', 'CheeseHeadScrew')
      // 上游 `k / cos(degrees(5))`：`math.degrees(5)` = 286.4789 被当作弧度 →
      // cos 为负 → 长度为负；与 `5 − 90 = −85°` 叠加后 = 沿 5° 内倾母线向上。
      const len = k / Math.cos((5 * 180) / Math.PI)
      const o = { x: 0, y: 0 }
      const p0 = { x: dk / 2, y: 0 }
      const p1 = polarLineEnd(p0, 5 - 90, len)
      const p2 = { x: 0, y: p1.y }
      const segs = [line(o, p0), line(p0, p1), line(p1, p2), line(p2, o)]
      return filletSegs(segs, topEdgeMaxXCornerIndices(segs), k * 0.25)
    },
    recess: (d) => defaultHeadRecess(d.data),
    countersink: (d) => defaultCountersink(d),
  },

  // 沉头（length_offset = k）：-90-a/2 方向的锥面母线 + fillet2D(0.075k)
  CounterSunkScrew: {
    profile: (d) => {
      const a = num(d.data, 'a', 'CounterSunkScrew')
      const k = num(d.data, 'k', 'CounterSunkScrew')
      const dk = num(d.data, 'dk', 'CounterSunkScrew')
      const o = { x: 0, y: 0 }
      const top = { x: 0, y: k }
      const rim = { x: dk / 2, y: k }
      const foot = polarLineEnd(rim, -90 - a / 2, k / Math.cos((a / 2) * DEG))
      const segs = [line(o, top), line(top, rim), line(rim, foot), line(foot, o)]
      return filletSegs(segs, topEdgeMaxXCornerIndices(segs), k * 0.075)
    },
    lengthOffset: (d) => num(d.data, 'k', 'CounterSunkScrew'),
    recess: (d) => defaultHeadRecess(d.data),
    // 上游覆写：vLineTo(k) → hLineTo(dk/2) → polarLine → close（顶端 z = k）
    countersink: (d) => counterSunkCountersink(d),
  },

  // 六角头（head_plan 六角 + 15° 倒角）
  HexHeadScrew: {
    profile: (d) => hexHeadProfile(d),
    plan: (d) => hexPlanPoints(polygonDiagonal(num(d.data, 's', 'HexHeadScrew'), 6)),
    // 上游覆写：`width = e + socket_clearance + e`
    countersink: (d) => {
      const s = num(d.data, 's', 'HexHeadScrew')
      const k = num(d.data, 'k', 'HexHeadScrew')
      const e = polygonDiagonal(s, 6)
      return rectSegs((e + d.socketClearance + e) / 2, k)
    },
  },

  // 六角法兰头：头型/plan 复用 HexHead，另加 flange_profile
  HexHeadWithFlangeScrew: {
    profile: (d) => hexHeadProfile(d),
    plan: (d) => hexPlanPoints(polygonDiagonal(num(d.data, 's', 'HexHeadWithFlangeScrew'), 6)),
    flange: (d) => {
      const dc = num(d.data, 'dc', 'HexHeadWithFlangeScrew')
      const c = num(d.data, 'c', 'HexHeadWithFlangeScrew')
      const flangeAngle = 25
      const tangent = {
        x: (c / 2) * Math.cos((90 - flangeAngle) * DEG) + (dc - c) / 2,
        y: (c / 2) * Math.sin((90 - flangeAngle) * DEG) + c / 2,
      }
      const half = dc / 2 - c / 2
      const o = { x: 0, y: 0 }
      const cap = polarLineEnd(tangent, 180 - flangeAngle, half)
      return [line(o, { x: half, y: 0 }), arcSeg({ x: half, y: 0 }, tangent, -c / 2), line(tangent, cap), line(cap, { x: 0, y: cap.y }), line({ x: 0, y: cap.y }, o)]
    },
    // 上游覆写：`width = max(dc + shaft_clearance, e + socket_clearance)`
    countersink: (d) => {
      const clr = clearanceHoleDiameters(d.threadSize.split('-')[0]!)
      const dia = clr['Normal']
      if (dia === undefined) throw new Error('countersink_profile: Normal clearance missing')
      const dc = num(d.data, 'dc', 'HexHeadWithFlangeScrew')
      const s = num(d.data, 's', 'HexHeadWithFlangeScrew')
      const k = num(d.data, 'k', 'HexHeadWithFlangeScrew')
      const shaftClearance = dia - d.threadDiameter
      return rectSegs(Math.max(dc + shaftClearance, polygonDiagonal(s, 6) + d.socketClearance) / 2, k)
    },
  },

  // 盘头（spline 头型，无 fillet）
  PanHeadScrew: {
    profile: (d) => {
      const k = num(d.data, 'k', 'PanHeadScrew')
      const dk = num(d.data, 'dk', 'PanHeadScrew')
      const o = { x: 0, y: 0 }
      // cq `spline([(dk*0.25,k)], tangents=[(-sin5°, cos5°), (-1,0)], includeCurrent=True)`
      const t0 = { x: -Math.sin(5 * DEG), y: 0, z: Math.cos(5 * DEG) }
      const segs = [
        line(o, { x: dk / 2, y: 0 }),
        splineSeg({ x: dk / 2, y: 0 }, { x: dk * 0.25, y: k }, t0, { x: -1, y: 0, z: 0 }),
        line({ x: dk * 0.25, y: k }, { x: 0, y: k }),
        line({ x: 0, y: k }, o),
      ]
      return segs
    },
    recess: (d) => defaultHeadRecess(d.data),
    countersink: (d) => defaultCountersink(d),
  },

  // 带台肩盘头：flat = √((k−c)(2rf−(k−c)))，-rf 优弧收顶。唯一类型 din967 是 PH
  // （cross）沉孔 → W5 已知缺口（B 侧 `default_head_recess` 显式抛错）。
  PanHeadWithCollarScrew: {
    profile: (d) => {
      const rf = num(d.data, 'rf', 'PanHeadWithCollarScrew')
      const k = num(d.data, 'k', 'PanHeadWithCollarScrew')
      const dk = num(d.data, 'dk', 'PanHeadWithCollarScrew')
      const c = num(d.data, 'c', 'PanHeadWithCollarScrew')
      const flat = Math.sqrt(k - c) * Math.sqrt(2 * rf - (k - c))
      const o = { x: 0, y: 0 }
      return [
        line(o, { x: dk / 2, y: 0 }),
        line({ x: dk / 2, y: 0 }, { x: dk / 2, y: c }),
        line({ x: dk / 2, y: c }, { x: flat, y: c }),
        arcSeg({ x: flat, y: c }, { x: 0, y: k }, -rf),
        line({ x: 0, y: k }, o),
      ]
    },
    recess: (d) => defaultHeadRecess(d.data),
    countersink: (d) => defaultCountersink(d),
  },

  // 高圆柱头：oval_height = rf − √(4rf²−dk²)/2。唯一类型 iso7045 是 PH → W5 缺口。
  RaisedCheeseHeadScrew: {
    profile: (d) => {
      const dk = num(d.data, 'dk', 'RaisedCheeseHeadScrew')
      const k = num(d.data, 'k', 'RaisedCheeseHeadScrew')
      const rf = num(d.data, 'rf', 'RaisedCheeseHeadScrew')
      const oval = rf - Math.sqrt(4 * rf * rf - dk * dk) / 2
      const o = { x: 0, y: 0 }
      return [
        line(o, { x: 0, y: k }),
        arcSeg({ x: 0, y: k }, { x: dk / 2, y: k - oval }, rf),
        line({ x: dk / 2, y: k - oval }, { x: dk / 2, y: 0 }),
        line({ x: dk / 2, y: 0 }, o),
      ]
    },
    recess: (d) => defaultHeadRecess(d.data),
    countersink: (d) => defaultCountersink(d),
  },

  // 高沉头椭圆头（length_offset = k）：-rf 优弧顶 + 锥面母线 + fillet2D(0.075k)
  RaisedCounterSunkOvalHeadScrew: {
    profile: (d) => {
      const a = num(d.data, 'a', 'RaisedCounterSunkOvalHeadScrew')
      const k = num(d.data, 'k', 'RaisedCounterSunkOvalHeadScrew')
      const rf = num(d.data, 'rf', 'RaisedCounterSunkOvalHeadScrew')
      const dk = num(d.data, 'dk', 'RaisedCounterSunkOvalHeadScrew')
      const oval = rf - Math.sqrt(4 * rf * rf - dk * dk) / 2
      const o = { x: 0, y: 0 }
      const rim = { x: dk / 2, y: k }
      const foot = polarLineEnd(rim, -90 - a / 2, k / Math.cos((a / 2) * DEG))
      const segs = [
        line(o, { x: 0, y: k + oval }),
        arcSeg({ x: 0, y: k + oval }, rim, rf),
        line(rim, foot),
        line(foot, o),
      ]
      return filletSegs(segs, topEdgeMaxXCornerIndices(segs), k * 0.075)
    },
    lengthOffset: (d) => num(d.data, 'k', 'RaisedCounterSunkOvalHeadScrew'),
    recess: (d) => defaultHeadRecess(d.data),
    countersink: (d) => counterSunkCountersink(d),
  },

  // 无头紧定螺钉（custom_make）：圆柱(min_radius) − 六角沉孔（外接圆 e、深 t）
  SetScrew: {
    custom: (d) => {
      const s = num(d.data, 's', 'SetScrew')
      const t = num(d.data, 't', 'SetScrew')
      const e = polygonDiagonal(s, 6)
      const dims = isoThreadDimensions({
        major_diameter: d.threadDiameter,
        pitch: d.threadPitch,
        external: true,
      })
      // 上游 `circle(min_radius).polygon(6, e).extrude(t).faces(">Z").workplane()
      //       .circle(min_radius).extrude(length−t).mirror()` —— 嵌套 wire 成孔后镜像，
      // 等价于「绕 Z 的圆柱（z∈[−length,0]）减六角棱柱（z∈[−t,0]）」（探针逐位吻合）。
      const core = cut(
        cylinderBetween(dims.minRadius, -d.length, 0),
        hexPrism(e, -t, 0),
      )
      if (d.simple) return { handle: core, threadLength: d.length }
      const thread = isoThread({
        major_diameter: d.threadDiameter,
        pitch: d.threadPitch,
        length: d.length,
        external: true,
        hand: d.hand,
        end_finishes: ['fade', 'fade'],
        simple: false,
      })
      return {
        handle: fuse(core, translateShape(thread.handle!, 0, 0, -d.length)),
        threadLength: d.length,
      }
    },
    countersink: () => null,
  },

  // 内六角圆柱头：rect(dk/2, k) + fillet2D(0.075k)
  SocketHeadCapScrew: {
    profile: (d) => {
      const dk = num(d.data, 'dk', 'SocketHeadCapScrew')
      const k = num(d.data, 'k', 'SocketHeadCapScrew')
      const o = { x: 0, y: 0 }
      const segs = [
        line(o, { x: dk / 2, y: 0 }),
        line({ x: dk / 2, y: 0 }, { x: dk / 2, y: k }),
        line({ x: dk / 2, y: k }, { x: 0, y: k }),
        line({ x: 0, y: k }, o),
      ]
      return filletSegs(segs, topEdgeMaxXCornerIndices(segs), k * 0.075)
    },
    recess: (d) => defaultHeadRecess(d.data),
    countersink: (d) => defaultCountersink(d),
  },
}

/** `rect(w, h, centered=False)` 的轮廓段序列（(0,0)→(w,0)→(w,h)→(0,h)→(0,0)）。 */
function rectSegs(w: number, h: number): Seg[] {
  const o = { x: 0, y: 0 }
  return [line(o, { x: w, y: 0 }), line({ x: w, y: 0 }, { x: w, y: h }), line({ x: w, y: h }, { x: 0, y: h }), line({ x: 0, y: h }, o)]
}

/**
 * 六角头轮廓（`fastener.py:177`）：`e = polygon_diagonal(s, 6)`、
 * `cs = (e − s)·tan15°/2`（15° 顶倒角）。
 * @param d - 解析后的 screw_data。
 * @returns XZ 轮廓段序列。
 */
function hexHeadProfile(d: ScrewData): Seg[] {
  const k = num(d.data, 'k', 'HexHeadScrew')
  const s = num(d.data, 's', 'HexHeadScrew')
  const e = polygonDiagonal(s, 6)
  const cs = ((e - s) * Math.tan(15 * DEG)) / 2
  const o = { x: 0, y: 0 }
  return [
    line(o, { x: e / 2, y: 0 }),
    line({ x: e / 2, y: 0 }, { x: e / 2, y: k - cs }),
    line({ x: e / 2, y: k - cs }, { x: s / 2, y: k }),
    line({ x: s / 2, y: k }, { x: 0, y: k }),
    line({ x: 0, y: k }, o),
  ]
}

/**
 * 沉头族共用的 `countersink_profile`（`fastener.py:147` / `:404`）：
 * `vLineTo(k) → hLineTo(dk/2) → polarLine(k/cos(a/2), −90−a/2) → close`。
 * @param d - 解析后的 screw_data。
 * @returns XZ 轮廓段序列（顶点最大 z = k）。
 */
function counterSunkCountersink(d: ScrewData): Seg[] {
  const a = num(d.data, 'a', 'countersink_profile')
  const k = num(d.data, 'k', 'countersink_profile')
  const dk = num(d.data, 'dk', 'countersink_profile')
  const o = { x: 0, y: 0 }
  const rim = { x: dk / 2, y: k }
  const foot = polarLineEnd(rim, -90 - a / 2, k / Math.cos((a / 2) * DEG))
  return [
    line(o, { x: 0, y: k }),
    line({ x: 0, y: k }, rim),
    line(rim, foot),
    line(foot, o),
  ]
}

/**
 * 入参解析（上游 `Screw.__init__` 的前半段，`fastener.py:186-223`）：尺寸拆解 +
 * 类型/旋向校验 + `isolate_fastener_type` 查表。
 * @param className - 12 类之一（决定参数表与钩子集）。
 * @param p - 入参。
 * @returns 解析后的 screw_data 与基本量。
 * @throws 尺寸串格式错、类型/旋向非法、该规格在表中缺失时（全部与上游同文）。
 */
function resolveScrewData(className: ScrewClassName, p: ScrewParams): ScrewData {
  const table = SCREW_TABLES[className]
  const types = screwTypes(className)

  const size = p.size.trim()
  const sizeParts = size.split('-')
  if (sizeParts.length !== 2)
    throw new Error(`${JSON.stringify(sizeParts)} invalid, must be formatted as size-pitch or size-TPI`)
  const threadSize = size
  const isMetric = threadSize.startsWith('M')
  let threadDiameter: number
  let threadPitch: number
  if (isMetric) {
    threadDiameter = Number(sizeParts[0]!.slice(1))
    threadPitch = Number(sizeParts[1])
  } else {
    ;[threadDiameter, threadPitch] = decodeImperialSize(threadSize)
  }

  if (!types.includes(p.fastener_type))
    throw new Error(`${p.fastener_type} invalid, must be one of ${types.join(', ')}`)
  const hand = p.hand ?? 'right'
  if (hand !== 'left' && hand !== 'right')
    throw new Error(`${hand} invalid, must be one of 'left' or 'right'`)

  const isolatedTable = isolateFastenerType(p.fastener_type, table)
  const screwData = isolatedTable[threadSize]
  if (!screwData)
    throw new Error(`${size} invalid, must be one of ${Object.keys(isolatedTable).join(', ')}`)

  return {
    data: screwData,
    threadSize,
    threadDiameter,
    threadPitch,
    length: p.length,
    simple: p.simple ?? true,
    hand,
    socketClearance: p.socket_clearance ?? 6,
  }
}

/**
 * 头型轮廓的**顶点序列**（首段起点 + 各段终点，含 `fillet2D` 切点）——对应 A 侧
 * `head_profile` 的边端点。逐位对照的回归锁通道（见 `src/screw.test.ts`），
 * 也是 W9·P1-b 复用沉孔轮廓的入口。
 * @param className - 12 类之一。
 * @param p - 入参（只需 `size` / `fastener_type` 等，`length` 不参与轮廓）。
 * @returns XZ 顶点列（局部 x→半径、y→轴向）；`SetScrew` 无头型时返回 `[]`。
 */
export function screwProfilePoints(className: ScrewClassName, p: ScrewParams): Pt[] {
  const hooks = SCREW_DEFS[className]
  if (!hooks.profile) return []
  const segs = hooks.profile(resolveScrewData(className, p))
  return [segs[0]!.a, ...segs.map((s) => s.b)]
}

/**
 * `Screw.__init__`（`fastener.py:176`）的 B 侧复刻：解析 + 装配 + 派生量。
 * @param className - 12 类之一（决定参数表与钩子集）。
 * @param p - 入参。
 * @returns 螺钉实体与上游同名派生量。
 */
export function buildScrew(className: ScrewClassName, p: ScrewParams): ScrewResult {
  const hooks = SCREW_DEFS[className]
  const d = resolveScrewData(className, p)
  const { threadSize, threadDiameter, threadPitch, hand, simple } = d
  const size = threadSize

  // ── make_head ──（上游 fastener.py:1513）
  let head: BrepHandle | null = null

  if (hooks.profile) {
    const profileSegs = hooks.profile(d)
    const maxHeadHeight = profileMaxZ(profileSegs)
    const maxHeadRadius = profileMaxX(profileSegs)
    const revolved = revolveXZProfile(profileSegs)
    const planPoints = hooks.plan?.(d)
    if (hooks.recess) {
      const recess = recessCutter(hooks.recess(d), maxHeadHeight)
      const planSolid = extrudePlanSolid(
        planPoints ? polygonWire(planPoints) : rectPlanWire(3 * maxHeadRadius),
        maxHeadHeight,
      )
      head = intersect(revolved, cut(planSolid, recess))
    } else if (planPoints) {
      head = intersect(revolved, extrudePlanSolid(polygonWire(planPoints), maxHeadHeight))
    } else {
      throw new Error(`${className}: head_profile without plan or recess is unsupported`)
    }
    if (hooks.flange) head = fuse(head, revolveXZProfile(hooks.flange(d)))
  }

  // ── length_offset / 装配 ──
  const lengthOffset = hooks.lengthOffset ? hooks.lengthOffset(d) : 0
  if (lengthOffset >= p.length)
    throw new Error(`Screw length ${p.length} is <= countersunk screw head ${lengthOffset}`)
  const maxThreadLength = p.length - lengthOffset
  const threadLength = p.length - lengthOffset

  let handle: BrepHandle | null = null
  let headHeight = 0
  let headDiameter = 0

  if (hooks.custom) {
    // SetScrew：无头。上游 `if method_exists(custom_make): cq_object = custom_make()`
    const r = hooks.custom(d)
    handle = r.handle
  } else if (head !== null) {
    const bb = bboxOf(head)
    headHeight = bb.zmax
    headDiameter = 2 * Math.max(bb.xmax, bb.ymax)
    const headT = translateShape(head, 0, 0, -lengthOffset)
    const dims = isoThreadDimensions({
      major_diameter: threadDiameter,
      pitch: threadPitch,
      external: true,
    })
    const shank = cylinderBetween(dims.minRadius, -p.length, -lengthOffset)
    if (!simple) {
      const thread = isoThread({
        major_diameter: threadDiameter,
        pitch: threadPitch,
        length: threadLength,
        external: true,
        hand,
        end_finishes: ['fade', 'raw'],
        simple: false,
      })
      handle = fuse(headT, fuse(shank, translateShape(thread.handle!, 0, 0, -lengthOffset - threadLength)))
    } else {
      handle = fuse(headT, shank)
    }
  }

  // ── `min_hole_depth` 相关派生量 ──
  const cs = hooks.countersink ? hooks.countersink(d) : null
  const headOffset = cs ? profileMaxZ(cs) : null

  return {
    handle,
    screwClass: className,
    size,
    threadSize,
    isMetric: threadSize.startsWith('M'),
    threadDiameter,
    threadPitch,
    length: p.length,
    fastenerType: p.fastener_type,
    hand,
    simple,
    screwData: d.data,
    headHeight,
    headDiameter,
    maxThreadLength,
    threadLength,
    socketClearance: d.socketClearance,
    headOffset,
    minHoleDepth: headOffset === null ? null : p.length + headOffset - lengthOffset,
    minHoleDepthStraight: p.length - lengthOffset,
    info: `${className}(${p.fastener_type}): ${threadSize}x${p.length}${hand === 'left' ? ' left hand thread' : ''}`,
  }
}
