/**
 * editor-ops — the editor op subgroup entry (`@faicad/faijs-extra/editor-ops`).
 *
 * Carries the plan §4.2 A group: `fai_drill` / `fai_extrude` / `fai_split`,
 * `group` / `assembly`, `copy`, `load`. Unlike the full entry this module never
 * reaches three's non-basic chain (`three/examples`' `SVGLoader`,
 * `Shape`/`ExtrudeGeometry`) nor opentype.js — its dependency graph is three's
 * math/container/basic-generator API only.
 *
 * That property is what lets the weapp worker mount these ops: the end side
 * needs `cad.group` / `cad.copy` / `cad.load` to replay web-authored project
 * scripts, but must not bundle the svg/3D-text chain (plan §3.1 G3). The guard
 * `entry-boundary.test.ts` pins it.
 */
import { CONTRACT_VERSION, type LibNamespace } from '@faicad/faijs/runtime-state'
import { registerSymbolTableEntries, unregisterSymbolTableEntries } from '@faicad/faijs/symbol-table'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import { EDITOR_OPS } from './op-names'
import { fai_drill } from './ops/fai_drill'
import { fai_extrude } from './ops/fai_extrude'
import { fai_split } from './ops/fai_split'
import { group, assembly } from './ops/compound'
import { copy } from './ops/copy'
import { load } from './ops/load'

/**
 * Assemble the editor-owned ops into a `cad`-shaped namespace.
 *
 * @returns the editor op namespace, ready to be spread over the platform surface.
 */
export function createEditorOpsNamespace(): LibNamespace {
  return {
    contractVersion: CONTRACT_VERSION,
    fai_drill,
    fai_extrude,
    fai_split,
    group,
    assembly,
    copy,
    load,
  } as unknown as LibNamespace
}

/**
 * Merge the editor op namespace over a platform namespace (pure).
 * @param platform - the platform namespace (`createApiNamespace()`).
 * @returns the merged namespace to register as the host's `cad` library.
 */
export function mergeEditorOpsNamespace(platform: LibNamespace): LibNamespace {
  return { ...platform, ...createEditorOpsNamespace() }
}

/**
 * The `cad` namespace a three-basic-only host registers: core's platform
 * surface plus the editor-owned ops (no svg/3D-text creators).
 *
 * This is the entry the weapp worker uses — it must not bundle
 * `three/examples`' `SVGLoader` nor the `Shape`/`ExtrudeGeometry` chain.
 *
 * @returns the namespace to hand to `registerLib('cad', …)`.
 */
export function createEditorOwnedCadNamespace(): LibNamespace {
  return mergeEditorOpsNamespace(createApiNamespace())
}

/** Register the A-group op names in the core symbol table (P5). */
export function registerEditorOpsSymbols(): void {
  registerSymbolTableEntries(EDITOR_OPS)
}

/** Undo `registerEditorOpsSymbols()`. */
export function unregisterEditorOpsSymbols(): void {
  unregisterSymbolTableEntries(EDITOR_OPS)
}

export { EDITOR_OPS } from './op-names'
export { fai_drill } from './ops/fai_drill'
export { fai_extrude } from './ops/fai_extrude'
export { fai_split } from './ops/fai_split'
export { group, assembly } from './ops/compound'
export type { GroupParams, AssemblyParams, AssemblyBehavior } from './ops/compound'
export { copy } from './ops/copy'
export { load } from './ops/load'
