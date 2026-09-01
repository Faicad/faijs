/**
 * P5 测试专用内核装配：等价于 brepjs tests 的 `./setup.ts`(initKernel)。
 *
 * 与 P3 批同款：我们的内核不是 brepjs 的 register/更替机制，而是 D10 单实例——
 * 宿主 `initOcctWasm()` 就绪后 `bindOcctKernel()` 把唯一 OcctKernel 注入移植树
 * 的 registry(幂等 + 冻结)。仅 kernel-bound 的 P5 测试(operations 建模、sketching
 * 草图到实体)需要 `useKernelBeforeAll`；纯 2D/gear 数学测试不需要。
 *
 * 来源：docs/plans/2026-09-01-layered-api-architecture.md §P5 / §D10。
 */

import { beforeAll } from 'vitest'
import { initOcctWasm } from '@faicad/faijs-core/occt-kernel/occtKernel'
import { bindOcctKernel, getBrepjsKernel, isOcctKernelBound } from '@faicad/faijs-core/api/occt-kernel-bridge'
import { getKernel } from '@faicad/faijs-core/vendored/brepjs/kernel/index'

export { bindOcctKernel, getBrepjsKernel, isOcctKernelBound, getKernel }

/** 与 brepjs tests/setup.ts 同契约的 `currentKernel`（D10 恒为 occt-wasm）。 */
export const currentKernel: string = 'occt-wasm'

/** 与 brepjs tests/setup-kernel.ts 同契约的 initOCCT / initOC 别名：同样完成 D10 绑定。 */
export async function initOCCT(): Promise<void> {
  await initOcctWasm()
  bindOcctKernel()
}
export const initOC = initOCCT

/** brepjs 测试同款 initKernel：await 后内核已绑定冻结。 */
export async function initKernel(): Promise<void> {
  await initOcctWasm()
  bindOcctKernel()
}

/** 注册 beforeAll：各 kernel-bound 测试共用。 */
export function useKernelBeforeAll(): void {
  beforeAll(async () => {
    await initKernel()
  }, 30000)
}