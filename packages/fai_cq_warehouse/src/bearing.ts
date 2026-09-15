// Copyright 2026 Faicad. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * bearing.ts — 轴承 5 类（W6）—— 上游 `cq_warehouse.bearing.Bearing` 基类 +
 * 5 个子类的逐位复刻。
 *
 * 装配流（`bearing.py:223 make_bearing`）：
 * ```
 *   outer_race = revolve(outer_race_section)        # XZ 平面轮廓绕 Z 旋 360°
 *   inner_race = revolve(inner_race_section)
 *   bearing    = outer.fuse(inner)
 *   if capped:  bearing = bearing.fuse(cap).fuse(cap.mirror("XY").translate((0,0,B)))
 *   else:       for each roller in polarArray(race_center_radius, N):
 *                  bearing = bearing.fuse(roller.located(Location((0,0,B/2))))
 *                if cage: bearing = bearing.fuse(cage)
 * ```
 * 滚子（roller）：深沟球/角接触 = 球；圆柱滚子 = 圆柱；圆锥滚子 = 圆锥（绕 X 倾
 * `roller_axis_angle`）。
 *
 * 几何坐标：轮廓画在 XZ 平面（局部 x → 世界 X＝半径、局部 y → 世界 +Z），
 * `revolveProfile` 绕 Z 轴 360°。滚子阵列在 XY 平面内半径 `race_center_radius`
 * 处，整体抬升到 `z = B/2`（与上游 `polarArray` + `Location((0,0,B/2))` 完全同构）。
 *
 * ⚠️ **两条本阶段首次确认、并由 `scripts/kernel-bearing-probe.py` 实测锁定的复刻事实**：
 * 1. `Sketch.trapezoid(w,h,a1,a2,angle)`（`sketch.py:284`）经 `.push((cx,cy))` 平移 +
 *    `.faces()[0].rotate(Y, −90)` 映射成 (半径=|Y|, z=X) 的凸四边形，其中 `angle`
 *    是绕 Z 的**整体旋转**（不是 a2）。`cup` 用 `angle=90°`、`cone` 用 `angle=−90°`，
 *   两者 a2 恒为 90°，故 v4 的 `h/tan(a2)` 项恒为 0。四角 line-line 圆角（r34/r12）
 *    用本文件的 `lineLineFillet` 精确解，与上游 `vertices().fillet()` 在凸四边形上等价。
 * 2. **圆锥滚子的 `roller_diameter` 是几何测量值**：上游 `roller.faces(">Z").edges()
 *    .val().radius()*2.5`，即锥顶（z=B/2 处）那一圈半径 ×2.5；本包直接算
 *    `2.5·cone_radii[0]`（cone_radii[0] 是 `makeCone` 顶端半径），无需真建锥再量。
 * 3. **上游 `cone_length` 的著名 quirk**：`(Db/2)/asin(radians(a))`（用了 `asin`
 *    而非 `sin`），`cone_angle` 与 `race_center_radius` 都依赖于此——必须逐字复刻，
 *    否则圆锥几何整体偏移。已写入本文件并在探针中数字比对一致。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import {
  arcEdge,
  cone,
  cut,
  cylinderBetween,
  fuse,
  interpolateEdgeWithTangents,
  lineEdge,
  mirrorAbout,
  planarFace,
  revolveProfile,
  rotateAbout,
  translate as translateShape,
  wireFromEdges,
} from './primitives'
import {
  BEARING_TABLES,
  isolateFastenerType,
  type BearingClassName,
} from './params'
import TAPERED_FILLET_DROP from './data/tapered-fillet-drop.json'

/** XZ 平面轮廓点：局部 (x, y)，revolve 后局部 x→世界半径、局部 y→世界 +Z。 */
interface Pt {
  x: number
  y: number
}

const DEG = Math.PI / 180
const TWO_PI = 2 * Math.PI

/** 旋转轴（Z 轴）——上游 `Workplane("XZ").revolve()` 的隐式轴。 */
const AXIS_Z = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
/** 绕 X 轴旋转（圆锥滚子倾角）。 */
const AXIS_X = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

