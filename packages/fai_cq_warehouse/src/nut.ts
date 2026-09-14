/**
 * nut.ts — 螺母七类移植（上游 `cq_warehouse/fastener.py:365-1240`，方案 §8 W4）。
 *
 * 类映射（方案 §4.2）：`Nut` 基类 → {@link buildNut}；具体类 → `hexNut()` /
 * `hexNutWithFlange()` / `unchamferedHexagonNut()` / `squareNut()` / `domedCapNut()` /
 * `bradTeeNut()` / `heatSetNut()`；轮廓与 plan → `nutProfile()` / `nutPlanWire()`
 * （纯几何，不建 kernel 对象，便于单测与复用）。
 *
 * ## `make_nut` 的四步映射（fastener.py:581-635）
 *
 * | 上游 | 本包 |
 * |---|---|
 * | `nut_profile().toPending().revolve()` | 轮廓段列 → wire → {@link primitives.revolveProfile} |
 * | `Workplane("XY").add(nut_plan()).toPending().extrude(max_nut_height)` | plan wire → {@link primitives.planarFace} → {@link primitives.extrudeFace} |
 * | `.faces("<Z").workplane().hole(d, depth)` | {@link primitives.cylinderBetween} 后 `cut` |
 * | `nut.intersect(blank)` / `.union(flange)` / `.union(thread)` | `intersect` / `fuse` |
 *
 * ⚠️ **plan 必须先成 face 再拉伸**：probe 实测（`scripts/kernel-nut-probe.ts` 段 1）
 * `extrude(wire,0,0,3)` 对 4×2 矩形给体积 −16（错），传 face 才得 24（对）。内核不校验
 * 输入拓扑——传错不抛错，只静默给错几何。
 *
 * ⚠️ **`max_nut_height` 取轮廓最高顶点 z**（上游 `profile.vertices(">Z").val().Z`），
 * 不是 `nut_data["m"]`：DomedCapNut 的球顶使之为 `m + dk/2`。
 *
 * ## cq 语义的逐条复现（读 cadquery `cq.py` 源码确认，证据见 W4 分析文档）
 *
 * - `polygon(nSides, diameter)`：顶点自角度 **0** 起（首顶点在 `(r, 0)`），半径 = `diameter/2`
 *   （`cq.py:2677-2688`）。
 * - `rect(w, h, centered=False)`：轮廓为 `(0,0) → (w,0) → (w,h) → (0,h)`。
 * - `radiusArc(end, radius)` → `sagittaArc`（`cq.py:2154-2188`）：`sag = |r| − √(r²−half²)`，
 *   符号随 radius；`sagittaArc` 把 sag 沿**弦法向旋转 ±90°**得第三点（`cq.py:2139-2150`）。
 * - XZ 工作平面的局部 `(u, v)` → 世界 `(u, 0, v)`（局部 x 沿世界 X，局部 y 沿世界 Z）。
 *
 * ## 未实现（W4 内的已知缺口，显式抛错而非静默降级）
 *
 * `HeatSetNut` 的 `make_nut`（fastener.py:947）不走向轮廓旋转，而是
 * `Face.makeNSidedSurface` 造 knurl 面 + `Shell.makeShell` + `Solid.makeSolid`。
 * 本内核无 `makeNSidedSurface`；probe（`scripts/kernel-nut-probe.ts` 段 4）实测
 * `makeNonPlanarFace(4 边扭面 wire)` 退化为 **3 边面**（面积 2.749170），几何不等价
 * ——不构成可接受的替代。详见 `docs/analysis/2026-09-14-cq-warehouse-nut-washer-probe.md`。
 *
 * `BradTeeNut` **已实现**：其 `custom_make` 需要的 `extensions.clearanceHole` 由
 * `src/recess.ts` 的 **W4 临时**等价实现承担（按方案 §8-W4 去重表，W9·P1-b 落地后替换）。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import {
  clearanceHoleData,
  isolateFastenerType,
  tapHoleData,
  typesOf,
  NUT_TABLES,
  SCREW_TABLES,
  type ParamRow,
  type NutClassName,
} from './params'
import { imperialStrToFloat, INCH } from './measure'
import {
  arcEdge,
  bboxDiagonal,
  bboxOf,
  circleWireXY,
  cut,
  cylinderBetween,
  extrudeFace,
  fuse,
  intersect,
  lineEdge,
  planarFace,
  polygonWire,
  revolveProfile,
  translate,
  wireFromEdges,
} from './primitives'
import {
  tempClearanceHoleCutter,
  tempCounterSunkCountersinkProfile,
} from './recess'
import { isoThread, type Hand } from './thread'

/** 旋转轴（+Z）。 */
const AXIS_Z = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
/** 上游 `Nut.socket_clearance`（fastener.py:554）= 6 mm。 */
export const SOCKET_CLEARANCE = 6

// ── 类型 ──────────────────────────────────────────────────────────────────

/** 轮廓顶点（XZ 平面极坐标形态：`r` = 到轴距离，`z` = 轴向高度）。 */
export interface NutProfilePoint {
  r: number
  z: number
}

/** 轮廓的一段（cq `hLineTo`/`vLineTo`/`lineTo` 为直线，`radiusArc` 为圆弧）。 */
export type NutProfileSegment =
  | { kind: 'line'; to: NutProfilePoint }
  | { kind: 'radiusArc'; to: NutProfilePoint; radius: number }

