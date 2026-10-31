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
  PmiThreadSpec,
  PmiPilotHole,
  PmiHoleAxis,
  PmiThreadHole,
  PmiItem,
  PmiItemKind,
  PmiSetMeta,
  PmiSet,
  PmiEntry,
} from './types'

// Factory functions
export { dimension, gdt, datum, surfaceFinish, note, threadHole } from './types'

// Shape methods
export { attachPmiMethods, appendPmiItem, type ShapePmiMethods } from './methods'

// Registry（跨 op 存活的单一真源；查询用 pmiOf 而非读 Shape.pmi）
export { pmiOf, addPmiItem, collectPmiOf, ownPmiOf, clearPmiOfPart, registerPmiParents, resetPmiRegistry } from './registry'

// Query functions
export { pmiItems, pmiOn, pmiDatums, pmiThreads } from './query'

// Display text（螺纹孔：底孔 + 螺纹一体呈现）
export { formatThreadHole, formatThreadSpec } from './text'
