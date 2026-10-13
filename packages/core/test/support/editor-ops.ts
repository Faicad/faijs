/**
 * test-support/editor-ops — re-export editor ops for core's tests.
 *
 * After the 2026-10-13 merge, sketch and faijs-extra were absorbed into core.
 * `createRuntime(ports)` now provides the full cad namespace (platform + sketch
 * + extra) directly — tests no longer need to merge/register editor ops.
 *
 * This module remains as a thin compatibility layer so existing test imports
 * continue to resolve without per-file changes:
 * - `createApiNamespaceWithEditorOps()` → `createApiNamespace()` (already full)
 * - `createEditorRuntime(ports, mode?)` → `createRuntime(ports, mode)`
 * - `registerEditorExtensions()` → no-op (cad is built-in, nothing to register)
 *
 * Not part of the published package: `tsconfig.build.json` excludes
 * `src/test-support/`, so nothing here reaches `dist/`.
 * Production code must never import this module.
 */
export {
  fai_drill, fai_extrude, fai_split, group, assembly, copy, load, text, svgExtrude,
} from '../../src/extra'
export {
  sketch, assertSketchParams,
} from '../../src/sketch/op'

// ── Compatibility wrappers for tests that used to assemble editor ops ──

import { createApiNamespace } from '../../src/api/api-namespace'
import { createRuntime } from '../../src/cad-runtime/runtime'
import type { LibNamespace } from '../../src/runtime-state'
import type { HostPorts } from '../../src/cad-runtime/ports'
import type { ExecutionMode } from '../../src/cad-runtime/ports'
import type { CadRuntime } from '../../src/cad-runtime/runtime'

/**
 * Returns the full cad namespace (platform + sketch + extra).
 *
 * After the merge, `createApiNamespace()` already contains all ops.
 * This function is kept as a compatibility wrapper for tests that pass it
 * to `new CadRuntime(ports, mode, { cad: ... })`.
 */
export function createApiNamespaceWithEditorOps(): LibNamespace {
  return createApiNamespace()
}

/**
 * Create a runtime with the full built-in cad namespace.
 *
 * Compatibility wrapper: tests that used to call a custom assembly function
 * now just use `createRuntime` which has the full cad namespace built-in.
 */
export function createEditorRuntime(
  ports: HostPorts,
  mode?: ExecutionMode,
  options?: { determinism?: 'error' | 'warn' | 'off' },
): CadRuntime {
  return createRuntime(ports, mode, undefined, options)
}

/**
 * No-op: editor extensions (symbols, mesh providers) are now built-in.
 *
 * Kept for compatibility with tests that used to call this in `beforeAll`.
 */
export function registerEditorExtensions(): void {
  // No-op: cad namespace is fully built-in after the 2026-10-13 merge.
}
