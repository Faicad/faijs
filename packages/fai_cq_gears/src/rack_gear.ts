/**
 * rack_gear — RackGear / HerringboneRackGear（齿条）实体构造
 *
 * 对应 `RackGear._build_gear_faces()` + `_build()`（`HerringboneRackGear` 只覆盖
 * `_build_tooth_faces`，其余全部继承）：
 *
 * ```
 * ① 齿面：4 段梯形直线廓形 × 2 行（z=0 / z=width，行间 x 平移 tx=tan(h)·width）
 *    → 2×2 点阵 → spline 面（Herringbone：上下两半正反螺旋，共 8 面/齿）
 * ② 沿 X 以 π·m 为步距复制齿（按螺旋方向多补 extra 个），端部用
 *    x=0 / x=length 两块大平面 `split` 裁剪（compound → 按 bbox 取碎片）
 * ③ 左/右侧面：收 x=0 / x=length 平面上的齿面边 + 3 条轮廓线 → 组线 → 平面
 * ④ 背面（y=ld−height 矩形）+ 顶/底盖面（收 z=width / z=0 的边组线成面）
 * ⑤ sew → makeSolid → fixFaceOrientations
 * ```
 *
 * 官方 `build()` 对齿条**无** bore/chamfer 特征（`_build` 只做 faces→shell→solid），
 * 所以回归体积直接对照 regression json 的 expected。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel } from './kernel'
import {
  GEAR_BASE_CONSTANTS, rackGearGeometry,
  type RackGearGeometry, type RackGearParams, type ToothGrid, type ToothSegment,
} from './profile'
import { buildSplineFace, DEFAULT_SPLINE_FACE_STRATEGY, type SplineFaceStrategy } from './spline-face'
import { connectEdgesToWires, edgeEnds, shellToSolid } from './geom-build'
import { vec3, type Vec3 } from './math'

/** 侧端裁剪平面比齿廓超出的余量（Python `cp_ext`）。 */
const CP_EXT = 10.0
/** 判定「边完全落在某坐标平面」的容差（远小于 wire_comb_tol）。 */
const PLANAR_PICK_TOL = 1e-6

/**
 * 顶/底盖面组线合并容差：cq `consolidateWires` 链接样条近似边时依赖
 * 样条容差量级的顶点合并（1e-2），不是拓扑容差 1e-6（probe-case26.py 实证）。
 */
const CAP_WIRE_MERGE_TOL = 1e-2

/** RackGear 实体构造选项。 */
export interface BuildRackGearOptions {
  strategy?: SplineFaceStrategy
  /** 缝合容差（cq `shell_sewing_tol`）。 */
  shellSewingTol?: number
  /** 组线容差（cq `wire_comb_tol`）。 */
  wireCombTol?: number
  /** HerringboneRackGear：齿宽上下两半正反螺旋。 */
  herringbone?: boolean
}

/**
 * 一个齿面段的 2×2 点阵：底行在 `z`（x 平移 `x`），顶行在 `z+w`（x 再平移
 * `tan(helix)·w`）。cq `_build_tooth_faces` 的 pts1/pts2 逐字对应。
 */
function rackFaceGrid(
  segPts: Vec3[], seg: ToothSegment, helixRad: number, x: number, z: number, w: number,
): ToothGrid {
  const tx = Math.tan(helixRad) * w
  return {
    segment: seg,
    rows: 2,
    cols: 2,
    points: [
      segPts.map((p) => vec3(p.x + x, p.y, z)),
      segPts.map((p) => vec3(p.x + x + tx, p.y, z + w)),
    ],
  }
}

/**
 * ① 基础齿面（单个齿位，未平移）：普通 4 面，Herringbone 上下两半共 8 面。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 齿条几何量
 * @param herringbone 是否人字齿（上下两半螺旋方向相反）
 * @param strategy 样条建面策略
 * @returns 基础齿面数组（4 或 8 个面）
 */