/** 闭合轮廓（`start` + 依次到达的段；收尾边由 {@link profileWire} 补）。 */
export interface NutProfile {
  start: NutProfilePoint
  segments: NutProfileSegment[]
}

/** `Nut.__init__`（fastener.py:520）的入参——参数名逐字沿用上游 snake_case。 */
export interface NutParams {
  size: string
  fastener_type: string
  hand?: Hand
  simple?: boolean
}

/** `buildNut` 的结果：几何句柄 + 上游同名派生量。 */
export interface NutResult {
  handle: BrepHandle
  /** 上游 `nut_class`（`type(self).__name__`）。 */
  nutClass: NutClassName
  size: string
  /** 上游 `self.thread_size`（`size` 的前两段以 `-` 连接）。 */
  threadSize: string
  /** 上游 `self.length_size`（`size` 含第三段时存在，如 HeatSetNut 的 `Standard`）。 */
  lengthSize?: string
  isMetric: boolean
  threadDiameter: number
  threadPitch: number
  fastenerType: string
  hand: Hand
  /** 上游默认 `simple=True`（不建螺纹）。 */
  simple: boolean
  /** `isolate_fastener_type` 后的该规格行。 */
  nutData: ParamRow
  /** 上游 `nut_thickness`（最高顶点 z）。 */
  nutThickness: number
  /** 上游 `nut_diameter`（2 × 最大水平半径）。 */
  nutDiameter: number
  /** 上游 `info`。 */
  info: string
  /** 上游 `clearance_hole_diameters`（`size.split("-")[0]` → 配合等级 → mm）；缺表为 `{}`。 */
  clearanceHoleDiameters: Record<string, number>
  /** 上游 `tap_hole_diameters`（完整 `thread_size` → Soft/Hard → mm）；缺表为 `{}`。 */
  tapHoleDiameters: Record<string, number>
}

// ── cq 轮廓数学（读 cq.py 源码逐条复现）────────────────────────────────────

/**
 * `fastener.py:54 polygon_diagonal` —— 对边距 → 对角（外接圆）直径。
 * @param width - 对边距（正多边形两条平行边之间的距离）。
 * @param numSides - 边数（默认 6，即六角螺母）。
 * @returns 外接圆直径 `width / cos(π / numSides)`。
 */
export function polygonDiagonal(width: number, numSides = 6): number {
  return width / Math.cos(Math.PI / numSides)
}

/** `cq.py:2139-2150 sagittaArc` 的第三点（弧中点）。 */
function sagittaMidpoint(
  start: NutProfilePoint,
  end: NutProfilePoint,
  sag: number,
): NutProfilePoint {
  const dr = end.r - start.r
  const dz = end.z - start.z
  const len = Math.hypot(dr, dz)
  if (len === 0) return { r: start.r, z: start.z }
  const ur = dr / len
  const uz = dz / len
  // cq 在局部 (x, y) 平面内旋转 ±90°：(x,y) → (−y,x)（sag>0）或 (y,−x)（sag<0）；
  // 局部 y 对应世界 z。
  const sr = (sag > 0 ? -uz : uz) * Math.abs(sag)
  const sz = (sag > 0 ? ur : -ur) * Math.abs(sag)
  return { r: (start.r + end.r) / 2 + sr, z: (start.z + end.z) / 2 + sz }
}

/**
 * `cq.py:2154-2188 radiusArc` → `sagittaArc` 的弧中点。
 * @param start - 弧起点（轮廓当前点）。
 * @param end - 弧终点。
 * @param radius - 弧半径（正=凸、负=凹，语义同 cq）。
 * @returns 弧上一点（供三点弧 `makeArcEdge`）。
 */
export function radiusArcMidpoint(
  start: NutProfilePoint,
  end: NutProfilePoint,
  radius: number,
): NutProfilePoint {
  const half = Math.hypot(end.r - start.r, end.z - start.z) / 2
  const r2l2 = radius * radius - half * half
  if (Math.abs(r2l2) < 1e-12) return sagittaMidpoint(start, end, radius > 0 ? Math.abs(radius) : -Math.abs(radius))
  if (r2l2 < 0)
    throw new Error(
      `Nut: arc radius ${radius} is not large enough to reach the end point (chord half-length ${half})`,
    )
  const sag = Math.abs(radius) - Math.sqrt(r2l2)
  return sagittaMidpoint(start, end, radius > 0 ? sag : -sag)
}

/**
 * 轮廓的点列（起点 + 各段终点），用于取 `max_nut_height` 等。
 * @param p - 轮廓（{@link ProfileBuilder} 链式构造的产物）。
 * @returns 顶点序列，首元素为轮廓起点。
 */
export function profilePoints(p: NutProfile): NutProfilePoint[] {
  return [p.start, ...p.segments.map((s) => s.to)]
}

/** 链式轮廓构造器（方法名对齐 cq，`hLine`/`vLine` 为**相对**位移，`*To` 为绝对）。 */
class ProfileBuilder {
  private readonly startPt: NutProfilePoint
  private readonly segs: NutProfileSegment[] = []
  private cur: NutProfilePoint

  constructor(start: NutProfilePoint) {
    this.startPt = start
    this.cur = start
  }

