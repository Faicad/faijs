/**
 * @faicad/faijs-core/weapp — weapp 专用宿主入口（docs/plans/2026-09-20-weapp-host-entry-design.md）
 *
 * 小程序（无 OCCT 环境）宿主的最小导出面：brepkit wasm 装载注入点 + brepkit BREP
 * 引擎注册 + 环境无关执行栈。全部为 re-export，零新实现。
 *
 * 为什么独立成入口：browser umbrella 曾 re-export brepkit 符号，导致 web 端模块图
 * 包含 brepkitWasm.js（其 node 分支 import('brepkit-wasm') 被 vite 静态解析而报错）。
 * 宿主边界必须由静态入口声明，而不是靠构建脚本事后 stub 剔除。
 *
 * 导出面受 entry-boundary.test.ts 白名单守卫约束——新增导出必须同步更新白名单。
 * web/desktop 宿主禁止 import 本入口（brepkit 是 weapp 专属 BREP 引擎）。
 */

// brepkit wasm 装载（weapp 专属注入点；宿主装配期调用一次 setBrepkitWasmInitFn）
export { setBrepkitWasmInitFn, initBrepkitWasm, isBrepkitInitialized } from './brepkit-kernel/brepkitWasm'

// brepkit BREP 引擎注册（weapp 只注册 brepkit，不注册 occt）
export { registerBrepkitBrepEngine, BREPKIT_BREP_ENGINE_ID, ensureBrepkitDefaultEngine } from './brep/engine/adapters/brepkit'

// BREP 引擎注册表（环境无关；ensureBrepChain 见已注册引擎即跳过 OCCT）
export { registerBrepEngine, hasBrepEngine, getActiveBrepEngineId, freezeEngineRegistries } from './brep/engine/registry'
export type { BrepEngine, BrepEngineProvider } from './brep/engine/registry'
export type { BrepEngineApi } from './brep/engine/primitives'

// cad-runtime（环境无关执行栈，与 weapp worker 装配顺序 §6.1 一致）
export { createRuntime } from './cad-runtime/runtime'
export type { CadRuntime } from './cad-runtime/runtime'

export { createApiNamespace } from './api/api-namespace'
