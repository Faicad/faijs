/**
 * primitives — mesh geometry primitives, screw generators, and BREP bridges.
 *
 * Public API surface aggregated for umbrella `export *` consumption.
 * Internal-only symbols (GeneratorType, AnyPrimitiveType, PRIMITIVE_COLORS,
 * PrimitiveGeometryData, PrimitiveRecord, DEFAULT_SEGMENTS) are NOT re-exported.
 */

// mesh-primitives
export { mergeBufferGeometries, makePrimitiveGeo, DEFAULT_SIZE, applyPrimitiveOffset } from './mesh-primitives'

// screw
export { makeScrew } from './screw/screw'

// screw-db
export { getScrewSpec, getScrewSpecs, threadToPitchMm, SCREW_HEAD_DIMS } from './screw/screw-db'
export type { ScrewParams, ScrewSpec, ScrewSystem } from './screw/screw-db'

// parse-svg-size
export { parseSvgNaturalSize } from './parse-svg-size'

// brep-primitives (PrimitiveParams from here is the union type, NOT types.ts's)
export {
  extractMeshData, primitiveToBrepSolid, geometryToBrepSolid,
  brepSolidToStep, primitiveToBrepStep,
} from './brep-primitives'
export type { PrimitiveToBrepResult, PrimitiveParams } from './brep-primitives'

// text/cjk-font
export { loadSystemCjkFont, containsCjk, isCjkChar } from './text/cjk-font'
export type { CjkFontResult } from './text/cjk-font'

// types (note: PrimitiveParams is NOT re-exported from here to avoid clash
// with brep-primitives' PrimitiveParams union type)
export type {
  PrimitiveType, PrimitiveParamsRecord, PrimitiveArgsRecord, PrimitiveMeta,
} from './types'
export { nextPrimitiveColor } from './types'