/** `num(row)`：轴承参数表取数（`isolateFastenerType` 已在生成期求值，运行期只收窄）。 */
function num(row: Record<string, number | string>, key: string, where: string): number {
  const v = row[key]
  if (typeof v !== 'number')
    throw new Error(`${where}: bearing_data["${key}"] is not numeric (got ${JSON.stringify(v)})`)
  return v
}

/** 局部 (x,y) → 世界 3D（局部 x→X＝半径、局部 y→Z）。 */
function v3(p: Pt): BrepVec3 {
  return { x: p.x, y: 0, z: p.y }
}

/**
 * 查 tapered-fillet-drop.json 行为表：该尺寸的 cup 是否被上游丢 (r=D/2, h=C) 圆角。
 * 表由 `scripts/gen-fillet-drop.py` 在 cadquery 环境实测生成（A 侧真值，非启发式）。
 * @param size - 轴承规格（如 `M17-40-13.25`）。
 * @returns 丢角为 true；非 tapered 尺寸/表外尺寸恒 false（仅 tapered cup 调用）。
 */
function dropsTopOuterCorner(size: string): boolean {
  const hit = TAPERED_FILLET_DROP.sizes.find((r) => r.size === size)
  return hit?.drop_top_outer ?? false
}

/** 段列（XZ 轮廓）→ 封闭 wire → 绕 Z 旋成实体。 */
function revolveProfileEdges(edges: BrepHandle[]): BrepHandle {
  return revolveProfile(planarFace(wireFromEdges(edges)), AXIS_Z, TWO_PI)
}

/** 直线段 edge。 */
function eLine(a: Pt, b: Pt): BrepHandle {
  return lineEdge(v3(a), v3(b))
}

/** 圆弧段 edge（cq `radiusArc`，radius 带符号决定凸向，与上游逐字一致）。 */
function eArc(a: Pt, b: Pt, radius: number): BrepHandle {
  // 圆弧中点用与 cq `radiusArcMidpoint` 一致的带符号 sagitta 解（见 screw.ts）。
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) / 2
  const r2l2 = radius * radius - len * len
  let sag = Math.abs(radius)
  if (Math.abs(r2l2) >= 1e-7) sag -= Math.sqrt(Math.max(0, r2l2))
  const ux = dx / (2 * len)
  const uy = dy / (2 * len)
  const sx = radius > 0 ? -uy * sag : uy * sag
  const sy = radius > 0 ? ux * sag : -ux * sag
  const mid: Pt = { x: (a.x + b.x) / 2 + sx, y: (a.y + b.y) / 2 + sy }
  return arcEdge(v3(a), v3(mid), v3(b))
}

/** 插值样条段 edge（cq `spline(tangents=[t0,t1])`）。tangents 为 2D（局部 x→X、y→Z）。 */
function eSpline(a: Pt, b: Pt, t0: Pt, t1: Pt): BrepHandle {
  return interpolateEdgeWithTangents(
    [v3(a), v3(b)],
    { x: t0.x, y: 0, z: t0.y },
    { x: t1.x, y: 0, z: t1.y },
  )
}

/** 直线-直线角圆角（cq `Wire.fillet2D` 的线-线角闭式）。 */
function lineLineFillet(
  corner: Pt,
  inDir: Pt,
  outDir: Pt,
  r: number,
): { p1: Pt; p2: Pt; mid: Pt } {
  const u1 = { x: -inDir.x, y: -inDir.y }
  const cosT = u1.x * outDir.x + u1.y * outDir.y
  const theta = Math.acos(Math.max(-1, Math.min(1, cosT)))
  const t = r / Math.tan(theta / 2)
  const bis = { x: u1.x + outDir.x, y: u1.y + outDir.y }
  const bl = Math.hypot(bis.x, bis.y) || 1
  const bn = { x: bis.x / bl, y: bis.y / bl }
  const cdist = r / Math.sin(theta / 2)
  const ctr = { x: corner.x + bn.x * cdist, y: corner.y + bn.y * cdist }
  const near = { x: corner.x - ctr.x, y: corner.y - ctr.y }
  const nl = Math.hypot(near.x, near.y) || 1
  const mid = { x: ctr.x + (near.x / nl) * r, y: ctr.y + (near.y / nl) * r }
  return {
    p1: { x: corner.x + u1.x * t, y: corner.y + u1.y * t },
    p2: { x: corner.x + outDir.x * t, y: corner.y + outDir.y * t },
    mid,
  }
}

