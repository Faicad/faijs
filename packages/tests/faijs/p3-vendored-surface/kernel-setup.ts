/**
 * P3 测试专用内核装配：等价于 brepjs tests 的 `./setup.ts`（initKernel）。
 *
 * 2026-09-25 core-decouple Phase 2：core 不再注入 vendored kernel registry
 * （`api/occt-kernel-bridge.ts` 已删除）。本文件改为**自装配**——从 faijs 唯一的
 * occt-wasm 单例（`initOcctWasm` 链路）构造 `OcctWasmAdapter` 并注册、冻结
 * vendored registry（D10 单实例语义由该单例天然保证）。
 *
 * `injectCurrentBrepEngineAsKernel`/`getBrepjsKernel`/`isOcctKernelBound` 保留原
 * 导出名（tests 既有 import 面不变），语义对应：自装配（幂等：已激活则 no-op）/
 * vendored registry 默认内核 / registry 是否有激活内核。
 *
 * division 列表来自 docs/plans/2026-09-01-layered-api-architecture.md §D10。
 *
 * `shouldSkipSuite`/`skipIfDiverges`：转发到同目录 `kernel-divergences.ts`
 *（brepjs 官方注册表的忠实移植，当前内核 `occt-wasm` 分支）。occt-wasm 在 brepjs
 * CI 里会跳过「fuse 应用 simplify 后合并共面」这类 occt 独有的 behavior，见注册项。
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
// 真实 divergence 注册表（按 occt-wasm 分支咨询），见同目录 kernel-divergences.ts
export {
  currentKernelId,
  isBrepkit,
  shouldSkipSuite,
  skipIfDiverges,
} from './kernel-divergences.js'

/** vendored registry 的默认内核读取器（原桥导出名，语义等价）。 */
export const getBrepjsKernel = getKernel

/** vendored registry 是否有激活内核（原桥 isOcctKernelBound 语义）。 */
export function isOcctKernelBound(): boolean {
  return getActiveKernelId() !== null
}

export { getKernel }

/**
 * 自装配 vendored kernel registry（core-decouple Phase 2 后由 tests 承担的原桥职责）。
 *
 * 幂等：registry 已有激活内核（含跨实例 globalThis 同步）则 no-op，返回当前内核。
 */
export async function injectCurrentBrepEngineAsKernel(): Promise<ReturnType<typeof getKernel>> {
  await initOcctWasm()
  await registerOcctBrepEngine()
  syncRegistryFromGlobal()
  if (getActiveKernelId() === null) {
    const adapter = OcctWasmAdapter.fromKernel(getHostKernel() as never)
    registerKernel('occt-wasm', adapter)
    freezeKernels()
  }
  syncRegistryToGlobal()
  return getKernel()
}

/** brepjs 测试同款 initKernel：在 beforeAll 里 await 后即可开展（内核已绑定冻结）。 */
export async function initKernel(): Promise<void> {
  await injectCurrentBrepEngineAsKernel()
}

/** 注册 beforeAll：各测试共用（自装配含幂等，重复调用安全）。 */
export function useKernelBeforeAll(): void {
  beforeAll(async () => {
    await initKernel()
  }, 30000)
}
