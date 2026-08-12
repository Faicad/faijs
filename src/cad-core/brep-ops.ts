/**
 * @deprecated 此文件已拆分到 `src/brep/` 目录下。
 *
 * - BREP 链状态管理 → `@/brep/brep-chain`
 * - 核心 BREP 操作 → `@/brep/brep-ops`
 * - 操作分派器 → `@/brep/ops/dispatcher`
 *
 * 此文件仅作为向后兼容的 re-export 入口。
 * 新代码请直接从 `@/brep/...` 导入。
 */

export {
  type BrepChainState,
  createBrepChainState, initBrepChainState,
  releaseBrepChainState, breakBrepChain,
  lastSolidOfChain,
  BREP_NATIVE_OPS, MESH_ONLY_OPS,
  isCadFormat,
} from '../brep/brep-chain'

export {
  solidToShape,
  translateBrep, rotateBrep, scaleBrep,
  fuseBrep, cutBrep, commonBrep,
  drillBrep, splitBrep, extrudeBrep,
  loadBrep,
  matrixToArray,
  type DrillBrepParams, type SplitBrepParams, type SplitBrepResult, type ExtrudeBrepParams,
} from '../brep/brep-ops'

export { getSolidBoundingBox } from '../brep/brep-utils'
