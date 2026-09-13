/**
 * bevel_gear — BevelGear 锥齿轮实体构造
 *
 * 对应 cq_gears `bevel_gear.py::BevelGear`（`_build_tooth_faces` / `_build_gear_faces`
 * / `_trim_bottom` / `_trim_top` / `_make_bore` / `_build`）：
 *
 * ```
 * ① 球面齿廓（单位球面，`profile.ts::bevelGearGeometry`）× 每行锥距 r
 *    → 4 段 × surf_splines 行点阵 → `Face.makeSplineApprox` → 4 张齿面
 * ② 每张齿面用两个 z=const 平面 `face.split` 裁顶（z=tc_h，取 zmax 最大片）
 *    与裁底（z=pc_h，取 zmax 最小片）
 * ③ 每张齿面绕 Z 转 tau·i（i = 0..z-1）→ 4z 张面；再补 z=tc_h / z=pc_h 两个端盖
 * ④ sew(shell_sewing_tol) → makeSolid → fixFaceOrientations
 * ⑤ `_trim_bottom`/`_trim_top`：XZ 平面轮廓绕 **Z** 回转 360° 的 cutter 布尔差
 * ⑥ 重定向（绕 X 转 180° → 沿 Z 平移 cone_h → 绕 Z 转 t_align_angle）
 * ⑦ `_make_bore`：沿 Z 贯穿圆柱差
 * ```
 *
 * 与 Python 的差异（有意为之，几何等价）：
 * - 端盖的边界边不用 cq 的 `edges('<Z')` 极值选择器（按**边的质心**聚类，容差 1e-4），
 *   而用**解析平面**判定：两条裁切边分别精确落在 z = tc_h / z = pc_h 上，
 *   按「边上采样点全部落在该平面 ±1e-6」收集，选出的边集与极值选择器一致且更稳。
 * - `Wire.combine(...)` 用 `geom-build.ts::connectEdgesToWires` 复刻（同 `wire_comb_tol`）。
 *
 * ⚠️ `cq.Workplane('XZ')` 的局部坐标 (u, v) → 世界 (u, 0, v)，其法向为 **−Y**；
 * `revolve()` 缺省轴 = 工作面原点沿法向 → 即**全局 Z 轴**。故回转体一律绕 Z。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import type { GearKernel } from '@faicad/cq-compat'
import {
  GEAR_BASE_CONSTANTS, bevelGearGeometry,
  type BevelGearGeometry, type BevelGearParams, type ToothGrid,
} from './profile'
import { linspace, rotateRows, sphereToCartesian, type Vec3 } from './math'
import {
  buildSplineFace, DEFAULT_SPLINE_FACE_STRATEGY,
  type SplineFaceOptions, type SplineFaceStrategy,
} from './spline-face'
import { connectEdgesToWires } from '@faicad/cq-compat'

/** 判定「边上所有采样点是否落在 z 平面内」的容差（mm）。 */
const PLANE_PICK_TOL = 1e-6

/** `_make_bore` 的贯穿余量（与 features.ts 的 CHAMFER_E 同量级）。 */
const BORE_E = 0.01

/** 齿廓 4 段（顺序与 Python `_build_tooth_faces` 的循环一致）。 */
const BEVEL_SEGMENTS = ['lflank', 'tip', 'rflank', 'root'] as const

function segmentPoints(geom: BevelGearGeometry, seg: (typeof BEVEL_SEGMENTS)[number]): Vec3[] {
  switch (seg) {
    case 'lflank': return geom.t_lflank_pts
    case 'tip': return geom.t_tip_pts
    case 'rflank': return geom.t_rflank_pts
    case 'root': return geom.t_root_pts
  }
}

/** BevelGear 实体构造选项。 */
export interface BuildBevelGearOptions extends SplineFaceOptions {
  strategy?: SplineFaceStrategy
  /** 缝合容差（cq `shell_sewing_tol`，GearBase 默认 1e-2）。 */
  shellSewingTol?: number
  /** 组线容差（cq `wire_comb_tol`，GearBase 默认 1e-2）。 */
  wireCombTol?: number
  /** 轴孔直径（沿 Z 贯穿，`BevelGear._make_bore`）。 */
  boreD?: number
  /** 是否裁底（cq `trim_bottom`，默认 true）。 */
  trimBottom?: boolean
  /** 是否裁顶（cq `trim_top`，默认 true）。 */
  trimTop?: boolean
}

