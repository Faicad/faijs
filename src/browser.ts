/**
 * Browser facade — re-export core's browser entry (no node-host) + cad injection.
 */
export * from '@faicad/faijs-core/browser'
import { createRuntime as createRuntimeCore, type HostPorts, type ExecutionMode, type CadRuntime } from '@faicad/faijs-core'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'

// ── D1-⓪ 迁移完成（P6）：原 drill/engrave/solveFaceMate/applyTransform 由 stdlib 出包，
//    现已全部并入 core 的 L3 api/ 层，随 `export * from core/browser` 一并导出。
//    宿主红线：生产代码只 import @faicad/faijs/browser（3d_editor whitelist），
//    宿主侧 import 已批量迁移，见 3d_editor D1-⓪。

/**
 * Create a CadRuntime and inject the cad namespace (L3 API surface).
 *
 * Browser facade wrapper — delegates to core's createRuntime, then
 * registers the built-in L3 api so faijs scripts can call `cad.*` ops.
 *
 * @param ports - Host bindings (CSG engine, fonts, assets, event sink, etc.).
 * @param mode  - Optional execution mode override (auto / brep / mesh).
 * @returns A ready-to-execute CadRuntime instance with the cad library registered.
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime {
  const rt = createRuntimeCore(ports, mode)
  rt.registerLib('cad', createApiNamespace(), {
    default: true,
    compat: false,
    packageName: '@faicad/faijs',
  })
  return rt
}
