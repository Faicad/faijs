/**
 * @faicad/faijs facade entry — re-export engine + stdlib packages.
 *
 * 门面薄层：全部导出来自 @faicad/faijs-core 与 @faicad/faijs-stdlib（P5）。
 * 公共 API 面与迁移前 src/index.ts 一致（P0 导出面快照 diff 守卫）。
 *
 * createRuntime 在这里包装（E-a-1）：core 不默认装配 cad 命名空间
 * （引擎零函数知识，K5），由门面注入——3d_editor / demo 零改动。
 */
export * from '@faicad/faijs-core'
import { createRuntime as createRuntimeCore, type HostPorts, type ExecutionMode, type CadRuntime } from '@faicad/faijs-core'
import { createInternalStdlib } from '@faicad/faijs-stdlib/internal-stdlib'

/**
 * 创建 CadRuntime 并注入 cad 命名空间（标准库）。
 * 与 core 的 createRuntime 同签名；第三方库仍经 runtime.registerLib() 注册。
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime {
  const rt = createRuntimeCore(ports, mode)
  rt.registerLib('cad', createInternalStdlib())
  return rt
}
