/**
 * pairs — 齿轮对（装配体）构造
 *
 * 对应 cq_gears `bevel_gear.py::BevelGearPair`：把两个单体锥齿轮按轴交角装配成一个
 * Compound（`asm.toCompound()`），本包返回**两件各自的 solid**，由调用方决定导出方式
 * （`exportStepFromSolids` 把它们各写成一个 XCAF 条目/产品）。
 *
 * ## 装配定位链（2026-09-12 在 cadquery-env 实测确定，非推断）
 *
 * Python 侧：
 *
 * ```python
 * loc = cq.Location()
 * loc *= cq.Location(cq.Vector(0, 0, gear.cone_h), cq.Vector(0, 1, 0), degrees(axis_angle))
 * loc *= cq.Location(cq.Vector(0, 0, -pinion.cone_h))
 * if pinion.z % 2 == 0:
 *     loc *= cq.Location(cq.Vector(0, 0, 0), cq.Vector(0, 0, 1), degrees(pi / pinion.z))
 * ```
 *
 * 两条实测结论（`out/probe-loc.py`，输出见当日日志）：
 *
 * 1. `LocA * LocB` 的复合是**右到左**——先应用 B，再应用 A
 *    （实测 `(r*t)·(1,0,0) = (0,11,0)`：先平移 +10x 再绕 Z 转 90°，而非反过来）。
 *    故 `loc = A*B*C` 的施加顺序是 **C → B → A**。
 * 2. `Location(t, ax, angle)` 的 `t` 是**平移分量**，旋转轴恒是**过原点**的
 *    `gp_Ax1(Vector(0,0,0), ax)`——不是「绕 t 点旋转」。
 *    实测 `Location((0,0,5), Y, 90)` 作用在 `(1,0,0)` 上得 `(0,0,4)`
 *    =「先绕原点 Y 转 90° 得 (0,0,-1)，再平移 +5z」，且 `toTuple()` 为 `((0,0,5),(0,90,0))`。
 *
 * 所以 pinion 的最终位姿是，按施加顺序：
 *
 * | 步 | 对应 Python | 本文件实现 |
 * |---|---|---|
 * | C | `Location((0,0,0), Z, degrees(pi/z))`，**仅 pinion 齿数为偶** | 绕 Z 转过原点转 `π/z` |
 * | B | `Location((0,0,-pinion.cone_h))` | 沿 Z 平移 `-pinionConeH` |
 * | A | `Location((0,0,gear.cone_h), Y, degrees(axis_angle))` | 绕 Y 转过原点转 `axisAngle`，再沿 Z 平移 `+gearConeH` |
 *
 * gear 不加任何定位（Python 用 `cq.Location()` 恒等）。
 *
 * ## 与 Python 的两处差异（照抄，不改）
 *
 * - **pinion 不传 `clearance`**：Python 侧 `BevelGearPair.__init__` 给 gear 传了
 *   `clearance`、给 pinion 只传了 `backlash`（`clearance` 落回默认 0.0）。
 *   本实现逐字保持这个不对称。
 * - **pinion 的螺旋角取负**：`-helix_angle`（一对锥齿轮的旋向相反）。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel, RawAxis } from './kernel'
import { bevelGearGeometry, type BevelGearGeometry, type BevelGearParams } from './profile'
import { buildBevelGearSolid, type BuildBevelGearOptions } from './bevel_gear'
import type { SplineFaceStrategy } from './spline-face'

/** 锥齿轮副参数（逐字沿用 Python `BevelGearPair.__init__` 的构造参数名）。 */
export interface BevelGearPairParams {
  module: number
  /** 大轮齿数（cq `gear_teeth`）。 */
  gear_teeth: number
  /** 小轮齿数（cq `pinion_teeth`）。 */
  pinion_teeth: number
  face_width: number
  /** 轴交角（度，cq `axis_angle`，默认 90）。 */
  axis_angle?: number
  pressure_angle?: number
  helix_angle?: number
  clearance?: number
  backlash?: number
}

