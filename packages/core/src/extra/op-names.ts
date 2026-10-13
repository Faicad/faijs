/**
 * op-names — the editor-owned op name lists (single source).
 *
 * 2026-10-13 merge: these names now live in core (`packages/core/src/extra/`).
 * `createApiNamespace()` carries the complete cad surface (platform + sketch
 * + extra ops). The lists serve two consumers:
 *
 * 1. the cad-namespace membership guards (all ops are in `createApiNamespace`),
 *    and
 * 2. the symbol table (gen-symbol-table discovers each op from the explicit
 *    keys in `createApiNamespace()`; no separate `registerEditorSymbols()`
 *    call is needed).
 *
 * `EDITOR_OPS` is the editor-owned op group (plan §4.2 A) and `CREATOR_OPS` the
 * svg / 3D-text creator group (plan §4.2 B). The split is not cosmetic: the A
 * group is lightweight (no heavy deps), so the weapp worker can mount it via
 * the `@faicad/faijs/extra/editor-ops` entry while the B group — which carries
 * the opentype.js / SVG / text-geometry chain — stays off the end-side bundle.
 */

/** A group (plan §4.2): editor-owned ops, three basic API only. */
export const EDITOR_OPS = [
  'fai_drill',
  'fai_extrude',
  'fai_split',
  'group',
  'assembly',
  'copy',
  'load',
] as const

/** B group (plan §4.2): svg / 3D-text creators; carry the non-basic three chain. */
export const CREATOR_OPS = [
  'text',
  'svgExtrude',
] as const

/** Every op name the editor ops group carries, in assembly order. */
export const ALL_EDITOR_OPS = [...EDITOR_OPS, ...CREATOR_OPS] as const

/** Name of an editor-owned op (`cad.<name>`). */
export type EditorOpName = (typeof EDITOR_OPS)[number]

/** Name of a creator op (`cad.<name>`). */
export type CreatorOpName = (typeof CREATOR_OPS)[number]

/**
 * Membership test for the editor-owned op list (A group).
 *
 * @param name - the `cad.<name>` candidate to test.
 * @returns true when the name is one of `EDITOR_OPS`.
 */
export function isEditorOp(name: string): name is EditorOpName {
  return (EDITOR_OPS as readonly string[]).includes(name)
}
