/**
 * Adaptors from legacy profile-segment shapes to `Curve2dObj` (pure-data).
 *
 * faijs `cad.profile` historically fed its own `ProfileLineSeg`/`ProfileArcSeg`
 * segment model directly into OCCT edge construction. To unify every 2D input on
 * the pure-2D `Geometry2dObj` base (plan F2), this module converts those segment
 * shapes into `Curve2dObj` without importing `api/` (the input types are declared
 * structurally here; `api/profile.ts`'s `ProfileSeg` is structurally compatible).
 *
 * @module
 */
import type { Curve2dObj } from './curve2d'
import { makeLine2d, makeArc2dThreePoints, makeCircle2d, makeBSpline2d, trimCurve } from './curve2d'

/** Line segment in profile form (2D, z=0). */
export interface ProfileLineSegLike {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Arc segment in profile form (2D, z=0). `x1/y1/x2/y2` are the sampled arc
 * endpoints, but many inputs omit them (e.g. FCBL corpus), so endpoints are
 * always re-derived from `(cx, cy, radius, startAngle, endAngle)` — matching
 * the original kernel construction. */
export interface ProfileArcSegLike {
  kind: 'arc'
  cx: number
  cy: number
  radius: number
  startAngle: number
  endAngle: number
  ccw: boolean
  x1?: number
  y1?: number
  x2?: number
  y2?: number
}

/**
 * Spline segment in profile form — the NURBS control data of one curve, as the
 * kernel reports it (`BrepNurbsCurveData`).
 *
 * This is the segment kind that lets a source whose geometry is genuinely a
 * parametric curve (a Bézier text outline, a projected B-spline) stay a curve
 * all the way into the wire instead of being sampled into a polyline. Both a
 * Bézier and a B-spline travel here: a Bézier IS a clamped B-spline, and the
 * kernel builds both from this one record.
 *
 * ⚠️ `first`/`last` are the TRIM of the edge on its basis-curve parameter axis.
 * Omitting them means "the whole curve" — which is only right when the source
 * edge really does span its basis curve (measured: ~20 % of parametric edges do
 * not, so a rebuild without the trim runs past a neighbour's start).
 */
export interface ProfileSplineSegLike {
  kind: 'spline'
  /** Polynomial degree. */
  degree: number
  /** Flat control points `[x, y, x, y, …]`. */
  poles: number[]
  /** Distinct knot values, parallel to `multiplicities`. */
  knots: number[]
  /** Multiplicity of each entry in `knots`. */
  multiplicities: number[]
  /** True for a periodic (wrap-around) curve. */
  periodic?: boolean
  /** Per-pole weights; omit for a non-rational curve. */
  weights?: number[]
  /** Trim start on the basis-curve parameter axis (defaults to the curve start). */
  first?: number
  /** Trim end on the basis-curve parameter axis (defaults to the curve end). */
  last?: number
}

/** A profile segment: a line, an arc, or a parametric spline. */
export type ProfileSegLike = ProfileLineSegLike | ProfileArcSegLike | ProfileSplineSegLike

/**
 * Convert a single profile segment to the equivalent 2D curve.
 * @param seg - the profile line, arc or spline segment.
 * @returns the equivalent `Curve2dObj` (line, trimmed arc, full circle, or a
 *   spline — trimmed when the segment carries a `first`/`last` range).
 */
export function profileSegToCurve(seg: ProfileSegLike): Curve2dObj {
  if (seg.kind === 'line') return makeLine2d(seg.x1, seg.y1, seg.x2, seg.y2)
  if (seg.kind === 'spline') {
    const poles: [number, number][] = []
    for (let i = 0; i + 1 < seg.poles.length; i += 2) poles.push([seg.poles[i]!, seg.poles[i + 1]!])
    const curve = makeBSpline2d(poles, seg.knots, seg.multiplicities, seg.degree, !!seg.periodic, seg.weights)
    // The trim is expressed on the basis curve's own parameter axis, which is
    // exactly `TrimmedCurve2d`'s contract — so it survives to the lift, where
    // the kernel splits the rebuilt edge instead of us re-deriving the poles.
    return seg.first !== undefined && seg.last !== undefined ? trimCurve(curve, seg.first, seg.last) : curve
  }
  // GOTCHA（2026-09-25, A3 FCBL_tree_entourage）：`ccw` 决定几何方向，非元数据。
  // CW 弧的正向扫角是 startAngle→endAngle **递减**：不能沿用 `endAngle−startAngle`
  // 再归一化到 (0,2π]，那样会把短 CW 弧（如 65°）算成 CCW 的补角长弧
  // （294°），使 makeArcEdge 收到穿过旋转轴的补角弧 → revolve 退化 → BRepMesh 挂死
  // （进程无声死亡，正被 sketch-arc-ccw-gotcha.test.ts 护栏锁定）。
  // 归一化沿用 brepjs/旧 `arcToHandles`：`while` 平移而非 `%`（`%` 会把
  // 恰为 2π 的整圆扫角消成 0——fp 上 `x % x === 0`——把整圆误判成退化线段）。
  let sweep = seg.ccw ? seg.endAngle - seg.startAngle : seg.startAngle - seg.endAngle
  while (sweep <= 0) sweep += 2 * Math.PI
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
  // 极小扫角（退化弧）→ 退化为线段。
  if (sweep < 1e-9) return makeLine2d(seg.cx + seg.radius * Math.cos(seg.startAngle), seg.cy + seg.radius * Math.sin(seg.startAngle), seg.cx + seg.radius * Math.cos(seg.endAngle), seg.cy + seg.radius * Math.sin(seg.endAngle))
  // 整圆（扫 ≈ 2π，起点≈终点）须保留为真圆：三点构造过奇异点退化（→line）。
  if (sweep >= 2 * Math.PI - 1e-9) return makeCircle2d(seg.cx, seg.cy, seg.radius, seg.ccw)
  // 端点/中点一律由 (cx, cy, radius, angle) 解析（缺失 x1/y1/x2/y2 时仍精确），
  // 与旧 `arcToHandles` 一致：这样相邻线段的接缝点完全重合，wire 闭合。
  const sx = seg.cx + seg.radius * Math.cos(seg.startAngle)
  const sy = seg.cy + seg.radius * Math.sin(seg.startAngle)
  const ex = seg.cx + seg.radius * Math.cos(seg.endAngle)
  const ey = seg.cy + seg.radius * Math.sin(seg.endAngle)
  // 几何中点：CCW 从 startAngle 顺向 +sweep/2；CW 从 startAngle 反向 −sweep/2；
  // 三点(起点/中点/终点)定唯一弧。
  const midAngle = seg.ccw ? seg.startAngle + sweep / 2 : seg.startAngle - sweep / 2
  const mx = seg.cx + seg.radius * Math.cos(midAngle)
  const my = seg.cy + seg.radius * Math.sin(midAngle)
  return makeArc2dThreePoints(sx, sy, mx, my, ex, ey)
}