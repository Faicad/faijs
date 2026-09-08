/**
 * @faicad/faijs �?Faicad CAD execution engine
 *
 * 公开 API 统一入口。所有导出按层组织：
 * - L0 文本层：parser / codegen / symbol-table / types
 * - L1 几何执行层：BREP ops / Shape / 导出
 * - L1 Mesh 执行层：cad API
 * - L1 Boolean/CSG 辅助：cross-section / deriveNormals / extrude-helpers / joinery-shapes
 * - L1 Primitives：geometry / screw / svg-extrude / text / types
 * - L1 SDF：sdf-runner / templates / types
 * - L1 Knurl：KnurlGenerator / subdivision / textureLoader
 * - L1 Topology：build-face-ids / build-selector-runtime / types
 * - L2 编排层：CadRuntime / HostPorts
 * - L3 Node Host：createNodePorts / CLI
 * - OCCT Kernel：initOcctWasm / getKernel / setOcctWasmInitFn / ...
 * - CSG Backend：setCsgBackend / geoToManifoldMesh / ...
 */

// ── identity：品牌类型 + 信任点（f0，零依赖）
export type {
  FileId, InnerId, ScopedId, StmtId, PartName, GroupName,
  RefId, ReferenceId, SelectorKey, OccurrenceId, ShapeId,
  FaceId, EdgeId, NodeId, StatementId, FaceSelector,
} from './identity'
export {
  asFileId, asInnerId, asScopedId, asStmtId, asPartName, asGroupName,
  asRefId, asReferenceId, asSelectorKey, asOccurrenceId, asShapeId,
  asFaceId, asEdgeId, asNodeId,
  toScopedId, splitScopedId, isScopedId, toInnerId,
} from './identity'

// ── 运行时状态锚点（零依赖层；引擎与库共享）
export {
  configureBackends, getBackends, setCurrentStmt, getCurrentStmt,
  keep, keepHidden, getRuntimeState, nameOf, setName, setKeepSink,
  setPendingAssemblyTransforms, takePendingAssemblyTransforms, assertContractVersion,
  CONTRACT_VERSION,
} from './runtime-state'
export type {
  Backends, FaijsRuntimeState, ShapeSlot, KeepSink, RuntimeExecutionMode,
  AssemblyTransform, StdlibFn, StdlibNamespace, ExecutionAnchor,
} from './runtime-state'

// ── L0 文本层（IR 是引擎内部实现细节，不导出；公开面只有代码文本工具与结果类型）
export type {
  Vec3, JsonValue,
  TerminalShape, ParamDef,
} from './lang/types'
export {
  derivePartName, getMaxModelNum,
} from './lang/allocate-id'
export type { DerivePartNameInput, DerivePartNameResult } from './lang/allocate-id'
export { fmtNum, formatCodeLine } from './lang/codegen'
export type { FormatCodeLineInput } from './lang/codegen'
export { analyzeCode } from './lang/statement-summary'
export type { StatementSummary } from './lang/statement-summary'
export { codeToArgs } from './lang/code-to-args'
export type { CodeToArgsResult } from './lang/code-to-args'
// MetadataExtractor — 无 IR 元数据提取器（UI 通道语义源；UiMetadata 全量）
export { extractMetadata } from './lang/metadata-extractor'
export type {
  UiMetadata, ParamEntry, ImportEntry, FunctionEntry, BlockEntry, KeepEntry,
  ExtractMetadataOptions,
} from './lang/metadata-extractor'
// SecurityScanner — 静态安全门禁（纵深防御第一层）
export { scanSource, scanAst, assertSecure } from './lang/security-scanner'
export type {
  SecurityPolicy, SecurityRuleId, SecurityViolation,
  SecurityScanOptions, SecurityScanResult,
} from './lang/security-scanner'
// HostArg — 宿主友好位置参数类型（IR 屏蔽层）
export type {
  HostArg, HostRef, HostVarRef, HostParamRef, HostCallRef, HostExprRef, HostRefKind,
} from './lang/host-arg'
export {
  isHostVarRef, isHostParamRef, isHostCallRef, isHostExprRef, isHostRef,
  hostArgToDisplay, hostArgToLiteral, HOST_REF_KINDS,
} from './lang/host-arg'

