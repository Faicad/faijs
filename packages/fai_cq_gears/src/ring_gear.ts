/**
 * ring_gear — RingGear（内部齿）实体构造
 *
 * 对应 `RingGear._build_gear_faces()` + `_build_rim_face()` + `_build()`：
 *
 * ```
 * ① 4z 个齿面（复用 SpurGear 的 `buildToothFaces`，因为点集布局一致）
 * ② 外圈 rim：两圈圆环 wire（z=0 / z=width）经 `loft(ruled=true)` 蒙成圆柱面
 * ③ 顶/底面：在 z=width / z=0 收齿面边界边 → 组线成内孔 wire，
 *    再用 `Face.makeFromWires(rimWire, [toothWire])` 做成**环形**盖面（外圆 rim_r、内孔齿廓）
 * ④ sew(齿面 + rim + 2 盖面) → makeSolid → fixFaceOrientations
 * ```
 *
 * 与 SpurGear 的关键差异：端面是**环形**（外 rim 圆 + 内齿廓孔），不是实心圆盘；
 * 多了外圈 rim 圆柱面。倒角（chamfer）属于 `_make_chamfer`，需要布尔差，
 * 暂未实现（occt-wasm 对 B-spline 实体布尔差是已知限制，见 cq-compat E 类 blocked），
 * 故本构建产出的是**非倒角**实体，体积对照 Python `build(chamfer=None)`。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel } from './kernel'
import { ringGearGeometry, GEAR_BASE_CONSTANTS, type RingGearParams } from './profile'
import {
  DEFAULT_SPLINE_FACE_STRATEGY,
  soleFace, type SplineFaceOptions, type SplineFaceStrategy,
} from './spline-face'
import { buildToothFaces, buildHerringboneToothFaces } from './spur_gear'
import { connectEdgesToWires, faceFromWires } from './geom-build'

/** 判定「边是否落在某个 z 平面上」的容差（远小于 wire_comb_tol）。 */
const PLANAR_PICK_TOL = 1e-6

/** RingGear 实体构造选项（在 `SplineFaceOptions` 上加容差与策略覆盖）。 */
export interface BuildRingGearOptions extends SplineFaceOptions {
  strategy?: SplineFaceStrategy
  /** 缝合容差（cq `shell_sewing_tol`）。 */
  shellSewingTol?: number
  /** 组线容差（cq `wire_comb_tol`）。 */
  wireCombTol?: number
  /** 人字齿：齿面沿宽度方向拆成上下两半、各以相反螺旋扭转（V 形）。 */
  herringbone?: boolean
}

/**
 * 一个半径 `radius`、圆心在 `(0,0,z)`、法向 +Z 的整圆 wire。
 *
 * @param kernel 原始 OCCT 内核
 * @param radius 圆半径
 * @param z 圆所在高度
 * @returns 闭合圆 wire
 */
function circleWire(kernel: RawOcctKernel, radius: number, z: number): BrepHandle {
  const arc = kernel.makeCircleArc({ x: 0, y: 0, z }, { x: 0, y: 0, z: 1 }, radius, 0, Math.PI * 2)
  return kernel.makeWire([arc])
}

/**
 * 外圈 rim 圆柱面（cq `Face.makeRuledSurface(w1, w2)` 的等价物）。
 *
 * @param kernel 原始 OCCT 内核
 * @param rimR 外圈半径（`rd + rim_width`）
 * @param width 齿宽
 * @returns 圆柱侧面（Face）
 */
function buildRimFace(kernel: RawOcctKernel, rimR: number, width: number): BrepHandle {
  const w0 = circleWire(kernel, rimR, 0)
  const w1 = circleWire(kernel, rimR, width)
  // `loft(wires, isSolid=false, ruled=true)` 在两圈之间蒙出 ruled 圆柱面
  return soleFace(kernel, kernel.loft([w0, w1], false, true))
}