/** `_build_tooth_faces` 用到的四个锥距/高度/平面尺寸（Python 同款中间量）。 */
interface BevelFaceFrames {
  /** 分度锥高度 pc_h = cos(gamma_r)·gs_r（= cone_h） */
  pcH: number
  /** 延长后的分度锥母线 pc_f = pc_h / cos(gamma_f) */
  pcF: number
  /** 分度锥底面半径 pc_rb = pc_f·sin(gamma_f) */
  pcRB: number
  /** 顶锥高度 tc_h = cos(gamma_f)·(gs_r − face_width) */
  tcH: number
  /** 顶锥母线 tc_f = tc_h / cos(gamma_r) */
  tcF: number
  /** 顶锥底面半径 tc_rb = tc_f·sin(gamma_f) */
  tcRB: number
}

function faceFrames(geom: BevelGearGeometry): BevelFaceFrames {
  const pcH = Math.cos(geom.gammaR) * geom.gsR
  const pcF = pcH / Math.cos(geom.gammaF)
  const tcH = Math.cos(geom.gammaF) * (geom.gsR - geom.faceWidth)
  const tcF = tcH / Math.cos(geom.gammaR)
  return {
    pcH, pcF,
    pcRB: pcF * Math.sin(geom.gammaF),
    tcH, tcF,
    tcRB: tcF * Math.sin(geom.gammaF),
  }
}

/** z = const、边长 `size` 的正方形平面（cq `Face.makePlane(length=size, width=size)` 的等价物）。 */
function squarePlaneAtZ(kernel: GearKernel, z: number, size: number): BrepHandle {
  const half = size / 2
  const c = [
    { x: -half, y: -half, z },
    { x: half, y: -half, z },
    { x: half, y: half, z },
    { x: -half, y: half, z },
  ]
  const edges = c.map((p, i) => kernel.makeLineEdge(p, c[(i + 1) % 4]))
  return kernel.makeFace(kernel.makeWire(edges))
}

/**
 * 复刻 cq `Face.split(plane)` + 「按 zmax 取片」的选择规则。
 *
 * cq 侧：`cpd = face.split(plane)`，若返回 Compound 则取 `max/min(list(cpd), key=zmax)`，
 * 否则（平面没切到面）直接用原面。内核的 `split` 同样在「没切到」时原样返回该面。
 *
 * @param which `'top'` 取 zmax 最大的片（裁顶）、`'bottom'` 取 zmax 最小的片（裁底）
 * @returns 保留的那一片
 */
function splitFaceKeep(
  kernel: GearKernel, face: BrepHandle, plane: BrepHandle, which: 'top' | 'bottom',
): BrepHandle {
  const res = kernel.split(face, [plane])
  if (kernel.isFace(res)) return res
  const pieces = kernel.getSubShapes(res, 'face')
  if (pieces.length === 0) {
    throw new Error(`splitFaceKeep: split produced no face fragment (which=${which})`)
  }
  if (pieces.length === 1) return pieces[0]
  let best = pieces[0]
  let bestZ = which === 'top' ? -Infinity : Infinity
  for (const p of pieces) {
    const z = kernel.getBoundingBox(p).zmax
    if (which === 'top' ? z > bestZ : z < bestZ) {
      bestZ = z
      best = p
    }
  }
  return best
}

/**
 * ①+②：4 张齿面（每张已按 z = tc_h / z = pc_h 裁顶裁底）。
 *
 * 复刻 `_build_tooth_faces`：行参数 `spline_tf = linspace((pc_f, ta1), (tc_f − 0.01, ta2), n)`
 * 给出每行的锥距 `r` 与扭转角 `a`，行点 = 「单位球面齿廓 @ rotation_matrix(轴 Z, a)」× r。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 锥齿轮几何量
 * @param strategy 齿面建面策略
 * @param options 容差/次数选项
 * @returns 4 张裁切后的齿面
 */