export function rackToothFaces(
  kernel: RawOcctKernel,
  geom: RackGearGeometry,
  herringbone: boolean,
  strategy: SplineFaceStrategy,
): BrepHandle[] {
  const segs: Array<[ToothSegment, Vec3[]]> = [
    ['lflank', geom.t_lflank_pts],
    ['tip', geom.t_tip_pts],
    ['rflank', geom.t_rflank_pts],
    ['root', geom.t_root_pts],
  ]
  const faces: BrepHandle[] = []
  const half = geom.width / 2
  if (herringbone) {
    const tx = Math.tan(geom.helixAngle) * half
    for (const [seg, pts] of segs) {
      // 下半：正向螺旋，z ∈ [0, width/2]
      faces.push(buildSplineFace(kernel, rackFaceGrid(pts, seg, geom.helixAngle, 0, 0, half), strategy))
      // 上半：反向螺旋，起点 x 平移 tx，z ∈ [width/2, width]
      faces.push(buildSplineFace(kernel, rackFaceGrid(pts, seg, -geom.helixAngle, tx, half, half), strategy))
    }
  } else {
    for (const [seg, pts] of segs) {
      faces.push(buildSplineFace(kernel, rackFaceGrid(pts, seg, geom.helixAngle, 0, 0, geom.width), strategy))
    }
  }
  return faces
}

/**
 * ② 单个齿位的齿面：基础齿面沿 X 平移 `π·m·i`，然后按 cq 顺序做左/右端裁剪。
 *
 * cq 的 split 语义（probe-rack.ts 已实测）：
 * - 工具平面与面相交 → compound，碎片按 bbox.xmax / xmin 取
 * - 不相交 → 原面单返回（cq 返回 face 本身），再按 bbox 判断丢弃
 *
 * @param kernel 原始 OCCT 内核
 * @param base 基础齿面数组（rackToothFaces 的产物）
 * @param dx 齿位沿 X 的平移量（π·m·i）
 * @param i 齿位序号（决定触发哪一侧裁剪分支）
 * @param geom 齿条几何量
 * @param extra 端部补齿数（Python `extra`）
 * @param cutL 左端裁剪平面（x=0）
 * @param cutR 右端裁剪平面（x=length）
 * @returns 保留的面；完全被裁掉时返回空数组
 */
export function toothAtPosition(
  kernel: RawOcctKernel,
  base: BrepHandle[],
  dx: number,
  i: number,
  geom: RackGearGeometry,
  extra: number,
  cutL: BrepHandle,
  cutR: BrepHandle,
): BrepHandle[] {
  const faces: BrepHandle[] = []
  for (const tf of base) {
    let face = kernel.translate(tf, dx, 0, 0)
    if (i <= extra + 1) {
      const cpd = kernel.split(face, [cutL])
      const frags = kernel.isFace(cpd) ? [cpd] : kernel.getSubShapes(cpd, 'face')
      if (frags.length > 1) {
        // compound：取 bbox.xmax 最大的碎片（cq max(key=get_xmax)）
        let best = frags[0]
        for (const f of frags) {
          if (kernel.getBoundingBox(f).xmax > kernel.getBoundingBox(best).xmax) best = f
        }
        face = best
      } else {
        face = frags[0]
        if (kernel.getBoundingBox(face).xmax < 0.0) continue
      }
    }
    if (i >= geom.z - extra - 1) {
      const cpd = kernel.split(face, [cutR])
      const frags = kernel.isFace(cpd) ? [cpd] : kernel.getSubShapes(cpd, 'face')
      if (frags.length > 1) {
        // compound：取 bbox.xmin 最小的碎片（cq min(key=get_xmin)）
        let best = frags[0]
        for (const f of frags) {
          if (kernel.getBoundingBox(f).xmin < kernel.getBoundingBox(best).xmin) best = f
        }
        face = best
      } else {
        face = frags[0]
        if (kernel.getBoundingBox(face).xmin > geom.length) continue
      }
    }
    faces.push(face)
  }
  return faces
}

