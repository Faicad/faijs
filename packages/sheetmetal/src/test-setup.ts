/**
 * Test kernel setup — D10 单实例装配（对应 morph tests/setup 的 initOCCT）。
 *
 * 设计：docs/plans/2026-09-01-layered-api-architecture.md §7.5 ④ / §D10
 *
 * 2026-09-25 core-decouple Phase 2：core 不再注入 vendored kernel registry
 * （`api/occt-kernel-bridge.ts` 已删除）——本文件自装配：从 faijs 唯一的
 * occt-wasm 单例（`initOcctWasm` 链路）构造 `OcctWasmAdapter` 并注册、冻结
 * vendored registry（幂等）。钣金 2D 层（unfold/dxf/nest）经 compat 直调 compat
 * L2 时需要它；纯数学测试（reference）不依赖内核，但保留同一装配以与原版测试
 * 形态一致。
 */

import { initOcctWasm, getKernel as getHostKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { OcctWasmAdapter } from '@faicad/faijs-brepjs/kernel/occtWasm/occtWasmAdapter'
import {
  registerKernel,
  freezeKernels,
  getActiveKernelId,
  syncRegistryFromGlobal,
  syncRegistryToGlobal,
} from '@faicad/faijs-brepjs/kernel/index'

/** 与原版 morph tests/setup.ts 同名：初始化内核（幂等自装配）。 */
export async function initOCCT(): Promise<void> {
  await initOcctWasm()
  await registerOcctBrepEngine()
  syncRegistryFromGlobal()
  if (getActiveKernelId() === null) {
    const adapter = OcctWasmAdapter.fromKernel(getHostKernel() as never)
    registerKernel('occt-wasm', adapter)
    freezeKernels()
  }
  syncRegistryToGlobal()
}