  /** `lineTo(r, z)` —— 绝对值。 */
  lineTo(r: number, z: number): this {
    this.segs.push({ kind: 'line', to: { r, z } })
    this.cur = { r, z }
    return this
  }

  /** `hLineTo(r)` —— 水平线到绝对 `r`（保持当前 `z`）。 */
  hLineTo(r: number): this {
    return this.lineTo(r, this.cur.z)
  }

  /** `vLineTo(z)` —— 垂直线到绝对 `z`（保持当前 `r`）。 */
  vLineTo(z: number): this {
    return this.lineTo(this.cur.r, z)
  }

  /** `hLine(dr)` —— 水平**相对**位移。 */
  hLine(dr: number): this {
    return this.lineTo(this.cur.r + dr, this.cur.z)
  }

  /** `vLine(dz)` —— 垂直**相对**位移。 */
  vLine(dz: number): this {
    return this.lineTo(this.cur.r, this.cur.z + dz)
  }

  /** `radiusArc(end, radius)` —— 圆弧段。 */
  arcTo(r: number, z: number, radius: number): this {
    this.segs.push({ kind: 'radiusArc', to: { r, z }, radius })
    this.cur = { r, z }
    return this
  }

  /** `polarLine(distance, angleDeg)` —— 按极角走给定距离（cq `cq.py polarLine`）。 */
  polarLine(distance: number, angleDeg: number): this {
    const a = (angleDeg * Math.PI) / 180
    return this.lineTo(
      this.cur.r + distance * Math.cos(a),
      this.cur.z + distance * Math.sin(a),
    )
  }

  /** 收尾（`close()` 的直线边由 {@link profileWire} 补）。 */
  build(): NutProfile {
    return { start: this.startPt, segments: [...this.segs] }
  }
}

function toWorld(p: NutProfilePoint): BrepVec3 {
  return { x: p.r, y: 0, z: p.z }
}

/** 轮廓段列（从 `start` 起、闭合回 `start`）→ XZ 平面闭合 wire。 */
function profileWire(p: NutProfile): BrepHandle {
  const edges: BrepHandle[] = []
  let cur = p.start
  for (const seg of p.segments) {
    if (seg.kind === 'line') edges.push(lineEdge(toWorld(cur), toWorld(seg.to)))
    else {
      const mid = radiusArcMidpoint(cur, seg.to, seg.radius)
      edges.push(arcEdge(toWorld(cur), toWorld(mid), toWorld(seg.to)))
    }
    cur = seg.to
  }
  if (cur.r !== p.start.r || cur.z !== p.start.z)
    edges.push(lineEdge(toWorld(cur), toWorld(p.start)))
  return wireFromEdges(edges)
}

function num(row: ParamRow, key: string, where: string): number {
  const v = row[key]
  if (typeof v !== 'number')
    throw new Error(`${where}: nut_data["${key}"] is not numeric (got ${JSON.stringify(v)})`)
  return v
}

function requireMS(row: ParamRow, where: string): { m: number; s: number } {
  return { m: num(row, 'm', where), s: num(row, 's', where) }
}

const DEG15 = (15 * Math.PI) / 180

// ── 轮廓（上游各 `nut_profile`）─────────────────────────────────────────────

/**
 * `Nut.default_nut_profile`（fastener.py:637）—— 六角双倒角轮廓（HexNut / HexNutWithFlange 用）。
 * @param data - 该规格的参数行（含 m/s）。
 * @returns 轮廓（起点在轴上 `(0,0)`）。
 */
export function defaultNutProfile(data: ParamRow): NutProfile {
  const { m, s } = requireMS(data, 'Nut')
  const e = polygonDiagonal(s, 6)
  const cs = ((e - s) * Math.tan(DEG15)) / 2
  return new ProfileBuilder({ r: 0, z: 0 })
    .hLineTo(s / 2)
    .lineTo(e / 2 - 0.001, cs)
    .vLineTo(m - cs)
    .lineTo(s / 2, m)
    .hLineTo(0)
    .build()
}

/**
 * `DomedCapNut.nut_profile`（fastener.py:685）—— 六角 + 球顶（含两段 `radiusArc`）。
 *
 * ⚠️ 起点为 `(1, 0)`（上游 `moveTo(1*MM, 0)`）而非轴上：轮廓留下 r∈[0,1] 的内孔，
 * 最终由 `nut_blank` 的螺纹孔覆盖（对 M≥4 无影响）。
 * @param data - 该规格的参数行（含 dk/m/s）。
 * @returns 轮廓。
 */
export function domedCapNutProfile(data: ParamRow): NutProfile {
  const { m, s } = requireMS(data, 'DomedCapNut')
  const dk = num(data, 'dk', 'DomedCapNut')
  const e = polygonDiagonal(s, 6)
  const cs = ((e - s) * Math.tan(DEG15)) / 2
  return new ProfileBuilder({ r: 1, z: 0 })
    .hLineTo(s / 2)
    .lineTo(e / 2, cs)
    .vLineTo(m - cs)
    .lineTo(s / 2, m)
    .hLineTo(dk / 2)
    .arcTo(0, m + dk / 2, -dk / 2)
    .vLineTo(m + dk / 2 - 1)
    .arcTo(dk / 2 - 1, m, dk / 2 - 1)
    .hLineTo(1)
    .build()
}

