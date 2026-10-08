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

// ── 共享面（env-agnostic：identity + runtime-state + lang/*）──
// 手写清单已收敛：三处 umbrella（index/browser/weapp）统一 re-export，防漂移。
export * from './env-agnostic'

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

// ── L1 Mesh ──
// B3 correction (2026-10-06): no `cad` / `meshCad` aggregate is exported from the library
// face. `cad` belongs to the script face (host-injected ops); TS consumers import
// per-module from `@faicad/faijs/mesh/*`.
// 宿主注入的 mesh 装饰几何（cad.engrave 的文字/SVG 几何链在 @faicad/faijs-extra）
export { setEngraveDecorationProvider, getEngraveDecorationProvider } from './mesh/decoration-provider'
export type { EngraveDecorationProvider, EngraveDecorationParams } from './mesh/decoration-provider'
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
export { parseSvgNaturalSize } from './primitives/parse-svg-size'
export {
  extractMeshData, primitiveToBrepSolid, geometryToBrepSolid,
  brepSolidToStep, primitiveToBrepStep,
} from './primitives/brep-primitives'
export type { PrimitiveToBrepResult, PrimitiveParams } from './primitives/brep-primitives'
// B 组（svg 挤出 / 3D 文字几何链）已随 @faicad/faijs-extra 迁出；
// 留 core 的是零 three 的 CJK 字符判定与系统字体装载。
export { loadSystemCjkFont, containsCjk, isCjkChar } from './primitives/text/cjk-font'
export type { CjkFontResult } from './primitives/text/cjk-font'
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
// D1（2026-09-19）：createRuntime 自注册 cad 默认命名空间（引擎 + 标准库定位）。
// 需要纯引擎（不带 cad）的宿主可直接 import { createRuntime } from './cad-runtime/runtime'。
export { CadRuntime, createRuntime, computeContentKey, AppendPrefixError } from './cad-runtime/createRuntimeWithCad'
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
// brepkit 端侧 BREP 引擎（微信小程序等无 OCCT 环境）：由宿主注入 wasm init 并抢先注册，
// 使 ensureBrepChain 不回退 OCCT。setBrepkitWasmInitFn 注入自定义初始化（如 WXWebAssembly 实例化）。
export { registerBrepkitBrepEngine, BREPKIT_BREP_ENGINE_ID, ensureBrepkitDefaultEngine } from './brep/engine/adapters/brepkit'
// brepkit 网格实体后端（网格语义路径；与 BREP 槽独立注册）。装了它，`cad.load`
// 的 STL/3MF 路径才产出「网格实体 + 近似拓扑」；不装则维持裸网格的历史行为。
export { registerBrepkitMeshEngine, BREPKIT_MESH_ENGINE_ID, ensureBrepkitMeshBackend } from './brep/engine/adapters/brepkit'
export { setBrepkitWasmInitFn, initBrepkitWasm, isBrepkitInitialized } from './brepkit-kernel/brepkitWasm'
export {
  registerBrepEngine, getBrepEngine, hasBrepEngine, getActiveBrepEngineId,
  registerMeshEngine, getMeshEngine, getActiveMeshEngineId, freezeEngineRegistries,
  isMeshEngineRegistered, getMeshSolidBackend,
} from './brep/engine/registry'
export type { BrepEngine, BrepEngineProvider, MeshEngine } from './brep/engine/registry'
// 网格实体（近似拓扑的载体）：端口 + 注册表 + 驱动。
export { MeshSolidRegistry, normalizeMeshSolid, describeMeshSolid, buildMeshSolidTopology, weldToleranceFor } from './brep/mesh-solid'
export type {
  MeshSolidBackend, MeshSolidResult, MeshSolidKernelOps, MeshSolidInput, MeshSolidNormalizeOptions,
} from './brep/mesh-solid'
// 槽位互斥不变量（分派前置校验；缺陷即报错）
export { assertShapeSlotExclusive } from './cad-runtime/backend-dispatch'
export type { BrepEngineApi } from './brep/engine/primitives'
export type {
  BrepHandle, BrepMeshResult, BrepBoundingBox, BrepVec3, BrepEvolutionKind,
  BrepEvolutionData, BrepXcafDocument,
} from './brep/engine/types'

// ── BREP Topology ──
export { buildSolidTopologyRuntime } from './brep/brep-topology'
export type { SolidTopologyResult } from './brep/brep-topology'

// ── Font Registry (for browser host injection) ──
export { setFontLoader, getFontLoader, loadFont, ensureDefaultFont, ensureFont, getFont, clearFonts } from './brep/text/fontRegistry'
export type { FontLoader } from './brep/text/fontRegistry'

// ── L3 Node Host ──
// node-host 模块已移�?@faicad/faijs/node 入口，避免浏览器环境静�?import
// node-host 模块（含 Node.js 专用代码�?fs/path）导致生产构�?404�?
// �?Node.js 环境中：import { createNodePorts } from '@faicad/faijs/node'

// ── L3 Browser Host ──
export { createBrowserPorts } from './browser-host'
export type { CreateBrowserPortsOptions } from './browser-host'
// D3-Browser（§9.4）：CDN 通用 libLoader 工厂（a/b 混合）。**不**被 createBrowserPorts
// 默认装配——demo 的源码 alias HMR 路径必须零网络；CDN 装载由主机显式注入。
export { createBrowserLibLoader, DEFAULT_CDN_BASE } from './cad-runtime/browser-lib-loader'
export type {
  BrowserLibLoader, BrowserLibMeta, CreateBrowserLibLoaderOptions,
} from './cad-runtime/browser-lib-loader'
export { BrowserEventSink } from './browser-host/browser-event-sink'
export { BrowserFontProvider } from './browser-host/browser-font-provider'
export type { BrowserFontProviderOptions } from './browser-host/browser-font-provider'
export { FetchAssetResolver } from './browser-host/fetch-asset-resolver'
export type { FetchAssetResolverOptions } from './browser-host/fetch-asset-resolver'

// ── L3 API 面（api/ 层）──
// P23 主导出切换（§4.2 / Q1）：`export * from './api'` 现在同时带来
// ① faijs 特有 dual op（mesh+brep 双路径，D11 双形态归一）；
// ② 生成脚本面 op（`api/generated/script-face.ts`，defineOp({ brep: __own_* }) 直连的
//    brep-only 语句级 op——`cad.*` 脚本面与此同源，B1 三源一致）；
// ③ 2026-09-25 core-decouple：brepjsCompat 命名空间与 op 投影随旧子包删除
//    （裁决 9）；`api/geom-types`（原名 api/brepjs-compat，2026-10-07 改名）仅保留 core 内联的 Result / 向量 / 平面 / 错误 /
//    常量组合器（§5.2），顶层平铺不变。
export * from './api'
export { createApiNamespace } from './api/api-namespace'
// B5 (2026-10-06): unit constants re-exported from the main entry. In the script
// face they are import-free globals (S4_SAFE_GLOBALS subset); TS consumers now
// get the same names here instead of hunting for the /units subpath.
export {
  MM, CM, M, MICRON, INCH, FOOT, YARD,
  DEGREE, RADIAN,
  SCRIPT_UNIT_NAMES,
} from './units'
// Vec3 双源消歧：env-agnostic（lang/types）与 api（mesh/types）均有 Vec3，
// 显式 re-export 定为 lang 版（与收敛前 index.ts 的具名导出一致）。
export type { Vec3 } from './lang/types'
