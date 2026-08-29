/**
 * @faicad/faijs/csg — CSG/Boolean operations entry
 *
 * Browser-safe exports for CSG/Boolean operations.
 * Use this in worker contexts to avoid pulling in Node.js code.
 */

export { manifoldToMeshData, weldPositionsWorker, dovetailBooleanSplit, dowelOrTenonBooleanSplit } from './boolean/csg-core'
export { computeSection, buildExtrudedProfile } from './boolean/cross-section'
export { deriveNormals } from './boolean/deriveNormals'
export { buildExtrudeParts, makeWorldPlane } from './boolean/extrude-helpers'
export type { ExtrudeParts, ExtrudeOffsetMode } from './boolean/extrude-helpers'
export {
  buildWedgeGeometry, buildDowelGeometry, buildStraightTenonGeometry,
} from './boolean/joinery-shapes'
export type { JoineryMeshData } from './boolean/joinery-shapes'
export { geoToManifoldMesh, manifoldMeshToGeo } from './boolean/geo-convert'
export type {
  ManifoldMeshData, BooleanOperation,
  DovetailGrooveParams, DowelSplitParams, StraightTenonSplitParams,
} from './boolean/geo-convert'