/**
 * `UnchamferedHexagonNut.nut_profile`（fastener.py:1189）—— 无倒角矩形（六角对边距）。
 * @param data - 该规格的参数行（含 m/s）。
 * @returns 轮廓。
 */
export function unchamferedHexagonNutProfile(data: ParamRow): NutProfile {
  const { m, s } = requireMS(data, 'UnchamferedHexagonNut')
  const w = polygonDiagonal(s, 6) / 2 - 0.001
  return new ProfileBuilder({ r: 0, z: 0 })
    .hLineTo(w)
    .vLineTo(m)
    .hLineTo(0)
    .build()
}

/**
 * `SquareNut.nut_profile`（fastener.py:1211）—— 四方双倒角（`polygon_diagonal(s, 4)`）。
 * @param data - 该规格的参数行（含 m/s）。
 * @returns 轮廓。
 */
export function squareNutProfile(data: ParamRow): NutProfile {
  const { m, s } = requireMS(data, 'SquareNut')
  const e = polygonDiagonal(s, 4)
  const cs = ((e - s) * Math.tan(DEG15)) / 2
  return new ProfileBuilder({ r: 0, z: 0 })
    .hLineTo(e / 2 - 0.001)
    .vLineTo(m - cs)
    .lineTo(s / 2, m)
    .hLineTo(0)
    .build()
}

/**
 * `BradTeeNut.nut_profile`（fastener.py:751）—— 法兰盘 + 台肩（**相对**位移 `vLine`/`hLine`）。
 * @param data - 该规格的参数行（含 c/dc/m/s）。
 * @returns 轮廓（点序：`(0,0) → (0,m) → (dc/2,m) → (dc/2,m−c) → (s,m−c) → (s,0) → (0,0)`）。
 */
export function bradTeeNutProfile(data: ParamRow): NutProfile {
  const m = num(data, 'm', 'BradTeeNut')
  const s = num(data, 's', 'BradTeeNut')
  const dc = num(data, 'dc', 'BradTeeNut')
  const c = num(data, 'c', 'BradTeeNut')
  return new ProfileBuilder({ r: 0, z: 0 })
    .vLine(m)
    .hLine(dc / 2)
    .vLine(-c)
    .hLineTo(s)
    .vLineTo(0)
    .hLineTo(0)
    .build()
}

/**
 * `HexNutWithFlange.flange_profile`（fastener.py:1139）—— 25° 过切线 + `radiusArc` + `polarLine`。
 * @param data - 该规格的参数行（含 c/dc）。
 * @returns 轮廓（起点在轴上 `(0,0)`）。
 */
export function hexNutFlangeProfile(data: ParamRow): NutProfile {
  const dc = num(data, 'dc', 'HexNutWithFlange')
  const c = num(data, 'c', 'HexNutWithFlange')
  const flangeAngle = 25
  // tangent_point = (c/2)·(cos(90−fa), sin(90−fa)) + ((dc−c)/2, c/2)
  const rad = ((90 - flangeAngle) * Math.PI) / 180
  const tangentR = (c / 2) * Math.cos(rad) + (dc - c) / 2
  const tangentZ = (c / 2) * Math.sin(rad) + c / 2
  return new ProfileBuilder({ r: 0, z: 0 })
    .hLineTo(dc / 2 - c / 2)
    .arcTo(tangentR, tangentZ, -c / 2)
    .polarLine(dc / 2 - c / 2, 180 - flangeAngle)
    .hLineTo(0)
    .build()
}

// ── plan（上游各 `nut_plan`）──────────────────────────────────────────────

/**
 * 正多边形顶点（`cq polygon(nSides, diameter)` 等价：首顶点在 `(r, 0)`）。
 * @param diameter - 外接圆直径（mm）。
 * @param nSides - 边数。
 * @returns XY 平面顶点列（z=0）。
 */
export function polygonPlanPoints(diameter: number, nSides: number): BrepVec3[] {
  const radius = diameter / 2
  const pts: BrepVec3[] = []
  for (let i = 0; i < nSides; i++) {
    const o = ((2 * Math.PI) / nSides) * i
    pts.push({ x: radius * Math.cos(o), y: radius * Math.sin(o), z: 0 })
  }
  return pts
}

/**
 * `Nut.default_nut_plan`（fastener.py:659）—— 正六边形。
 * @param data - 该规格的参数行（含 s）。
 * @returns XY 平面六边形 wire。
 */
export function defaultNutPlanWire(data: ParamRow): BrepHandle {
  return polygonWire(polygonPlanPoints(polygonDiagonal(num(data, 's', 'Nut'), 6), 6))
}

/**
 * `SquareNut.nut_plan`（fastener.py:1227）—— 边长 s 的正方形（`rect(s, s)`，居中）。
 * @param data - 该规格的参数行（含 s）。
 * @returns XY 平面正方形 wire。
 */
export function squareNutPlanWire(data: ParamRow): BrepHandle {
  const h = num(data, 's', 'SquareNut') / 2
  return polygonWire([
    { x: -h, y: -h, z: 0 },
    { x: h, y: -h, z: 0 },
    { x: h, y: h, z: 0 },
    { x: -h, y: h, z: 0 },
  ])
}

/**
 * `BradTeeNut.nut_plan`（fastener.py:764）—— 直径 dc 的圆。
 * @param data - 该规格的参数行（含 dc）。
 * @returns XY 平面圆 wire。
 */
