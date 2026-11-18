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
  PmiLocalNote,
  PmiGeneralNoteLine,
  PmiGeneralNote,
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
export { dimension, gdt, datum, surfaceFinish, localNote, generalNote, threadHole } from './types'

// Shape methods
export { attachPmiMethods, appendPmiItem, type ShapePmiMethods } from './methods'

// Registry（跨 op 存活的单一真源；查询用 pmiOf 而非读 Shape.pmi）
export { pmiOf, addPmiItem, collectPmiOf, ownPmiOf, clearPmiOfPart, registerPmiParents, resetPmiRegistry } from './registry'

// Query functions
export { pmiItems, pmiOn, pmiDatums, pmiThreads, pmiGeneralNotes } from './query'

// Display text（螺纹孔：底孔 + 螺纹一体呈现）
export { formatThreadHole, formatThreadSpec } from './text'

// Display text（通用注释：编号条目块或单条无编号要求）
export { formatGeneralNote, generalNoteLines } from './general-note'

// 旧 kind 的读取归一（外部数据宽容兼容：`note` / `techNote` → 当前字面量）
export { normalizePmiKind, migratePmiItem, migratePmiSet } from './kind-alias'