export function buildBevelToothFaces(
  kernel: GearKernel,
  geom: BevelGearGeometry,
  strategy: SplineFaceStrategy,
  options: SplineFaceOptions = {},
): BrepHandle[] {
  const f = faceFrames(geom)

  // 起止扭转角
  const ta1 = (-(f.pcF - geom.gsR) / geom.faceWidth) * geom.twistAngle
  const ta2 = ((geom.gsR - f.tcF) / geom.faceWidth) * geom.twistAngle

  const surfSplines = Math.max(1, Math.ceil(Math.abs(geom.twistAngle) / (Math.PI * 2)))
    * geom.surfaceSplines

  // np.linspace((pc_f, ta1), (tc_f - 0.01, ta2), surf_splines)
  const rs = linspace(f.pcF, f.tcF - 0.01, surfSplines)
  const as = linspace(ta1, ta2, surfSplines)

  // cq 的裁切平面比齿面大 1000 倍（tcp_size = tc_rb·1000），照抄保证平面完全覆盖面。
  const topPlane = squarePlaneAtZ(kernel, f.tcH, f.tcRB * 1000)
  const bottomPlane = squarePlaneAtZ(kernel, f.pcH, f.pcRB * 1000)

  const tFaces: BrepHandle[] = []
  for (const seg of BEVEL_SEGMENTS) {
    const spline = segmentPoints(geom, seg)
    const rows: Vec3[][] = rs.map((r, i) => {
      const rotated = rotateRows(spline, { x: 0, y: 0, z: 1 }, as[i])
      return rotated.map((p) => ({ x: p.x * r, y: p.y * r, z: p.z * r }))
    })
    const grid: ToothGrid = { segment: seg, rows: rows.length, cols: rows[0].length, points: rows }
    let face = buildSplineFace(kernel, grid, strategy, options)
    face = splitFaceKeep(kernel, face, topPlane, 'top')
    face = splitFaceKeep(kernel, face, bottomPlane, 'bottom')
    tFaces.push(face)
  }
  return tFaces
}

/**
 * 收集落在 z 平面上的边界边并组成一个平面端盖。
 *
 * 对应 `_build_gear_faces` 里的 `wp.edges('<Z')` / `wp.edges('>Z')` + `Wire.combine`
 * + `Face.makeFromWires`。判据用「边上采样点全部落在该平面 ±PLANE_PICK_TOL」——
 * 两条裁切边是 split 产生的、精确落在 z = tc_h / z = pc_h 上，故与极值选择器等价。
 *
 * @param kernel 原始 OCCT 内核
 * @param faces 全部齿面
 * @param z 目标平面高度
 * @param wireCombTol 组线容差
 * @returns 平面端盖
 */
export function capBevelAtZ(
  kernel: GearKernel,
  faces: BrepHandle[],
  z: number,
  wireCombTol: number = GEAR_BASE_CONSTANTS.wire_comb_tol,
): BrepHandle {
  const edges: BrepHandle[] = []
  for (const f of faces) {
    for (const e of kernel.getSubShapes(f, 'edge')) {
      const { first, last } = kernel.curveParameters(e)
      const samples = [first, (first + last) / 2, last].map((t) => kernel.curvePointAtParam(e, t))
      if (samples.every((p) => Math.abs(p.z - z) <= PLANE_PICK_TOL)) edges.push(e)
    }
  }
  if (edges.length === 0) {
    throw new Error(`capBevelAtZ: no boundary edges found on plane z=${z}`)
  }
  const wires = connectEdgesToWires(kernel, edges, wireCombTol)
  if (wires.length === 0) {
    throw new Error(`capBevelAtZ: no closed loop on z=${z} from ${edges.length} edges`)
  }
  // 接缝处可能产生小碎环（多于一条 wire）；取 bbox 面积最大的那条（真实端面边界）。
  let cap = wires[0]
  if (wires.length > 1) {
    let bestArea = -1
    for (const w of wires) {
      const bb = kernel.getBoundingBox(w)
      const area = (bb.xmax - bb.xmin) * (bb.ymax - bb.ymin)
      if (area > bestArea) { bestArea = area; cap = w }
    }
  }
  return kernel.makeFace(kernel.healWire(cap, wireCombTol))
}

