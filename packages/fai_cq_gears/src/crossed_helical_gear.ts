/**
 * crossed_helical_gear — CrossedHelicalGear（交错轴斜齿轮）实体构造
 *
 * 对应 `crossed_helical_gear.py::CrossedHelicalGear`：它继承 `SpurGear`，
 * **实体构造（`_build_gear_faces`）逐字继承**——端面是实心圆盘（`makeFromWires(outer)`
 * 单 wire 成面），没有 RingGear 的 rim / 环形盖面。唯一差异在**齿廓公式**：
 * 端面模数 `mt = m/cos(helix)`、端面压力角 `at0`，见 `crossedHelicalGearGeometry`。
 *
 * 因此这里只需「用自己的公式算 geom，再交给共用的 `buildGearSolid`」。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel } from './kernel'
import {
  crossedHelicalGearGeometry, type CrossedHelicalGearParams,
} from './profile'
import { buildGearSolid, type BuildSpurGearOptions } from './spur_gear'

/**
 * CrossedHelicalGear 裸实体（无 bore / hub / recess / chamfer）。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 交错轴斜齿轮参数（模数/齿数/宽度/螺旋角等）
 * @param build 构造选项（策略/容差覆盖）
 * @returns 朝向归一化后的 solid
 */
export function buildCrossedHelicalSolid(
  kernel: RawOcctKernel,
  params: CrossedHelicalGearParams,
  build: BuildSpurGearOptions = {},
): BrepHandle {
  return buildGearSolid(kernel, crossedHelicalGearGeometry(params), build)
}
