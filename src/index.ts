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

// ── D1-⓪ 桥接：宿主（3d_editor）从 @faicad/faijs/stdlib 迁移到根导出的先行导出。
//    在 P6（取消 stdlib）之前 drill/engrave 暂从 stdlib re-export，P6 落 L3 后改指 L3 API 面。
export { drill } from '@faicad/faijs-stdlib'
export { engrave } from '@faicad/faijs-stdlib'

/**
 * Create a CadRuntime and inject the cad namespace (standard library).
 *
 * Facade wrapper — same signature as core's createRuntime; third-party
 * libraries are still registered via runtime.registerLib().
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
