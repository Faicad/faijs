/**
 * @platform occt
 * core vitest 全局装配（2026-09-25 core-decouple Phase 2 §5.1 / wrapup §4.3）。
 *
 * brepjs 子包删除后（裁决 9），core 不再注入任何 vendored kernel registry——
 * compat op（投影）与 view 投影统一走 core 自有引擎链路：`initOcctWasm` 单例
 * 就绪 + `registerOcctBrepEngine`（幂等，core 引擎注册表）。本 setup 在每
 * worker 启动时完成该装配；纯单元测试文件不受影响（仅多加载一份 wasm 单例，
 * 无功能副作用）。
 */
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'

await initOcctWasm()
await registerOcctBrepEngine()
