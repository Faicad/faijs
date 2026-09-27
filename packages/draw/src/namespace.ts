/**
 * namespace — fold the `draw` entry into a host's `cad` namespace.
 *
 * Mirrors `@faicad/faijs-extra` and `@faicad/faijs-sketch`: core's
 * `createApiNamespace()` carries the platform surface only; this library exports
 * the `draw` entry plus a merge function and symbol registration, and the host
 * decides whether to fold it in:
 *
 * ```ts
 * import { createRuntime } from '@faicad/faijs/browser'
 * import { createDrawCadNamespace, registerDrawSymbols } from '@faicad/faijs-draw'
 *
 * const rt = createRuntime(ports, mode)
 * rt.registerLib('cad', createDrawCadNamespace(), { default: true })
 * registerDrawSymbols()
 * ```
 *
 * The `draw` object itself lives in `./draw` and is kernel-free; this wiring file
 * is allowed to import the core registration/namespace APIs (the same seam the
 * sketch and editor packages use).
 *
 * @module
 */
import { CONTRACT_VERSION, type StdlibNamespace } from '@faicad/faijs/runtime-state'
import { registerSymbolTableEntries, unregisterSymbolTableEntries } from '@faicad/faijs/symbol-table'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import { draw } from './draw.js'

/** The entry names this library contributes to the `cad` namespace. */
export const DRAW_OPS = ['draw'] as const

/**
 * Assemble the draw-owned entry set into a `cad`-shaped namespace fragment.
 *
 * @returns the draw namespace fragment.
 */
export function createDrawNamespace(): StdlibNamespace {
  return {
    contractVersion: CONTRACT_VERSION,
    draw,
  } as unknown as StdlibNamespace
}

/**
 * Merge the draw namespace over a platform namespace.
 *
 * Pure: no registration side effects. Draw keys win on collision.
 *
 * @param platform - the platform namespace (`createApiNamespace()`).
 * @returns the merged namespace to register as the host's `cad` library.
 */
export function mergeDrawNamespace(platform: StdlibNamespace): StdlibNamespace {
  return { ...platform, ...createDrawNamespace() }
}

/**
 * The `cad` namespace a host registers: core's platform surface plus `draw`.
 *
 * @returns the namespace to hand to `registerLib('cad', …)`.
 */
export function createDrawCadNamespace(): StdlibNamespace {
  return mergeDrawNamespace(createApiNamespace())
}

/**
 * Register the `draw` name in the core symbol table, so static analysis that
 * reads `SYMBOL_TABLE` recognises `cad.draw`.
 */
export function registerDrawSymbols(): void {
  registerSymbolTableEntries(DRAW_OPS)
}

/** Undo {@link registerDrawSymbols}. */
export function unregisterDrawSymbols(): void {
  unregisterSymbolTableEntries(DRAW_OPS)
}