// Copyright 2026 Faicad. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * sprocket.ts — 链轮（W7）—— 上游 `cq_warehouse.sprocket.Sprocket` 的逐位复刻。
 *
 * 装配流（`sprocket.py:157 _make_sprocket`）：
 * ```
 *   outline = polarArray(pitch_radius, 0, 360, N).tooth_outline(...)  # N 个齿轮廓
 *             .consolidateWires()                                     # 合成单闭合 wire
 *             .rotate(Z, 90)                                          # 对齐链轮旋转计算
 *   sprocket = outline.extrude(thickness).translate((0, 0, -thickness/2))
 *   if flat:  sprocket.edges(RadiusNthSelector(2)).chamfer(0.25*t, 0.5*t)
 *   if mount: polarArray(bcd/2).circle(mbd/2).cutThruAll()
 *   if bore:  circle(bore/2).cutThruAll()
 * ```
 *
 * ⚠️ 复刻事实（`scripts/probe-sprocket-outline.py` / `probe-sprocket-chamfer.py`
 * 在 cadquery 环境实测锁定，2026-09-15）：
 *
 * 1. **每齿净变换 = 纯旋转 Rz(90° + k·a)**：polarArray 的 Location
 *    （平移 p·û(ka)、旋转 k·a）与齿轮廓的 translate(-p, 0) 恰好相消
 *    （û(ka) 为角 ka 方向单位向量），即上游注释掉的 `#1006` rotate 修正。
 *    相邻齿在滚子窝底共享端点（浮点 ~1e-13 内），全齿构成**单闭合链**：
 *    平齿 5 弧/齿（窝弧+侧弧+顶弧+侧弧+窝弧）、尖齿 4 弧/齿（无顶弧）。
 *    链的遍历方向为顺时针（角度递减），故齿序为 k = 0, N-1, N-2, …, 1。
 *
 * 2. **平齿倒角 = 上下两圈锥环切削**：cq `chamfer(0.25t, 0.5t)` 在齿顶圆
 *    （半径 outer_rad）的上、下两圈圆边上各生成一个锥面（A 侧 32T 实测
 *    CONE 面 64 = 顶 32 + 底 32）。锥面母线过 (r = R − 0.25t, z = ±t/2)
 *    与 (r = R, z = ±t)，斜率 dr/dz = 0.5（径向腿 0.25t、轴向腿 0.5t）。
 *    内核 `chamferDistAngle` 的第二面 F 由内核自选、调用方不可指定
 *    （primitives.ts 契约），故本实现用「圆柱 − 圆锥」构造锥环切割器，
 *    切削面与 cq 倒角锥面完全重合。
 *
 * 3. **flat 判定**：上游用拉伸体圆边 unique 半径数 == 3 判定
 *    （窝半径 / 侧弧半径 / 顶弧半径）；数学等价于齿廓交点 outer_pt.y > 0
 *    （make_tooth_outline 的分支条件），本实现直接用后者，免拓扑查询。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import {
  arcEdge,
  cone,
  cut,
  cylinderBetween,
  extrudeFace,
  mirrorAbout,
  planarFace,
  radiusArcMidpoint,
  translate as translateShape,
  volumeOf,
  wireFromEdges,
} from './primitives'
import { requireKernel, type WarehouseKernel } from './kernel'

/** 2D 轮廓点（齿局部坐标系，齿尖朝 +X）。 */
interface P2 {
  x: number
  y: number
}

const INCH = 25.4
const DEG = Math.PI / 180