/**
 * ③：全部面（4z 张齿面 + 顶/底两个端盖）。
 *
 * 复刻 `_build_gear_faces`：每张齿面绕 Z 转 tau·i，然后按 `edges('<Z')`（z 最小 = tc_h）
 * 与 `edges('>Z')`（z 最大 = pc_h）组线成端盖。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 锥齿轮几何量
 * @param strategy 齿面建面策略
 * @param options 容差/次数选项
 * @returns 全部面（含两端盖）
 */
export function buildBevelGearFaces(
  kernel: GearKernel,
  geom: BevelGearGeometry,
  strategy: SplineFaceStrategy,
  options: BuildBevelGearOptions = {},
): BrepHandle[] {
  const f = faceFrames(geom)
  const tFaces = buildBevelToothFaces(kernel, geom, strategy, options)

  const axisZ = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
  const faces: BrepHandle[] = []
  for (let i = 0; i < geom.z; i++) {
    const angle = geom.tau * i
    for (const tf of tFaces) {
      faces.push(i === 0 ? tf : kernel.rotate(tf, axisZ, angle))
    }
  }
  faces.push(capBevelAtZ(kernel, faces, f.tcH, options.wireCombTol))
  faces.push(capBevelAtZ(kernel, faces, f.pcH, options.wireCombTol))
  return faces
}

/** XZ 平面轮廓（世界坐标 (u, 0, v)）→ wire → face → 绕 Z 回转 360° 的旋转体。 */
function revolveProfile(
  kernel: GearKernel, pts: BrepVec3[], arcMid: number,
): BrepHandle {
  // pts = [起点, 弧中点, 弧终点, 拐点1, 拐点2]，最后自动闭合回起点。
  const edges: BrepHandle[] = [
    kernel.makeArcEdge(pts[0], pts[arcMid], pts[2]),
    kernel.makeLineEdge(pts[2], pts[3]),
    kernel.makeLineEdge(pts[3], pts[4]),
    kernel.makeLineEdge(pts[4], pts[0]),
  ]
  const face = kernel.makeFace(kernel.makeWire(edges))
  return kernel.revolve(
    face, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, Math.PI * 2,
  )
}

/**
 * 复刻 `BevelGear._trim_bottom`：半径 gs_r 上的三点圆弧轮廓绕 Z 回转成 cutter，
 * 再从实体上布尔差。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 锥齿轮几何量
 * @returns cutter（旋转体）
 */
export function makeTrimBottomCutter(
  kernel: GearKernel, geom: BevelGearGeometry,
): BrepHandle {
  const r = geom.gsR
  const p1 = sphereToCartesian(r, geom.gammaR * 0.99, Math.PI / 2)
  const p2 = sphereToCartesian(r, geom.gammaP, Math.PI / 2)
  const p3 = sphereToCartesian(r, geom.gammaF * 1.01, Math.PI / 2)
  const x1 = Math.tan(geom.gammaF) * geom.coneH + 1.0
  const uv = (p: Vec3): BrepVec3 => ({ x: p.x, y: 0, z: p.z })
  return revolveProfile(kernel, [
    uv(p1), uv(p2), uv(p3),
    { x: x1, y: 0, z: p3.z },
    { x: x1, y: 0, z: p1.z },
  ], 1)
}

/**
 * 复刻 `BevelGear._trim_top`：半径 gs_r − face_width 上的圆弧轮廓（内边界落在轴上）
 * 绕 Z 回转成 cutter，再从实体上布尔差。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 锥齿轮几何量
 * @returns cutter（旋转体）
 */
