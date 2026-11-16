/**
 * spine-analysis — 脊柱事实（纯几何，不扫掠）
 *
 * ## 为什么需要
 *
 * 扫掠该走哪条路，完全由**脊柱长什么样**决定，而不是由调用方的心情决定：
 *
 * | 脊柱事实 | 单次扫掠的结果（实测，见 test/api/sweep-kernel-behavior.test.ts） |
 * |---|---|
 * | 单边任意曲线 | 精确（1.0000） |
 * | 多边、同类型、全 G1 | 精确（1.0000） |
 * | 多边、混合类型、全 G1 | **A×(弧长 − 腿长)** —— 绑定层缺陷，必须逐段 |
 * | 多边、全直线、有 G0 折角 | 内核默认过渡下退化为「平移塌陷」（2/π、1/2） |
 * | 有断裂 / 折返 / 退化 | 语义无解或产出自交体 |
 *
 * 所以把「脊柱是什么」抽成一份可测的事实表（本文件），策略层只读这张表做判断，
 * 执行层与判据层都不再各自重复解析脊柱。
 *
 * ## 不变量
 *
 * - **只读**：不构造几何、不加锁、不吞异常——量不出来就如实置 `null` 并留痕。
 * - **不判对错**：这里只回答「是什么」；「能不能扫、该怎么扫」在
 *   `sweep-strategy.ts`，这里不抛业务错误。
 * - 每条边的子形状句柄在函数内部 release（借用语义与 `getSubShapes` 一致）。
 */

import type { BrepCurveParameters, BrepHandle, BrepVec3 } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'

/** 边的几何粗分类。`line`/`arc` 参与策略判断，`other`（样条等）保守处理。 */
export type SpineEdgeKind = 'line' | 'arc' | 'other'

/** 单条边的几何事实。 */
export interface SpineEdgeFacts {
  kind: SpineEdgeKind
  /** 内核 `curveType` 的原始值（诊断用：'line' / 'circle' / 'bspline' …）。 */
  curveType: string
  start: BrepVec3
  end: BrepVec3
  /** 起点 / 终点单位切向（沿边的走向，即 curveParameters 的 first→last）。 */
  tStart: BrepVec3
  tEnd: BrepVec3
  /** 参数中点处的点（弧用它反解半径）。 */
  mid: BrepVec3
  /**
   * 平面性判定用的采样点（沿边取的点，不是控制点）。
   *
   * 采样密度按边类型分：`line` 只要两端（直线在两端之间不会有偏差）；`arc` 取
   * 两端 + 中点（三点定圆，够了）；`other`（样条 / 椭圆 / 螺旋）取 5 点 —— 单条
   * 空间样条如果只取 3 点，任意三点都共面，会把弯曲的脊柱误判成平面。
   */
  samples: BrepVec3[]
  length: number
  /** `kind === 'arc'` 时的弧半径（由起点切向 + 弦长反解），其余为 undefined。 */
  radius?: number
}

/** 一个 G0 节点（两段之间的折角）。 */
export interface SpineCorner {
  /** 拐角发生在 edges[index-1] 与 edges[index] 之间；闭合脊柱的收尾拐角 index = edges.length。 */
  index: number
  point: BrepVec3
  /** 转角（弧度，0…π）。 */
  turn: number
}

/** 脊柱事实。字段口径与阈值依据见下方 `analyzeSpine` 的注释。 */
export interface SpineFacts {
  edges: SpineEdgeFacts[]
  totalLength: number
  closed: boolean
  /** 相邻边端点不重合的位置（index = 后一条边的下标）。 */
  gaps: { index: number; dist: number }[]
  /** 只收 G0 节点（turn > G1_TOL）。 */
  corners: SpineCorner[]
  maxTurn: number
  /** 任一转角 > FOLD_TURN（175°）：180° 折返会让第二段整条落在第一段体内。 */
  fold: boolean
  /** 边类型不止一种（`line` / `arc` / `other` 之间）。 */
  mixed: boolean
  /**
   * 整条脊柱是否落在**单一平面**内（容差见 `PLANAR_RELATIVE_TOL`）。
   *
   * 为什么要这个事实：smlib 只有 `SmApiCreateSweepAlongPlanarPath`，空间 G0 折角进去
   * 会退化成体积 0、非流形的碎片（实测 P0i：V=0 / manifold=false / 10 面）。这条事实
   * 让「引擎能不能做这个折角」在**扫掠之前**就被判掉，而不是先扫再发现。
   */
  planar: boolean
  /** 边长 < DEGENERATE_LENGTH 的边下标。 */
  degenerate: number[]
}

