/**
 * crossed_pair — 交错轴齿轮对（CrossedGearPair / HyperbolicGearPair）
 *
 * 对应 `crossed_helical_gear.py`：两个单体齿轮按轴交角装配成一个 Compound。
 * 两件都各自用现成的实体构造（`buildCrossedHelicalSolid` / `buildHyperbolicGearSolid`），
 * 差异只在**装配定位链**与**螺旋角分配**：
 *
 * ## 螺旋角分配（CrossedGearPair）
 *
 * `gear1_helix_angle is None` 时两齿轮各取 `shaft_angle/2`；否则
 * `g1 = gear1_helix_angle`、`g2 = shaft_angle − gear1_helix_angle`。
 *
 * ## gear2 定位链（两种对类完全一致，仅 X 向偏移不同）
 *
 * Python（右到左复合 `loc = A; loc *= B; loc *= C; loc *= D` ⇒ 施加顺序 D→C→B→A）：
 *
 * ```python
 * loc = cq.Location(Vector(r0_1 + r0_2, 0, w1/2))          # A 平移
 * loc *= cq.Location(Vector(0,0,0), X, shaft_angle)        # B 绕原点 X 转
 * loc *= cq.Location(Vector(0,0,-w2/2))                     # C 平移
 * loc *= cq.Location(Vector(0,0,0), Z, align_angle)        # D 绕原点 Z 转
 * ```
 *
 * `align_angle = (0 if gear2.z%2 else 180/gear2.z) + degrees(gear2.twist + gear1.twist*ratio)/2`，
 * `ratio = gear1.z / gear2.z`。
 *
 * ## X 向偏移差异
 * - CrossedGearPair：用两齿轮分度半径之和 `r0_1 + r0_2`；
 * - HyperbolicGearPair：用两齿轮**喉部半径**之和 `throat_r1 + throat_r2`。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel, RawAxis } from './kernel'
import {
  crossedHelicalGearGeometry, hyperbolicGearGeometry,
  type CrossedHelicalGearParams, type HyperbolicGearParams, type HyperbolicGearGeometry,
} from './profile'
import { buildCrossedHelicalSolid } from './crossed_helical_gear'
import { buildHyperbolicGearSolid, type BuildSpurGearOptions } from './spur_gear'

const Z_AXIS: RawAxis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
const X_AXIS: RawAxis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

/** 装配定位链的输入量（拆出来便于单测直接验证定位本身）。 */
export interface SecondGearPlacement {
  /** gear2 绕 Z 的对齿/对齐角（弧度）。 */
  alignAngleRad: number
  /** 轴交角（弧度）。 */
  shaftAngleRad: number
  /** X 向平移量（Crossed 用 r0 和、Hyperbolic 用 throat_r 和）。 */
  offsetX: number
  /** gear1 宽度（Z 向平移分量）。 */
  gear1Width: number
  /** gear2 宽度（Z 向平移分量）。 */
  gear2Width: number
}

/**
 * 把第二齿轮摆到与第一齿轮啮合的位姿（复刻 Python 的四步 `loc *=`）。
 *
 * 施加顺序 **D → C → B → A**：先绕原点 Z 转 `alignAngle`，再沿 Z 平移 `-w2/2`，
 * 再绕原点 X 转 `shaftAngle`，最后沿 X 平移 `offsetX`、沿 Z 平移 `w1/2`。
 *
 * @param kernel 原始 OCCT 内核
 * @param g2 第二齿轮 solid
 * @param place 定位链输入量
 * @returns 定位后的第二齿轮 solid
 */
export function placeSecondGear(
  kernel: RawOcctKernel, g2: BrepHandle, place: SecondGearPlacement,
): BrepHandle {
  let s = g2
  s = kernel.rotate(s, Z_AXIS, place.alignAngleRad) // D
  s = kernel.translate(s, 0, 0, -place.gear2Width / 2) // C
  s = kernel.rotate(s, X_AXIS, place.shaftAngleRad) // B
  return kernel.translate(s, place.offsetX, 0, place.gear1Width / 2) // A
}