function unit(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y) || 1
  return { x: v.x / l, y: v.y / l }
}

/**
 * 闭合多边形（凸四边形/矩形）带四角 line-line 圆角的轮廓 wire。
 * @param corners - 角点（按轮廓序，凸多边形，闭合）。
 * @param radii - 每个角点的圆角半径（与 corners 等长）；为 0 表示尖角（不倒圆）。
 * @param skip - 需要保留尖角（跳过倒圆）的角点索引集合。上游
 *   `Sketch.vertices().fillet(r34)` 对 tapered cup 在部分尺寸上会静默丢弃
 *   (r=D/2, h=C) 角的圆角（OCC `BRepFilletAPI_MakeFillet2d` quirk，无闭式
 *   分界，14/26 尺寸触发，见 W6 分析文档）；该行为由 A 侧行为表
 *   `src/data/tapered-fillet-drop.json` 数据驱动，禁止启发式。
 * @returns 倒角后的 edge 列（已闭合）。
 */
function filletedPolygonEdges(
  corners: Pt[],
  radii: number[],
  skip: ReadonlySet<number> = new Set(),
): BrepHandle[] {
  const n = corners.length
  const p1: Pt[] = []
  const p2: Pt[] = []
  const mid: Pt[] = []
  for (let i = 0; i < n; i++) {
    if (skip.has(i) || Math.abs(radii[i] ?? 0) <= 1e-9) {
      p1.push(corners[i])
      p2.push(corners[i])
      mid.push(corners[i])
      continue
    }
    const prev = corners[(i - 1 + n) % n]
    const cur = corners[i]
    const next = corners[(i + 1) % n]
    const inDir = unit({ x: cur.x - prev.x, y: cur.y - prev.y })
    const outDir = unit({ x: next.x - cur.x, y: next.y - cur.y })
    const g = lineLineFillet(cur, inDir, outDir, radii[i])
    p1.push(g.p1)
    p2.push(g.p2)
    mid.push(g.mid)
  }
  const edges: BrepHandle[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    // 本角出边：从 p2[i] 到下一角的 p1[j]（p 相同时 filletedPolygonEdges 已跳过圆角）
    edges.push(eLine(p2[i], p1[j]))
    // 下一角圆角弧：p1[j] → mid[j] → p2[j]（用显式中点，避免 sign 歧义）
    if (!skip.has(j) && Math.abs(radii[j]) > 1e-9) {
      edges.push(arcEdge(v3(p1[j]), v3(mid[j]), v3(p2[j])))
    }
  }
  return edges
}

// ── 滚道截面（revolve 前的 XZ 轮廓） ───────────────────────────────────────

/** 默认滚道截面：矩形（x∈[x0,x1], y∈[0,h]）四角圆角 r（深沟球/圆柱滚子用）。 */
function defaultRaceEdges(x0: number, x1: number, h: number, r: number): BrepHandle[] {
  const c: Pt[] = [
    { x: x0, y: 0 },
    { x: x1, y: 0 },
    { x: x1, y: h },
    { x: x0, y: h },
  ]
  return filletedPolygonEdges(c, [r, r, r, r])
}

