/**
 * cadquery-selectors — CadQuery 拓扑选择器子系统（独立物理边界）
 *
 * 单一选择器真相的边界（plan §4.5/§4.6）：grammar → parseSelector、实体投影
 * （entity.ts）、谓词（predicates.ts）、链式收窄求值（resolve.ts），以及面向
 * faijs `Shape` 的薄适配（face/edge）。cq-compat 只经此处 re-export 消费，
 * 与 faijs 自有的命名 / 血缘 TopoRef 系统物理隔离，不依赖之。
 */

export { asBrepShape } from './borrow-bridge'
export { resolveFaceSelector } from './face'
export { resolveEdgeSelection, resolveFaceEdgeSelection, resolveVertexSelection } from './edge'
export { parseSelector, SYNTAX_FEATURES, NAMED_VIEW, AXES, TYPE_NAMES } from './grammar'
export type { SelectorExpr, AtomDesc, EntityKind, SelStep, Vec3 } from './types'
export {
  faceGeom,
  edgeGeom,
  vertexGeom,
  subShapeHandles,
  orientedFaceNormal,
  faceGeomType,
  edgeGeomType,
  type EntityGeom,
  type P3,
  type ShapeHandle,
} from './entity'
export {
  DIR_TOLERANCE,
  NTH_TOLERANCE,
} from './predicates'
export {
  isParallel,
  isPerpendicular,
  isAligned,
  isDirectionCandidate,
  typeMatches,
  entityDirection,
} from './predicates'
export {
  resolveSelection,
  resolveStepHandles,
  EmptyNthError,
  type ChainResult,
  type Selection,
} from './resolve'