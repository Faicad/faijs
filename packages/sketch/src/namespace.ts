/**
 * namespace — assemble and merge the sketch op into a host's `cad` namespace.
 *
 * Mirrors `@faicad/faijs-extra`'s pattern: core's `createApiNamespace()` carries
 * the platform surface only; this library exports the sketch op plus a merge
 * function and symbol registration, and the host decides whether to fold it in:
 *
 * ```ts
 * import { createRuntime } from '@faicad/faijs/browser'
 * import { createSketchCadNamespace, registerSketchSymbols, installSketchSolver }
 *   from '@faicad/faijs-sketch'
 * import { createNodePlanegcsSolver } from '@faicad/faijs-sketch/node'
 *
 * const rt = createRuntime(ports, mode)
 * rt.registerLib('cad', createSketchCadNamespace(), { default: true })
 * registerSketchSymbols()
 * installSketchSolver(createNodePlanegcsSolver)
 * ```
 */
import { CONTRACT_VERSION, type LibNamespace } from '@faicad/faijs/runtime-state'
import { registerSymbolTableEntries, unregisterSymbolTableEntries } from '@faicad/faijs/symbol-table'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import { SKETCH_OP_NAME, sketch } from './op.js'

/** The op names this library contributes to the `cad` namespace. */
export const SKETCH_OPS = [SKETCH_OP_NAME] as const

/**
 * Assemble the sketch-owned op set into a `cad`-shaped namespace fragment.
 *
 * @returns the sketch namespace fragment.
 */
export function createSketchNamespace(): LibNamespace {
  return {
    contractVersion: CONTRACT_VERSION,
    sketch,
  } as unknown as LibNamespace
}

/**
 * Merge the sketch namespace over a platform namespace.
 *
 * Pure: no registration side effects. Sketch keys win on collision.
 *
 * @param platform - the platform namespace (`createApiNamespace()`).
 * @returns the merged namespace to register as the host's `cad` library.
 */
export function mergeSketchNamespace(platform: LibNamespace): LibNamespace {
  return { ...platform, ...createSketchNamespace() }
}

/**
 * The `cad` namespace a host registers: core's platform surface plus the sketch op.
 *
 * @returns the namespace to hand to `registerLib('cad', …)`.
 */
export function createSketchCadNamespace(): LibNamespace {
  return mergeSketchNamespace(createApiNamespace())
}

/**
 * Register the sketch op name in the core symbol table, so static analysis that
 * reads `SYMBOL_TABLE` recognises `cad.sketch`.
 */
export function registerSketchSymbols(): void {
  registerSymbolTableEntries(SKETCH_OPS)
}

/** Undo {@link registerSketchSymbols}. */
export function unregisterSketchSymbols(): void {
  unregisterSymbolTableEntries(SKETCH_OPS)
}