/** 齿轮对构造选项。 */
export interface BuildBevelGearPairOptions {
  /** 齿面建面策略（两件共用）。 */
  strategy?: SplineFaceStrategy
  /** 轴孔直径（两件共用，cq `bore_d`）。 */
  boreD?: number
  /** 是否裁底（两件共用）。 */
  trimBottom?: boolean
  /** 是否裁顶（两件共用）。 */
  trimTop?: boolean
  /** 是否对 pinion 施加装配定位（cq `transform_pinion`，默认 true）。 */
  transformPinion?: boolean
  /** 是否构建大轮（cq `build_gear`，默认 true）。 */
  buildGear?: boolean
  /** 是否构建小轮（cq `build_pinion`，默认 true）。 */
  buildPinion?: boolean
}

const Z_AXIS: RawAxis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
const Y_AXIS: RawAxis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }

/** pinion 定位链的输入量（拆出来便于单测直接验证定位本身）。 */
export interface PinionPlacement {
  /** 轴交角（度）。 */
  axisAngleDeg: number
  /** 大轮锥顶到底面的距离 `BevelGear.cone_h`。 */
  gearConeH: number
  /** 小轮锥顶到底面的距离 `BevelGear.cone_h`。 */
  pinionConeH: number
  /** 小轮齿数（决定是否施加绕 Z 的 π/z 对齿旋转）。 */
  pinionTeeth: number
}

/** 一对锥齿轮的构建结果。 */
export interface BevelGearPairBuild {
  /** 大轮 solid（未加定位）。 */
  gear?: BrepHandle
  /** 小轮 solid（**已加**定位，除非 `transformPinion: false`）。 */
  pinion?: BrepHandle
  /** 大轮几何量（含 `coneH`）。 */
  gearGeometry: BevelGearGeometry
  /** 小轮几何量（含 `coneH`）。 */
  pinionGeometry: BevelGearGeometry
  /** 实际使用的轴交角（度）。 */
  axisAngleDeg: number
}

/**
 * 齿轮对的导出条目（名字 + solid），供 `exportStepFromSolids` 一件一个产品。
 *
 * ⚠️ 不带颜色：cq 侧的装配色（`BevelGearPair.asm_gear_color = 'goldenrod'` /
 * `asm_pinion_color = 'lightsteelblue'`）在 `assemble()` 里赋给 `cq.Assembly`，
 * 而 `_build()` 返回的是 `asm.toCompound()`——**颜色在这一步就被丢掉了**。
 * 实测参考 STEP（`out/ref-pairs/bp-basic.step`）里 `MANIFOLD_SOLID_BREP` 计数为 2、
 * `COLOUR_RGB` 计数为 **0**。故 B 侧同样不着色，两侧才逐项可比。
 *
 * @param build `buildBevelGearPair` 的结果
 * @returns 按 gear → pinion 顺序排列的条目（缺件则跳过）
 */
export function bevelPairExportParts(
  build: BevelGearPairBuild,
): Array<{ name: string; solid: BrepHandle }> {
  const parts: Array<{ name: string; solid: BrepHandle }> = []
  if (build.gear) parts.push({ name: 'gear', solid: build.gear })
  if (build.pinion) parts.push({ name: 'pinion', solid: build.pinion })
  return parts
}


/**
 * 复刻 `BevelGearPair.__init__` 的分锥角分配。
 *
 * `delta_gear = atan(sin(A) / (pinion_teeth/gear_teeth + cos(A)))`、
 * `delta_pinion = atan(sin(A) / (gear_teeth/pinion_teeth + cos(A)))`。
 *
 * @param params 齿轮副参数
 * @returns 大轮 / 小轮的分度锥角（度）
 */
export function bevelPairConeAngles(params: BevelGearPairParams): { gearDeg: number; pinionDeg: number } {
  const axis = ((params.axis_angle ?? 90.0) * Math.PI) / 180.0
  const sinA = Math.sin(axis)
  const cosA = Math.cos(axis)
  const ratio = params.pinion_teeth / params.gear_teeth
  return {
    gearDeg: (Math.atan(sinA / (ratio + cosA)) * 180.0) / Math.PI,
    pinionDeg: (Math.atan(sinA / (1.0 / ratio + cosA)) * 180.0) / Math.PI,
  }
}