export function bradTeeNutPlanWire(data: ParamRow): BrepHandle {
  return circleWireXY(num(data, 'dc', 'BradTeeNut') / 2)
}

// ── 沉孔切割器轮廓（上游各 `countersink_profile`）───────────────────────────

/** 矩形切割器轮廓（`rect(width/2, height, centered=False)`）。 */
function rectProfile(width: number, height: number): NutProfile {
  return new ProfileBuilder({ r: 0, z: 0 })
    .hLineTo(width)
    .vLineTo(height)
    .hLineTo(0)
    .build()
}

/**
 * `Nut.default_countersink_profile`（fastener.py:664）—— 含 `socket_clearance` 的矩形环。
 * @param data - 该规格的参数行（含 m/s）。
 * @returns 切割器轮廓。
 */
export function defaultNutCountersinkProfile(data: ParamRow): NutProfile {
  const { m, s } = requireMS(data, 'Nut')
  const width = polygonDiagonal(s, 6) + SOCKET_CLEARANCE
  return rectProfile(width / 2, m)
}

/**
 * `SquareNut.countersink_profile`（fastener.py:1231）—— 四方版。
 * @param data - 该规格的参数行（含 m/s）。
 * @returns 切割器轮廓。
 */
export function squareNutCountersinkProfile(data: ParamRow): NutProfile {
  const { m, s } = requireMS(data, 'SquareNut')
  const width = polygonDiagonal(s, 4) + SOCKET_CLEARANCE
  return rectProfile(width / 2, m)
}

/**
 * `DomedCapNut.countersink_profile`（fastener.py:707）—— 高度含球顶 `dk/2`。
 * @param data - 该规格的参数行（含 dk/m/s）。
 * @returns 切割器轮廓。
 */
export function domedCapNutCountersinkProfile(data: ParamRow): NutProfile {
  const { m, s } = requireMS(data, 'DomedCapNut')
  const dk = num(data, 'dk', 'DomedCapNut')
  const width = polygonDiagonal(s, 6) + SOCKET_CLEARANCE
  return rectProfile(width / 2, m + dk / 2)
}

/**
 * `HexNutWithFlange.countersink_profile`（fastener.py:1157）—— 取 `dc+clearance` 与
 * `socket_clearance` 的较大者。
 * @param data - 该规格的参数行（含 dc/m/s）。
 * @param threadDiameter - 螺纹公称直径（mm）。
 * @param clearanceHoleDiameter - 该配合等级的间隙孔直径（mm）。
 * @returns 切割器轮廓。
 */
export function hexNutFlangeCountersinkProfile(
  data: ParamRow,
  threadDiameter: number,
  clearanceHoleDiameter: number,
): NutProfile {
  const { m, s } = requireMS(data, 'HexNutWithFlange')
  const dc = num(data, 'dc', 'HexNutWithFlange')
  const clearance = clearanceHoleDiameter - threadDiameter
  const width = Math.max(dc + clearance, polygonDiagonal(s, 6) + SOCKET_CLEARANCE)
  return rectProfile(width / 2, m)
}

// ── 英制尺寸解码（fastener.py:74）──────────────────────────────────────────

/** 英制编号规格（`#0`…`#12`）的直径（mm，fastener.py:79-92）。 */
const IMPERIAL_NUMBERED_SIZES: Readonly<Record<string, number>> = {
  '#0000': 0.021 * INCH,
  '#000': 0.034 * INCH,
  '#00': 0.047 * INCH,
  '#0': 0.06 * INCH,
  '#1': 0.073 * INCH,
  '#2': 0.086 * INCH,
  '#3': 0.099 * INCH,
  '#4': 0.112 * INCH,
  '#5': 0.125 * INCH,
  '#6': 0.138 * INCH,
  '#8': 0.164 * INCH,
  '#10': 0.19 * INCH,
  '#12': 0.216 * INCH,
}

/**
 * `fastener.py:74 decode_imperial_size` —— 拆英寸规格为 (大径 mm, 螺距 mm)。
 * @param size - 形如 `1/4-20` 或 `#6-32` 的英制规格。
 * @returns `[大径 mm, 螺距 mm]`。
 */
export function decodeImperialSize(size: string): [number, number] {
  const parts = size.split('-')
  if (parts.length < 2)
    throw new Error(`Nut: imperial size ${JSON.stringify(size)} must be size-TPI`)
  let major: number
  if (size.startsWith('#')) {
    const v = IMPERIAL_NUMBERED_SIZES[parts[0]!]
    if (v === undefined) throw new Error(`Nut: unknown imperial numbered size ${parts[0]}`)
    major = v
  } else {
    const v = imperialStrToFloat(parts[0]!)
    if (typeof v !== 'number')
      throw new Error(`Nut: imperial size ${JSON.stringify(parts[0])} is not a measure`)
    major = v
  }
  const tpi = imperialStrToFloat(parts[1]!)
  if (typeof tpi !== 'number')
    throw new Error(`Nut: imperial TPI ${JSON.stringify(parts[1])} is not a measure`)
  return [major, INCH / (tpi / INCH)]
}

// ── buildNut（`Nut.__init__` + `make_nut`）──────────────────────────────────

/** 标准族的类钩子（profile / plan / 可选法兰）。沉孔轮廓单独导出，不进本钩子。 */
interface StandardNutHooks {
  profile: (data: ParamRow) => NutProfile
  planWire: (data: ParamRow) => BrepHandle
  flangeProfile?: (data: ParamRow) => NutProfile
}

