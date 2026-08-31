/**
 * @faicad/faijs/sdf — SDF operations entry
 *
 * Browser-safe exports for SDF operations.
 * Use this in worker contexts to avoid pulling in Node.js code.
 */

export type { SdfMeshData } from './sdf/sdf-runner'
export { runSdfInline } from './sdf/sdf-core'
export { SDF_TEMPLATES, DEFAULT_SDF_TEMPLATE } from './sdf/templates'
export type {
  SdfMeta, SdfBox, SdfParamDef, SdfTemplateCategory,
  SdfWorkerInput, SdfWorkerMessage,
} from './sdf/types'
export { boxToTuple, parseParamDefs, defaultParamValues } from './sdf/types'