/** G0/G1 分界：1e-3 rad ≈ 0.057°。该量级下斜接与过渡的几何差别不可见，但内核默认过渡的退化仍在。 */
export const G1_TOL = 1e-3
/** 折返阈值：175°。实测 180° 折返产出自交实体，且并集退化为包含关系。 */
export const FOLD_TURN = (175 * Math.PI) / 180
/** 零长边阈值（绝对量）。 */
export const DEGENERATE_LENGTH = 1e-9
/** 端点重合判据：相对总长的比例。OCCT 顶点合并精度在 1e-7 量级，取相对量避免大零件误判。 */
const GAP_RELATIVE_TOL = 1e-6
/**
 * 平面性容差（相对总长）。采样点是内核的精确求值（`curvePointAtParam`），直线 / 圆弧 /
 * 样条在真正平面的脊柱上偏差在 1e-14 量级；1e-6 只用来吸收大零件的浮点噪声。
 */
const PLANAR_RELATIVE_TOL = 1e-6

function sub(a: BrepVec3, b: BrepVec3): BrepVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a: BrepVec3, b: BrepVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function norm(v: BrepVec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function cross(a: BrepVec3, b: BrepVec3): BrepVec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

/**
 * 单位化；零向量回落到 +Z（与 `curveTangent` 在退化点上的一致口径）。
 * @param v - 任意非零向量（零向量不报错，回落 +Z）。
 * @returns 单位向量。
 */
export function unit(v: BrepVec3): BrepVec3 {
  const l = norm(v)
  return l < 1e-12 ? { x: 0, y: 0, z: 1 } : { x: v.x / l, y: v.y / l, z: v.z / l }
}

function dist(a: BrepVec3, b: BrepVec3): number {
  return norm(sub(a, b))
}

/**
 * 两向量夹角（弧度，0…π），入参不需要是单位向量。
 * @param a - 第一个向量。
 * @param b - 第二个向量。
 * @returns 夹角（弧度）；任一向量为零向量时返回 0（不猜方向）。
 */
export function angleBetween(a: BrepVec3, b: BrepVec3): number {
  const na = norm(a)
  const nb = norm(b)
  if (na < 1e-12 || nb < 1e-12) return 0
  const c = Math.min(1, Math.max(-1, dot(a, b) / (na * nb)))
  return Math.acos(c)
}

/**
 * 弧半径：用「起点切向 + 起点到中点的弦」反解。
 *
 * 圆上「切向–弦」夹角 = 该弦所对圆心角的一半 ⇒ R = |chord| / (2·sin(夹角))。
 * 比三点圆拟合更稳：整圆（首末点重合）时三点拟合退化，这个式子仍然成立。
 * 量不出（近乎共线、参数退化）就返回 undefined——半径只用于错误信息与自交预判，
 * 拿不到就不判，不猜。
 */
function arcRadius(p0: BrepVec3, pm: BrepVec3, t0: BrepVec3): number | undefined {
  const chord = sub(pm, p0)
  const chordLen = norm(chord)
  if (chordLen < 1e-9) return undefined
  const alpha = angleBetween(chord, t0)
  const s = Math.sin(alpha)
  if (s < 1e-6) return undefined
  const r = chordLen / (2 * s)
  return Number.isFinite(r) && r > 0 ? r : undefined
}

/**
 * 数值切向：用同一曲线上的两个邻近点做单侧差分。
 *
 * **为什么不用内核的 `curveTangent`**（实测，2026-11-16）：先对边调
 * `curveParameters` 再调 `curveTangent`，之后紧跟的 `sweepFull`（带 `withContact`）
 * 会以 `Sweep operation failed` 失败——同一个扫掠在「不读切向」时正常。这是
 * occt-wasm 的调用交互缺陷（`MakePipe` 不受影响），faijs 无法在内核里修，只能在
 * 分析层绕开：点求值（`curvePointAtParam`）单独使用是安全的。
 *
 * 精度：单侧差分的方向误差 ≈ h·κ/2，取 h = 1e-4 × 参数区间即 1e-5 rad 量级
 * （≪ 判据 C2 的 1° 容差），足够支撑落位与拐角判定。
 */
function numericTangent(
  api: BrepEngineApi,
  edge: BrepHandle,
  pr: BrepCurveParameters,
  at: 'start' | 'end',
): BrepVec3 {
  const span = Math.abs(pr.last - pr.first)
  const h = Math.max(span * 1e-4, 1e-9)
  const p = (t: number): BrepVec3 => api.curvePointAtParam(edge, t)
  const d = at === 'start' ? sub(p(pr.first + h), p(pr.first)) : sub(p(pr.last), p(pr.last - h))
  return norm(d) < 1e-12 ? { x: 0, y: 0, z: 1 } : unit(d)
}

/** 单条边的几何事实。任何一次内核读取失败都退回保守值，不让分析整体失败。 */
function edgeFacts(api: BrepEngineApi, edge: BrepHandle): SpineEdgeFacts {
  let curveType = 'other'
  try {
    curveType = String(api.curveType(edge) ?? '').toLowerCase()
  } catch {
    /* 保留 'other' */
  }
  let pr: BrepCurveParameters = { first: 0, last: 0 }
  try {
    pr = api.curveParameters(edge)
  } catch {
    /* 保留 {0,0} */
  }
  const p0 = api.curvePointAtParam(edge, pr.first)
  const p1 = api.curvePointAtParam(edge, pr.last)
  let t0: BrepVec3
  let t1: BrepVec3
  try {
    t0 = numericTangent(api, edge, pr, 'start')
    t1 = numericTangent(api, edge, pr, 'end')
  } catch {
    t0 = unit(sub(p1, p0))
    t1 = t0
  }
  // 缺省用弦长：`getLength` 读不出来时它就是唯一不猜的答案。
  let length = dist(p0, p1)
  try {
    length = api.getLength(edge)
  } catch {
    /* 保留弦长 */
  }
  const kind: SpineEdgeKind = curveType === 'line' ? 'line' : curveType === 'circle' ? 'arc' : 'other'
  const mid = api.curvePointAtParam(edge, (pr.first + pr.last) / 2)
  const samples = kind === 'line'
    ? [p0, p1]
    : kind === 'arc'
      ? [p0, mid, p1]
      : [0, 0.25, 0.5, 0.75, 1].map((f) => api.curvePointAtParam(edge, pr.first + (pr.last - pr.first) * f))
  const facts: SpineEdgeFacts = { kind, curveType, start: p0, end: p1, tStart: t0, tEnd: t1, mid, samples, length }
  if (kind === 'arc') {
    const r = arcRadius(p0, mid, t0)
    if (r !== undefined) facts.radius = r
  }
  return facts
}

/**
 * 采样点集 → 是否共面（容差内）。
 *
 * 三点定面 + 最大偏离：沿点集找第一个「不退化」的三元组定平面（退化 = 投影面积小于
 * `tol²`，此时三点几乎共线，定不出唯一平面），再量其余点到该平面的距离。
 * 找不到任何非退化三元组（纯直线脊柱）时视为共面 —— 直线当然是共面的。
 *
 * @param points - 采样点（顺序不重要）。
 * @param tol - 允许的最大偏离距离（绝对量，由调用方按零件尺度换算）。
 * @returns 共面 / 空间。
 */
function pointsPlanar(points: BrepVec3[], tol: number): boolean {
  if (points.length < 4) return true // 三点必共面
  const p0 = points[0]!
  let normal: BrepVec3 | undefined
  for (let i = 1; i < points.length && normal === undefined; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const n = cross(sub(points[i]!, p0), sub(points[j]!, p0))
      if (norm(n) > tol * tol) {
        normal = unit(n)
        break
      }
    }
  }
  if (normal === undefined) return true
  const n = normal
  for (const p of points) {
    if (Math.abs(dot(sub(p, p0), n)) > tol) return false
  }
  return true
}

