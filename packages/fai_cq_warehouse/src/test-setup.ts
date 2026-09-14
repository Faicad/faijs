/**
 * test-setup.ts — CLI/测试侧 configureBackends（方案 §6 W2 交付物）。
 *
 * 库代码本身不初始化内核（§5.1 约束 2：host provides it）；测试与脚本扮演
 * host 角色：initOcctWasm 后把唯一实例注入 Backends，再经 requireKernel() 取用。
 * Backends 形状对齐 core/runtime-state.ts（contractVersion/config/kernel/fonts/
 * texture/assets/events 必填；本包用不到的端口置 null 并注明）。
 */

import { initOcctWasm } from '@faicad/faijs-core/occt-kernel/occtKernel'
import { configureBackends, CONTRACT_VERSION } from '@faicad/faijs-core'
import type { Backends } from '@faicad/faijs-core'

let configured = false

/** 初始化 occt-wasm 并注入 Backends（幂等：重复调用只装配一次）。 */
export async function setupWarehouseKernel(): Promise<void> {
  if (configured) return
  const kernel = await initOcctWasm()
  // 本包只消费 kernel.brep；fonts/texture/assets/events 等端口测试用不到，置 null
  const backends: Backends = {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep' },
    kernel: { brep: kernel, csg: undefined, sdf: undefined },
    fonts: null,
    texture: null,
    assets: null,
    events: null,
  }
  configureBackends(backends)
  configured = true
}