export function makeTrimTopCutter(
  kernel: GearKernel, geom: BevelGearGeometry,
): BrepHandle {
  const r = geom.gsR - geom.faceWidth
  const p1 = sphereToCartesian(r, geom.gammaR, Math.PI / 2)
  const p2 = sphereToCartesian(r, geom.gammaP, Math.PI / 2)
  const p3 = sphereToCartesian(r, geom.gammaF * 1.01, Math.PI / 2)
  const uv = (p: Vec3): BrepVec3 => ({ x: p.x, y: 0, z: p.z })
  return revolveProfile(kernel, [
    uv(p1), uv(p2), uv(p3),
    { x: 0, y: 0, z: p3.z },
    { x: 0, y: 0, z: p1.z },
  ], 1)
}

/**
 * 内核布尔差有时返回「仅含 1 个 solid 的 compound」外壳，
 * 解包成 solid（与 `features.ts::asSolid` 同思路）。
 */
function asSolid(kernel: GearKernel, shape: BrepHandle): BrepHandle {
  if (kernel.isSolid(shape)) return shape
  if (kernel.getShapeType(shape) === 'compound') {
    const solids = kernel.getSubShapes(shape, 'solid')
    if (solids.length === 1) return solids[0]
  }
  return shape
}

/**
 * ①–⑦：完整 BevelGear 实体。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 锥齿轮参数（逐字沿用 Python 构造参数名）
 * @param build 构造选项（策略/容差/裁切/轴孔）
 * @returns 朝向归一化（齿轮轴 = +Z、底面 z = 0）后的 solid
 */
export function buildBevelGearSolid(
  kernel: GearKernel,
  params: BevelGearParams,
  build: BuildBevelGearOptions = {},
): BrepHandle {
  const geom = bevelGearGeometry(params)
  const strategy = build.strategy ?? DEFAULT_SPLINE_FACE_STRATEGY
  const faces = buildBevelGearFaces(kernel, geom, strategy, build)

  // cq `make_shell(faces)`（BRepBuilderAPI_Sewing，tol = shell_sewing_tol）+ `Solid.makeSolid`
  const shell = kernel.sew(faces, build.shellSewingTol ?? GEAR_BASE_CONSTANTS.shell_sewing_tol)
  const solid = kernel.makeSolid(shell)
  let body = kernel.fixFaceOrientations(solid)
  if (!kernel.isSolid(body)) {
    throw new Error(
      `buildBevelGearSolid: result is not a solid (got ${String(kernel.getShapeType(body))})`,
    )
  }

  // ⑤ 裁底 / 裁顶（cq 顺序：先 bottom 后 top）
  if (build.trimBottom !== false) {
    body = asSolid(kernel, kernel.cut(body, makeTrimBottomCutter(kernel, geom)))
  }
  if (build.trimTop !== false) {
    body = asSolid(kernel, kernel.cut(body, makeTrimTopCutter(kernel, geom)))
  }
  if (!kernel.isSolid(body)) {
    throw new Error('buildBevelGearSolid: result is not a solid after trims')
  }

  // ⑥ 把齿轮摆正：绕 X 转 180° → 沿 Z 平移 cone_h → 绕 Z 转 t_align_angle
  const tAlignAngle = -geom.mpTheta / 2.0 - Math.PI / 2.0 + Math.PI / geom.z
  body = kernel.rotate(
    body, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, Math.PI,
  )
  body = kernel.translate(body, 0, 0, geom.coneH)
  body = kernel.rotate(
    body, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, tAlignAngle,
  )

  // ⑦ 轴孔：`faces('<Z').workplane().circle(bore_d/2).cutThruAll()`。
  // 缺省 centerOption='ProjectedOrigin' ⇒ 圆的圆心落在齿轮轴上（x=y=0），故等价于
  // 「沿 Z 轴、从实体 zmin 下方贯穿到 zmax 上方」的圆柱差。
  if (build.boreD !== undefined) {
    const bb = kernel.getBoundingBox(body)
    const height = (bb.zmax - bb.zmin) + 2 * BORE_E
    const cyl = kernel.makeCylinder(build.boreD / 2, height)
    body = asSolid(kernel, kernel.cut(body, kernel.translate(cyl, 0, 0, bb.zmin - BORE_E)))
    if (!kernel.isSolid(body)) {
      throw new Error('buildBevelGearSolid: result is not a solid after bore')
    }
  }
  return body
}
