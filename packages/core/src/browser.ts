/**
 * @faicad/faijs/browser — Browser-safe exports (F6: A/B/C/D 四类收敛)
 *
 * Excludes L3 Node Host modules (node-host/*) that depend on node:fs/node:path.
 * Use this entry point in browser/worker contexts to avoid pulling in Node.js code.
 *
 * For full exports (including Node.js), use @faicad/faijs instead.
 *
 * 导出分类（契约 §11 白名单四类）：
 * - A 类 = lang/ 全部导出（脚本类型 + 构建辅助 + 接口约定类型 + 常量）
 * - B 类 = cad-runtime/ + createBrowserPorts + 外部资源注入点 + 执行位置选项
 * - C 类 = 执行产物类型（Shape + 拓扑数据类型 + buildSelectorRuntimeMaps）
 * - D 类 = 辅助函数 + 预览 API（明确导出后使用）
 *
 * Phase 2 收尾完成：deprecated 区已删除。宿主如需执行/读取几何，一律走
 * CadRuntime.execute / 高层 API（importStep/exportStep/ensureOcctKernel）；
 * 主线程 CSG/SDF 预览走 previewMeshIntersect / runSdfMain。
 */

// ═══════════════════════════════════════════════════════════
// identity：品牌类型 + 信任点（f0，零依赖）
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// A 类：lang/ 文本面导出（IR 是引擎内部实现细节，不导出；公开面只有代码文本工具与结果类型）
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// B 类：cad-runtime/ + createBrowserPorts + 外部资源注入点
// ═══════════════════════════════════════════════════════════

export { CadRuntime, createRuntime, AppendPrefixError } from './cad-runtime/runtime'
export { createPreviewExec } from './cad-runtime/preview-exec'
export type { PreviewExec } from './cad-runtime/preview-exec'
export type { ExecutionResult, ExecuteOptions, CheckResult, CheckError, PartTopology, TopologySource } from './cad-runtime/runtime'
export type {
  HostPorts,
  CsgBackend, SdfBackend, FontProvider, TextureSampler,
  AssetResolver, EventSink, ExecutionMode,
  MeshData, PlaneParams, SplitResult as CsgSplitResult,
  DovetailGrooveParams as PortDovetailGrooveParams,
  DowelSplitParams as PortDowelSplitParams,
  StraightTenonSplitParams as PortStraightTenonSplitParams,
} from './cad-runtime/ports'

// 外部资源注入点
export { setManifoldWasmUrl, getManifoldWasmUrl } from './mesh/manifold-loader'
export { setOcctWasmInitFn } from './occt-kernel/occtKernel'
export { setFontLoader, getFontLoader, loadFont, ensureDefaultFont, getFont, clearFonts } from './brep/text/fontRegistry'
export type { FontLoader } from './brep/text/fontRegistry'
export { setKnurlTextureLoader } from './mesh/knurl/textureLoader'

// L3 Browser Host 工厂
export { createBrowserPorts } from './browser-host'
export type { CreateBrowserPortsOptions } from './browser-host'
export { BrowserEventSink } from './browser-host/browser-event-sink'
export { BrowserFontProvider } from './browser-host/browser-font-provider'
export type { BrowserFontProviderOptions } from './browser-host/browser-font-provider'
export { FetchAssetResolver } from './browser-host/fetch-asset-resolver'
export type { FetchAssetResolverOptions } from './browser-host/fetch-asset-resolver'
export { WorkerCsgBackend } from './browser-host/worker-csg-backend'
export { WorkerSdfBackend } from './browser-host/worker-sdf-backend'

// E12.2: OCCT 高层 API（B 类——宿主用这些替代底层 kernel 函数）
export { importStep, importStepMultiPart, exportStep, releaseSolid, ensureOcctKernel, disposeOcct, exportStepFromSolidsHighLevel } from './occt-kernel/highLevelApi'
export type { ImportStepResult, ImportStepPartResult, ExportStepOptions } from './occt-kernel/highLevelApi'
// 高层 API 的类型签名依赖的 OCCT 句柄/内核类型（D 类，公共契约）
export type { OcctKernel, ShapeHandle, WasmTessellatedMesh, Mesh, MeshDeflectionOptions } from './occt-kernel/highLevelApi'

