/**
 * view — faijs 视图投影能力（路径 A：工程线稿 SVG；路径 B 见 3d_editor 宿主）
 *
 * 设计文档：docs/plans/2026-09-10-faijs-view-projection-and-screenshot.md §3.2
 *
 * 三个 op 全部返回**纯数据**（字符串 / 相机对象），不产出 Shape：
 *   - viewCamera(view)  → 视图规格解析为相机纯数据；
 *   - projectView(shape, view, opts?) → 单视图投影 SVG 字符串；
 *   - projectSheet(shape, views, opts?) → 多视图（三视图 + 等轴测）组合 SVG。
 *
 * 均为只读查询：不消费、不修改 shape（配合 §3.7 规则 1：无赋值裸调用默认不消费）。
 */

export { viewCamera, resolveCamera, type ViewSpec, type StandardView, type IsoView, type AxisPlaneView, type DirectionView } from './view-camera'
export { projectView, projectViewSvg, type ProjectViewOptions, type ProjectionSvg } from './view-projection'
export { projectSheet, type SheetView, type ProjectSheetOptions } from './view-sheet'
