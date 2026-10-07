/**
 * BREP 操作统一导出
 *
 * 目录结构：
 * - brep-ops.ts: 核心 BREP 操作（变换、布尔、钻孔、分割、拉伸）
 * - brep-chain.ts: BREP 链状态管理
 * - brep-utils.ts: 通用工具
 * - brep-topology.ts / primitives-brep.ts / mesh-solid.ts: 拓扑查询、原型、实体化
 * - face-evolution.ts / handle-bridge.ts / effective-deflection.ts: 面演化、句柄桥、偏转
 * - engine/: BREP 引擎注册表与适配器（adapters/ 下 occt、brepkit、brep-mock）
 * - export/: 导出（stl.ts、step.ts、export-model.ts）
 * - svg/: SVG → 实体
 * - text/: 文字 BREP（fontRegistry.ts、text-to-solid.ts）
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
