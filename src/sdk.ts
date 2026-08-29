/**
 * sdk — 第三方库开发面（F3 / roadmap V2.2）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-near-term-landing-plan.md §6
 *
 * 第三方库模块（`import * as mech from 'mech-lib'` 的目标）用它开发：
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
} from './stdlib/shape'
export type {
  SolidShape,
  CompoundShape,
  ShapeKind,
  StdShape,
  BrepHolder,
} from './stdlib/shape'
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
} from './runtime-state'
export type {
  Backends,
  RuntimeExecutionMode,
  StdlibFn,
  StdlibNamespace,
  ShapeSlot,
  KeepSink,
} from './runtime-state'
