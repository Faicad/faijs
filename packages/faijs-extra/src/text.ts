/**
 * text — three-free BREP entry for the stdlib `text` op.
 *
 * Re-exports `textBrep` (the OCCT text-solid path) so node consumers such as
 * the cq-compat layer can use it WITHOUT bundling the mesh/three chain. The
 * full `defineOp` wrapper (with mesh path) stays in `./ops/text`.
 */
export { textBrep } from './ops/text-brep'
