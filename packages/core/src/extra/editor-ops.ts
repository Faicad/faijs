/**
 * @faicad/faijs/extra/editor-ops — lightweight editor op closure.
 *
 * Carries the A group editor ops (`fai_drill` / `fai_extrude` / `fai_split`,
 * `group` / `assembly`, `copy`, `load`) without the heavy text/SVG geometry
 * chain (opentype.js, etc.). The cad namespace is now fully assembled inside
 * `createApiNamespace()`, so this entry no longer exposes merge/register
 * functions — it only re-exports the ops for bundle consumers that need the
 * lightweight closure (e.g. the weapp worker).
 *
 * The cad namespace is identical on all platforms; only the implementation
 * closure differs.
 */
export { EDITOR_OPS } from './op-names'
export { fai_drill } from './ops/fai_drill'
export { fai_extrude } from './ops/fai_extrude'
export { fai_split } from './ops/fai_split'
export { group, assembly } from './ops/compound'
export type { GroupParams, AssemblyParams, AssemblyBehavior } from './ops/compound'
export { copy } from './ops/copy'
export { load } from './ops/load'