function assertHand(hand: Hand, where: string): void {
  if (hand !== 'right' && hand !== 'left')
    throw new Error(`${where}: hand must be one of "right" or "left" not ${hand}`)
}

function makeBlank(
  planWire: BrepHandle,
  maxNutHeight: number,
  threadHeight: number,
  threadDiameter: number,
): BrepHandle {
  const blank = extrudeFace(planarFace(planWire), maxNutHeight)
  // `.faces("<Z").workplane().hole(d, depth)`：自 z=0 起钻 threadHeight 深
  return cut(blank, cylinderBetween(threadDiameter / 2, 0, threadHeight))
}

function makeStandardNut(hooks: StandardNutHooks, ctx: {
  nutData: ParamRow
  threadDiameter: number
  threadHeight: number
  simple: boolean
  threadPitch: number
  hand: Hand
}): BrepHandle {
  const profile = hooks.profile(ctx.nutData)
  const maxNutHeight = Math.max(...profilePoints(profile).map((p) => p.z))

  const nut = revolveProfile(profileWire(profile), AXIS_Z, 2 * Math.PI)
  let out = intersect(nut, makeBlank(hooks.planWire(ctx.nutData), maxNutHeight, ctx.threadHeight, ctx.threadDiameter))

  if (hooks.flangeProfile) {
    let flange = revolveProfile(profileWire(hooks.flangeProfile(ctx.nutData)), AXIS_Z, 2 * Math.PI)
    const fb = bboxOf(flange)
    // `.faces(">Z").hole(d)` 无 depth → 穿透
    flange = cut(flange, cylinderBetween(ctx.threadDiameter / 2, fb.zmin - 1, fb.zmax + 1))
    out = fuse(out, flange)
  }

  if (!ctx.simple) {
    const t = isoThread({
      major_diameter: ctx.threadDiameter,
      pitch: ctx.threadPitch,
      length: ctx.threadHeight,
      external: false,
      end_finishes: ['fade', 'fade'],
      hand: ctx.hand,
    })
    if (t.handle) out = fuse(out, t.handle)
  }
  return out
}

/** `Nut.__init__` 解析后的入参（`buildNut` 与 `buildBradTeeNut` 共用）。 */
interface ResolvedNut {
  size: string
  threadSize: string
  lengthSize?: string
  isMetric: boolean
  threadDiameter: number
  threadPitch: number
  hand: Hand
  simple: boolean
  nutData: ParamRow
}

/** 规格串 → (大径, 螺距)：公制 `M6-1` 直取，英制 `1/4-20` / `#6-32` 走 {@link decodeImperialSize}。 */
function parseThreadDistance(threadSize: string, isMetric: boolean, size: string): [number, number] {
  const parts = threadSize.split('-')
  if (isMetric) {
    const d = Number(parts[0]!.slice(1))
    const p = Number(parts[1])
    if (!Number.isFinite(d) || !Number.isFinite(p))
      throw new Error(`Nut: metric size ${JSON.stringify(size)} is malformed`)
    return [d, p]
  }
  return decodeImperialSize(threadSize)
}

/**
 * `Nut.__init__`（fastener.py:520）的公共解析：规格拆分 + 表行定位 + hand/simple 归一。
 * @param className - 螺母类名（决定参数表与报错文案）。
 * @param p - 入参（`size` / `fastener_type` / `hand` / `simple`）。
 * @returns 解析后的入参集合。
 */
function resolveNut(className: NutClassName, p: NutParams): ResolvedNut {
  const table = NUT_TABLES[className]
  const types = typesOf(table)

  const size = p.size.trim()
  const sizeParts = size.split('-')
  if (sizeParts.length < 2)
    throw new Error(
      `${JSON.stringify(sizeParts)} invalid, must be formatted as size-pitch(-length) or size-TPI(-length) where length is optional`,
    )
  const threadSize = sizeParts.slice(0, 2).join('-')
  const lengthSize = sizeParts.length === 3 ? sizeParts[2] : undefined
  const isMetric = threadSize.startsWith('M')
  const [threadDiameter, threadPitch] = parseThreadDistance(threadSize, isMetric, size)

  if (!types.includes(p.fastener_type))
    throw new Error(`${p.fastener_type} invalid, must be one of ${types.join(', ')}`)

  const hand: Hand = p.hand ?? 'right'
  assertHand(hand, className)
  const simple = p.simple ?? true

  const isolated = isolateFastenerType(p.fastener_type, table)
  const nutData = isolated[size]
  if (!nutData)
    throw new Error(`${size} invalid, must be one of ${Object.keys(isolated).join(', ')}`)

  return { size, threadSize, lengthSize, isMetric, threadDiameter, threadPitch, hand, simple, nutData }
}