// ── L1 几何执行 ──
export type { Shape } from './mesh/types'
export type { BrepChainState } from './brep/brep-chain'
export {
  createBrepChainState, initBrepChainState, releaseBrepChainState,
  isCadFormat,
} from './brep/brep-chain'
export {
  solidToShape, getSolidBoundingBox,
  translateBrep, rotateBrep, scaleBrep,
  fuseBrep, cutBrep, commonBrep,
  drillBrep, splitBrep, extrudeBrep,
  loadBrep, matrixToArray,
} from './brep'
export type { DrillBrepParams, SplitBrepParams, SplitBrepResult, ExtrudeBrepParams } from './brep'
export { buildStlBufferFromMesh } from './brep/export/stl'
export { exportStepFromSolid, exportStepFromSolids } from './brep/export/step'
export type { StepExportEntry } from './brep/export/step'

// ── L1 Mesh 执行�?──
export { cad } from './mesh'
export { setManifoldWasmUrl, getManifoldWasmUrl, getManifoldModule } from './mesh/manifold-loader'
export type {
  BoundingBox, FaceDescriptor,
  BoxParams, SphereParams, CylinderParams, ConeParams, WedgeParams,
  TextParams, SvgExtrudeParams, SdfParams,
  DrillParams, ExtrudeParams, EngraveParams, KnurlParams,
  SplitPlane, SplitResult,
} from './mesh/types'
export { NRAD_DEFAULT, NRAD_MIN, NRAD_MAX, clampNRad } from './mesh/types'
export { faceAt } from './mesh/query'

// ── L1 Boolean/CSG 辅助 ──
export { computeSection, buildExtrudedProfile } from './boolean/cross-section'
export { manifoldToMeshData, weldPositionsWorker, dovetailBooleanSplit, dowelOrTenonBooleanSplit } from './boolean/csg-core'
export { deriveNormals } from './boolean/deriveNormals'
export { buildExtrudeParts, makeWorldPlane } from './boolean/extrude-helpers'
export type { ExtrudeParts, ExtrudeOffsetMode } from './boolean/extrude-helpers'
export {
  buildWedgeGeometry, buildDowelGeometry, buildStraightTenonGeometry,
} from './boolean/joinery-shapes'
export type { JoineryMeshData } from './boolean/joinery-shapes'

// ── CSG Backend ──
export { setCsgBackend } from './boolean/csg-backend'
export { geoToManifoldMesh, manifoldMeshToGeo } from './boolean/geo-convert'
export type {
  ManifoldMeshData, BooleanOperation,
  DovetailGrooveParams, DowelSplitParams, StraightTenonSplitParams,
} from './boolean/geo-convert'

// ── L1 Primitives ──
export { mergeBufferGeometries, makePrimitiveGeo, DEFAULT_SIZE, applyPrimitiveOffset } from './primitives/mesh-primitives'
export { makeScrew } from './primitives/screw/screw'
export { getScrewSpec, getScrewSpecs, threadToPitchMm, SCREW_HEAD_DIMS } from './primitives/screw/screw-db'
export type { ScrewParams, ScrewSpec, ScrewSystem } from './primitives/screw/screw-db'
export { svgToExtrudedGeometry } from './primitives/svg-extrude'
export {
  extractMeshData, primitiveToBrepSolid, geometryToBrepSolid,
  brepSolidToStep, primitiveToBrepStep,
} from './primitives/brep-primitives'
export type { PrimitiveToBrepResult, PrimitiveParams } from './primitives/brep-primitives'
export { loadSystemCjkFont, containsCjk, isCjkChar, createMixedTextGeometry } from './primitives/text/cjk'
export type { CjkFontResult } from './primitives/text/cjk'
export { createTextGeometry, getOpentypeFont, opentypePathToGeometry } from './primitives/text-geometry'
export type {
  PrimitiveType, PrimitiveParamsRecord, PrimitiveArgsRecord, PrimitiveMeta,
} from './primitives/types'
export { nextPrimitiveColor } from './primitives/types'