/**
 * 大平面工具（cq `Face.makePlane(length, width, basePnt, dir)` 的等价物）。
 *
 * @param kernel 原始 OCCT 内核
 * @param length 平面在局部 u 方向的长度
 * @param width 平面在局部 v 方向的宽度
 * @param basePnt 平面中心点
 * @param dir 平面法向
 * @returns 矩形平面 Face
 */
export function cutPlane(
  kernel: RawOcctKernel,
  length: number, width: number,
  basePnt: Vec3, dir: Vec3,
): BrepHandle {
  // 面法向 dir，面内局部坐标：任取与 dir 垂直的两个轴
  const ref = Math.abs(dir.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0)
  let u = vec3(dir.y * ref.z - dir.z * ref.y, dir.z * ref.x - dir.x * ref.z, dir.x * ref.y - dir.y * ref.x)
  const un = Math.hypot(u.x, u.y, u.z)
  u = vec3(u.x / un, u.y / un, u.z / un)
  const v = vec3(
    dir.y * u.z - dir.z * u.y,
    dir.z * u.x - dir.x * u.z,
    dir.x * u.y - dir.y * u.x,
  )
  const h = length / 2
  const w = width / 2
  const p = (a: number, b: number): Vec3 => vec3(
    basePnt.x + u.x * a + v.x * b,
    basePnt.y + u.y * a + v.y * b,
    basePnt.z + u.z * a + v.z * b,
  )
  const es = [
    kernel.makeLineEdge(p(-h, -w), p(h, -w)),
    kernel.makeLineEdge(p(h, -w), p(h, w)),
    kernel.makeLineEdge(p(h, w), p(-h, w)),
    kernel.makeLineEdge(p(-h, w), p(-h, -w)),
  ]
  return kernel.makeFace(kernel.makeWire(es))
}

/**
 * 收集边集合里「边中心 X 为极值」的边（cq `edges('<X'/'>X')` 语义）。
 *
 * @param kernel 原始 OCCT 内核
 * @param faces 候选面集合
 * @param side 取最小（left）还是最大（right）
 * @returns 中心落在极值 ±容差内的边
 */
export function extremeXEdges(
  kernel: RawOcctKernel, faces: BrepHandle[], side: 'left' | 'right',
): BrepHandle[] {
  let extreme = side === 'left' ? Infinity : -Infinity
  const centers: Array<{ e: BrepHandle; cx: number }> = []
  for (const f of faces) {
    for (const e of kernel.getSubShapes(f, 'edge')) {
      const bb = kernel.getBoundingBox(e)
      const cx = (bb.xmin + bb.xmax) / 2
      centers.push({ e, cx })
      extreme = side === 'left' ? Math.min(extreme, cx) : Math.max(extreme, cx)
    }
  }
  // cq DirectionMinMaxSelector 的容差语义：中心在极值 ± tol 内都算选中
  return centers.filter((c) => Math.abs(c.cx - extreme) <= PLANAR_PICK_TOL).map((c) => c.e)
}

/**
 * ③ 端面（cq 左/右侧面）：裁剪后的齿面在端部截面上的边 + 3 条轮廓直线
 * （沿截面到背面 y=ld−height 的两条横线 + 背面竖线），组线成面。
 *
 * cq 的辅助线从 `vertices('<Z')` / `vertices('>Z')` 出发——即截面链上 **z 最小/
 * 最大的端点**（其 y 未必是链上 y 的极值，螺旋齿条下两者不同）。
 *
 * @param kernel 原始 OCCT 内核
 * @param toothFaces 裁剪后的齿面集合
 * @param side 左端（x=0）还是右端（x=length）
 * @param geom 齿条几何量
 * @param wireCombTol 组线容差
 * @returns 端面 Face
 */
