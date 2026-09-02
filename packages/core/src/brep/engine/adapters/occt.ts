/**
 * engine/adapters/occt — OCCT BREP 引擎适配器（槽位 1 的默认实现）
 *
 * 设计：docs/plans/2026-08-30-brep-engine-switch.md §6.2 / §9.2
 *
 * 本文件是「occt 引擎实现」的注册入口：把 occt-kernel 的 initOcctWasm 包装为
 * BrepEngine 注册进注册表。业务层（runtime/brep ops/stdlib）只经注册表取引擎，
 * 不直接 import occt 初始化函数——引擎本体可整体替换（换一个适配器即换引擎）。
 *
 * OCCT 类型耦合（import 'occt-wasm'）只存在于 occt-kernel/occtKernel.ts（A1 验收
 * 允许的唯一耦合区）；本文件经 initOcctWasm 函数边界获得 BrepEngineApi，不直接
 * 接触 occt-wasm 类型。
 */

import { registerBrepEngine, hasBrepEngine, isBrepEngineRegistered, type BrepEngine } from '../registry'
import type { AssertSatisfiesBrepEngineApi } from '../primitives'
import { initOcctWasm } from '../../../occt-kernel/occtKernel'
import { bindOcctKernel } from '../../../api/occt-kernel-bridge'

/** OCCT 引擎注册 id（默认 BREP 引擎；首个注册自动成为默认）。 */
export const OCCT_BREP_ENGINE_ID = 'occt'

/**
 * 装配 OCCT BREP 引擎（宿主启动时调用一次，幂等）。
 *
 * 预初始化 initOcctWasm()：wasm 加载完成后立即注册——保证注册返回后
 * getKernel() 立即可用（occt-kernel 单例已就绪），provider 直接返回预初始化实例。
 * 幂等：已注册（含运行时默认装配或宿主先行注册）则跳过注册，仅确保 wasm 预初始化。
 */
export async function registerOcctBrepEngine(): Promise<void> {
  const primitives = await initOcctWasm()
  if (isBrepEngineRegistered(OCCT_BREP_ENGINE_ID)) return
  registerBrepEngine(OCCT_BREP_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: OCCT_BREP_ENGINE_ID,
    primitives,
    capabilities: {
      evolution: true,
      heal: true,
      directEdit: true,
      advSurface: true,
      assembly: true,
      // P7 并入（D4）：OCCT 是精确 B-rep 内核——如实声明 brepjs KernelCapabilities 字段。
      exact: true,
      brepExport: true,
      exactMeasurement: true,
      tessellationModel: 'extract-time',
    },
  }))
  // P7-②：同一装配点把移植内核注册表绑定到同一个 occt-wasm 实例（D10 单实例 + 冻结）。
  // 使 L3 调移植 L2 的 op（如 fillet）在宿主装配后立即可用；幂等，重复调用安全。
  bindOcctKernel()
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

// §7.8 编译期守卫：initOcctWasm 的返回类型必须满足 BrepEngineApi。
// 若未来 occt-kernel 的导出类型不再满足接口（如接口新增方法）→ tsc 报错列出缺失。
type _AssertOcctApi = AssertSatisfiesBrepEngineApi<Awaited<ReturnType<typeof initOcctWasm>>>
