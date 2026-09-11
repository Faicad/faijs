/**
 * view-camera — 视图规格 → 投影相机（faijs 视图投影能力，路径 A 纯数据面）
 *
 * 设计文档：docs/plans/2026-09-10-faijs-view-projection-and-screenshot.md §3.2
 *
 * 视图规格（ViewSpec）：
 *   - 六个标准正交视图：'front' | 'back' | 'top' | 'bottom' | 'left' | 'right'
 *     （方向沿用 vendored brepjs PROJECTION_PLANES：front=(0,-1,0)、top=(0,0,-1)…，
 *      与 FreeCAD TechDraw 的方向向量惯例一致，见方案 §2.2）；
 *   - 等轴测：'iso' | 'isometric'（方向 (1,-1,1)，方案 §2.3 定稿）；
 *   - 轴对平面：'XY' | 'XZ' | 'YZ' | 'YX' | 'ZX' | 'ZY'（vendored 平面名）；
 *   - 任意方向：{ dir: Vec3, xAxis?: Vec3 }（xAxis 缺省由方向自动推导）。
 *
 * viewCamera 是纯数据函数（无 Shape 输入，kind 'pure' 语义）：把视图规格解析成
 * vendored brepjs 的 Camera 纯数据对象，供 projectView/projectSheet 与宿主复用。
 * 返回类型 re-export 自 vendored（api/generated/projection.ts 已登记 Camera type）。
 */

import { createCamera, cameraFromPlane, type Camera } from '../../vendored/brepjs/projection/cameraFns.js'
import { isProjectionPlane } from '../../vendored/brepjs/projection/projectionPlanes.js'
import { unwrap } from '../../vendored/brepjs/core/result.js'
import type { Vec3 } from '../../vendored/brepjs/core/types.js'

/** 六个标准正交视图名（vendored CubeFace 同集）。 */
export type StandardView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right'

/** 等轴测视图名（faijs 新增别名；方向 (1,-1,1)）。 */
export type IsoView = 'iso' | 'isometric'

/** 轴对平面名（vendored ProjectionPlane 的子集）。 */
export type AxisPlaneView = 'XY' | 'XZ' | 'YZ' | 'YX' | 'ZX' | 'ZY'

/** 任意方向视图规格。 */
export interface DirectionView {
  /** 视向（相机沿此方向观察；零向量报错）。 */
  dir: Vec3
  /** 可选水平轴（缺省由方向自动推导）。 */
  xAxis?: Vec3
}

/**
 * faijs 视图投影的视图规格：标准正交 / 等轴测 / 轴对平面 / 任意方向。
 */
export type ViewSpec = StandardView | IsoView | AxisPlaneView | DirectionView

/** 等轴测视向（方案 §2.3：Iso=(1,-1,1)，与 FreeCAD 惯例一致）。 */
const ISO_DIR: Vec3 = [1, -1, 1]

/**
 * 解析视图规格为投影相机（纯数据，无 Shape 输入；不消费任何几何）。
 * @group 查询
 * @inputs 0
 * @async false
 * @qual ok
 * @name viewCamera
 * @returns { direction, xAxis? } 归一化方向向量（iso = (1,-1,1)/√3，与 FreeCAD/OCCT 惯例一致）。未知视图名抛错；零方向向量抛错。用于 3d_editor 侧三轴相机渲染（mesh/SDF 形状的截图通道）。
 * @param view - 视图规格：标准视图名（front/back/top/bottom/left/right/iso（=isometric）/XY/XZ/YZ/YX/ZX/ZY）或方向对象。type:string|{dir,xAxis?} required:true
 * @example
 * const cam = cad.viewCamera('iso')
 * const cam = cad.viewCamera({ dir: [1, -1, 1] })
  */
export function viewCamera(view: ViewSpec): Camera {
  if (typeof view === 'string') {
    if (view === 'iso' || view === 'isometric') {
      return unwrap(createCamera([0, 0, 0], ISO_DIR))
    }
    if (isProjectionPlane(view)) {
      return unwrap(cameraFromPlane(view))
    }
    throw new Error(`[faijs/view] unknown view '${view}' (expected front/back/top/bottom/left/right/iso/isometric or an axis pair)`)
  }
  const { dir, xAxis } = view
  return unwrap(createCamera([0, 0, 0], dir, xAxis))
}

/** resolveCamera = viewCamera 别名（projectView/projectSheet 内部使用；与方案措辞一致）。 */
export const resolveCamera = viewCamera
