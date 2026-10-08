/**
 * boolean — CSG/boolean auxiliary modules (public API surface).
 *
 * This index.ts aggregates the public exports of boolean/ submodules so that
 * the umbrella entries (index.ts / browser.ts) can `export * from './boolean'`
 * without hand-listing individual symbols.
 *
 * Internal-only symbols (SimpleUnionFind, createWedge, createDowel,
 * computeCrossSectionWidth, etc.) are NOT re-exported here.
 */

// cross-section
export { computeSection, buildExtrudedProfile } from './cross-section'

// csg-core
export {
  manifoldToMeshData,
  weldPositionsWorker,
  dovetailBooleanSplit,
  dowelOrTenonBooleanSplit,
  chainBoolean,
  meshToManifold,
} from './csg-core'

// deriveNormals
export { deriveNormals } from './deriveNormals'

// extrude-helpers
export { buildExtrudeParts, makeWorldPlane } from './extrude-helpers'
export type { ExtrudeParts, ExtrudeOffsetMode } from './extrude-helpers'

// joinery-shapes
export {
  buildWedgeGeometry,
  buildDowelGeometry,
  buildStraightTenonGeometry,
} from './joinery-shapes'
export type { JoineryMeshData } from './joinery-shapes'

// csg-backend
export { setCsgBackend } from './csg-backend'

// geo-convert
export { geoToManifoldMesh, manifoldMeshToGeo } from './geo-convert'
export type {
  ManifoldMeshData,
  BooleanOperation,
  DovetailGrooveParams,
  DowelSplitParams,
  StraightTenonSplitParams,
} from './geo-convert'

// manifold-preview (ManifoldMeshData aliased to avoid clash with geo-convert's)
export { previewMeshIntersect } from './manifold-preview'
export type { ManifoldMeshData as PreviewManifoldMeshData } from './manifold-preview'
