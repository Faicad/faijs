/**
 * sdk — 第三方库开发面（F3 / roadmap V2.2）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-near-term-landing-plan.md §6
 *
 * 第三方库模块（`import * as mech from 'gear-lib-demo'` 的目标）用它开发：
 * ```ts
 * import { solid, fromBrep, isShape, keep, getBackends, CONTRACT_VERSION } from '@faicad/faijs/sdk'
 * export const contractVersion = CONTRACT_VERSION
 * export function makeHeadstock(params) { ... }
 * ```
 *
 * 本入口**零 heavy 运行时依赖**：只 re-export runtime-state（L0+ 零依赖锚点层）
 * 与 stdlib/shape（构造器 + 身份表，仅 type-import mesh 类型）。
 * 值导入闭包不含 three / occt-wasm / manifold / node:*——由守卫测试保证
 * （dist/sdk.js 静态 import 扫描）。
 *
 * 与主入口的关系：sdk 是主入口的**子集 + 极薄 re-export**，供库作者按需导入；
 * 主入口 / browser / stdlib 不受影响（additive）。
 */

// ── 构造器与身份表（stdlib/shape：类型化构造器 + BREP 句柄登记） ──

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
  configureBackends,
  assertContractVersion,
  CONTRACT_VERSION,
  BrepUnsupportedError,
  MeshUnsupportedError,
} from './runtime-state'
export type {
  Backends,
  RuntimeExecutionMode,
  StdlibFn,
  StdlibNamespace,
  ShapeSlot,
  KeepSink,
} from './runtime-state'

// ── BREP 桥接（B1：第三方库造 BREP 产物的三角化入口） ──
// handle-bridge 只 import runtime-state / stdlib/shape / type-only mesh/types，
// 零 heavy 依赖——dist/sdk.js 守卫测试继续通过。

export { getKernel, meshHandle, fromHandle } from './brep/handle-bridge'
export type { MeshHandleOptions } from './brep/handle-bridge'

// ── 双路径实现声明（D 面契约：mesh 必选、BREP 可选；几何函数专用） ──
// define-op 只依赖 runtime-state / stdlib/shape / handle-bridge / backend-dispatch
// 与 type-only mesh、brep 类型——零 heavy 依赖，dist/sdk.js 守卫继续通过。
// 第三方库作者用 defineOp 声明实现集合；dispatchPath 不再直接导出——
// 分派由 defineOp 包装器内部调用（规则仍是引擎 backend-dispatch.ts 单点）。

export { defineOp, assertLibConforms, DUAL_OP_META } from './define-op'
export type {
  DualOpMeta,
  DualOpOptions,
  DualOpImpls,
  MeshImpl,
  BrepImpl,
  MeshData,
  BrepResult,
  ConsumeSpec,
} from './define-op'
export type { BrepCapabilityName } from './cad-runtime/backend-dispatch'
