/**
 * host-env — 宿主环境轴（§2.5）的测试装配支撑。
 *
 * 导出命令（`cad.exportStl` / `cad.exportBrep` / `cad.exportStep` / `cad.export3mf`）
 * 只在 `'node'` 宿主开放，门禁读**装配期**写入的 `HostPorts.hostEnv`（经
 * `config.hostEnv` 暴露）。因此任何直接（或经脚本面）调用这些命令的用例都必须先
 * 声明宿主：漏声明等于非 node，用例会整体翻到 `current=<none>` 的拒绝分支。
 *
 * 两个装配形态各一份，覆盖两种取用路径：
 * - `hostPorts()` / `runtimeOn()`：建 `CadRuntime`——脚本面（`cad.*`）用例用；
 * - `configureHost()`：直连 `configureBackends`，不建 runtime——库面直连（TS
 *   import 同一函数）与无 runtime 的用例用，验证「门在函数体内、无旁路」。
 *
 * `runtimeOn` 的命名空间带编辑器 op（`createApiNamespaceWithEditorOps`），与
 * `.fai.js` 真实可用面一致。
 */

import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { CadRuntimeOptions } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { createApiNamespaceWithEditorOps } from './editor-ops'

/** 宿主环境三值；`undefined` = 未声明（既有的「只给 events」装配形态）。 */
export type TestHostEnv = 'node' | 'browser' | 'weapp' | undefined

/** 宿主声明三值 + 未声明（只给 events 的既有装配形态）。 */
export function hostPorts(hostEnv?: 'node' | 'browser' | 'weapp'): HostPorts {
  return { events: { emit: () => {} }, hostEnv } as HostPorts
}

/** 指定宿主声明的 runtime（门禁读装配期的 `HostPorts.hostEnv`）。 */
export function runtimeOn(
  hostEnv: TestHostEnv,
  mode: ExecutionMode = 'brep',
  options?: CadRuntimeOptions,
): CadRuntime {
  return new CadRuntime(hostPorts(hostEnv), mode, { cad: createApiNamespaceWithEditorOps() }, options)
}

/**
 * 直连形态的 backends 装配（不建 runtime——门禁读同一份 `config.hostEnv` /
 * `config.brepEngineId`）。用来验证库面直连旁路：门在函数体内，TS import 同一函数
 * 同样被拒。
 */
export function configureHost(hostEnv: TestHostEnv, engineId: string | null = 'occt'): void {
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: engineId, hostEnv },
    kernel: { brep: null, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}
