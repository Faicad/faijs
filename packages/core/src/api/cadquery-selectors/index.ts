/**
 * cadquery-selectors — CadQuery 拓扑选择器子系统（独立物理边界）
 *
 * 等价搬运自 `packages/cq-compat/src/workplane.ts` 的选择器实现，供
 * cq-compat 薄封装 re-export。与 faijs 自有的命名 / 血缘 TopoRef 系统
 * 物理隔离，不依赖之。
 */

export { asBrepShape } from './borrow-bridge'
export { resolveFaceSelector } from './face'
export { resolveEdgeSelection, resolveFaceEdgeSelection } from './edge'