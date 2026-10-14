/**
 * sdk — 第三方库开发面（F3 / roadmap V2.2）
 *
 *
 * 第三方库模块（`import * as gear from 'my-lib'` 的目标）用它开发：
 * ```ts
 * import { solid, fromBrep, isShape, keep, getBackends, CONTRACT_VERSION } from '@faicad/faijs/sdk'
 * export const contractVersion = CONTRACT_VERSION
 * export function makeSpurGear(params) { ... }
 * ```
 *
 * 本入口**零 heavy 运行时依赖**：只 re-export runtime-state（L0+ 零依赖锚点层）
 * 与 api/shape（构造器 + 身份表，仅 type-import mesh 类型）。
 * 值导入闭包不含 three / occt-wasm / manifold / node:*——由守卫测试保证
 * （dist/sdk.js 静态 import 扫描）。
 *
 * 与主入口的关系：sdk 是主入口的**子集 + 极薄 re-export**，供库作者按需导入；
 * 主入口 / browser / api 层不受影响（additive）。
 */

// ── 构造器与身份表（api/shape：类型化构造器 + BREP 句柄登记） ──

export {
  solid,
  fromBrep,
  compound,
  isShape,
  isCompound,
  hasBrep,
  brepOf,
  nameOfShapes,
  getSlot,
  ensureSlot,
} from './shape'
export type {
  SolidShape,
  CompoundShape,
  ShapeKind,
  StdShape,
  BrepHolder,
} from './shape'
export type { Shape } from './mesh/types'

// ── 运行时状态锚点（零依赖层：keep / backends / 契约版本 / 错误类型） ──

export {
  keep,
  keepHidden,
  getBackends,
  getConfiguredBrepEngineId,
  configureBackends,
  assertContractVersion,
  CONTRACT_VERSION,
  BrepUnsupportedError,
  MeshUnsupportedError,
} from './runtime-state'
export type {
  Backends,
  RuntimeExecutionMode,
  LibFn,
  LibNamespace,
  ShapeSlot,
  KeepSink,
} from './runtime-state'

// ── BREP 桥接（B1：第三方库造 BREP 产物的三角化入口） ──
// handle-bridge 只 import runtime-state / api/shape / type-only mesh/types，
// 零 heavy 依赖——dist/sdk.js 守卫测试继续通过。
//
// 内核取用三分（一个出口对应一种代码，见 docs/library-dev-guide.md「内核取用」）：
//   · 中立 op / 中立库 → `getBrepApi()`（本文件，L1 契约面）；
//   · 平台 op / 平台库 → 上面的 `getBrepApi()` 取 L1 部分，
//     `getOcctKernel()` / `getBrepKitKernel()` 取平台部分。平台面不在本文件导出
//     ——它会 import occt-wasm（heavy），只能从 `@faicad/faijs/occt-kernel/occtKernel`
//     / `@faicad/faijs/brepkit-kernel/brepkitKernel` 子路径取。
//   · 数据 / 声明库 → 什么都不取。
// `getBackends().kernel.*` 裸槽位是 core 内部实现细节，库代码不得读。

export { getBrepApi, meshHandle, fromHandle } from './brep/handle-bridge'
export type { MeshHandleOptions } from './brep/handle-bridge'
export { BREP_ENGINE_IDS, type BrepEngineId, type BrepHandle } from './brep/engine/types'
export type { BrepEngineApi } from './brep/engine/primitives'

// ── 双路径实现声明（D 面契约：mesh 必选、BREP 可选；几何函数专用） ──
// define-op 只依赖 runtime-state / api/shape / handle-bridge / backend-dispatch
// 与 type-only mesh、brep 类型——零 heavy 依赖，dist/sdk.js 守卫继续通过。
// 第三方库作者用 defineOp 声明实现集合；dispatchPath 不再直接导出——
// 分派由 defineOp 包装器内部调用（规则仍是引擎 backend-dispatch.ts 单点）。

export { defineOp, assertLibConforms, hasDualOp, dualOpMetaOf, DUAL_OP_META } from './define-op'
export type {
  DualOpMeta,
  DualOpOptions,
  DualOpImpls,
  MeshImpl,
  BrepImpl,
  MeshData,
  BrepResult,
} from './define-op'
