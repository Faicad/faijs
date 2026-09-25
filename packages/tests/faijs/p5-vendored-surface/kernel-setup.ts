/**
 * P5 测试专用内核装配：等价于 brepjs tests 的 `./setup.ts`(initKernel)。
 *
 * 与 P3 批同款（2026-09-25 core-decouple Phase 2）：core 不再注入 vendored
 * kernel registry（`api/occt-kernel-bridge.ts` 已删除）——本文件自装配：从 faijs
 * 唯一的 occt-wasm 单例（`initOcctWasm` 链路）构造 `OcctWasmAdapter` 并注册、冻结
 * vendored registry（D10 单实例语义由该单例天然保证）。仅 kernel-bound 的 P5
 * 测试(operations 建模、sketching 草图到实体)需要 `useKernelBeforeAll`；纯 2D/gear
 * 数学测试不需要。
 *
 * `injectCurrentBrepEngineAsKernel`/`getBrepjsKernel`/`isOcctKernelBound` 保留原
 * 导出名（tests 既有 import 面不变），语义对应：自装配（幂等）/ vendored registry
 * 默认内核 / registry 是否有激活内核。
 *
 * 来源：docs/plans/2026-09-01-layered-api-architecture.md §P5 / §D10。
 */

import { beforeAll } from 'vitest'
import { initOcctWasm, getKernel as getHostKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { OcctWasmAdapter } from '@faicad/faijs-brepjs/kernel/occtWasm/occtWasmAdapter'
import {
  registerKernel,
  freezeKernels,
  getKernel,
  getActiveKernelId,
  syncRegistryFromGlobal,
  syncRegistryToGlobal,
} from '@faicad/faijs-brepjs/kernel/index'

/** vendored registry 的默认内核读取器（原桥导出名，语义等价）。 */
export const getBrepjsKernel = getKernel

/** vendored registry 是否有激活内核（原桥 isOcctKernelBound 语义）。 */
export function isOcctKernelBound(): boolean {
  return getActiveKernelId() !== null
}

export { getKernel }

/** 与 brepjs tests/setup.ts 同契约的 `currentKernel`（D10 恒为 occt-wasm）。 */
export const currentKernel: string = 'occt-wasm'

/** 与 brepjs tests/setup-kernel.ts 同契约的 initOCCT / initOC 别名：同样完成自装配。 */
export async function initOCCT(): Promise<void> {
  await initKernel()
}
export const initOC = initOCCT

/** brepjs 测试同款 initKernel：await 后内核已绑定冻结（自装配，幂等）。 */
export async function initKernel(): Promise<void> {
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

/** 注册 beforeAll：各 kernel-bound 测试共用。 */
export function useKernelBeforeAll(): void {
  beforeAll(async () => {
    await initKernel()
  }, 30000)
}