export function endCapFace(
  kernel: RawOcctKernel,
  toothFaces: BrepHandle[],
  side: 'left' | 'right',
  geom: RackGearGeometry,
  wireCombTol: number,
): BrepHandle {
  const picked = extremeXEdges(kernel, toothFaces, side)
  if (picked.length === 0) {
    throw new Error(`endCapFace(${side}): no edges selected`)
  }
  // 截面链的 z 最小 / 最大端点（cq pt1 / pt2）
  let pt1: { y: number; z: number } | undefined
  let pt2: { y: number; z: number } | undefined
  for (const e of picked) {
    const ends = edgeEnds(kernel, e)
    for (const p of [ends.a, ends.b]) {
      if (!pt1 || p.z < pt1.z) pt1 = { y: p.y, z: p.z }
      if (!pt2 || p.z > pt2.z) pt2 = { y: p.y, z: p.z }
    }
  }
  const backY = geom.ld - geom.height
  const pt = (y: number, z: number): Vec3 => vec3(side === 'left' ? 0 : geom.length, y, z)
  const lines = [
    kernel.makeLineEdge(pt(pt1!.y, pt1!.z), pt(backY, pt1!.z)),
    kernel.makeLineEdge(pt(backY, pt1!.z), pt(backY, pt2!.z)),
    kernel.makeLineEdge(pt(backY, pt2!.z), pt(pt2!.y, pt2!.z)),
  ]
  const wires = connectEdgesToWires(kernel, [...picked, ...lines], wireCombTol)
  if (wires.length !== 1) {
    throw new Error(`endCapFace(${side}): expected 1 closed loop, got ${wires.length}`)
  }
  return kernel.makeFace(wires[0])
}

/**
 * ④ 背面：y = ld−height 平面上的 length×width 矩形（cq `.rect(length, width, centered=False)`）。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 齿条几何量
 * @returns 背面 Face
 */
export function backFace(kernel: RawOcctKernel, geom: RackGearGeometry): BrepHandle {
  const y = geom.ld - geom.height
  const p = (a: number, b: number): Vec3 => vec3(a, y, b)
  const es = [
    kernel.makeLineEdge(p(0, 0), p(geom.length, 0)),
    kernel.makeLineEdge(p(geom.length, 0), p(geom.length, geom.width)),
    kernel.makeLineEdge(p(geom.length, geom.width), p(0, geom.width)),
    kernel.makeLineEdge(p(0, geom.width), p(0, 0)),
  ]
  return kernel.makeFace(kernel.makeWire(es))
}

/**
 * ④ 顶/底盖面：收所有面在 z=const 平面上的边界边 → 组线（外轮廓 1 条，含齿谷
 * 波形与两侧背线）→ 平面。cq `.edges('>Z'/ '<Z').consolidateWires()` 后取第一条。
 *
 * @param kernel 原始 OCCT 内核
 * @param faces 候选面集合（齿面 + 端面 + 背面）
 * @param z 盖面所在高度（width 或 0）
 * @returns 盖面 Face（开环 wire 建面，与 cq 语义一致）
 */
export function planarCapAtZ(
  kernel: RawOcctKernel,
  faces: BrepHandle[],
  z: number,
): BrepHandle {
  const edges: BrepHandle[] = []
  for (const f of faces) {
    for (const e of kernel.getSubShapes(f, 'edge')) {
      const bb = kernel.getBoundingBox(e)
      if (Math.abs(bb.zmin - z) <= PLANAR_PICK_TOL && Math.abs(bb.zmax - z) <= PLANAR_PICK_TOL) {
        edges.push(e)
      }
    }
  }
  if (edges.length === 0) throw new Error(`planarCapAtZ: no edges at z=${z}`)
  // cq 的 consolidateWires 依赖样条近似边的顶点容差（≈spline tol 量级）链接边，
  // 且 makeFromWires 接受开环 wire（probe-case26.py 实测：cq 组出 1 条 closed=False
  // 的 wire 仍建面成功、体积精确）。故这里用样条容差量级合并、取第一条 wire、
  // 不强制闭合——与 cq 语义逐字对齐。
  const wires = connectEdgesToWires(kernel, edges, CAP_WIRE_MERGE_TOL)
  if (wires.length === 0) {
    throw new Error(`planarCapAtZ(z=${z}): no wires consolidated from ${edges.length} edges`)
  }
  return kernel.makeFace(wires[0])
}

