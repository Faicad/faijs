/**
 * Test kernel setup — D10 单实例装配（对应 morph tests/setup 的 initOCCT）。
 *
 * 设计：docs/plans/2026-09-01-layered-api-architecture.md §7.5 ④ / §D10
 *
 * 改走 faijs `initOcctWasm` 链路：wasm 就绪后 `bindOcctKernel()` 把唯一实例
 * 注入移植树的 kernel registry（幂等 + 冻结）。钣金 2D 层（unfold/dxf/nest）
 * 经 compat 直调 compat L2 时需要它；纯数学测试（reference）不依赖内核，
 * 但保留同一装配以与原版测试形态一致。
 */

import { initOcctWasm } from '@faicad/faijs-core/occt-kernel/occtKernel'
import { bindOcctKernel } from '@faicad/faijs-core/api/occt-kernel-bridge'

/** 与原版 morph tests/setup.ts 同名：初始化内核（幂等）。 */
export async function initOCCT(): Promise<void> {
  await initOcctWasm()
  bindOcctKernel()
}