/**
 * 分析一组已经取出的边句柄（**不释放**，所有权仍归调用方）。
 *
 * 之所以拆出这一层：执行器需要一边分析、一边复用同一批边句柄做逐段扫掠。分成
 * 「取句柄」与「算事实」两步，就不会出现「为了拿句柄再 `getSubShapes` 一遍」的
 * 二次调用（两次调用的边序没有契约保证）。
 *
 * @param api - 引擎面（只读查询）。
 * @param handles - 脊柱的边句柄，按脊柱走向排列。
 * @returns 脊柱事实。
 */
export function analyzeSpineEdges(api: BrepEngineApi, handles: BrepHandle[]): SpineFacts {
  const edges = handles.map((e) => edgeFacts(api, e))

  const totalLength = edges.reduce((s, e) => s + e.length, 0)
  const gapTol = Math.max(GAP_RELATIVE_TOL * totalLength, DEGENERATE_LENGTH)

  const gaps: { index: number; dist: number }[] = []
  const corners: SpineCorner[] = []
  for (let i = 1; i < edges.length; i++) {
    const prev = edges[i - 1]!
    const cur = edges[i]!
    const d = dist(prev.end, cur.start)
    if (d > gapTol) gaps.push({ index: i, dist: d })
    const turn = angleBetween(prev.tEnd, cur.tStart)
    if (turn > G1_TOL) corners.push({ index: i, point: cur.start, turn })
  }

  // 闭合：末边终点回到首边起点。**单边也要判**——整圆就是一条边、首尾重合；
  // 早期写成「边数 > 1」把整圆漏成「不闭合」，于是策略层会当成普通单边去扫。
  // 闭合脊柱还要把「收尾」也当成一个节点（可能带折角）。
  const closed =
    edges.length > 0 &&
    dist(edges[edges.length - 1]!.end, edges[0]!.start) <= gapTol &&
    totalLength > gapTol
  if (closed) {
    const last = edges[edges.length - 1]!
    const first = edges[0]!
    const turn = angleBetween(last.tEnd, first.tStart)
    if (turn > G1_TOL) corners.push({ index: edges.length, point: first.start, turn })
  }

  const degenerateIdx: number[] = []
  for (const [i, e] of edges.entries()) {
    if (e.length < DEGENERATE_LENGTH) degenerateIdx.push(i)
  }

  const kinds = new Set(edges.filter((e) => e.length >= DEGENERATE_LENGTH).map((e) => e.kind))
  const maxTurn = corners.reduce((m, c) => Math.max(m, c.turn), 0)
  const samples = edges.flatMap((e) => e.samples)
  const planar = pointsPlanar(samples, Math.max(PLANAR_RELATIVE_TOL * totalLength, DEGENERATE_LENGTH))

  return {
    edges,
    totalLength,
    closed,
    gaps,
    corners,
    maxTurn,
    fold: maxTurn > FOLD_TURN,
    mixed: kinds.size > 1,
    planar,
    degenerate: degenerateIdx,
  }
}