/**
 * 复刻 Python 的 `align_angle` 公式。
 *
 * `align_angle = (0 if gear2.z%2 else 180/gear2.z) + degrees(gear2.twist + gear1.twist*ratio)/2`，
 * `ratio = gear1.z / gear2.z`。两个 twist 都用**弧度**（来自几何量）。
 *
 * @param gear1Z 第一齿轮齿数
 * @param gear1TwistRad 第一齿轮扭转角（弧度）
 * @param gear2Z 第二齿轮齿数
 * @param gear2TwistRad 第二齿轮扭转角（弧度）
 * @returns 对齐角（弧度）
 */
export function crossedPairAlignAngle(
  gear1Z: number, gear1TwistRad: number, gear2Z: number, gear2TwistRad: number,
): number {
  const ratio = gear1Z / gear2Z
  // ⚠️ 分支方向与 cq 逐字一致：`align_angle = 0.0 if gear2.z % 2 else 180/gear2.z`。
  // 即 **gear2.z 为偶**时取 `180/gear2.z`（base 非零），**为奇**时取 0。
  // 2026-09-13 修正：此前把奇偶分支写反（偶→0、奇→180/z），导致 gear2 绕 Z 对齐角
  // 差半齿（如 z=20 时差 9°），gear2 被平移+旋转到错误位姿，compare-all 报
  // bool diff ≈ 整件体积（cgp-basic / hgp-basic 因此 DIFFERENT）。
  const alignDeg = (gear2Z % 2 === 0 ? 180 / gear2Z : 0)
    + (((gear2TwistRad * 180.0) / Math.PI) + ((gear1TwistRad * 180.0) / Math.PI) * ratio) / 2.0
  return (alignDeg * Math.PI) / 180.0
}

// ── CrossedGearPair ────────────────────────────────────────────────────────────

/** 交错轴斜齿轮对参数（逐字沿用 `CrossedGearPair.__init__`）。 */
export interface CrossedGearPairParams {
  module: number
  gear1_teeth_number: number
  gear2_teeth_number: number
  gear1_width: number
  gear2_width: number
  pressure_angle?: number
  shaft_angle?: number
  /** 第一齿轮螺旋角（度）；`null`/缺省 = 两齿轮各取 `shaft_angle/2`。 */
  gear1_helix_angle?: number | null
  clearance?: number
  backlash?: number
}

/** 齿轮对构造选项（扩展单体特征选项 + 装配开关）。 */
export interface BuildCrossedGearPairOptions extends BuildSpurGearOptions {
  /** 是否构建第一齿轮（默认 true）。 */
  buildGear1?: boolean
  /** 是否构建第二齿轮（默认 true）。 */
  buildGear2?: boolean
  /** 是否对 gear2 施加装配定位（默认 true）。 */
  transformGear2?: boolean
}

/** 交错轴斜齿轮对的构建结果。 */
export interface CrossedGearPairBuild {
  /** 第一齿轮 solid（未定位）。 */
  gear1?: BrepHandle
  /** 第二齿轮 solid（已定位）。 */
  gear2?: BrepHandle
  gear1Geometry: ReturnType<typeof crossedHelicalGearGeometry>
  gear2Geometry: ReturnType<typeof crossedHelicalGearGeometry>
  /** 轴交角（弧度）。 */
  shaftAngleRad: number
}

/**
 * 构建一对交错轴斜齿轮（`CrossedGearPair`）。
 *
 * 两件都走 `buildCrossedHelicalSolid`（用各自的 helix 角），差异只在参数：gear2 的
 * helix 由 `shaft_angle − gear1_helix` 决定；gear2 默认按轴交角定位到与第一齿轮啮合。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 齿轮对参数
 * @param options 构造选项
 * @returns 两件 solid（gear2 默认已定位）与两件几何量
 */
