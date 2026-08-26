/**
 * cad-runtime — L2 编排层公开 API
 *
 */

export { CadRuntime, createRuntime, computeContentKey } from './runtime'
export { createPreviewExec } from './preview-exec'
export type { PreviewExec } from './preview-exec'
export type {
  ExecutionResult,
  ExecuteOptions,
  CheckResult,
  CheckError,
} from './runtime'
export type {
  HostPorts,
  CsgBackend,
  SdfBackend,
  FontProvider,
  TextureSampler,
  AssetResolver,
  EventSink,
  ExecutionMode,
  MeshData,
  PlaneParams,
  SplitResult,
  DovetailGrooveParams,
  DowelSplitParams,
  StraightTenonSplitParams,
} from './ports'