/** 角接触轴承内圈截面（custom，spline+arc）；与 `bearing.py:401` 逐点一致。 */
function angularInnerEdges(d: number, d1: number, d2: number, r12: number, B: number): BrepHandle[] {
  const S0 = { x: d2 / 2 - r12, y: 0 }
  const A1 = { x: d2 / 2, y: r12 }
  const A2 = { x: d1 / 2, y: B - r12 }
  const A3 = { x: d1 / 2 - r12, y: B }
  const A4 = { x: d / 2 + r12, y: B }
  const A5 = { x: d / 2, y: B - r12 }
  const A6 = { x: d / 2, y: r12 }
  const A7 = { x: d / 2 + r12, y: 0 }
  return [
    eArc(S0, A1, -r12),
    eSpline(A1, A2, { x: 0, y: 1 }, { x: 0, y: 1 }),
    eArc(A2, A3, -r12),
    eLine(A3, A4),
    eArc(A4, A5, -r12),
    eLine(A5, A6),
    eArc(A6, A7, -r12),
    eLine(A7, S0),
  ]
}

/** 角接触轴承外圈截面（custom，spline+arc）；与 `bearing.py:420` 逐点一致。 */
function angularOuterEdges(
  d: number, D: number, D1: number, d2: number, r12: number, r34: number, B: number,
): BrepHandle[] {
  const D2 = D - (d2 - d)
  const S0 = { x: D / 2 - r12, y: 0 }
  const A1 = { x: D / 2, y: r12 }
  const A2 = { x: D / 2, y: B - r34 }
  const A3 = { x: D / 2 - r34, y: B }
  const A4 = { x: D2 / 2 + r12, y: B }
  const A5 = { x: D2 / 2, y: B - r12 }
  const A6 = { x: D1 / 2, y: r12 }
  const A7 = { x: D1 / 2 + r12, y: 0 }
  return [
    eArc(S0, A1, -r12),
    eLine(A1, A2),
    eArc(A2, A3, -r34),
    eLine(A3, A4),
    eArc(A4, A5, -r12),
    eSpline(A5, A6, { x: 0, y: -1 }, { x: 0, y: -1 }),
    eArc(A6, A7, -r12),
    eLine(A7, S0),
  ]
}

/**
 * 圆锥轴承外圈（cup）截面：trapezoid 经 `sketch.py:284` 顶点公式 + 整体 `angle=90°`
 * 旋转 + `rotate(Y,−90)` 映射成 (半径=|Y|, z=X) 后的凸四边形，四角圆角 r34。
 * 闭式由 `scripts/kernel-bearing-probe.py` 对照 cadquery 实测锁定（CUP match=True）。
 * @param D - 外径。@param C - cup 高度。@param Db - Dbmin（小端直径）。
 * @param a - 接触角（度）。@param r34 - 圆角半径。
 */
function taperedCupEdges(
  D: number,
  C: number,
  Db: number,
  a: number,
  r34: number,
  dropTopOuter: boolean,
): BrepHandle[] {
  const w = (D - Db) / 2
  const h = C
  const cx = C / 2
  const cy = D / 2 - (D - Db) / 4
  // 角点序 (V1,V2,V4,V3) 与上游 trapezoid polygon(v1,v2,v4,v3) 一致；
  // 半径 = |y'|、高度 = x'（x',y' 为平移后坐标，y' 对本类恒正）。
  const v1: Pt = { x: Math.abs(cy - w / 2), y: cx + h / 2 }
  const v2: Pt = { x: Math.abs(cy + w / 2), y: cx + h / 2 }
  const v4: Pt = { x: Math.abs(cy + w / 2), y: cx - h / 2 }
  // a1 = a+90 → 1/tan(a1) = −tan(a)，故 V3 半径 = cy − w/2 − h·tan(a)
  const v3: Pt = { x: Math.abs(cy - w / 2 - h * Math.tan(a * DEG)), y: cx - h / 2 }
  // V2 = (r=D/2, h=C) 顶边-外圆柱角：上游 `vertices().fillet(r34)` 在部分尺寸
  // 静默丢它的圆角（OCC MakeFillet2d quirk）——由 tapered-fillet-drop.json 行为表驱动。
  const skip = dropTopOuter ? new Set([1]) : new Set<number>()
  return filletedPolygonEdges([v1, v2, v4, v3], [r34, r34, r34, r34], skip)
}

