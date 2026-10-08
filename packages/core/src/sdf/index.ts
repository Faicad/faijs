/**
 * sdf — signed distance field mesh generation.
 *
 * Public API surface aggregated for umbrella `export *` consumption.
 */

// sdf-runner
export { runSdf } from './sdf-runner'
export type { SdfMeshData } from './sdf-runner'

// sdf-core
export { runSdfInline } from './sdf-core'

// templates
export { SDF_TEMPLATES, DEFAULT_SDF_TEMPLATE } from './templates'

// types
export type {
  SdfMeta, SdfBox, SdfParamDef, SdfTemplateCategory,
  SdfWorkerInput, SdfWorkerMessage,
} from './types'
export { boxToTuple, parseParamDefs, defaultParamValues } from './types'
