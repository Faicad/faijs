/**
 * op-names — the editor-owned op name lists (single source).
 *
 * These names live in `@faicad/faijs-extra`; core's `createApiNamespace()`
 * carries the platform surface only. The lists serve two consumers:
 *
 * 1. the cad-namespace membership guards (platform keys ∪ editor keys), and
 * 2. `registerEditorSymbols()` — the static symbol-table extension, so
 *    `cad.fai_drill` stays queryable by static analysis that reads the table
 *    (the runtime `check()` deliberately does not validate callee existence).
 *
 * `EDITOR_OPS` is the editor-owned op group (plan §4.2 A) and `CREATOR_OPS` the
 * svg / 3D-text creator group (plan §4.2 B). The split is not cosmetic: the A
 * group uses three's basic API only, so the weapp worker can mount it (see the
 * `@faicad/faijs-extra/editor-ops` entry) while the B group — which carries
 * `three/examples`' `SVGLoader` and the `Shape`/`ExtrudeGeometry` chain — stays
 * off the end-side bundle.
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

/** Every op name `createEditorNamespace()` carries, in assembly order. */
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
