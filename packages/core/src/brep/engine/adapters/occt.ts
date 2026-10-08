/**
 * engine/adapters/occt — OCCT BREP 引擎适配器（槽位 1 的默认实现）
 *
 * 本文件是「occt 引擎实现」的注册入口：把 `createOcctPrimitives()`（occt-kernel/
 * occt-primitives.ts，L1 契约 `BrepEngineApi` 的 occt 显式实现）注册进引擎注册表。
 * 业务层（runtime/brep ops/api）只经注册表取引擎，不直接 import occt 初始化
 * 函数——引擎本体可整体替换（换一个适配器即换引擎）。
 *
 * Phase 3：
 * 本文件不再做任何猴子补丁（旧版在 occt-wasm 单例上覆写 pattern 三方法与 33 个
 * 登记方法——全部移入 `createOcctPrimitives` 的显式对象字面量）。occt-wasm 类型
 * 耦合只存在于 occt-kernel/（A1 允许的唯一耦合区）；本文件不接触 occt-wasm 类型。
 *
 * 平台独有能力（loft 族、工具实体 section/split、L1 三员之外的 *WithHistory、
 * XCAF 等）不在 L1 契约里——平台代码经原生面 `getOcctKernel()`（D3）访问。
 */

import { registerBrepEngine, hasBrepEngine, isBrepEngineRegistered, type BrepEngine } from '../registry'
import { createOcctPrimitives } from '../../../occt-kernel/occt-primitives'

/** OCCT 引擎注册 id（默认 BREP 引擎；首个注册自动成为默认）。 */
export const OCCT_BREP_ENGINE_ID = 'occt'

/**
 * 装配 OCCT BREP 引擎（宿主启动时调用一次，幂等）。
 *
 * 预初始化 `createOcctPrimitives()`（内部 await initOcctWasm）：wasm 加载完成后
 * 立即注册——保证注册返回后内核单例已就绪。幂等：已注册（含运行时默认装配或
 * 宿主先行注册）则跳过注册，仅确保 wasm 预初始化。
 */
export async function registerOcctBrepEngine(): Promise<void> {
  const primitives = await createOcctPrimitives()
  if (isBrepEngineRegistered(OCCT_BREP_ENGINE_ID)) return
  registerBrepEngine(OCCT_BREP_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: OCCT_BREP_ENGINE_ID,
    primitives,
  }))
  // 2026-09-25 core-decouple Phase 2（§5.1）：删除 occt-kernel-bridge 后，本注册
  // 流程只管 core 引擎注册表，不再向旧 kernel registry 注入——compat
  // 兼容面（compat op）由 Phase 3 逐批自有化替换；中间态下需要 compat 面的
  // 宿主/测试自行装配 registry。
}

/**
 * 内置默认 BREP 引擎装配（OCCT）：宿主未注册任何引擎时的缺省值。
 *
 * OCCT 是 faijs 的默认 BREP 引擎——低频率、静态的替换：换引擎 = 宿主在
 * 装配期显式注册其它引擎（首个注册者为默认），或改本处默认。宿主无需为
 * 每次使用自行提供引擎；本函数幂等，已注册任何引擎则 no-op。
 */
export async function ensureOcctDefaultEngine(): Promise<void> {
  if (hasBrepEngine()) return
  await registerOcctBrepEngine()
}
