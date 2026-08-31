/**
 * BREP 操作统一导出
 *
 * 目录结构：
 * - brep-ops.ts: 核心 BREP 操作（变换、布尔、钻孔、分割、拉伸）
 * - brep-chain.ts: BREP 链状态管理
 * - brep-utils.ts: 通用工具
 * - brepjs-mirror/: 从 brepjs 参考的操作实现（镜像 brepjs src/operations/，勿手改核心算法）
 * - text/: 文字 BREP 实现（镜像 brepjs src/text/）
 * - ops/: 每个操作的 BREP + Mesh 分派器（src/ops/）
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
  releaseBrepChainState,
  isCadFormat,
} from './brep-chain'

// 通用工具
export { getSolidBoundingBox } from './brep-utils'

// F4 修复：不再反向 re-export executeStatement（ops/dispatcher）。
// brep/ 不应 re-export ops/ 的符号。宿主从 @faicad/faijs/browser 直接 import executeStatement。