export function buildCrossedGearPair(
  kernel: RawOcctKernel,
  params: CrossedGearPairParams,
  options: BuildCrossedGearPairOptions = {},
): CrossedGearPairBuild {
  const shaftAngleDeg = params.shaft_angle ?? 90.0

  let g1Helix: number
  let g2Helix: number
  if (params.gear1_helix_angle == null) {
    g1Helix = shaftAngleDeg / 2.0
    g2Helix = shaftAngleDeg / 2.0
  } else {
    g1Helix = params.gear1_helix_angle
    g2Helix = shaftAngleDeg - params.gear1_helix_angle
  }

  const gear1Params: CrossedHelicalGearParams = {
    module: params.module,
    teeth_number: params.gear1_teeth_number,
    width: params.gear1_width,
    pressure_angle: params.pressure_angle,
    helix_angle: g1Helix,
    clearance: params.clearance,
    backlash: params.backlash,
  }
  const gear2Params: CrossedHelicalGearParams = {
    module: params.module,
    teeth_number: params.gear2_teeth_number,
    width: params.gear2_width,
    pressure_angle: params.pressure_angle,
    helix_angle: g2Helix,
    clearance: params.clearance,
    backlash: params.backlash,
  }

  const geom1 = crossedHelicalGearGeometry(gear1Params)
  const geom2 = crossedHelicalGearGeometry(gear2Params)
  const shaftAngleRad = (shaftAngleDeg * Math.PI) / 180.0
  const alignAngleRad = crossedPairAlignAngle(geom1.z, geom1.twistAngle, geom2.z, geom2.twistAngle)

  const out: CrossedGearPairBuild = { gear1Geometry: geom1, gear2Geometry: geom2, shaftAngleRad }
  if (options.buildGear1 !== false) {
    out.gear1 = buildCrossedHelicalSolid(kernel, gear1Params, options)
  }
  if (options.buildGear2 !== false) {
    let g2 = buildCrossedHelicalSolid(kernel, gear2Params, options)
    if (options.transformGear2 !== false) {
      g2 = placeSecondGear(kernel, g2, {
        alignAngleRad,
        shaftAngleRad,
        offsetX: geom1.r0 + geom2.r0,
        gear1Width: params.gear1_width,
        gear2Width: params.gear2_width,
      })
    }
    out.gear2 = g2
  }
  return out
}

/**
 * 一对交错轴斜齿轮的导出条目（gear1 → gear2）。
 *
 * @param build 交叉轴齿轮对构建结果（gear2 可能为空——只有 `shafts_connected` 时存在）
 * @returns 具名实体数组（名字进 STEP 产品名，供逐件等价比对）
 */
export function crossedPairExportParts(
  build: CrossedGearPairBuild,
): Array<{ name: string; solid: BrepHandle }> {
  const parts: Array<{ name: string; solid: BrepHandle }> = []
  if (build.gear1) parts.push({ name: 'gear1', solid: build.gear1 })
  if (build.gear2) parts.push({ name: 'gear2', solid: build.gear2 })
  return parts
}

// ── HyperbolicGearPair ──────────────────────────────────────────────────────────

/** 双曲面齿轮对参数（逐字沿用 `HyperbolicGearPair.__init__`）。 */
export interface HyperbolicGearPairParams {
  module: number
  gear1_teeth_number: number
  /** 齿宽（两齿轮共用，沿 X）。 */
  width: number
  /** 轴交角（度）。 */
  shaft_angle: number
  /** 第二齿轮齿数（缺省 = 第一齿轮齿数）。 */
  gear2_teeth_number?: number
  pressure_angle?: number
  clearance?: number
  backlash?: number
}

/** 双曲面齿轮对的构建结果。 */
export interface HyperbolicGearPairBuild {
  gear1?: BrepHandle
  gear2?: BrepHandle
  gear1Geometry: HyperbolicGearGeometry
  gear2Geometry: HyperbolicGearGeometry
  /** 轴交角（弧度）。 */
  shaftAngleRad: number
}

