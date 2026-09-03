/**
 * @faicad/faijs facade entry — re-export engine + L3 API surface.
 *
 * 门面薄层：全部导出来自 @faicad/faijs-core（P6 起原 stdlib 包取消，L3 API 面并入 core 的 api/ 层）。
 * 公共 API 面与迁移前 src/index.ts 一致（P0 导出面快照 diff 守卫）。
 *
 * createRuntime 在这里包装（E-a-1）：core 运行时不默认装配 cad 命名空间
 * （引擎零函数知识，K5），由门面注入——3d_editor / demo 零改动。
 */
export * from '@faicad/faijs-core'
import { createRuntime as createRuntimeCore, type HostPorts, type ExecutionMode, type CadRuntime } from '@faicad/faijs-core'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'

// ── D1-⓪ 迁移完成（P6）：drill/engrave 已落入 L3 api/ 层，随上方 `export * from core`
//    一并导出；宿主（3d_editor）从 @faicad/faijs/browser 直接导入即可，不再需要 stdlib 子路径。

/**
 * Create a CadRuntime and inject the cad namespace (L3 API surface).
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
  // P23（§4.2 ②）：cad 命名空间已重建到兼容面同源清单上——faijs 特有 dual op
  // （mesh+brep 双路径）+ 生成脚本面 op（compatOp(projectBrepOp(…)) 包装的
  // brep-only 语句级 op）。`compat: false` 语义不变：cad 是引擎内置面，函数
  // 已自带 defineOp/compatOp 元数据，无需再经 admitCompatLib 收口。
  rt.registerLib('cad', createApiNamespace(), { default: true, compat: false })
  return rt
}
