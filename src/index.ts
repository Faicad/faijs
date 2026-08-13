/**
 * @faicad/faijs — Faicad CAD execution engine
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

// ── L0 文本层 ──
export type {
  PartScript, CadStatement, Arg, Vec3, JsonValue, ShapeRef,
  ParamRef, GeomRef, AssetRef, FeatureKind, FeatureMeta,
  TerminalShape, ParamDef, PartScriptMeta,
} from './lang/types'
export {
  isGeomRef, isParamRef, isAssetRef, createStatementId,
  createStatement, createPartScript,
} from './lang/types'
export { parseScript, ParseError, getApiVersion } from './lang/parser'
export type { ParseOptions, ParseResult } from './lang/parser'
export { sceneToCode, statementToCode, scriptToCode, fmtNum, buildArgsParts } from './lang/codegen'
export { validateStatementArgs, validateScriptArgs, getOpSchema, hasOpSchema } from './lang/args-schema'
export type { OpSchema, ArgFieldSchema, ArgType, ValidationError } from './lang/args-schema'

// ── L1 几何执行层 ──
export type { Shape, OpContext } from './brep/ops/types'
export { executeStatement } from './brep/ops/dispatcher'
export { canUseBrep } from './brep/ops/types'
export { resolveGeomRef } from './brep/ops/geom-ref'
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
} from './mesh-ops/brep-ops'
export type { DrillBrepParams, SplitBrepParams, SplitBrepResult, ExtrudeBrepParams } from './mesh-ops/brep-ops'
export { buildStlBufferFromMesh } from './brep/export/stl'
export { exportStepFromSolid } from './brep/export/step'

// ── L1 Mesh 执行层 ──
export { cad } from './mesh-ops'
export type {
  BoundingBox, FaceDescriptor,
  BoxParams, SphereParams, CylinderParams, ConeParams, WedgeParams,
  TextParams, SvgExtrudeParams, SdfParams,
  DrillParams, ExtrudeParams, EngraveParams, KnurlParams,
  SplitPlane, SplitResult,
} from './mesh-ops/types'
export { faceAt } from './mesh-ops/query'

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
export { mergeBufferGeometries, makePrimitiveGeo, DEFAULT_SIZE, applyPrimitiveOffset } from './primitives/geometry'
export { makeScrew } from './primitives/screw/screw'
export { getScrewSpec, getScrewSpecs, threadToPitchMm, SCREW_HEAD_DIMS } from './primitives/screw/screw-db'
export type { ScrewParams, ScrewSpec, ScrewSystem } from './primitives/screw/screw-db'
export { svgToExtrudedGeometry } from './primitives/svg-extrude'
export {
  extractMeshData, primitiveToCadSolid, geometryToCadSolid,
  cadSolidToStep, primitiveToStep,
} from './primitives/primitiveToCad'
export type { PrimitiveToCadResult, PrimitiveParams } from './primitives/primitiveToCad'
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
export { applyKnurlDisplacement, KNURL_DEFAULTS } from './mesh-ops/knurl/KnurlGenerator'
export type { KnurlBounds } from './mesh-ops/knurl/KnurlGenerator'
export { subdivide } from './mesh-ops/knurl/subdivision'
export { loadKnurlingTexture } from './mesh-ops/knurl/textureLoader'
export type { TextureData } from './mesh-ops/knurl/textureLoader'
export { QuantizedPointMap, weldVertices } from './mesh-ops/knurl/meshIndex'
export { computeUV, MODE_TRIPLANAR, getCubicBlendWeights, type MappingSettings } from './mesh-ops/knurl/mapping'
export { applyDisplacement, type DisplacementSettings } from './mesh-ops/knurl/displacement'

// ── L1 Topology ──
export { TOPOLOGY_FACE_ID_NONE, buildFaceIdsForPart } from './topology/build-face-ids'
export {
  buildSelectorRuntime, buildSelectorRuntimeData, buildSelectorRuntimeMaps,
} from './topology/build-selector-runtime'
export type { SelectorRuntimeData } from './topology/build-selector-runtime'
export type {
  SelectorRuntime, SelectorBundle, SelectorManifest, SelectorBuffers,
  FaceRow, EdgeRow, Reference,
  GlbContainer, BufferViewDescriptor, SelectorProxy,
} from './topology/types'

// ── L2 编排层 ──
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
export { addStepTopology, addAssemblyStepTopology, buildAssemblySelectorManifest } from './occt-kernel/topologyExt'
export type { GlbFromResultInput, PartTopologyInput, AssemblyTopologyResult } from './occt-kernel/topologyExt'

// ── BREP Topology ──
export { buildSolidTopologyRuntime } from './brep/brep-topology'
export type { SolidTopologyResult } from './brep/brep-topology'

// ── BREP ops (engrave etc.) ──
export { executeEngrave } from './brep/ops/engrave'

// ── Font Registry (for browser host injection) ──
export { setFontLoader, getFontLoader, loadFont, ensureDefaultFont, getFont, clearFonts } from './brep/text/fontRegistry'
export type { FontLoader } from './brep/text/fontRegistry'

// ── L3 Node Host ──
export { createNodePorts } from './node-host'
export { InlineCsgBackend } from './node-host/inline-csg-backend'
export { InlineSdfBackend } from './node-host/inline-sdf-backend'
export { NodeFontProvider } from './node-host/node-font-provider'
export { FsAssetResolver } from './node-host/fs-asset-resolver'
export { CliEventSink } from './node-host/cli-event-sink'
export { cliCheck, cliRun, cliMain, parseArgs } from './node-host/cli'
export type { CliCheckResult, CliRunResult, CliRunOptions } from './node-host/cli'

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