/**
 * 把事实压成一行人类可读的诊断串（错误消息、日志共用，避免两处措辞分叉）。
 * @param f - 脊柱事实。
 * @returns 形如 `2 edge(s) / 25.708 long / kinds arc+line / 1 G0 corner(s) (max 90.0°)` 的单行串。
 */
export function describeSpine(f: SpineFacts): string {
  const kinds = [...new Set(f.edges.map((e) => e.kind))].join('+') || 'none'
  return (
    `${f.edges.length} edge(s) / ${f.totalLength.toFixed(3)} long / kinds ${kinds}` +
    ` / ${f.corners.length} G0 corner(s)` +
    (f.corners.length > 0 ? ` (max ${((f.maxTurn * 180) / Math.PI).toFixed(1)}°)` : '') +
    (f.planar ? '' : ' / non-planar') +
    (f.closed ? ' / closed' : '')
  )
}

/**
 * 分析一条脊柱 wire 的几何事实（取边 → 分析 → 释放边句柄）。
 *
 * 需要复用边句柄做逐段扫掠时用 {@link analyzeSpineEdges}：本函数在返回前就把
 * 子形状句柄释放了。
 *
 * @param api - 引擎面（只用只读查询，不构造几何）。
 * @param spine - 脊柱 wire 句柄。
 * @returns 脊柱事实；边数 0 时返回空表（`edges: []`，`totalLength: 0`）。
 */
export function analyzeSpine(api: BrepEngineApi, spine: BrepHandle): SpineFacts {
  const handles = api.getSubShapes(spine, 'edge')
  try {
    return analyzeSpineEdges(api, handles)
  } finally {
    for (const h of handles) {
      try { api.release(h) } catch { /* 已释放 */ }
    }
  }
}
