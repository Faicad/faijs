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

import { registerBrepEngine, type BrepEngine } from '../registry'
import type { AssertSatisfiesBrepEngineApi } from '../primitives'
import { initOcctWasm } from '../../../occt-kernel/occtKernel'

/** OCCT 引擎注册 id（默认 BREP 引擎；首个注册自动成为默认）。 */
export const OCCT_BREP_ENGINE_ID = 'occt'

/**
 * 装配 OCCT BREP 引擎（宿主启动时调用一次，幂等）。
 *
 * 预初始化 initOcctWasm()：wasm 加载完成后立即注册——保证注册返回后
 * getKernel() 立即可用（occt-kernel 单例已就绪），provider 直接返回预初始化实例。
 */
export async function registerOcctBrepEngine(): Promise<void> {
  const primitives = await initOcctWasm()
  registerBrepEngine(OCCT_BREP_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: OCCT_BREP_ENGINE_ID,
    primitives,
    capabilities: {
      evolution: true,
      heal: true,
      directEdit: true,
      advSurface: true,
      assembly: true,
    },
  }))
}

// §7.8 编译期守卫：initOcctWasm 的返回类型必须满足 BrepEngineApi。
// 若未来 occt-kernel 的导出类型不再满足接口（如接口新增方法）→ tsc 报错列出缺失。
type _AssertOcctApi = AssertSatisfiesBrepEngineApi<Awaited<ReturnType<typeof initOcctWasm>>>