/**
 * 把小轮摆到与大轮啮合的位姿（复刻 Python 的三步 `loc *=`，见文件头表格）。
 *
 * 施加顺序 **C → B → A**，对应内核操作的调用顺序：
 * 先绕 Z 转（仅齿数为偶）、再沿 Z 平移 `-pinionConeH`、
 * 再绕 Y 转过原点转 `axisAngle`、最后沿 Z 平移 `+gearConeH`。
 *
 * @param kernel 原始 OCCT 内核
 * @param pinion 小轮 solid
 * @param place 定位链输入量
 * @returns 定位后的小轮 solid
 */
export function placePinion(
  kernel: RawOcctKernel, pinion: BrepHandle, place: PinionPlacement,
): BrepHandle {
  let s = pinion
  if (place.pinionTeeth % 2 === 0) {
    // C：`degrees(pi/z)` 传进 `Location` 后被 radians() 转回，净效果 = π/z 弧度。
    s = kernel.rotate(s, Z_AXIS, Math.PI / place.pinionTeeth)
  }
  // B
  s = kernel.translate(s, 0, 0, -place.pinionConeH)
  // A：绕 Y（过原点）转轴交角，再沿 Z 平移 gear.cone_h
  s = kernel.rotate(s, Y_AXIS, (place.axisAngleDeg * Math.PI) / 180.0)
  return kernel.translate(s, 0, 0, place.gearConeH)
}

/**
 * 构建一对锥齿轮（`BevelGearPair`）。
 *
 * 两件都走 `buildBevelGearSolid`；差异只在参数：pinion 拿 `-helix_angle`，
 * 且**不传** `clearance`（逐字复刻 Python 的不对称传参）。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 齿轮副参数
 * @param options 构造选项
 * @returns 两件 solid（pinion 默认已定位）与两件几何量
 */
export function buildBevelGearPair(
  kernel: RawOcctKernel,
  params: BevelGearPairParams,
  options: BuildBevelGearPairOptions = {},
): BevelGearPairBuild {
  const axisAngleDeg = params.axis_angle ?? 90.0
  const { gearDeg, pinionDeg } = bevelPairConeAngles(params)

  const common: BuildBevelGearOptions = {}
  if (options.strategy !== undefined) common.strategy = options.strategy
  if (options.boreD !== undefined) common.boreD = options.boreD
  if (options.trimBottom !== undefined) common.trimBottom = options.trimBottom
  if (options.trimTop !== undefined) common.trimTop = options.trimTop

  const gearParams: BevelGearParams = {
    module: params.module,
    teeth_number: params.gear_teeth,
    cone_angle: gearDeg,
    face_width: params.face_width,
  }
  if (params.pressure_angle !== undefined) gearParams.pressure_angle = params.pressure_angle
  if (params.helix_angle !== undefined) gearParams.helix_angle = params.helix_angle
  if (params.clearance !== undefined) gearParams.clearance = params.clearance
  if (params.backlash !== undefined) gearParams.backlash = params.backlash

  const pinionParams: BevelGearParams = {
    module: params.module,
    teeth_number: params.pinion_teeth,
    cone_angle: pinionDeg,
    face_width: params.face_width,
  }
  if (params.pressure_angle !== undefined) pinionParams.pressure_angle = params.pressure_angle
  // 旋向相反；`clearance` 故意不传（Python 同样没传）。
  pinionParams.helix_angle = -(params.helix_angle ?? 0.0)
  if (params.backlash !== undefined) pinionParams.backlash = params.backlash

  const gearGeometry = bevelGearGeometry(gearParams)
  const pinionGeometry = bevelGearGeometry(pinionParams)

  const out: BevelGearPairBuild = { gearGeometry, pinionGeometry, axisAngleDeg }

  if (options.buildGear !== false) {
    out.gear = buildBevelGearSolid(kernel, gearParams, common)
  }
  if (options.buildPinion !== false) {
    let pinion = buildBevelGearSolid(kernel, pinionParams, common)
    if (options.transformPinion !== false) {
      pinion = placePinion(kernel, pinion, {
        axisAngleDeg,
        gearConeH: gearGeometry.coneH,
        pinionConeH: pinionGeometry.coneH,
        pinionTeeth: params.pinion_teeth,
      })
    }
    out.pinion = pinion
  }
  return out
}
