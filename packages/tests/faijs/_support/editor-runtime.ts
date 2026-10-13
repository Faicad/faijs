/**
 * editor-runtime — create a runtime for the integration suite.
 *
 * After the 2026-10-13 merge, `createRuntime(ports)` provides the full cad
 * namespace (platform + sketch + extra) directly. Integration tests no
 * longer need to assemble the cad namespace — they just call
 * `createRuntime`.
 */
import { createRuntime, type CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '@faicad/faijs/cad-runtime/ports'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import type { LibNamespace } from '@faicad/faijs/runtime-state'

/**
 * Create a runtime with the full cad namespace (platform + sketch + extra).
 * @param ports - host ports.
 * @param mode - execution mode.
 * @returns a runtime carrying the complete cad namespace.
 */
export function createEditorRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime {
  return createRuntime(ports, mode)
}

/**
 * Returns the full cad namespace (platform + sketch + extra).
 *
 * Compatibility wrapper: after the merge, `createApiNamespace()` already
 * contains all ops. Tests that used to pass this to `new CadRuntime(…, { cad: … })`
 * can continue using it.
 */
export function createApiNamespaceWithEditorOps(): LibNamespace {
  return createApiNamespace()
}