/**
 * 圆锥轴承内圈（cone）截面的角点（radius=x, height=y）由 `buildBearing` 的 tapered
 * 分支内联构造——因为 cx = T − B/2 依赖 T，闭式由 `scripts/kernel-bearing-probe.py`
 * 对照 cadquery 实测锁定（CONE match=True）：
 *   V1=(|cy+w/2|, cx−B/2), V2=(|cy−w/2|, cx−B/2),
 *   V4=(|cy−w/2|, cx+B/2), V3=(|cy+w/2−B·tan(90+coneAngle), cx+B/2),
 *   cy = d/2 + (da−d)/2, cx = T − B/2。
 */

/**
 * 球滚子（半圆盘 revolve → 实体球）。
 * @param radius - 球半径。
 * @returns 球体 BREP 句柄。
 */
export function sphere(radius: number): BrepHandle {
  const A: BrepVec3 = { x: 0, y: 0, z: radius }
  const M: BrepVec3 = { x: radius, y: 0, z: 0 }
  const B: BrepVec3 = { x: 0, y: 0, z: -radius }
  // 半圆 (A→M→B) + 直径闭合线，构成半盘 face，revolve 360° → 完整球。
  return revolveProfileEdges([arcEdge(A, M, B), lineEdge(B, A)])
}

/** 圆柱滚子（轴向 +Z，居中）。 */
function cylinderRoller(radius: number, length: number): BrepHandle {
  return cylinderBetween(radius, -length / 2, length / 2)
}

/** 圆锥滚子（锥轴 +Z，居中，再绕 X 倾 `axisAngle` 度）。 */
function coneRoller(rBottom: number, rTop: number, length: number, axisAngle: number): BrepHandle {
  const c = translateShape(cone(rBottom, rTop, length), 0, 0, -length / 2)
  return rotateAbout(c, AXIS_X, -axisAngle * DEG)
}

/** 密封盖环形（revolve 矩形截面 → 短管），落位于 z∈[B/20, 2·B/20]。 */
function capRing(rInner: number, rOuter: number, B: number): BrepHandle {
  const base = revolveProfileEdges(defaultRaceEdges(rInner, rOuter, B / 20, 0))
  return translateShape(base, 0, 0, B / 20)
}

// ── 轴承参数解析与派生量 ────────────────────────────────────────────────────

/** 解析轴承参数 dict（size → 剥离 `SKT:` 前缀的逐尺寸行，运行期只读数字维度）。 */
function resolveBearing(
  className: BearingClassName,
  bearingType: string,
  size: string,
): Record<string, number | string> {
  const isolated = isolateFastenerType(bearingType, BEARING_TABLES[className])
  const row = isolated[size]
  if (!row) throw new Error(`bearing ${className}/${bearingType}: size ${size} not found`)
  return row
}

/** 轴承构造入参（args 逐字取自 manifest）。 */
export interface BearingParams {
  size: string
  bearingType: string
}

/** 轴承构造结果（含上游派生量，供测试锁定）。 */
export interface BearingResult {
  handle: BrepHandle
  /** 内径 d。 */
  boreDiameter: number
  /** 外径 D。 */
  outerDiameter: number
  /** 宽度（tapered = T，其余 = B）。 */
  thickness: number
  /** 滚子直径。 */
  rollerDiameter: number
  /** 滚道中心半径。 */
  raceCenterRadius: number
  /** 滚子数量。 */
  rollerCount: number
}

/** 5 类轴承的 W6 验收清单（方案 §8-W6）。 */
export const BEARING_CLASSES: readonly BearingClassName[] = [
  'SingleRowDeepGrooveBallBearing',
  'SingleRowCappedDeepGrooveBallBearing',
  'SingleRowAngularContactBallBearing',
  'SingleRowCylindricalRollerBearing',
  'SingleRowTaperedRollerBearing',
]

/** 圆锥滚子中心半径（cage 用，与上游 `cage()` 同式）。 */
function cageRadius(
  coneLength: number,
  rollerAxisAngle: number,
  l: number,
): number {
  return (coneLength - l) * Math.sin(rollerAxisAngle * DEG) + 0.5
}

/**
 * 构造一个轴承（5 类统一入口）。
 * @param className - 轴承类名。
 * @param p - 构造入参（size / bearing_type）。
 * @returns 轴承实体与上游派生量。
 */
