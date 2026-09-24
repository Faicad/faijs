/**
 * namespace — the full editor `cad` namespace assembly point.
 *
 * Core's `createApiNamespace()` returns the platform surface only. The ops that
 * serve the editor's canvas/drag/timeline model and the two non-basic-three
 * creators are assembled here with the exact keys they had inside core:
 *
 * - A group (`createEditorOpsNamespace()`, from `./editor-ops`): `fai_drill`,
 *   `fai_extrude`, `fai_split`, `group`, `assembly`, `copy`, `load`;
 * - B group: `text`, `svgExtrude`.
 *
 * The host merges the two namespaces and registers the result as its `cad`
 * library:
 *
 * ```ts
 * import { createRuntime } from '@faicad/faijs/browser'
 * import { createEditorCadNamespace, registerEditorSymbols, installEditorMeshProviders }
 *   from '@faicad/faijs-extra/browser'
 *
 * const rt = createRuntime(ports, mode)
 * rt.registerLib('cad', createEditorCadNamespace(), { default: true })
 * registerEditorSymbols()
 * installEditorMeshProviders()
 * ```
 *
 * Hosts that must not bundle three's non-basic chain (the weapp worker) use
 * `@faicad/faijs-extra/editor-ops` and `createEditorOwnedCadNamespace()` instead.
 *
 * Existing `.fai.js` scripts are unaffected: op names, signatures and semantics
 * are unchanged.
 */
import { CONTRACT_VERSION, type StdlibNamespace } from '@faicad/faijs/runtime-state'
import { registerSymbolTableEntries, unregisterSymbolTableEntries } from '@faicad/faijs/symbol-table'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import { setEngraveDecorationProvider } from '@faicad/faijs/mesh/decoration-provider'
import { ALL_EDITOR_OPS } from './op-names'
import { createEditorOpsNamespace } from './editor-ops'
import { text } from './ops/text'
import { svgExtrude } from './ops/svg-extrude'
import { createEngraveDecorationProvider } from './mesh/engrave-decoration'

/**
 * Assemble the whole editor-owned op set (A + B) into a `cad`-shaped namespace.
 *
 * Keys match the pre-split core namespace exactly, so a host that already
 * carried these ops keeps working after swapping the import source.
 *
 * @returns the editor namespace, ready to be spread over the platform surface.
 */
export function createEditorNamespace(): StdlibNamespace {
  return {
    ...createEditorOpsNamespace(),
    contractVersion: CONTRACT_VERSION,
    text,
    svgExtrude,
  } as unknown as StdlibNamespace
}

/**
 * Merge the editor namespace over a platform namespace.
 *
 * Pure: no registration side effects. Editor keys win on collision — today there
 * is none, and the membership guard fails loudly if one is ever introduced.
 *
 * @param platform - the platform namespace (`createApiNamespace()`).
 * @returns the merged namespace to register as the host's `cad` library.
 */
export function mergeEditorNamespace(platform: StdlibNamespace): StdlibNamespace {
  return { ...platform, ...createEditorNamespace() }
}

/**
 * The `cad` namespace a host registers: core's platform surface plus the whole
 * editor op set.
 *
 * Saves hosts from importing `createApiNamespace()` themselves; the extension
 * library is the party that knows the platform surface it extends.
 *
 * @returns the namespace to hand to `registerLib('cad', …)`.
 */
export function createEditorCadNamespace(): StdlibNamespace {
  return mergeEditorNamespace(createApiNamespace())
}

/**
 * Register every editor op name in the core symbol table (P5).
 *
 * Static analysis that reads `SYMBOL_TABLE` (callee lookup, the fcstd boundary
 * guard) then sees the editor ops. The runtime `check()` does not validate
 * callee existence, so this is an analysis aid, not a gate.
 */
export function registerEditorSymbols(): void {
  registerSymbolTableEntries(ALL_EDITOR_OPS)
}

/** Undo `registerEditorSymbols()`. */
export function unregisterEditorSymbols(): void {
  unregisterSymbolTableEntries(ALL_EDITOR_OPS)
}

/**
 * Install the mesh-level capabilities core asks its host for.
 *
 * Today: the `cad.engrave` mesh decoration provider (text/SVG → geometry). The
 * BREP path of `engrave` needs nothing from here — it uses OCCT directly.
 */
export function installEditorMeshProviders(): void {
  setEngraveDecorationProvider(createEngraveDecorationProvider())
}

/** Uninstall the providers installed by `installEditorMeshProviders()`. */
export function uninstallEditorMeshProviders(): void {
  setEngraveDecorationProvider(null)
}

export { ALL_EDITOR_OPS, CREATOR_OPS } from './op-names'
