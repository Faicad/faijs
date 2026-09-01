/**
 * P3 测试专用内核装配：等价于 brepjs tests 的 `./setup.ts`（initKernel）。
 *
 * 我们的内核不是 brepjs 的 register/更替机制，而是 D10 单实例：宿主 `initOcctWasm()`
 * 就绪后 `bindOcctKernel()` 把唯一 OcctKernel 注入移植树的 registry（幂等 + 冻结）。
 * division 列表来自 docs/plans/2026-09-01-layered-api-architecture.md §D10。
 *
 * `shouldSkipSuite`/`skipIfDiverges`：转发到同目录 `kernel-divergences.ts`
 *（brepjs 官方注册表的忠实移植，当前内核 `occt-wasm` 分支）。occt-wasm 在 brepjs
 * CI 里会跳过「fuse 应用 simplify 后合并共面」这类 occt 独有的 behavior，见注册项。
 */

import { beforeAll } from 'vitest'
import { initOcctWasm } from '@faicad/faijs-core/occt-kernel/occtKernel'
import { bindOcctKernel, getBrepjsKernel, isOcctKernelBound } from '@faicad/faijs-core/api/occt-kernel-bridge'
import { getKernel } from '@faicad/faijs-core/vendored/brepjs/kernel/index'
// 真实 divergence 注册表（按 occt-wasm 分支咨询），见同目录 kernel-divergences.ts
export {
  currentKernelId,
  isBrepkit,
  shouldSkipSuite,
  skipIfDiverges,
} from './kernel-divergences.js'

export { bindOcctKernel, getBrepjsKernel, isOcctKernelBound, getKernel }

/** brepjs 测试同款 initKernel：在 beforeAll 里 await 后即可开展（内核已绑定冻结）。 */
export async function initKernel(): Promise<void> {
  await initOcctWasm()
  bindOcctKernel()
}

/** 注册 beforeAll：各测试共用（内核绑定含幂等，重复调用安全）。 */
export function useKernelBeforeAll(): void {
  beforeAll(async () => {
    await initKernel()
  }, 30000)
}