export function buildBearing(className: BearingClassName, p: BearingParams): BearingResult {
  const row = resolveBearing(className, p.bearingType, p.size)
  const d = num(row, 'd', className)
  const D = num(row, 'D', className)
  const B = num(row, 'B', className)

  let innerEdges: BrepHandle[]
  let outerEdges: BrepHandle[]
  let roller: BrepHandle
  let rollerDiameter: number
  let raceCenterRadius: number
  let capped = false
  let cage = false
  let T = B

  switch (className) {
    case 'SingleRowDeepGrooveBallBearing':
    case 'SingleRowCappedDeepGrooveBallBearing': {
      const D1 = num(row, 'D1', className)
      const d1 = num(row, 'd1', className)
      const r12 = num(row, 'r12', className)
      innerEdges = defaultRaceEdges(d / 2, d1 / 2, B, r12)
      outerEdges = defaultRaceEdges(D / 2, D1 / 2, B, r12)
      rollerDiameter = 0.625 * (D1 - d1)
      raceCenterRadius = (D1 + d1) / 4
      roller = sphere(rollerDiameter / 2)
      capped = className === 'SingleRowCappedDeepGrooveBallBearing'
      break
    }
    case 'SingleRowAngularContactBallBearing': {
      const D1 = num(row, 'D1', className)
      const d1 = num(row, 'd1', className)
      const d2 = num(row, 'd2', className)
      const r12 = num(row, 'r12', className)
      const r34 = num(row, 'r34', className)
      innerEdges = angularInnerEdges(d, d1, d2, r12, B)
      outerEdges = angularOuterEdges(d, D, D1, d2, r12, r34, B)
      // 上游 0.4 * (D2 − d2)，D2 = D − (d2 − d)
      rollerDiameter = 0.4 * (D - (d2 - d) - d2)
      raceCenterRadius = (D1 + d1) / 4
      roller = sphere(rollerDiameter / 2)
      capped = true
      break
    }
    case 'SingleRowCylindricalRollerBearing': {
      const D1 = num(row, 'D1', className)
      const d1 = num(row, 'd1', className)
      const r12 = num(row, 'r12', className)
      innerEdges = defaultRaceEdges(d / 2, d1 / 2, B, r12)
      outerEdges = defaultRaceEdges(D / 2, D1 / 2, B, r12)
      rollerDiameter = 0.625 * (D1 - d1)
      raceCenterRadius = (D1 + d1) / 4
      const rollerLength = 0.7 * B
      roller = cylinderRoller(rollerDiameter / 2, rollerLength)
      break
    }
    case 'SingleRowTaperedRollerBearing': {
      const C = num(row, 'C', className)
      const Db = num(row, 'Dbmin', className)
      const a = num(row, 'a', className)
      const r12 = num(row, 'r12', className)
      const r34 = num(row, 'r34', className)
      const d1 = num(row, 'd1', className)
      const da = num(row, 'da', className)
      T = num(row, 'T', className)
      // ⚠️ 上游 quirk：cone_length = (Db/2) / asin(radians(a))（asin 非 sin）
      const coneLength = (Db / 2) / Math.asin(a * DEG)
      const coneAngle = Math.asin((d1 / 2) / coneLength) / DEG
      const rollerAxisAngle = (a + coneAngle) / 2
      const rollerLength = 0.7 * B
      const rollerConeAngle = a - coneAngle
      const coneRadii = [
        1.2 * (coneLength - 0) * Math.sin((rollerConeAngle * DEG) / 2),
        1.2 * (coneLength - rollerLength) * Math.sin((rollerConeAngle * DEG) / 2),
      ]
      rollerDiameter = 2.5 * coneRadii[0]
      raceCenterRadius = (coneLength - rollerLength / 2) * Math.sin(rollerAxisAngle * DEG)
      // 内圈（cone）截面：cx = T − B/2（上游 push((T − B/2, ...))）
      const w = (da - d) / 2
      const cyc = d / 2 + (da - d) / 2
      const a1 = 90 + coneAngle
      const cxCone = T - B / 2
      const cV1: Pt = { x: Math.abs(cyc + w / 2), y: cxCone - B / 2 }
      const cV2: Pt = { x: Math.abs(cyc - w / 2), y: cxCone - B / 2 }
      const cV4: Pt = { x: Math.abs(cyc - w / 2), y: cxCone + B / 2 }
      const cV3: Pt = { x: Math.abs(cyc + w / 2 - B / Math.tan(a1 * DEG)), y: cxCone + B / 2 }
      innerEdges = filletedPolygonEdges([cV1, cV2, cV4, cV3], [r12, r12, r12, r12])
      outerEdges = taperedCupEdges(D, C, Db, a, r34, dropsTopOuterCorner(p.size))
      roller = coneRoller(coneRadii[1], coneRadii[0], rollerLength, rollerAxisAngle)
      cage = true
      break
    }
    default:
      throw new Error(`buildBearing: unhandled class ${className}`)
  }

  const inner = revolveProfileEdges(innerEdges)
  const outer = revolveProfileEdges(outerEdges)
  let bearing = fuse(outer, inner)

  const rollerCount = Math.floor((1.8 * Math.PI * raceCenterRadius) / rollerDiameter)
  if (capped) {
    let rIn = d / 2
    let rOut = D / 2
    if (className === 'SingleRowAngularContactBallBearing') {
      const d2 = num(row, 'd2', className)
      rIn = d2 / 2
      rOut = (D - (d2 - d)) / 2
    }
    const cap1 = capRing(rIn, rOut, B)
    const cap2 = translateShape(
      mirrorAbout(cap1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      0,
      0,
      B,
    )
    bearing = fuse(bearing, cap1)
    bearing = fuse(bearing, cap2)
  } else {
    for (let i = 0; i < rollerCount; i++) {
      const ang = (TWO_PI * i) / rollerCount
      const pos = {
        x: raceCenterRadius * Math.cos(ang),
        y: raceCenterRadius * Math.sin(ang),
        z: B / 2,
      }
      // 上游 `polarArray(...).vals()` 的 Location 自带 `Rz(ang)` 自旋
      // （cq.py polarArray rotate=True 默认）——滚子先绕 Z 转到该方位，再平移落位。
      // 对球/圆柱滚子无影响（绕自身对称轴），对圆锥滚子决定倾斜朝向，必须复刻。
      const placed = translateShape(rotateAbout(roller, AXIS_Z, ang), pos.x, pos.y, pos.z)
      bearing = fuse(bearing, placed)
    }
    if (cage) {
      const thickness = 0.9 * T
      const cr0 = cageRadius(coneLengthForTapered(row, className), rollerAxisAngleForTapered(row, className), 0)
      const cr1 = cageRadius(coneLengthForTapered(row, className), rollerAxisAngleForTapered(row, className), thickness)
      const cageOuter = cone(cr1, cr0, thickness)
      const cageInner = cone(cr1 - 1, cr0 - 1, thickness)
      bearing = fuse(bearing, cut(cageOuter, cageInner))
    }
  }

  return {
    handle: bearing,
    boreDiameter: d,
    outerDiameter: D,
    thickness: T,
    rollerDiameter,
    raceCenterRadius,
    rollerCount,
  }
}

/** 圆锥派生量（与 buildBearing 内同式，供 cage 半径复用）。 */
function coneLengthForTapered(row: Record<string, number | string>, className: BearingClassName): number {
  const Db = num(row, 'Dbmin', className)
  const a = num(row, 'a', className)
  return (Db / 2) / Math.asin(a * DEG)
}

function rollerAxisAngleForTapered(row: Record<string, number | string>, className: BearingClassName): number {
  const Db = num(row, 'Dbmin', className)
  const a = num(row, 'a', className)
  const d1 = num(row, 'd1', className)
  const coneLength = (Db / 2) / Math.asin(a * DEG)
  const coneAngle = Math.asin((d1 / 2) / coneLength) / DEG
  return (a + coneAngle) / 2
}
