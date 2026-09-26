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
      // 完整传递引擎能力声明（evolution + methods + 族级布尔位）。能力路由
      // （rotate/applyMatrix 等 2026-09-26 B 批降级为 capabilities 判定）要求
      // 静态判定读到逐核方法名——只传 evolution 会让 methods 路由的 op 被误拒。
      brepCapabilities: engine.capabilities,
    },
    kernel: { brep: engine.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}
