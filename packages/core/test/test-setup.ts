/**
 * @platform occt
 * core vitest 全局装配（2026-09-25 core-decouple Phase 2 §5.1 / wrapup §4.3）。
 *
 * brepjs 子包删除后（裁决 9），core 不再注入任何外部 kernel registry——
 * compat op（投影）与 view 投影统一走 core 自有引擎链路：`initOcctWasm` 单例
 * 就绪 + `registerOcctBrepEngine`（幂等，core 引擎注册表）。本 setup 在每
 * worker 启动时完成该装配；纯单元测试文件不受影响（仅多加载一份 wasm 单例，
 * 无功能副作用）。
 */
import { initOcctWasm } from '../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../src/brep/engine/adapters/occt'

// jsdom worker（extra 收编带入的 svg mesh 测试，`@vitest-environment jsdom`）跳过
// occt 装配：occt-wasm 的 `init({ wasm: ArrayBuffer })` 在 browser-like 环境走
// URL/fetch 路径，把 ArrayBuffer 当 filename → `isFileURI: filename.startsWith is
// not a function`（TypeError，2026-10-13 实证）。jsdom 测试只跑纯 JS mesh 路径
// （svgExtrude），不需要 occt；若未来出现确实需要 BREP 引擎的 jsdom 测试，应改为
// 在该测试内显式 setOcctWasmInitFn（jsdom 无真实 fetch/fs 语义，occt-wasm 不能裸跑）。
if (typeof document === 'undefined') {
  await initOcctWasm()
  await registerOcctBrepEngine()
}