/**
 * ①–⑤：完整 RackGear / HerringboneRackGear 实体。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 齿条参数（逐字沿用 Python 构造参数名）
 * @param build 构造选项（策略/容差覆盖）
 * @returns solid
 */
export function buildRackGearSolid(
  kernel: RawOcctKernel,
  params: RackGearParams,
  build: BuildRackGearOptions = {},
): BrepHandle {
  const strategy = build.strategy ?? DEFAULT_SPLINE_FACE_STRATEGY
  const geom = rackGearGeometry(params)
  const herringbone = build.herringbone ?? false
  const wireCombTol = build.wireCombTol ?? GEAR_BASE_CONSTANTS.wire_comb_tol
  const sewingTol = build.shellSewingTol ?? GEAR_BASE_CONSTANTS.shell_sewing_tol

  // ② 端部裁剪平面（x=0 左侧 / x=length 右侧，各外扩 cp_ext）
  const cutL = cutPlane(
    kernel, geom.toothHeight + CP_EXT, geom.width + CP_EXT,
    vec3(0, 0, geom.width / 2), vec3(-1, 0, 0),
  )
  const cutR = cutPlane(
    kernel, geom.toothHeight + CP_EXT, geom.width + CP_EXT,
    vec3(geom.length, 0, geom.width / 2), vec3(1, 0, 0),
  )

  // extra = int(abs(ceil(tan(h)·width / (π·m))))——abs 在 ceil **之外**（Python 逐字：
  // `int(abs(np.ceil(...)))`），负螺旋角时 ceil 为负、取 abs 后为正。
  const extra = Math.abs(Math.ceil(Math.tan(geom.helixAngle) * geom.width / (Math.PI * geom.m)))

  const base = rackToothFaces(kernel, geom, herringbone, strategy)
  const toothFaces: BrepHandle[] = []
  // tidx 按螺旋方向分三种（Python 逐字）：正螺旋左侧多补、负螺旋右侧多补、直齿不补
  const iLo = geom.helixAngle > 0 ? -extra : 0
  const iHi = geom.helixAngle > 0 ? geom.z : geom.z + extra
  for (let i = iLo; i <= iHi; i++) {
    toothFaces.push(...toothAtPosition(kernel, base, Math.PI * geom.m * i, i, geom, extra, cutL, cutR))
  }
  if (toothFaces.length === 0) {
    throw new Error('buildRackGearSolid: no tooth faces survived end trimming')
  }

  // ③ 端面 + ④ 背面 + 顶/底盖面
  const lsFace = endCapFace(kernel, toothFaces, 'left', geom, wireCombTol)
  const rsFace = endCapFace(kernel, toothFaces, 'right', geom, wireCombTol)
  const bkFace = backFace(kernel, geom)
  const all = [...toothFaces, lsFace, rsFace, bkFace]
  const tpFace = planarCapAtZ(kernel, all, geom.width)
  const btFace = planarCapAtZ(kernel, all, 0)

  // ⑤ 缝合 → 实体化 → 朝向归一化
  const solid = shellToSolid(kernel, [...all, tpFace, btFace], sewingTol)
  // fixFaceOrientations 在微开口 shell（cq 同样存在：rs 端面只到 zmax≈width−0.18，
  // 靠 sew 容差吸收）上会把 solid 拆回 shell（debug-rack-cap.ts 实测）。退化路径：
  // makeSolid 的产物直接按体积符号归一化朝向。
  let oriented = solid
  if (kernel.isSolid(solid)) {
    const fixed = kernel.fixFaceOrientations(solid)
    if (kernel.isSolid(fixed)) oriented = fixed
  }
  if (!kernel.isSolid(oriented)) {
    throw new Error(
      `buildRackGearSolid: result is not a solid (got ${String(kernel.getShapeType(oriented))})`,
    )
  }
  if (kernel.getVolume(oriented) < 0) {
    oriented = kernel.reverseShape(oriented)
  }
  return oriented
}
