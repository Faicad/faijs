/**
 * core vitest 全局装配（2026-09-25 core-decouple Phase 2 §5.1）。
 *
 * 删除 `api/occt-kernel-bridge.ts` 后，core 不再向 vendored kernel registry
 * 注入（`registerOcctBrepEngine` 只管 core 引擎注册表）——跑 compat op（vendored
 * 投影）与 view 投影（`borrowBrepjsShape` → `getVendoredKernel`）的测试需自行
 * 装配。本 setup 在每 worker 启动时自装配 vendored registry：
 *   occt-wasm 单例（`initOcctWasm` 链路）→ `OcctWasmAdapter.fromKernel` →
 *   registerKernel('occt-wasm') → freezeKernels（幂等）。
 *
 * 纯单元测试文件不受影响（仅多加载一份 wasm 单例，无功能副作用）。core 测试
 * 无「registry 未注入」断言，故全局注入安全。
 */
import { initOcctWasm, getKernel as getHostKernel } from '../occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { OcctWasmAdapter } from '@faicad/faijs-brepjs/kernel/occtWasm/occtWasmAdapter'
import {
  registerKernel,
  freezeKernels,
  getActiveKernelId,
  syncRegistryFromGlobal,
  syncRegistryToGlobal,
} from '@faicad/faijs-brepjs/kernel/index'

await initOcctWasm()
await registerOcctBrepEngine()
syncRegistryFromGlobal()
if (getActiveKernelId() === null) {
  const adapter = OcctWasmAdapter.fromKernel(getHostKernel() as never)
  registerKernel('occt-wasm', adapter)
  freezeKernels()
}
syncRegistryToGlobal()
