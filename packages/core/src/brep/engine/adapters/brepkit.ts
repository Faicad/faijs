/**
 * engine/adapters/brepkit — brepkit BREP 引擎适配器（对照 adapters/occt.ts 形态）
 *
 * 把 createBrepkitPrimitives 包装为 BrepEngine 注册进注册表。业务层只经注册表取
 * 引擎，不直接 import brepkit 初始化函数——引擎本体可整体替换（换适配器即换引擎）。
 *
 * 小程序装配顺序（§6.1）：Worker 启动时先 setBrepkitWasmInitFn + 本函数注册，
 * ensureOcctDefaultEngine 的动态 import('occt-wasm') 永不触发。
 */

import {
  registerBrepEngine, isBrepEngineRegistered, hasBrepEngine,
  registerMeshEngine, getMeshSolidBackend, isMeshEngineRegistered,
  type BrepEngine,
} from '../registry'
import type { AssertSatisfiesBrepEngineApi } from '../primitives'
import { createBrepkitPrimitives, type BrepkitPrimitives } from '../../../brepkit-kernel/brepkitKernel'
import type { MeshSolidBackend } from '../../mesh-solid'
import { normalizeMeshSolid, describeMeshSolid, buildMeshSolidTopology } from '../../mesh-solid'

/** brepkit 引擎注册 id。 */
export const BREPKIT_BREP_ENGINE_ID = 'brepkit'

/**
 * 装配 brepkit BREP 引擎（宿主启动时调用一次，幂等）。
 *
 * 预初始化 createBrepkitPrimitives()：wasm 装载完成后立即注册——注册返回后
 * provider 直接返回就绪实例。幂等：已注册则跳过。
 *
 * 引擎能做什么由实现本身决定（`createBrepkitPrimitives` 的方法面），没有能力声明表：
 * 面演化三员（fuse/cut/fillet）在 `brep/engine/native-history.ts` 按引擎 id 记录，
 * 其余 `*WithHistory` 在 brepkit 内核里是 `unsupported(...)` 桩 —— 依赖它们的 op 走
 * 裸方法轨或由 `engines: ['occt']` 在装配前拒绝，绝无"声明了却跑不动"。
 */
export async function registerBrepkitBrepEngine(): Promise<void> {
  const primitives = await createBrepkitPrimitives()
  if (isBrepEngineRegistered(BREPKIT_BREP_ENGINE_ID)) return
  registerBrepEngine(BREPKIT_BREP_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: BREPKIT_BREP_ENGINE_ID,
    primitives,
  }))
}

/** 已注册任何 BREP 引擎则 no-op；否则注册 brepkit（可作为宿主的显式缺省装配点）。 */
export async function ensureBrepkitDefaultEngine(): Promise<void> {
  if (hasBrepEngine()) return
  await registerBrepkitBrepEngine()
}

// ── 网格实体后端（方案 2026-10-01 §3.3） ──

/** brepkit 网格实体后端 id —— 与 `defineOp.meshEngines` 的门禁名同源。 */
export const BREPKIT_MESH_ENGINE_ID = 'brepkit'

/**
 * 装配 brepkit **网格实体后端**（网格语义路径；与 BREP 槽独立）。
 *
 * 与 `registerBrepkitBrepEngine` 的关系：同一个 brepkit wasm 实例、同一个
 * `createBrepkitPrimitives()` 对象（已按内核 memo 化，见其 GOTCHA），但走的是
 * **mesh 语义**——逐三角形导入 → 缝合 → 共面合并 → 网格实体。
 *
 * 装与不装的区别：装了，`load` 的 mesh 路径产出的零件带近似拓扑（可选中面/边，
 * 后续 mesh op 可作用于其上）；不装，mesh 路径维持"裸网格、无拓扑"的历史行为。
 * 这是**宿主装配事实**，不是错误（与"规范化失败必须报错"是两回事）。
 *
 * 幂等：已注册同名 mesh 引擎则跳过。
 */
export async function registerBrepkitMeshEngine(): Promise<void> {
  const primitives = await createBrepkitPrimitives()
  if (isMeshEngineRegistered(BREPKIT_MESH_ENGINE_ID)) return
  const backend: MeshSolidBackend = {
    id: BREPKIT_MESH_ENGINE_ID,
    kernel: primitives,
    ops: primitives.meshSolid,
    normalize: (mesh, opts) => normalizeMeshSolid(backend, mesh, opts),
    describe: (solid, opts) => describeMeshSolid(backend, solid, opts),
    buildTopologyData: (result) => buildMeshSolidTopology(backend, result),
    release: (solid) => { primitives.release(solid) },
  }
  registerMeshEngine(BREPKIT_MESH_ENGINE_ID, { id: BREPKIT_MESH_ENGINE_ID, meshSolid: backend })
}

/** 已注册任何网格实体后端则 no-op；否则注册 brepkit（宿主的显式缺省装配点）。 */
export async function ensureBrepkitMeshBackend(): Promise<void> {
  if (getMeshSolidBackend()) return
  await registerBrepkitMeshEngine()
}

// §7.8 编译期完整性守卫：brepkit 原语集合必须满足 BrepEngineApi。
// 实现缺方法或签名不兼容 → tsc 在此报错列出缺失（与 occt 适配器同守卫）。
type _AssertBrepkitApi = AssertSatisfiesBrepEngineApi<BrepkitPrimitives>