/** 绕 Z 轴旋转（度，右手）。 */
function rotZ(p: P2, deg: number): P2 {
  const a = deg * DEG
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** 关于 XZ 平面镜像（上游 `Vector.flipY`）。 */
function flipY(p: P2): P2 {
  return { x: p.x, y: -p.y }
}

function add2(a: P2, b: P2): P2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

/** 2D → 世界 3D（z=0 平面）。 */
function v3(p: P2): BrepVec3 {
  return { x: p.x, y: p.y, z: 0 }
}

/**
 * 上游 `Sprocket.sprocket_pitch_radius`（sprocket.py:223）：
 * p = √(cp² / (2·(1 − cos(2π/N))))。
 * @param numTeeth - 齿数 N。
 * @param chainPitch - 链条节距 cp（mm）。
 * @returns 分度圆半径（mm）。
 */
export function sprocketPitchRadius(numTeeth: number, chainPitch: number): number {
  const a = (2 * Math.PI) / numTeeth
  return Math.sqrt((chainPitch * chainPitch) / (2 * (1 - Math.cos(a))))
}

/**
 * 上游 `Sprocket.sprocket_circumference`（sprocket.py:236）。
 * @param numTeeth - 齿数 N。
 * @param chainPitch - 链条节距 cp（mm）。
 * @returns 分度圆周长（mm）。
 */
export function sprocketCircumference(numTeeth: number, chainPitch: number): number {
  return 2 * Math.PI * sprocketPitchRadius(numTeeth, chainPitch)
}

/** 齿廓关键点与弧半径（make_tooth_outline 的产出，齿局部坐标系）。 */
interface ToothGeom {
  startPt: P2
  tangentPt: P2
  outerPt: P2
  spikePt: P2
  /** 滚子窝弧半径（带符号，凹弧）。 */
  slotRadius: number
  /** 齿侧弧半径。 */
  flankRadius: number
  /** 齿顶弧半径（仅平齿）。 */
  topRadius: number
  /** 平齿（有圆弧顶）；false = 尖齿。 */
  flat: boolean
}

/**
 * 探针复用 {@link computeToothGeom}（probe-sprocket-nochamfer.ts 等脚本取用）。
 * @param numTeeth - 齿数 N。
 * @param chainPitch - 链条节距（mm）。
 * @param rollerRad - 滚子窝半径（含 clearance，mm）。
 * @returns 齿廓关键点与弧半径（齿局部坐标系）。
 */
export function computeToothGeomForProbe(
  numTeeth: number,
  chainPitch: number,
  rollerRad: number,
): ToothGeom {
  return computeToothGeom(numTeeth, chainPitch, rollerRad)
}

/**
 * 探针复用 {@link toothArcs}：一颗齿的弧边序列（世界坐标，θk = 90° + k·a）。
 * @param g - 齿廓关键点几何。
 * @param thetaDeg - 该齿的旋转角（度）。
 * @returns 弧边 handle 序列（按上游 radiusArc 顺序）。
 */
export function toothArcsForProbe(g: ToothGeom, thetaDeg: number): BrepHandle[] {
  return toothArcs(g, thetaDeg)
}

function computeToothGeom(
  numTeeth: number,
  chainPitch: number,
  rollerRad: number,
): ToothGeom {
  const toothA = 360 / numTeeth
  const half = (toothA / 2) * DEG
  const pitchRad = sprocketPitchRadius(numTeeth, chainPitch)
  const outerRad = pitchRad + rollerRad / 2

  // 齿侧弧与齿顶弧的交角方程（sprocket.py:280 的 asin 表达式，逐字转录）
  const ps = pitchRad * Math.sin(half)
  const pc = pitchRad * Math.cos(half)
  const q = chainPitch - rollerRad
  const o2 = outerRad * outerRad
  const o3 = o2 * outerRad
  const o4 = o2 * o2
  const o6 = o4 * o2
  const pc2 = pc * pc
  const pc4 = pc2 * pc2
  const pc6 = pc4 * pc2
  const ps2 = ps * ps
  const ps3 = ps2 * ps
  const ps4 = ps2 * ps2
  const q2 = q * q
  const q4 = q2 * q2
  const radicand =
    -o6 * pc2 +
    2 * o4 * q2 * pc2 +
    2 * o4 * pc4 +
    2 * o4 * pc2 * ps2 -
    o2 * q4 * pc2 +
    2 * o2 * q2 * pc4 +
    2 * o2 * q2 * pc2 * ps2 -
    o2 * pc6 -
    2 * o2 * pc4 * ps2 -
    o2 * pc2 * ps4
  const frac =
    (-o3 * ps +
      Math.sqrt(radicand) +
      outerRad * q2 * ps -
      outerRad * pc2 * ps -
      outerRad * ps3) /
    (2 * o2 * (pc2 + ps2))
  const outerIntersectA = Math.asin(frac)

  // 滚子窝底（±tooth_a/2 处）
  const startPt = rotZ({ x: pitchRad - rollerRad, y: 0 }, toothA / 2)
  // 窝弧与齿侧弧的切点
  const tangentPt = add2(
    rotZ({ x: 0, y: -rollerRad }, -toothA / 2),
    rotZ({ x: pitchRad, y: 0 }, toothA / 2),
  )
  // 齿侧弧与齿顶弧的交点
  const outerPt = {
    x: outerRad * Math.cos(outerIntersectA),
    y: outerRad * Math.sin(outerIntersectA),
  }
  // 尖齿齿尖（无平顶时）
  const spikePt = {
    x:
      Math.sqrt(pitchRad * pitchRad - (chainPitch / 2) ** 2) +
      Math.sqrt(q * q - (chainPitch / 2) ** 2),
    y: 0,
  }

  return {
    startPt,
    tangentPt,
    outerPt,
    spikePt,
    slotRadius: -rollerRad,
    flankRadius: chainPitch - rollerRad,
    topRadius: outerRad,
    flat: outerPt.y > 0,
  }
}

/** 一颗齿的弧边序列（世界坐标，θk = 90° + k·a 旋转后），按上游 radiusArc 顺序。 */
function toothArcs(g: ToothGeom, thetaDeg: number): BrepHandle[] {
  const rot = (p: P2): BrepVec3 => v3(rotZ(p, thetaDeg))
  // cq radiusArc 三点弧：midpoint 复刻 sagittaArc 公式（带符号半径约定一致）
  const arc = (a: P2, b: P2, radius: number): BrepHandle =>
    arcEdge(rot(a), rot(radiusArcMidpoint(a, b, radius)), rot(b))
  const arcs: BrepHandle[] = [arc(g.startPt, g.tangentPt, g.slotRadius)]
  if (g.flat) {
    arcs.push(arc(g.tangentPt, g.outerPt, g.flankRadius))
    arcs.push(arc(g.outerPt, flipY(g.outerPt), g.topRadius))
    arcs.push(arc(flipY(g.outerPt), flipY(g.tangentPt), g.flankRadius))
  } else {
    arcs.push(arc(g.tangentPt, g.spikePt, g.flankRadius))
    arcs.push(arc(g.spikePt, flipY(g.tangentPt), g.flankRadius))
  }
  arcs.push(arc(flipY(g.tangentPt), flipY(g.startPt), g.slotRadius))
  return arcs
}

/** 链轮构造入参（与上游 `Sprocket.__init__` 签名一一对应，默认值同上游）。 */
export interface SprocketParams {
  /** 齿数 N（整数且 > 2）。 */
  numTeeth: number
  /** 链条节距（mm），默认 1/2" = 12.7。 */
  chainPitch?: number
  /** 链条滚子直径（mm），默认 5/16" = 7.9375。 */
  rollerDiameter?: number
  /** 滚子窝间隙（mm），默认 0。 */
  clearance?: number
  /** 轮体厚度（mm），默认 0.084" = 2.1336。 */
  thickness?: number
  /** 安装螺栓孔分布圆直径（mm），0 = 不开孔。 */
  boltCircleDiameter?: number
  /** 安装螺栓数量。 */
  numMountBolts?: number
  /** 安装螺栓孔直径（mm）。 */
  mountBoltDiameter?: number
  /** 中心孔直径（mm），0 = 不开孔。 */
  boreDiameter?: number
}

/** 链轮构造结果（含上游派生量，供测试锁定）。 */
export interface SprocketResult {
  handle: BrepHandle
  /** 齿数。 */
  numTeeth: number
  /** 链条节距（mm）。 */
  chainPitch: number
  /** 分度圆半径（上游 `pitch_radius` 属性）。 */
  pitchRadius: number
  /** 齿顶圆半径（上游 `outer_radius` 属性）。 */
  outerRadius: number
  /** 分度圆周长（上游 `pitch_circumference` 属性）。 */
  pitchCircumference: number
  /** 平齿（true）/ 尖齿（false）——上游 `_flat_teeth`。 */
  flatTeeth: boolean
  /** 厚度（mm）。 */
  thickness: number
}

/**
 * 构造一个链轮（上游 `Sprocket` 的唯一几何入口）。
 * @param p - 构造入参。
 * @returns 链轮实体与上游派生量。
 * @throws 当 `numTeeth` 不是 > 2 的整数，或 `rollerDiameter >= chainPitch`（同上游 ValueError）。
 */
export function buildSprocket(p: SprocketParams): SprocketResult {
  const numTeeth = p.numTeeth
  const chainPitch = p.chainPitch ?? 0.5 * INCH
  const rollerDiameter = p.rollerDiameter ?? (5 / 16) * INCH
  const clearance = p.clearance ?? 0
  const thickness = p.thickness ?? 0.084 * INCH
  const boltCircleDiameter = p.boltCircleDiameter ?? 0
  const numMountBolts = p.numMountBolts ?? 0
  const mountBoltDiameter = p.mountBoltDiameter ?? 0
  const boreDiameter = p.boreDiameter ?? 0

  // 上游 __init__ 的输入校验（逐字语义）
  if (!Number.isInteger(numTeeth) || numTeeth <= 2)
    throw new Error(`num_teeth must be an integer greater than 2 not ${numTeeth}`)
  if (rollerDiameter >= chainPitch)
    throw new Error(
      `roller_diameter ${rollerDiameter} is too large for chain_pitch ${chainPitch}`,
    )

  const pitchRadius = sprocketPitchRadius(numTeeth, chainPitch)
  const rollerRad = rollerDiameter / 2 + clearance
  const toothA = 360 / numTeeth
  const geom = computeToothGeom(numTeeth, chainPitch, rollerRad)

  // 全齿单闭合链（顺时针）：齿 0 → 齿 N-1 → … → 齿 1（见文件头事实 1）
  const edges: BrepHandle[] = []
  for (let k = 0; k < numTeeth; k++) {
    const ki = k === 0 ? 0 : numTeeth - k
    edges.push(...toothArcs(geom, 90 + ki * toothA))
  }
  let solid = extrudeFace(planarFace(wireFromEdges(edges)), thickness)
  // 顺时针 wire → 面法向 -Z → 拉伸体体积为负；翻正后再做切割
  // （reverseShape 在 WarehouseKernel 声明，BrepEngineApi 平台契约未含）
  if (volumeOf(solid) < 0) solid = (requireKernel() as WarehouseKernel).reverseShape(solid)
  // 上游 translate((0, 0, -thickness/2))：居中到 z ∈ [-t/2, t/2]
  solid = translateShape(solid, 0, 0, -thickness / 2)

  // 平齿：齿顶圆上下两圈锥环倒角（见文件头事实 2；尖齿不倒角）。
  // cq 在顶边（z=+t/2）的倒角锥面过 (R−0.25t, 0) 与 (R, t/2)（斜率 +0.5），
  // 底边镜像；两锥面在赤道 z=0 处于 r=R−0.25t 尖点相接。
  // 切割器 = 圆柱 − 圆锥（锥面即倒角面，圆柱只提供外界）。
  if (geom.flat) {
    const R = geom.topRadius
    const m = Math.max(1, thickness / 2) // 切削余量
    const h = thickness / 2 + m
    // 顶边倒角切割器：z ∈ [0, t/2+m]，锥面 r(z) = R−0.25t+0.5z（底在 z=0）
    const cutterTop = cut(
      cylinderBetween(R + m, 0, h),
      cone(R - 0.25 * thickness, R - 0.25 * thickness + 0.5 * h, h),
    )
    // 底边倒角切割器 = 顶边切割器关于 z=0 镜像
    const cutterBottom = mirrorAbout(cutterTop, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
    solid = cut(cut(solid, cutterTop), cutterBottom)
  }

  // 安装螺栓孔（上游三参数同时非 0 才开孔；cutThruAll = 双向贯通）
  if (boltCircleDiameter !== 0 && numMountBolts !== 0 && mountBoltDiameter !== 0) {
    for (let i = 0; i < numMountBolts; i++) {
      const a = ((i * 360) / numMountBolts) * DEG
      solid = cut(
        solid,
        translateShape(
          cylinderBetween(mountBoltDiameter / 2, -thickness, 2 * thickness),
          (boltCircleDiameter / 2) * Math.cos(a),
          (boltCircleDiameter / 2) * Math.sin(a),
          0,
        ),
      )
    }
  }

  // 中心孔
  if (boreDiameter !== 0)
    solid = cut(solid, cylinderBetween(boreDiameter / 2, -thickness, 2 * thickness))

  // 上游 outer_radius 属性（注意 spiky 分式用 roller_diameter/2 而非含 clearance 的 roller_rad）
  const outerRadius = geom.flat
    ? pitchRadius + rollerDiameter / 4
    : Math.sqrt(pitchRadius ** 2 - (chainPitch / 2) ** 2) +
      Math.sqrt((chainPitch - rollerDiameter / 2) ** 2 - (chainPitch / 2) ** 2)

  return {
    handle: solid,
    numTeeth,
    chainPitch,
    pitchRadius,
    outerRadius,
    pitchCircumference: sprocketCircumference(numTeeth, chainPitch),
    flatTeeth: geom.flat,
    thickness,
  }
}
