/**
 * @faicad/faijs-core/weapp — weapp 专用宿主入口
 *
 * 小程序（无 OCCT 环境）宿主的最小导出面：smlib wasm 装载注入点 + smlib BREP
 * 引擎注册 + 环境无关执行栈。全部为 re-export，零新实现。
 *
 * 2026-10-27（weapp 引擎更换）：weapp 专属 BREP 引擎由 brepkit 换为 smlib——
 * 装载注入点/引擎注册/默认引擎全部指向 smlib（3d_editor 侧 faijs.worker.ts 同步
 * 迁移，设计见 3d_editor 仓 2026-10-27 的「weapp smlib 引擎切换」计划）。
 * STL/STEP IO 走 smlib 内核桥（importStl/importStep/exportStep，wasm 0.45.6+
 * 内置 SmApiImportStlEx/ImportStepEx/ExportStepEx）——`cad.load` 的 STL/STEP 直构
 * 真 B-rep、`cad.export` 的 STEP 逐实体 AP203；3MF 仍走 faijs TS 解析路径（内核
 * 无 import3mf）。因此本入口不再导出网格实体后端注册（原 ensureBrepkitMeshBackend）。
 * faijs 核心库仍保留 occt/brepkit/smlib 三引擎（多引擎设计），brepkit 由其他
 * 入口/测试继续使用。
 *
 * 为什么独立成入口：browser umbrella 曾 re-export brepkit 符号，导致 web 端模块图
 * 包含 brepkitWasm.js（其 node 分支 import('brepkit-wasm') 被 vite 静态解析而报错）。
 * 宿主边界必须由静态入口声明，而不是靠构建脚本事后 stub 剔除。
 *
 * 导出面受 entry-boundary.test.ts 白名单守卫约束——新增导出必须同步更新白名单。
 * web/desktop 宿主禁止 import 本入口（smlib 是 weapp 专属 BREP 引擎）。
 */

// 共享面（env-agnostic：identity + runtime-state + lang/*）——三处 umbrella 统一
// re-export（§9.1），weapp worker 由此获得 analyzeCode 等语言层符号。
export * from './env-agnostic'

// smlib wasm 装载（weapp 专属注入点；宿主装配期调用一次 setSmlibWasmInitFn）。
// 微信端装载器返回 SmlibKernel 实例（WXWebAssembly 路径装载 + imports 注入 +
// invoke 转发；见 3d_editor weapp/src/worker/index.ts 的 loadSmlib）。
// createSmlibImportsByName / buildSmlibKernel 是微信端装载器复用的构件：
// WXWebAssembly 无 Module 句柄可枚举 imports（构建期烘焙清单），且需把 instance
// 构造成与 node 端同构的内核句柄——算法在 faijs，3d_editor 只做装配。
export { setSmlibWasmInitFn, initSmlibWasm, isSmlibInitialized, createSmlibImportsByName, buildSmlibKernel } from './smlib-kernel/smlibWasm'
export type { SmlibKernel } from './smlib-kernel/smlibWasm'

// smlib BREP 引擎注册（weapp 只注册 smlib，不注册 occt）
export { registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID, ensureSmlibDefaultEngine } from './brep/engine/adapters/smlib'

// BREP 引擎注册表（环境无关；ensureBrepChain 见已注册引擎即跳过 OCCT）
export { registerBrepEngine, getBrepEngine, getActiveBrepEngine, hasBrepEngine, getActiveBrepEngineId, freezeEngineRegistries, registerMeshEngine, getMeshEngine, getActiveMeshEngine, getActiveMeshEngineId, isMeshEngineRegistered, getMeshSolidBackend } from './brep/engine/registry'
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
export { createRuntime } from './cad-runtime/runtime'
export type { CadRuntime } from './cad-runtime/runtime'