/** 由几何句柄补齐上游的派生量（`nut_thickness` / `nut_diameter` / `info` / 孔表）。 */
function finalizeNut(
  r: ResolvedNut,
  className: NutClassName,
  p: NutParams,
  handle: BrepHandle,
): NutResult {
  const bb = bboxOf(handle)
  const nutThickness = bb.zmax
  const nutDiameter =
    2 * Math.max(Math.abs(bb.xmin), Math.abs(bb.xmax), Math.abs(bb.ymin), Math.abs(bb.ymax))
  return {
    handle,
    nutClass: className,
    size: r.size,
    threadSize: r.threadSize,
    lengthSize: r.lengthSize,
    isMetric: r.isMetric,
    threadDiameter: r.threadDiameter,
    threadPitch: r.threadPitch,
    fastenerType: p.fastener_type,
    hand: r.hand,
    simple: r.simple,
    nutData: r.nutData,
    nutThickness,
    nutDiameter,
    info: `${className}(${p.fastener_type}): ${r.threadSize}`,
    clearanceHoleDiameters: clearanceHoleData[r.threadSize.split('-')[0]!] ?? {},
    tapHoleDiameters: tapHoleData[r.threadSize] ?? {},
  }
}

/**
 * `Nut.__init__` + `make_nut`（fastener.py:520 / :581）的共享实现（标准族）。
 *
 * @param className - 螺母类名（决定参数表与输出标签）。
 * @param hooks - 该类的轮廓 / plan / 法兰钩子。
 * @param p - 入参（`size` / `fastener_type` / `hand` / `simple`）。
 * @returns 螺母实体与上游同名派生量。
 */
export function buildNut(
  className: NutClassName,
  hooks: StandardNutHooks,
  p: NutParams,
): NutResult {
  const r = resolveNut(className, p)
  const threadHeight = num(r.nutData, 'm', className)
  const handle = makeStandardNut(hooks, {
    nutData: r.nutData,
    threadDiameter: r.threadDiameter,
    threadHeight,
    simple: r.simple,
    threadPitch: r.threadPitch,
    hand: r.hand,
  })
  return finalizeNut(r, className, p, handle)
}

// ── 七个具体类 ────────────────────────────────────────────────────────────

/**
 * `HexNut`（fastener.py:1105）——iso4032 / iso4033 / iso4035。
 * @param p - 入参（`size` 如 `M6-1`；`fastener_type` 如 `iso4032`）。
 * @returns 螺母实体与派生量。
 */
export function hexNut(p: NutParams): NutResult {
  return buildNut(
    'HexNut',
    { profile: defaultNutProfile, planWire: defaultNutPlanWire },
    p,
  )
}

/**
 * `HexNutWithFlange`（fastener.py:1123）——din1665，带法兰分支。
 * @param p - 入参（`fastener_type` 固定 `din1665`）。
 * @returns 螺母实体与派生量。
 */
export function hexNutWithFlange(p: NutParams): NutResult {
  return buildNut(
    'HexNutWithFlange',
    {
      profile: defaultNutProfile,
      planWire: defaultNutPlanWire,
      flangeProfile: hexNutFlangeProfile,
    },
    p,
  )
}

/**
 * `UnchamferedHexagonNut`（fastener.py:1176）——iso4036，无倒角。
 * @param p - 入参（`fastener_type` 固定 `iso4036`）。
 * @returns 螺母实体与派生量。
 */
export function unchamferedHexagonNut(p: NutParams): NutResult {
  return buildNut(
    'UnchamferedHexagonNut',
    { profile: unchamferedHexagonNutProfile, planWire: defaultNutPlanWire },
    p,
  )
}

/**
 * `SquareNut`（fastener.py:1200）——din557，四方。
 * @param p - 入参（`fastener_type` 固定 `din557`）。
 * @returns 螺母实体与派生量。
 */
export function squareNut(p: NutParams): NutResult {
  return buildNut(
    'SquareNut',
    { profile: squareNutProfile, planWire: squareNutPlanWire },
    p,
  )
}

/**
 * `DomedCapNut`（fastener.py:674）——din1587，球顶。
 * @param p - 入参（`fastener_type` 固定 `din1587`）。
 * @returns 螺母实体与派生量。
 */
export function domedCapNut(p: NutParams): NutResult {
  return buildNut(
    'DomedCapNut',
    { profile: domedCapNutProfile, planWire: defaultNutPlanWire },
    p,
  )
}

/**
 * `cq.Workplane.polarArray(radius, startAngle, endAngle, count)`（cadquery `cq.py`）——
 * **只取位置，不建几何**（本包不需要平台的 `polarArray` parity）。
 *
 * cq 的角度分布为 `startAngle + (endAngle − startAngle)·i/count`（`i = 0..count−1`），
 * 即 `endAngle` 是**排他**上界：`(0, 360, 3)` → 0°/120°/240°。
 * @param radius - 阵列半径（mm）。
 * @param startAngleDeg - 起始角（度）。
 * @param endAngleDeg - 结束角（度，排他）。
 * @param count - 个数。
 * @returns `[x, y]` 位置列（z=0）。
 */
export function polarArrayLocations(
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  count: number,
): Array<[number, number]> {
  if (!Number.isInteger(count) || count <= 0)
    throw new Error(`Nut: polarArray count must be a positive integer, got ${count}`)
  const out: Array<[number, number]> = []
  for (let i = 0; i < count; i++) {
    const deg = startAngleDeg + ((endAngleDeg - startAngleDeg) * i) / count
    const a = (deg * Math.PI) / 180
    out.push([radius * Math.cos(a), radius * Math.sin(a)])
  }
  return out
}