/**
 * 构建一对双曲面齿轮（`HyperbolicGearPair`）。
 *
 * 两齿轮的扭转角由轴交角 + 喉部几何反算
 * （`g_twist = 2·asin((w/2)·tan(shaft/2) / r0)`），再各自走 `buildHyperbolicGearSolid`；
 * gear2 用 **throat_r 和** 作 X 向偏移（与 CrossedGearPair 的 r0 和不同）。
 *
 * @throws 扭转角无法计算（NaN，齿数/轴交角/齿宽组合不合法）时抛 Error
 *
 * @param kernel 原始 OCCT 内核
 * @param params 齿轮对参数
 * @param options 构造选项
 * @returns 两件 solid（gear2 默认已定位）与两件几何量
 */
export function buildHyperbolicGearPair(
  kernel: RawOcctKernel,
  params: HyperbolicGearPairParams,
  options: BuildCrossedGearPairOptions = {},
): HyperbolicGearPairBuild {
  const shaftAngleDeg = params.shaft_angle
  const g2Teeth = params.gear2_teeth_number ?? params.gear1_teeth_number

  const g1R0 = (params.module * params.gear1_teeth_number) / 2.0
  const g2R0 = (params.module * g2Teeth) / 2.0
  const alpha = (shaftAngleDeg / 2.0) * (Math.PI / 180.0)
  const hh = (params.width / 2.0) * Math.tan(alpha)

  const g1Twist = 2.0 * Math.asin(hh / g1R0)
  const g2Twist = 2.0 * Math.asin(hh / g2R0)
  if (Number.isNaN(g1Twist) || Number.isNaN(g2Twist)) {
    throw new Error(
      'HyperbolicGearPair: impossible to calculate the twist angle for the '
      + 'given shaft angle / teeth number / gear width',
    )
  }

  const gear1Params: HyperbolicGearParams = {
    module: params.module,
    teeth_number: params.gear1_teeth_number,
    width: params.width,
    twist_angle: (g1Twist * 180.0) / Math.PI,
    pressure_angle: params.pressure_angle,
    clearance: params.clearance,
    backlash: params.backlash,
  }
  const gear2Params: HyperbolicGearParams = {
    module: params.module,
    teeth_number: g2Teeth,
    width: params.width,
    twist_angle: (g2Twist * 180.0) / Math.PI,
    pressure_angle: params.pressure_angle,
    clearance: params.clearance,
    backlash: params.backlash,
  }

  const geom1 = hyperbolicGearGeometry(gear1Params)
  const geom2 = hyperbolicGearGeometry(gear2Params)
  const shaftAngleRad = (shaftAngleDeg * Math.PI) / 180.0
  const alignAngleRad = crossedPairAlignAngle(geom1.z, geom1.twistAngle, geom2.z, geom2.twistAngle)

  const out: HyperbolicGearPairBuild = { gear1Geometry: geom1, gear2Geometry: geom2, shaftAngleRad }
  if (options.buildGear1 !== false) {
    out.gear1 = buildHyperbolicGearSolid(kernel, gear1Params, options)
  }
  if (options.buildGear2 !== false) {
    let g2 = buildHyperbolicGearSolid(kernel, gear2Params, options)
    if (options.transformGear2 !== false) {
      g2 = placeSecondGear(kernel, g2, {
        alignAngleRad,
        shaftAngleRad,
        offsetX: geom1.throatR + geom2.throatR,
        gear1Width: params.width,
        gear2Width: params.width,
      })
    }
    out.gear2 = g2
  }
  return out
}

/**
 * 一对双曲面齿轮的导出条目（gear1 → gear2）。
 *
 * @param build 双曲面齿轮对构建结果（gear2 可能为空——只有 `shafts_connected` 时存在）
 * @returns 具名实体数组（名字进 STEP 产品名，供逐件等价比对）
 */
export function hyperbolicPairExportParts(
  build: HyperbolicGearPairBuild,
): Array<{ name: string; solid: BrepHandle }> {
  const parts: Array<{ name: string; solid: BrepHandle }> = []
  if (build.gear1) parts.push({ name: 'gear1', solid: build.gear1 })
  if (build.gear2) parts.push({ name: 'gear2', solid: build.gear2 })
  return parts
}