// ── BREP 引擎注册（宿主装配；引擎可切换——occt 只是默认实现） ──
export { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from './brep/engine/adapters/occt'
export {
  registerBrepEngine, getBrepEngine, hasBrepEngine, getActiveBrepEngineId, freezeEngineRegistries,
} from './brep/engine/registry'
export type { BrepEngine, BrepEngineProvider } from './brep/engine/registry'
export type { BrepEngineApi } from './brep/engine/primitives'
export type {
  BrepHandle, BrepMeshResult, BrepBoundingBox, BrepVec3, BrepCapabilities,
  BrepEvolutionData, BrepXcafDocument,
} from './brep/engine/types'

// keep-syntax（P7）：宿主守卫——outputs 现含 compound，消费端须区分
export { isCompoundLike } from './shape'
export { isMeshShape } from './mesh/types'

// ═══════════════════════════════════════════════════════════
// C 类：执行产物类型（Shape + 拓扑数据类型 + buildSelectorRuntimeMaps）
// ═══════════════════════════════════════════════════════════

export type { Shape } from './mesh/types'

// 拓扑数据类型
export type { SelectorRuntimeData } from './topology/build-selector-runtime'
export type {
  SelectorRuntime, SelectorBundle, SelectorManifest, SelectorBuffers,
  FaceRow, EdgeRow, Reference,
  BufferViewDescriptor, SelectorProxy,
} from './topology/types'

// buildSelectorRuntimeMaps: C 类（从 SelectorRuntimeData 构建 SelectorRuntime Maps）
export { buildSelectorRuntimeMaps } from './topology/build-selector-runtime'

// 拓扑常量
export { TOPOLOGY_FACE_ID_NONE } from './topology/build-face-ids'

// ── TopoRef 命名层（§3.7/§3.8：命名属于核心公共能力，随 browser/node 走）──
export * from './topology/naming'

// D 类辅助：拓扑构建函数（宿主在加载时刻调用，构建 mesh/primitive 近似拓扑）
// 注意：这些只在加载/创建时刻合法，变更后不重新生成
// BREP 真拓扑通过 CadRuntime.buildBrepTopology() 获取，不再直接导出 buildSolidTopologyRuntime
export { buildSelectorRuntime, buildSelectorRuntimeData } from './topology/build-selector-runtime'
export { buildFaceIdsForPart } from './topology/build-face-ids'
export type { SolidTopologyResult } from './brep/brep-topology'

// C 类辅助：面查询
export { faceAt } from './mesh/query'
export type {
  BoundingBox, FaceDescriptor,
  BoxParams, SphereParams, CylinderParams, ConeParams, WedgeParams,
  TextParams, SvgExtrudeParams, SdfParams,
  DrillParams, ExtrudeParams, EngraveParams, KnurlParams,
  SplitPlane, SplitResult,
} from './mesh/types'
export { NRAD_DEFAULT, NRAD_MIN, NRAD_MAX, clampNRad } from './mesh/types'

// SDF 类型
export type { SdfMeshData } from './sdf/sdf-runner'
export { SDF_TEMPLATES, DEFAULT_SDF_TEMPLATE } from './sdf/templates'
export type {
  SdfMeta, SdfBox, SdfParamDef, SdfTemplateCategory,
  SdfWorkerInput, SdfWorkerMessage,
} from './sdf/types'
export { boxToTuple, parseParamDefs, defaultParamValues } from './sdf/types'

// Primitive 类型
export type {
  PrimitiveType, PrimitiveParamsRecord, PrimitiveArgsRecord, PrimitiveMeta,
} from './primitives/types'
export { nextPrimitiveColor } from './primitives/types'
export type { ScrewParams, ScrewSpec, ScrewSystem } from './primitives/screw/screw-db'
export { getScrewSpec, getScrewSpecs, threadToPitchMm, SCREW_HEAD_DIMS } from './primitives/screw/screw-db'
export type { CjkFontResult } from './primitives/text/cjk'
export { loadSystemCjkFont, containsCjk, isCjkChar } from './primitives/text/cjk'
export { getOpentypeFont } from './primitives/text-geometry'

// Boolean/CSG 辅助类型
export type { ExtrudeParts, ExtrudeOffsetMode } from './boolean/extrude-helpers'
export type { JoineryMeshData } from './boolean/joinery-shapes'
export type {
  ManifoldMeshData, BooleanOperation,
  DovetailGrooveParams, DowelSplitParams, StraightTenonSplitParams,
} from './boolean/geo-convert'
export type { TextureData } from './mesh/knurl/textureLoader'
export type { KnurlBounds } from './mesh/knurl/KnurlGenerator'
export type { DrillBrepParams, SplitBrepParams, SplitBrepResult, ExtrudeBrepParams } from './brep/brep-ops'
export type { PrimitiveToBrepResult, PrimitiveParams } from './primitives/brep-primitives'

// ═══════════════════════════════════════════════════════════
// D 类：辅助函数 + 预览 API
// ═══════════════════════════════════════════════════════════

// 预览 API（D 类——宿主用这些做交互预览，不提交几何）
export { cad } from './mesh'
export { deriveNormals } from './boolean/deriveNormals'
export { computeSection, buildExtrudedProfile } from './boolean/cross-section'
export { buildExtrudeParts, makeWorldPlane } from './boolean/extrude-helpers'
export {
  buildWedgeGeometry, buildDowelGeometry, buildStraightTenonGeometry,
} from './boolean/joinery-shapes'
export { geoToManifoldMesh, manifoldMeshToGeo } from './boolean/geo-convert'
export { manifoldToMeshData, weldPositionsWorker, dovetailBooleanSplit, dowelOrTenonBooleanSplit, chainBoolean, meshToManifold } from './boolean/csg-core'
export { previewMeshIntersect } from './boolean/manifold-preview'
export type { ManifoldMeshData as PreviewManifoldMeshData } from './boolean/manifold-preview'
export { svgToExtrudedGeometry, parseSvgShapes } from './primitives/svg-extrude'
export type { SvgExtrudeOptions } from './primitives/svg-extrude'
export { createTextGeometry, opentypePathToGeometry } from './primitives/text-geometry'
export { runSdfInline } from './sdf/sdf-core'
export { runSdf as runSdfMain } from './sdf/sdf-runner'
export type { SdfMeshData as PreviewSdfMesh } from './sdf/sdf-runner'
export { createMixedTextGeometry } from './primitives/text/cjk'

// Knurl D 类
export { applyKnurlDisplacement, KNURL_DEFAULTS } from './mesh/knurl/KnurlGenerator'
export { subdivide } from './mesh/knurl/subdivision'
export { loadKnurlingTexture } from './mesh/knurl/textureLoader'
export { QuantizedPointMap, weldVertices } from './mesh/knurl/meshIndex'
export { computeUV, MODE_TRIPLANAR, getCubicBlendWeights, type MappingSettings } from './mesh/knurl/mapping'
export { applyDisplacement, type DisplacementSettings } from './mesh/knurl/displacement'

// Primitive D 类（预览用）
export { mergeBufferGeometries, makePrimitiveGeo, DEFAULT_SIZE, applyPrimitiveOffset } from './primitives/mesh-primitives'
export { makeScrew } from './primitives/screw/screw'
export {
  extractMeshData, primitiveToBrepSolid, geometryToBrepSolid,
  brepSolidToStep, primitiveToBrepStep,
} from './primitives/brep-primitives'

// BREP 辅助（D 类）
export {
  solidToShape,
  translateBrep, rotateBrep, scaleBrep, applyTransformBrep,
  fuseBrep, cutBrep, commonBrep,
  drillBrep, splitBrep, extrudeBrep,
  loadBrep, matrixToArray,
} from './brep/brep-ops'
export { getSolidBoundingBox } from './brep/brep-utils'
export { buildStlBufferFromMesh } from './brep/export/stl'
export { exportStepFromSolid, exportStepFromSolids } from './brep/export/step'
export type { StepExportEntry } from './brep/export/step'
export { reconstructSolidFromMesh, meshToAsciiStl, cadShapeIsValid, meshToStepBrep } from './occt-kernel/meshReconstruct'
