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
import { makeLine2d, makeArc2dThreePoints, makeCircle2d } from './curve2d'

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

/** A profile segment: either a profile line or a profile arc. */
export type ProfileSegLike = ProfileLineSegLike | ProfileArcSegLike

/**
 * Convert a single profile segment to the equivalent 2D curve.
 * @param seg - the profile line or arc segment.
 * @returns the equivalent `Curve2dObj` (line, trimmed arc, or full circle).
 */
export function profileSegToCurve(seg: ProfileSegLike): Curve2dObj {
  if (seg.kind === 'line') return makeLine2d(seg.x1, seg.y1, seg.x2, seg.y2)
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