// ── L1 SDF ──
export { runSdf } from './sdf/sdf-runner'
export type { SdfMeshData } from './sdf/sdf-runner'
export { runSdfInline } from './sdf/sdf-core'
export { SDF_TEMPLATES, DEFAULT_SDF_TEMPLATE } from './sdf/templates'
export type {
  SdfMeta, SdfBox, SdfParamDef, SdfTemplateCategory,
  SdfWorkerInput, SdfWorkerMessage,
} from './sdf/types'
export { boxToTuple, parseParamDefs, defaultParamValues } from './sdf/types'

// ── L1 Knurl ──
export { applyKnurlDisplacement, KNURL_DEFAULTS } from './mesh/knurl/KnurlGenerator'
export type { KnurlBounds } from './mesh/knurl/KnurlGenerator'
export { subdivide } from './mesh/knurl/subdivision'
export { loadKnurlingTexture, setKnurlTextureLoader } from './mesh/knurl/textureLoader'
export type { TextureData } from './mesh/knurl/textureLoader'
export { QuantizedPointMap, weldVertices } from './mesh/knurl/meshIndex'
export { computeUV, MODE_TRIPLANAR, getCubicBlendWeights, type MappingSettings } from './mesh/knurl/mapping'
export { applyDisplacement, type DisplacementSettings } from './mesh/knurl/displacement'

// ── L1 Topology ──
export { TOPOLOGY_FACE_ID_NONE, buildFaceIdsForPart } from './topology/build-face-ids'
export {
  buildSelectorRuntime, buildSelectorRuntimeData, buildSelectorRuntimeMaps,
} from './topology/build-selector-runtime'
export type { SelectorRuntimeData } from './topology/build-selector-runtime'
export type {
  SelectorRuntime, SelectorBundle, SelectorManifest, SelectorBuffers,
  FaceRow, EdgeRow, Reference,
  BufferViewDescriptor, SelectorProxy,
} from './topology/types'

export * from './topology/naming'

// ── L2 编排�?──
export { CadRuntime, createRuntime, computeContentKey, AppendPrefixError } from './cad-runtime/runtime'
export { createPreviewExec } from './cad-runtime/preview-exec'
export type { PreviewExec } from './cad-runtime/preview-exec'
export type { ExecutionResult, ExecuteOptions, CheckResult, CheckError, CadRuntimeOptions } from './cad-runtime/runtime'
export type {
  HostPorts, CsgBackend, SdfBackend, FontProvider, TextureSampler,
  AssetResolver, EventSink, ExecutionMode,
  MeshData, PlaneParams, SplitResult as CsgSplitResult,
  DovetailGrooveParams as PortDovetailGrooveParams,
  DowelSplitParams as PortDowelSplitParams,
  StraightTenonSplitParams as PortStraightTenonSplitParams,
  LibLoader, ProjectLoader,
} from './cad-runtime/ports'

// ── OCCT Kernel ──
export {
  initOcctWasm, getKernel, disposeOcctWasm, setOcctWasmInitFn,
  computeEffectiveDeflection, importStepToMesh, importBrepToMesh,
  meshesToStep, releaseShape,
  importAssemblyFromStep, releaseAssemblyTree, collectLeafParts,
} from './occt-kernel/occtKernel'
export type {
  WasmTessellatedMesh, WasmImportResult, AssemblyPartNode,
  MeshDeflectionOptions, ShapeHandle, OcctKernel,
  Mesh, EdgeData, SurfaceKind, CurveKind,
} from './occt-kernel/occtKernel'

