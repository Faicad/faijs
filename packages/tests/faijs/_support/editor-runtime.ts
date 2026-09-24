/**
 * editor-runtime — mount the editor extension library in the integration suite.
 *
 * Since D1 (2026-09-23) the editor-owned ops (`fai_*` / `group` / `assembly` /
 * `copy` / `load`, plus `text` / `svgExtrude`) live in `@faicad/faijs-extra`, and
 * the host — not the engine — assembles the `cad` namespace. Integration tests
 * are hosts, so they assemble it here.
 */
import { createRuntime as createRuntimeCore, type CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '@faicad/faijs/cad-runtime/ports'
import type { StdlibNamespace } from '@faicad/faijs'
import {
  createEditorCadNamespace, installEditorMeshProviders, registerEditorSymbols,
} from '@faicad/faijs-extra'

/** Platform surface + editor ops: the `cad` namespace a host registers. */
export function createApiNamespaceWithEditorOps(): StdlibNamespace {
  return createEditorCadNamespace()
}

/** Register the static-analysis extensions the editor ops need. */
export function registerEditorExtensions(): void {
  registerEditorSymbols()
  installEditorMeshProviders()
}

/**
 * Drop-in replacement for `createRuntime` that mounts the editor ops too.
 * @param ports - host ports.
 * @param mode - execution mode.
 * @returns a runtime carrying platform + editor ops.
 */
export function createEditorRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime {
  const rt = createRuntimeCore(ports, mode, { cad: createApiNamespaceWithEditorOps() })
  registerEditorExtensions()
  return rt
}
