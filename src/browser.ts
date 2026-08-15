/**
 * @faicad/faijs/browser — Browser-safe exports
 *
 * Excludes L3 Node Host modules (node-host/*) that depend on node:fs/node:path.
 * Use this entry point in browser/worker contexts to avoid pulling in Node.js code.
 *
 * For full exports (including Node.js), use @faicad/faijs instead.
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

// ── L1 几何执行层 ──
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
  solidToShape,
  translateBrep, rotateBrep, scaleBrep,
  fuseBrep, cutBrep, commonBrep,
  drillBrep, splitBrep, extrudeBrep,
  loadBrep, matrixToArray,
} from './brep/brep-ops'
export { getSolidBoundingBox } from './brep/brep-utils'
export type { DrillBrepParams, SplitBrepParams, SplitBrepResult, ExtrudeBrepParams } from './brep/brep-ops'
export { buildStlBufferFromMesh } from './brep/export/stl'
export { exportStepFromSolid } from './brep/export/step'
export { cad } from './mesh'
export { faceAt } from './mesh/query'
export type {
  BoundingBox, FaceDescriptor,
  BoxParams, SphereParams, CylinderParams, ConeParams, WedgeParams,
  TextParams, SvgExtrudeParams, SdfParams,
  DrillParams, ExtrudeParams, EngraveParams, KnurlParams,
  SplitPlane, SplitResult,
} from './mesh/types'
export { NRAD_DEFAULT, NRAD_MIN, NRAD_MAX, clampNRad } from './mesh/types'

// ── L1 Boolean/CSG 辅助 ──
export { computeSection, buildExtrudedProfile } from './boolean/cross-section'
export { manifoldToMeshData, weldPositionsWorker, dovetailBooleanSplit, dowelOrTenonBooleanSplit, chainBoolean, meshToManifold } from './boolean/csg-core'
export { deriveNormals } from './boolean/deriveNormals'
export { buildExtrudeParts, makeWorldPlane } from './boolean/extrude-helpers'
export type { ExtrudeParts, ExtrudeOffsetMode } from './boolean/extrude-helpers'
export {
  buildWedgeGeometry, buildDowelGeometry, buildStraightTenonGeometry,
} from './boolean/joinery-shapes'
export type { JoineryMeshData } from './boolean/joinery-shapes'

// ── CSG Backend ──
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
export type { SdfMeshData } from './sdf/sdf-runner'
export { SDF_TEMPLATES, DEFAULT_SDF_TEMPLATE } from './sdf/templates'
export type {
  SdfMeta, SdfBox, SdfParamDef, SdfTemplateCategory,
  SdfWorkerInput, SdfWorkerMessage,
} from './sdf/types'
export { boxToTuple, parseParamDefs, defaultParamValues } from './sdf/types'
export { runSdfInline } from './sdf/sdf-core'

// ── L1 Knurl ──
export { applyKnurlDisplacement, KNURL_DEFAULTS } from './mesh/knurl/KnurlGenerator'
export type { KnurlBounds } from './mesh/knurl/KnurlGenerator'
export { subdivide } from './mesh/knurl/subdivision'
export { loadKnurlingTexture } from './mesh/knurl/textureLoader'
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
  GlbContainer, BufferViewDescriptor, SelectorProxy,
} from './topology/types'

// ── L2 编排层 ──
export { CadRuntime, createRuntime, computeContentKey } from './cad-runtime/runtime'
export type { ExecutionResult, ReplayOptions, CheckResult, CheckError } from './cad-runtime/runtime'
export type {
  HostPorts,
  CsgBackend, SdfBackend, FontProvider, TextureSampler,
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
export { executeEngrave } from './ops/engrave'

// ── Font Registry (for browser host injection) ──
export { setFontLoader, getFontLoader, loadFont, ensureDefaultFont, getFont, clearFonts } from './brep/text/fontRegistry'
export type { FontLoader } from './brep/text/fontRegistry'

// ── L3 Browser Host ──
export { createBrowserPorts } from './browser-host'
export type { CreateBrowserPortsOptions } from './browser-host'
export { BrowserEventSink } from './browser-host/browser-event-sink'
export { BrowserFontProvider } from './browser-host/browser-font-provider'
export type { BrowserFontProviderOptions } from './browser-host/browser-font-provider'
export { FetchAssetResolver } from './browser-host/fetch-asset-resolver'
export type { FetchAssetResolverOptions } from './browser-host/fetch-asset-resolver'

// ── Manifold Loader (WASM URL injection) ──
export { setManifoldWasmUrl, getManifoldWasmUrl, getManifoldModule } from './mesh/manifold-loader'

// ── Knurl Texture Loader (browser host injection) ──
export { setKnurlTextureLoader } from './mesh/knurl/textureLoader'

// ── Worker Backends (for consumers that want Worker-based CSG/SDF) ──
export { WorkerCsgBackend } from './browser-host/worker-csg-backend'
export { WorkerSdfBackend } from './browser-host/worker-sdf-backend'