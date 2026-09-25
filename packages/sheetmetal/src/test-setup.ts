/**
 * Test kernel setup — core-decouple §5.8 改写：sheetmetal 不再依赖 brepjs
 * vendored registry，几何调用全部走 core API 面（@faicad/faijs/api）与 core
 * 引擎。内核装配：occt-wasm 单例初始化 + occt BREP 引擎注册（幂等）+
 * runtime-state 后端配置（brep 模式，lib 面执行的前置条件）。
 */

import { initOcctWasm } from '@faicad/faijs/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { getBrepEngine } from '@faicad/faijs/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '@faicad/faijs'

/** 与原版 morph tests/setup.ts 同名：初始化内核（幂等自装配）。 */
export async function initOCCT(): Promise<void> {
  await initOcctWasm()
  await registerOcctBrepEngine()
  const engine = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: {
      mode: 'brep',
      brepEngineId: engine.id,
      brepCapabilities: { evolution: engine.capabilities.evolution },
    },
    kernel: { brep: engine.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}
