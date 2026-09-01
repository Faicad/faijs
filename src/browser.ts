/**
 * Browser facade — re-export core's browser entry (no node-host) + cad injection.
 */
export * from '@faicad/faijs-core/browser'
import { createRuntime as createRuntimeCore, type HostPorts, type ExecutionMode, type CadRuntime } from '@faicad/faijs-core'
import { createInternalStdlib } from '@faicad/faijs-stdlib/internal-stdlib'

// ── D1-⓪ 桥接：宿主（3d_editor）从 @faicad/faijs/stdlib 迁移到根/浏览器导出。
//    宿主红线：生产代码只允许 import @faicad/faijs/browser（3d_editor contract-entry.test.ts），
//    故 drill/engrave 在此暴露；对应宿主 whitelist 更新在 3d_editor 侧一并落地。
export { drill } from '@faicad/faijs-stdlib'
export { engrave } from '@faicad/faijs-stdlib'

// 装配约束求解器（D 类预览 API + B 类执行 API）——随 stdlib 出包（P5）
export { solveFaceMate, applyTransform } from '@faicad/faijs-stdlib'
export type { FaceMateConstraint, AssemblyConstraint } from '@faicad/faijs-stdlib'

/**
 * Create a CadRuntime and inject the cad namespace (standard library).
 *
 * Browser facade wrapper — delegates to core's createRuntime, then
 * registers the built-in stdlib so faijs scripts can call `cad.*` ops.
 *
 * @param ports - Host bindings (CSG engine, fonts, assets, event sink, etc.).
 * @param mode  - Optional execution mode override (auto / brep / mesh).
 * @returns A ready-to-execute CadRuntime instance with the cad library registered.
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime {
  const rt = createRuntimeCore(ports, mode)
  rt.registerLib('cad', createInternalStdlib())
  return rt
}
