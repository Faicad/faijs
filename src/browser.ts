/**
 * Browser facade — re-export core's browser entry (no node-host) + cad injection.
 */
export * from '@faicad/faijs-core/browser'
import { createRuntime as createRuntimeCore, type HostPorts, type ExecutionMode, type CadRuntime } from '@faicad/faijs-core'
import { createInternalStdlib } from '@faicad/faijs-stdlib/internal-stdlib'

// 装配约束求解器（D 类预览 API + B 类执行 API）——随 stdlib 出包（P5）
export { solveFaceMate, applyTransform } from '@faicad/faijs-stdlib'
export type { FaceMateConstraint, AssemblyConstraint } from '@faicad/faijs-stdlib'

/**
 * 创建 CadRuntime 并注入 cad 命名空间（标准库；E-a-1 门面包装）。
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime {
  const rt = createRuntimeCore(ports, mode)
  rt.registerLib('cad', createInternalStdlib())
  return rt
}
