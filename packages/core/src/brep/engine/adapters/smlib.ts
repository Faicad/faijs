/**
 * engine/adapters/smlib — smlib（usd-brep SM_API）BREP 引擎适配器
 *
 * 对照 adapters/brepkit.ts 形态：把 createSmlibPrimitives 包装为 BrepEngine 注册进
 * 注册表。业务层只经注册表取引擎，不直接 import smlib 初始化函数。
 *
 * P1 能力面（方案文档 §6 P1）：生命周期、图元、布尔（副本化）、变换、测量、
 * meshShape/wireframe、getSubShapes（face/edge）。其余 L1 方法在 smlibKernel.ts
 * 内为 `unsupported` 桩——依赖它们的 op 由 `engines: ['occt'|'brepkit']` 声明在
 * 装配前拒绝，绝无"声明了却跑不动"（与 brepkit 的 *WithHistory 桩同纪律）。
 */
import {
  registerBrepEngine, isBrepEngineRegistered, hasBrepEngine,
  type BrepEngine,
} from '../registry'
import type { AssertSatisfiesBrepEngineApi } from '../primitives'
import { createSmlibPrimitives, type SmlibPrimitives } from '../../../smlib-kernel/smlibKernel'

/** smlib 引擎注册 id。 */
export const SMLIB_BREP_ENGINE_ID = 'smlib'

/**
 * 装配 smlib BREP 引擎（宿主启动时调用一次，幂等）。
 *
 * 预初始化 createSmlibPrimitives()：wasm 装载完成后立即注册——注册返回后
 * provider 直接返回就绪实例。幂等：已注册则跳过。
 */
export async function registerSmlibBrepEngine(): Promise<void> {
  const primitives = await createSmlibPrimitives()
  if (isBrepEngineRegistered(SMLIB_BREP_ENGINE_ID)) return
  registerBrepEngine(SMLIB_BREP_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: SMLIB_BREP_ENGINE_ID,
    primitives,
  }))
}

/** 已注册任何 BREP 引擎则 no-op；否则注册 smlib（宿主的显式缺省装配点）。 */
export async function ensureSmlibDefaultEngine(): Promise<void> {
  if (hasBrepEngine()) return
  await registerSmlibBrepEngine()
}

// 编译期完整性守卫：smlib 原语集合必须满足 BrepEngineApi。
// 实现缺方法或签名不兼容 → tsc 在此报错列出缺失（与 occt/brepkit 适配器同守卫）。
type _AssertSmlibApi = AssertSatisfiesBrepEngineApi<SmlibPrimitives>
