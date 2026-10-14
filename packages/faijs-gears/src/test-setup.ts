/**
 * test-setup.ts — 本包测试与脚本侧的**宿主装配**（host 角色）。
 *
 * 库代码本身不装配内核（内核取用面收敛 2026-10-14 §3.1：库只经双句柄取宿主已注入的
 * 内核；本包的 `src/` 里没有 `initOcctWasm`，也没有裸槽位读）。测试
 * （`test/setup.ts` 经 vitest `setupFiles`）与脚本（`scripts/*.ts`、
 * `test/stability/runner-entry.ts` 子进程）扮演宿主：初始化 occt-wasm 单例、注册
 * occt BREP 引擎、把引擎的 L1 契约面注入 `Backends.kernel.brep`，并让
 * `config.brepEngineId = 'occt'`。
 *
 * 这样 `gearKernel()` 的两个出口才都就绪：`getBrepApi()`（读注入槽位的 L1 面）与
 * `getOcctKernel()`（occt 平台面）。**不注入 raw 内核**——注入 L1 适配器才能让
 * 「类型说有、运行时没有」的偏差被测试发现。
 *
 * 与 `packages/sheetmetal/test/setup.ts` 的 `initOCCT()` 同构（同一装配顺序）。
 * 本文件名在 `scripts/check-lib-layering.mjs` 的自装配豁免名单里
 * （`BOOTSTRAP_EXEMPT`），是库包里唯一允许叫内核初始化函数的地方。
 */

import { initOcctWasm } from '@faicad/faijs/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '@faicad/faijs/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '@faicad/faijs'

let configured: Promise<void> | null = null

/** 装配 occt 内核 + 注入 Backends（幂等：并发/重复调用共用同一次装配）。 */
export function initOCCT(): Promise<void> {
  configured ??= (async () => {
    await initOcctWasm()
    await registerOcctBrepEngine()
    const engine = await getActiveBrepEngine()
    // 本包只消费 kernel.brep；fonts/texture/assets/events 测试与脚本都用不到，置 null 并在此注明。
    const backends: Backends = {
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'brep', brepEngineId: engine.id },
      kernel: { brep: engine.primitives, csg: undefined, sdf: undefined },
      fonts: null,
      texture: null,
      assets: null,
      events: null,
    }
    configureBackends(backends)
  })()
  return configured
}
