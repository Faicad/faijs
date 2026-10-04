/**
 * test-support/editor-ops — mount the editor extension library in core's tests.
 *
 * Core's own suite is an *engine* suite: it drives scripts such as
 * `cad.fai_drill(part0, …)`, `cad.assembly({…})`, `cad.text({…})` through the
 * runtime to exercise keep/replay/lineage/exec-backend behaviour. Since D1
 * (2026-09-23) those ops live in `@faicad/faijs-extra`, and the host — not the
 * engine — assembles the `cad` namespace. Tests therefore assemble it the same
 * way a host does, through this module.
 *
 * Not part of the published package: `tsconfig.build.json` excludes
 * `src/test-support/`, so nothing here reaches `dist/`. The import of
 * `@faicad/faijs-extra` exists only in the test graph — a shipped dependency on
 * the extension library would be a cycle (extra peer-depends on core).
 *
 * Production code must never import this module.
 */
import { createRuntime as createRuntimeCore, CadRuntime } from '../cad-runtime/runtime'
import type { CadRuntimeOptions } from '../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../cad-runtime/ports'
import type { LibNamespace } from '../runtime-state'
import {
  createEditorCadNamespace, registerEditorSymbols, installEditorMeshProviders,
} from '@faicad/faijs-extra'

/**
 * The full `cad` namespace a host registers: platform surface + editor ops.
 * @returns the merged namespace.
 */
export function createApiNamespaceWithEditorOps(): LibNamespace {
  return createEditorCadNamespace()
}

/**
 * Register the static-analysis extensions the editor ops need: their names in
 * the symbol table and the `cad.engrave` mesh decoration provider.
 */
export function registerEditorExtensions(): void {
  registerEditorSymbols()
  installEditorMeshProviders()
}

/**
 * Register the merged namespace and its static-analysis extensions on an
 * existing runtime (the `registerLib('cad', …)` step a host performs).
 * @param rt - the runtime to configure.
 */
export function registerEditorNamespace(rt: CadRuntime): void {
  rt.registerLib('cad', createApiNamespaceWithEditorOps(), {
    default: true,
    packageName: '@faicad/faijs',
  })
  registerEditorExtensions()
}

/**
 * Drop-in replacement for core's `createRuntime` that also mounts the editor
 * extension library.
 *
 * @param ports - host ports.
 * @param mode - execution mode.
 * @param options - runtime options (its `cad` field is overwritten by the merged namespace).
 * @returns a runtime carrying platform + editor ops.
 */
export function createEditorRuntime(
  ports: HostPorts,
  mode?: ExecutionMode,
  options?: CadRuntimeOptions,
): CadRuntime {
  // 纯引擎 createRuntime(ports, mode, libs, options)：libs 注入即注册，
  // defaultNsName 缺省就是 'cad'（与宿主 registerLib(…, {default:true}) 等价）。
  const rt = createRuntimeCore(ports, mode, { cad: createApiNamespaceWithEditorOps() }, options)
  registerEditorExtensions()
  return rt
}

export {
  fai_drill, fai_extrude, fai_split, group, assembly, copy, load, text, svgExtrude,
} from '@faicad/faijs-extra'
