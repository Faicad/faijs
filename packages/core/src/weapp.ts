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

// 共享面（env-agnostic：identity + runtime-state + lang/*）——三处 umbrella 统一
// re-export（§9.1），weapp worker 由此获得 analyzeCode 等语言层符号。
export * from './env-agnostic'

// brepkit wasm 装载（weapp 专属注入点；宿主装配期调用一次 setBrepkitWasmInitFn）
export { setBrepkitWasmInitFn, initBrepkitWasm, isBrepkitInitialized } from './brepkit-kernel/brepkitWasm'

// brepkit BREP 引擎注册（weapp 只注册 brepkit，不注册 occt）
export { registerBrepkitBrepEngine, BREPKIT_BREP_ENGINE_ID, ensureBrepkitDefaultEngine } from './brep/engine/adapters/brepkit'
// brepkit 网格实体后端（网格语义路径；与 BREP 槽独立注册）。weapp 侧装了它，
// `cad.load` 的 STL/3MF 路径就产出「网格实体 + 近似拓扑」。
export { registerBrepkitMeshEngine, BREPKIT_MESH_ENGINE_ID, ensureBrepkitMeshBackend } from './brep/engine/adapters/brepkit'

// BREP 引擎注册表（环境无关；ensureBrepChain 见已注册引擎即跳过 OCCT）
export { registerBrepEngine, hasBrepEngine, getBrepEngine, getActiveBrepEngineId, freezeEngineRegistries, registerMeshEngine, getMeshEngine, getActiveMeshEngineId, isMeshEngineRegistered, getMeshSolidBackend } from './brep/engine/registry'
export type { BrepEngine, BrepEngineProvider, MeshEngine } from './brep/engine/registry'
export type { BrepEngineApi } from './brep/engine/primitives'
// 网格实体（近似拓扑的载体）：端口 + 注册表 + 驱动。
export { MeshSolidRegistry, normalizeMeshSolid, describeMeshSolid, buildMeshSolidTopology, weldToleranceFor } from './brep/mesh-solid'
export type {
  MeshSolidBackend, MeshSolidResult, MeshSolidKernelOps, MeshSolidInput, MeshSolidNormalizeOptions,
} from './brep/mesh-solid'
export { assertShapeSlotExclusive } from './cad-runtime/backend-dispatch'

// cad-runtime（环境无关执行栈）：createRuntime 为 with-cad 变体（§9.2），与
// browser/node 入口同口径——自带 cad 命名空间注册，宿主无需手工补注册。
export { createRuntime } from './cad-runtime/createRuntimeWithCad'
export type { CadRuntime } from './cad-runtime/createRuntimeWithCad'
