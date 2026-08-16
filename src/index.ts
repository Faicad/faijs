/**
 * @faicad/faijs �?Faicad CAD execution engine
 *
 * 公开 API 统一入口。所有导出按层组织：
 * - L0 文本层：parser / codegen / args-schema / types
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

// ── L0 文本�?──
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
} from './lang/allocate-id'
export type { AllocateIdContext } from './lang/allocate-id'
export { parseScript, ParseError, getApiVersion, computeTerminalShapes } from './lang/parser'
export type { ParseOptions, ParseResult } from './lang/parser'
export { statementToLine, scriptToCode, fmtNum, buildArgsParts } from './lang/codegen'
export { validateStatementArgs, validateScriptArgs, getOpSchema, hasOpSchema } from './lang/args-schema'
export type { OpSchema, ArgFieldSchema, ArgType, ValidationError } from './lang/args-schema'

// ── L1 几何执行�?──
export type { Shape, OpContext } from './ops/types'
export { executeStatement } from './ops/dispatcher'
export { canUseBrep } from './ops/types'
export { resolveGeomRef } from './ops/geom-ref'
export type { BrepChainState } from './brep/brep-chain'
export {
  createBrepChainState, initBrepChainState, releaseBrepChainState,
  breakBrepChain, lastSolidOfChain,
  BREP_NATIVE_OPS, MESH_ONLY_OPS, isCadFormat,
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
export { exportStepFromSolid } from './brep/export/step'

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

// ── L2 编排�?──
export { CadRuntime, createRuntime, computeContentKey } from './cad-runtime/runtime'
export type { ExecutionResult, ReplayOptions, CheckResult, CheckError } from './cad-runtime/runtime'
export type {
  HostPorts, CsgBackend, SdfBackend, FontProvider, TextureSampler,
  AssetResolver, EventSink, ExecutionMode,
  MeshData, PlaneParams, SplitResult as CsgSplitResult,
  DovetailGrooveParams as PortDovetailGrooveParams,
  DowelSplitParams as PortDowelSplitParams,
  StraightTenonSplitParams as PortStraightTenonSplitParams,
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

// ── OCCT Topology Extension ──
export { buildSelectorManifest, buildAssemblySelectorManifest } from './occt-kernel/topologyExt'
export type { SelectorManifestInput, PartTopologyInput, AssemblyTopologyResult } from './occt-kernel/topologyExt'

// ── BREP Topology ──
export { buildSolidTopologyRuntime } from './brep/brep-topology'
export type { SolidTopologyResult } from './brep/brep-topology'

// ── BREP ops (engrave etc.) ──
export { executeEngrave } from './ops/engrave'

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

// ── Test helpers ──
export { replayScript, type ReplayOutput } from './test-helpers'
