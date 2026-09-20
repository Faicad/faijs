/**
 * createRuntimeWithCad — D1（2026-09-19）：cad 默认命名空间内置引擎。
 *
 * faijs 的定位是「引擎 + 标准库」。cad 经 defineOp 注册为均匀库数据，与第三方库
 * 走完全相同的 registerLib 路径，引擎并不对其特判（K5 不违反）。因此宿主拿到
 * createRuntime 即带 cad，无需再经独立的门面包注入——这正是删除门面（D2-A）的前提。
 *
 * 需要「不带 cad 的纯引擎」的宿主（如只想用 parser / runtime 框架自注册别的 op 集）
 * 可直接用 cad-runtime/runtime 的 createRuntime（不带 cad 注册）。
 */
import { createRuntime as createRuntimeCore, type CadRuntime, type CadRuntimeOptions } from './runtime'
import type { ExecutionMode, HostPorts } from './ports'
import { createApiNamespace } from '../api/api-namespace'

export { CadRuntime, computeContentKey, AppendPrefixError } from './runtime'

/**
 * 创建带内置 `cad` 库的 CadRuntime（D1）。
 * @param ports - host ports (io/env/kernel backends) supplied by the embedding host.
 * @param mode - execution mode ('auto' | 'brep' | 'mesh'); defaults to the runtime's own logic.
 * @param options - additional CadRuntime options (forwarded to the core runtime).
 * @returns a CadRuntime with the `cad` namespace pre-registered as the default lib.
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode, options?: CadRuntimeOptions): CadRuntime {
  const rt = createRuntimeCore(ports, mode, undefined, options)
  rt.registerLib('cad', createApiNamespace(), {
    default: true,
    packageName: '@faicad/faijs',
  })
  return rt
}
