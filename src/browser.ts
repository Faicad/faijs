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
 * ⚠️ deprecated 区：以下符号已标记为 deprecated，3d_editor 侧 E12 迁移完成后移除：
 *   - L1 内部执行引擎 API（executeStatement / BREP chain / OCCT kernel 底层函数）
 *   - 底层拓扑构建函数（已被 ExecutionResult.topology 替代）
 *   - getManifoldModule（已交由 CsgBackend）
 */

// ═══════════════════════════════════════════════════════════
// A 类：lang/ 全部导出（脚本类型 + 构建辅助 + 接口约定类型 + 常量）
// ═══════════════════════════════════════════════════════════

export type {
  PartScript, CadStatement, Arg, Vec3, JsonValue, ShapeRef,
  ParamRef, GeomRef, AssetRef, FeatureKind, FeatureMeta,
  TerminalShape, ParamDef, PartScriptMeta,
} from './lang/types'
export {
  isGeomRef, isParamRef, isAssetRef,
  createStatement, createPartScript,
} from './lang/types'
export {
  allocateStatementId, allocateSplitIds,
  isPartVmId, getModelNum, getVersionNum,
  isGrpId, getGroupNum,
} from './lang/allocate-id'
export type { AllocateIdContext } from './lang/allocate-id'
export { parseScript, ParseError, getApiVersion, computeTerminalShapes } from './lang/parser'
export type { ParseOptions, ParseResult } from './lang/parser'
export { statementToLine, scriptToCode, fmtNum, buildArgsParts } from './lang/codegen'
export { validateStatementArgs, validateScriptArgs, getOpSchema, hasOpSchema } from './lang/args-schema'
export type { OpSchema, ArgFieldSchema, ArgType, ValidationError } from './lang/args-schema'

// ═══════════════════════════════════════════════════════════
// B 类：cad-runtime/ + createBrowserPorts + 外部资源注入点
// ═══════════════════════════════════════════════════════════

export { CadRuntime, createRuntime } from './cad-runtime/runtime'
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

// E15.1: 装配约束求解器（D 类预览 API + B 类执行 API）
export {
  solveFaceMate, applyTransform, executeDoAssemble, previewAssembly, executeAssemblyPassForStmt,
} from './ops/assemble'
export type {
  FaceMateConstraint, AssemblyConstraint, AssemblyDefinition, DoAssembleContext,
} from './ops/assemble'

// ═══════════════════════════════════════════════════════════
// C 类：执行产物类型（Shape + 拓扑数据类型 + buildSelectorRuntimeMaps）
// ═══════════════════════════════════════════════════════════

export type { Shape } from './ops/types'
export type { OpContext } from './ops/types'

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
export { svgToExtrudedGeometry, parseSvgShapes } from './primitives/svg-extrude'
export type { SvgExtrudeOptions } from './primitives/svg-extrude'
export { createTextGeometry, opentypePathToGeometry } from './primitives/text-geometry'
export { runSdfInline } from './sdf/sdf-core'
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
export { executeEngrave } from './ops/engrave'
export { reconstructSolidFromMesh, meshToAsciiStl, cadShapeIsValid, meshToStepBrep } from './occt-kernel/meshReconstruct'

// ═══════════════════════════════════════════════════════════
// ⚠️ deprecated 区：L1 内部执行引擎 API（3d_editor E12 迁移后移除）
// 红线 6：宿主不应 import 这些符号。以下保留仅为兼容过渡。
// ═══════════════════════════════════════════════════════════

/** @deprecated 用 CadRuntime.execute() 替代手动逐语句执行 */
export { executeStatement } from './ops/dispatcher'
/** @deprecated 用 CadRuntime.execute() 替代 */
export { computeContentKey } from './cad-runtime/runtime'
/** @deprecated BREP 链是执行内部状态，宿主不应触碰；用 CadRuntime.execute() */
export { canUseBrep } from './ops/types'
/** @deprecated BREP 链是执行内部状态，宿主不应触碰；用 CadRuntime.execute() */
export { resolveGeomRef } from './ops/geom-ref'
/** @deprecated BREP 链是执行内部状态，宿主不应触碰；用 CadRuntime.execute() */
export type { BrepChainState } from './brep/brep-chain'
/** @deprecated BREP 链是执行内部状态，宿主不应触碰；用 CadRuntime.execute() */
export {
  createBrepChainState, initBrepChainState, releaseBrepChainState,
  BREP_NATIVE_OPS, MESH_ONLY_OPS, isCadFormat,
} from './brep/brep-chain'
/** @deprecated 用高层 API importStep/exportStep 替代 */
export {
  initOcctWasm, getKernel, disposeOcctWasm,
  computeEffectiveDeflection, importStepToMesh, importBrepToMesh,
  meshesToStep, releaseShape,
  importAssemblyFromStep, releaseAssemblyTree, collectLeafParts,
} from './occt-kernel/occtKernel'
/** @deprecated 用高层 API 类型替代 */
export type {
  WasmTessellatedMesh, WasmImportResult, AssemblyPartNode,
  MeshDeflectionOptions, ShapeHandle, OcctKernel,
  Mesh, EdgeData, SurfaceKind, CurveKind,
} from './occt-kernel/occtKernel'
/** @deprecated 交由 faijs CsgBackend */
export { getManifoldModule } from './mesh/manifold-loader'
