/**
 * BREP 操作统一导出
 *
 * 目录结构：
 * - brep-ops.ts: 核心 BREP 操作（变换、布尔、钻孔、分割、拉伸）
 * - brep-chain.ts: BREP 链状态管理
 * - brep-utils.ts: 通用工具
 * - operations/: 从 brepjs 参考的操作实现（镜像 brepjs src/operations/）
 * - text/: 文字 BREP 实现（镜像 brepjs src/text/）
 * - ops/: 每个操作的 BREP + Mesh 分派器
 */

// 核心 BREP 操作
export {
  solidToShape,
  translateBrep, rotateBrep, scaleBrep,
  fuseBrep, cutBrep, commonBrep,
  drillBrep, splitBrep, extrudeBrep,
  loadBrep, matrixToArray,
  type DrillBrepParams, type SplitBrepParams, type SplitBrepResult, type ExtrudeBrepParams,
} from './brep-ops'

// BREP 链状态管理
export {
  type BrepChainState,
  createBrepChainState, initBrepChainState,
  releaseBrepChainState, breakBrepChain,
  lastSolidOfChain,
  BREP_NATIVE_OPS, MESH_ONLY_OPS,
  isCadFormat,
} from './brep-chain'

// 通用工具
export { getSolidBoundingBox } from './brep-utils'

// 操作分派器
export { executeStatement } from './ops/dispatcher'
