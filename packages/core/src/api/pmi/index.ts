/**
 * api/pmi/index — PMI module entry point
 *
 * Re-exports PMI types, Shape methods, and query functions.
 * Library developers import from `@faicad/faijs/api/pmi` (this file).
 */

// Types
export type {
  PmiDimensionType,
  PmiDimension,
  PmiGdtType,
  PmiMaterialCondition,
  PmiProjectedToleranceZone,
  PmiCompositeSegment,
  PmiGdt,
  PmiDatumType,
  PmiDatumTargetParams,
  PmiDatum,
  PmiSurfaceParameter,
  PmiTextureDirection,
  PmiSurfaceFinish,
  PmiNote,
  PmiItem,
  PmiItemKind,
  PmiSetMeta,
  PmiSet,
  PmiEntry,
} from './types'

// Factory functions
export { dimension, gdt, datum, surfaceFinish, note } from './types'

// Shape methods
export { attachPmiMethods, type ShapePmiMethods } from './methods'

// Query functions
export { pmiItems, pmiOn, pmiDatums } from './query'