/**
 * `BradTeeNut.custom_make`（fastener.py:734）—— 大法兰盘 + `brad_num` 个沉头螺钉孔。
 *
 * 上游步骤：`make_nut()` → `faces(">Z").workplane()` → `polarArray(bcd/2, 0, 360, brad_num)`
 * → `clearanceHole(fastener=CounterSunkScrew(brad_size, 2c, "iso10642"))`。
 *
 * 本包把 `clearanceHole` 走 {@link recess.tempClearanceHoleCutter}（**W4 临时**，
 * W9·P1-b 落地后替换为 `src/holes.ts`）。解析验证（`scripts/probe-bradtee-decomposition.py`
 * 出 A 侧中间量；B 侧 STEP 等价由 `src/nut.test.ts` 锁定）：
 *  - `make_nut()` = 3585.465923（与前剖面/plan 模型解析值一致）；
 *  - 每孔切除 65.4292（截锥 ∪ 杆部 ∪ 钻尖 在法兰板内的并集），3 孔共 196.290；
 *  - 终值 = 3389.175287，与 A 侧 manifest 逐位一致。
 *
 * ⚠️ **不调上游的 `.clean()`**（OCCT `ShapeUpgrade_UnifySameDomain`）——只合同域面、
 * 不改体积；内核无该封装（cq-compat parity 欠账）。见 `src/recess.ts` 文件头。
 * @param p - 入参（`size` / `fastener_type`=`Hilitchi`）。
 * @returns 螺母实体与派生量。
 */
export function bradTeeNut(p: NutParams): NutResult {
  const r = resolveNut('BradTeeNut', p)
  const nutData = r.nutData
  const profile = bradTeeNutProfile(nutData)
  const maxNutHeight = Math.max(...profilePoints(profile).map((q) => q.z))
  const nutThreadHeight = num(nutData, 'm', 'BradTeeNut')

  let nut = intersect(
    revolveProfile(profileWire(profile), AXIS_Z, 2 * Math.PI),
    makeBlank(bradTeeNutPlanWire(nutData), maxNutHeight, nutThreadHeight, r.threadDiameter),
  )

  // `brad = CounterSunkScrew(size=brad_size, length=2c, fastener_type="iso10642")`
  // —— W5 之前只用它的两个参数面：间隙孔表 + 沉头轮廓（见 src/recess.ts 文件头）。
  const bradSize = String(nutData['brad_size'] ?? '')
  const bradParts = bradSize.split('-')
  if (bradParts.length < 2 || !bradSize.startsWith('M'))
    throw new Error(`BradTeeNut: brad_size ${JSON.stringify(bradSize)} must be a metric size-pitch`)
  const clearanceRow = clearanceHoleData[bradParts[0]!]
  const clearance = clearanceRow?.['Normal']
  if (clearance === undefined)
    throw new Error(
      `BradTeeNut: no Normal clearance hole for brad size ${bradSize} (table: ${Object.keys(clearanceRow ?? {}).join(', ') || 'missing'})`,
    )
  const screwData = isolateFastenerType('iso10642', SCREW_TABLES.CounterSunkScrew)[bradSize]
  if (!screwData)
    throw new Error(`BradTeeNut: no iso10642 countersunk data for ${bradSize}`)

  // `depth=None` → 上游取 `self.largestDimension()`（包围盒对角线）
  const cutter = tempClearanceHoleCutter({
    countersinkProfile: tempCounterSunkCountersinkProfile(screwData, 'Normal'),
    holeRadius: clearance / 2,
    depth: bboxDiagonal(nut),
  })

  // `polarArray(bcd/2, 0, 360, brad_num)` 落在 `>Z` 面上 → z = 顶面高度
  const topZ = bboxOf(nut).zmax
  const bcd = num(nutData, 'bcd', 'BradTeeNut')
  const bradNum = num(nutData, 'brad_num', 'BradTeeNut')
  for (const [x, y] of polarArrayLocations(bcd / 2, 0, 360, bradNum))
    nut = cut(nut, translate(cutter, x, y, topZ))

  return finalizeNut(r, 'BradTeeNut', p, nut)
}

/**
 * `HeatSetNut`（fastener.py:791）—— McMaster-Carr / Hilitchi 热熔铜螺母。
 *
 * ⚠️ **W4 未实现（显式抛错）**。上游 `make_nut`（fastener.py:947）不走向轮廓旋转，
 * 而是 `Face.makeNSidedSurface` 造 knurl 面 + `Shell.makeShell` + `Solid.makeSolid`。
 * 本内核无 `makeNSidedSurface`；probe（`scripts/kernel-nut-probe.ts` 段 4）实测
 * `makeNonPlanarFace(4 边扭面 wire)` 退化为 **3 边面**（面积 2.749170），几何不等价
 * ——不构成可接受的替代。详见 W4 分析文档。
 * @param p - 入参（`size` 形如 `M3-0.5-Standard`）。
 * @throws 总是抛出，说明缺失内核能力。
 * @returns 永不返回（抛错）。
 */
export function heatSetNut(p: NutParams): NutResult {
  throw new Error(
    `HeatSetNut: not implemented in W4 — make_nut needs Face.makeNSidedSurface for the knurl ` +
      `faces (kernel has no such primitive; makeNonPlanarFace degenerates a 4-edge twisted ` +
      `face to a 3-edge face, measured area 2.749170). Requested ${p.size}/${p.fastener_type}. ` +
      `See docs/analysis/2026-09-14-cq-warehouse-nut-washer-probe.md`,
  )
}