// ── OCCT Mesh Reconstruct ──
export { reconstructSolidFromMesh, meshToAsciiStl, cadShapeIsValid, meshToStepBrep } from './occt-kernel/meshReconstruct'

// ── OCCT 高层导出（多实体、零 fuse） ──
export { exportStepFromSolidsHighLevel } from './occt-kernel/highLevelApi'

// ── OCCT Topology Extension ──
export { buildSelectorManifest, buildAssemblySelectorManifest, buildTopologyAdjacency } from './occt-kernel/topologyExt'
export type { SelectorManifestInput, PartTopologyInput, AssemblyTopologyResult, TopologyAdjacency } from './occt-kernel/topologyExt'

// ── BREP 引擎注册（宿主装配；引擎可切换——occt 只是默认实现） ──
export { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from './brep/engine/adapters/occt'
export { registerBrepMockEngine, BREP_MOCK_ENGINE_ID, createBrepMockApi } from './brep/engine/adapters/brep-mock'
export {
  registerBrepEngine, getBrepEngine, hasBrepEngine, getActiveBrepEngineId,
  registerMeshEngine, getMeshEngine, getActiveMeshEngineId, freezeEngineRegistries,
} from './brep/engine/registry'
export type { BrepEngine, BrepEngineProvider, MeshEngine } from './brep/engine/registry'
export type { BrepEngineApi } from './brep/engine/primitives'
export type {
  BrepHandle, BrepMeshResult, BrepBoundingBox, BrepVec3, BrepCapabilities,
  BrepEvolutionData, BrepXcafDocument,
} from './brep/engine/types'

// ── BREP Topology ──
export { buildSolidTopologyRuntime } from './brep/brep-topology'
export type { SolidTopologyResult } from './brep/brep-topology'

// ── Font Registry (for browser host injection) ──
export { setFontLoader, getFontLoader, loadFont, ensureDefaultFont, getFont, clearFonts } from './brep/text/fontRegistry'
export type { FontLoader } from './brep/text/fontRegistry'

// ── L3 Node Host ──
// node-host 模块已移�?@faicad/faijs/node 入口，避免浏览器环境静�?import
// node-host 模块（含 Node.js 专用代码�?fs/path）导致生产构�?404�?
// �?Node.js 环境中：import { createNodePorts } from '@faicad/faijs/node'

// ── L3 Browser Host ──
export { createBrowserPorts } from './browser-host'
export type { CreateBrowserPortsOptions } from './browser-host'
export { BrowserEventSink } from './browser-host/browser-event-sink'
export { BrowserFontProvider } from './browser-host/browser-font-provider'
export type { BrowserFontProviderOptions } from './browser-host/browser-font-provider'
export { FetchAssetResolver } from './browser-host/fetch-asset-resolver'
export type { FetchAssetResolverOptions } from './browser-host/fetch-asset-resolver'

// ── L3 API 面（原 packages/stdlib 迁入，P6/D1）──
// P23 主导出切换（§4.2 / Q1）：`export * from './api'` 现在同时带来
// ① faijs 特有 dual op（mesh+brep 双路径，D11 双形态归一）；
// ② 生成脚本面 op（`api/generated/script-face.ts`，compatOp(projectBrepOp(…)) 包装的
//    brep-only 语句级 op——`cad.*` 脚本面与此同源，B1 三源一致）；
// ③ brepjs 形态 TS 兼容面（`api/brepjs-compat`，以 `brepjsCompat` 命名空间导出——库作者面，
//    句柄进出 + Result 语义）及其 Result / 向量 / 平面组合器（顶层平铺）。
// op 符号不平铺 brepjsCompat 版：`brepjsCompat.fuse`（句柄形态）与顶层 `fuse`（faijs 形态）
// 是同一 vendored 实现的两个投影，按「一个名字一份实现」红线（§6.3）只保留脚本面那份。
export * from './api'
export { createApiNamespace } from './api/api-namespace'