/**
 * 在高度 `z` 收齿面边界边 → 组线成内孔 wire，与外圈 rim 圆合成**环形**盖面。
 *
 * @param kernel 原始 OCCT 内核
 * @param toothFaces 全部齿面（含 z 向厚度）
 * @param rimR 外圈半径
 * @param z 目标平面高度
 * @param wireCombTol 组线容差（mm）
 * @returns 环形盖面（外 rim 圆、内齿廓孔）
 */
function ringCapAtZ(
  kernel: RawOcctKernel,
  toothFaces: BrepHandle[],
  rimR: number,
  z: number,
  wireCombTol: number | undefined,
): BrepHandle {
  const edges: BrepHandle[] = []
  for (const f of toothFaces) {
    for (const e of kernel.getSubShapes(f, 'edge')) {
      const bb = kernel.getBoundingBox(e)
      if (Math.abs(bb.zmin - z) <= PLANAR_PICK_TOL && Math.abs(bb.zmax - z) <= PLANAR_PICK_TOL) {
        edges.push(e)
      }
    }
  }
  if (edges.length === 0) {
    throw new Error(`ringCapAtZ: no tooth boundary edges found at z=${z}`)
  }
  const toothWires = connectEdgesToWires(kernel, edges, wireCombTol ?? GEAR_BASE_CONSTANTS.wire_comb_tol)
  if (toothWires.length !== 1) {
    throw new Error(
      `ringCapAtZ: expected one closed tooth-profile loop at z=${z}, got ${toothWires.length} wires from ${edges.length} edges`,
    )
  }
  const rimWire = circleWire(kernel, rimR, z)
  return faceFromWires(kernel, rimWire, [toothWires[0]])
}

/** ①–④：完整 RingGear 实体（内部齿，非倒角）。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 齿轮参数
 * @param build 构造选项（策略/容差覆盖）
 * @returns 朝向归一化后的 solid
 */
export function buildRingGearSolid(
  kernel: RawOcctKernel,
  params: RingGearParams,
  build: BuildRingGearOptions = {},
): BrepHandle {
  const strategy = build.strategy ?? DEFAULT_SPLINE_FACE_STRATEGY
  const geom = ringGearGeometry(params)
  const toothFaces = build.herringbone
    ? buildHerringboneToothFaces(kernel, geom, strategy, build)
    : buildToothFaces(kernel, geom, strategy, build)

  const rimR = geom.rd + params.rim_width
  const rimFace = buildRimFace(kernel, rimR, geom.width)
  const top = ringCapAtZ(kernel, toothFaces, rimR, geom.width, build.wireCombTol)
  const bottom = ringCapAtZ(kernel, toothFaces, rimR, 0, build.wireCombTol)

  const all = [...toothFaces, rimFace, top, bottom]

  const shell = kernel.sew(all, build.shellSewingTol ?? GEAR_BASE_CONSTANTS.shell_sewing_tol)
  const solid = kernel.makeSolid(shell)
  const oriented = kernel.fixFaceOrientations(solid)
  if (!kernel.isSolid(oriented)) {
    throw new Error(
      `buildRingGearSolid: result is not a solid (got ${String(kernel.getShapeType(oriented))})`,
    )
  }
  return oriented
}

/** ①–④：完整 HerringboneRingGear 实体（人字内齿，裸齿轮）。
 *
 * 齿廓数学与 RingGear 同构（`gearGeometryForClass` 已分派到 `ringGearGeometry`），
 * 差异只在建面阶段：齿面拆成上下两半、反向螺旋形成 V 形（复用
 * `buildHerringboneToothFaces`）；rim 圆柱面与环形盖面与 RingGear 一致。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 内齿参数（逐字沿用 Python 构造参数名）
 * @param build 构造选项（策略/容差覆盖）
 * @returns 朝向归一化后的 solid
 */
export function buildHerringboneRingGearSolid(
  kernel: RawOcctKernel,
  params: RingGearParams,
  build: BuildRingGearOptions = {},
): BrepHandle {
  return buildRingGearSolid(kernel, params, { ...build, herringbone: true })
}
