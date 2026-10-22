/**
 * @faicad/faijs — Faicad CAD execution engine
 *
 * Public API umbrella entry. All exports are re-exports (no new signatures).
 * Organized by architecture layer (L0–L3); each layer consumes `export *` from
 * its sub-module index.ts, with explicit disambiguation for same-name types.
 */

// ── 共享面（env-agnostic：identity + runtime-state + lang/*）──
export * from './env-agnostic'

// ── L1 Mesh（types + knurl + decoration + manifold-loader + query + import-model）──
export * from './mesh'

// ── L1 BREP（ops + chain + utils + export）──
export * from './brep'
export { buildStlBufferFromMesh } from './brep/export/stl'
export { exportStepFromSolid, exportStepFromSolids } from './brep/export/step'
export type { StepExportEntry } from './brep/export/step'

// ── L1 Boolean/CSG ──
export * from './boolean'

// ── L1 Primitives ──
export * from './primitives'

// ── L1 SDF ──
export * from './sdf'

// ── L1 Topology ──
export { TOPOLOGY_FACE_ID_NONE, buildFaceIdsForPart } from './topology/build-face-ids'
export {
  buildSelectorRuntime, buildSelectorRuntimeData, buildSelectorRuntimeMaps,
} from './topology/build-selector-runtime'
export { buildVertexAdjacency } from './topology/build-vertex-adjacency'
export type { SelectorRuntimeData } from './topology/build-selector-runtime'
export type {
  SelectorRuntime, SelectorBundle, SelectorManifest, SelectorBuffers,
  FaceRow, EdgeRow, Reference,
  BufferViewDescriptor, SelectorProxy, VertexAdjacency,
} from './topology/types'
export * from './topology/naming'

// ── L2 编排层 ──
// createRuntime auto-registers the built-in cad namespace (D1, facade-refactor
// 2026-10-08). Use createBareRuntime for a pure engine without cad.
export { CadRuntime, createRuntime, createBareRuntime, computeContentKey, AppendPrefixError } from './cad-runtime/runtime'
export { createPreviewExec } from './cad-runtime/preview-exec'
export type { PreviewExec } from './cad-runtime/preview-exec'
export type { ExecutionResult, ExecuteOptions, CheckResult, CheckError, CadRuntimeOptions, PartTopology, TopologySource } from './cad-runtime/runtime'
export type { ExecutionStats, ExecutionPath, ExecutionFallbackReason } from './cad-runtime/execution-stats'
export type {
  HostPorts, CsgBackend, SdfBackend, FontProvider, TextureSampler,
  AssetResolver, EventSink, ExecutionMode, HostEnv,
  MeshData, PlaneParams, SplitResult as CsgSplitResult,
  DovetailGrooveParams as PortDovetailGrooveParams,
  DowelSplitParams as PortDowelSplitParams,
  StraightTenonSplitParams as PortStraightTenonSplitParams,
  LibLoader, ProjectLoader,
} from './cad-runtime/ports'
// 两级声明契约（2026-10-14 §3.3）：库级定位属性（`faijs.lib`）+ 函数级实现事实
// （`fn.engines`）。`LibLoader.libMetaFor` / `registerLib({ lib, peers })` 的声明形状。
export { LIB_ROLES, assertLibDecl, resolveFunctionEngines } from './cad-runtime/lib-decl'
export type {
  LibRole, LibDecl, LibMeta,
  LibFunctionView, LibDescription, LibCallableView, LibRejectedView, LibsUnderEngine,
} from './cad-runtime/lib-decl'

// ── OCCT Kernel ──
export {
  initOcctWasm, getOcctKernel, disposeOcctWasm, setOcctWasmInitFn,
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
export type { BrepKitKernel } from './brepkit-kernel/brepkitWasm'
// brepkit 平台面（D3）：平台特定代码访问 brepkit 独有能力的唯一出口——与 occt 侧
// `getOcctKernel()` 对称。库代码 import 它即声明「这段代码只跑在 brepkit 引擎下」。
export { getBrepKitKernel } from './brepkit-kernel/brepkitKernel'
export {
  registerBrepEngine, getBrepEngine, getActiveBrepEngine, hasBrepEngine, getActiveBrepEngineId,
  registerMeshEngine, getMeshEngine, getActiveMeshEngine, getActiveMeshEngineId, freezeEngineRegistries,
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

// ── L3 Browser Host ──
export { createBrowserPorts } from './browser-host'
export type { CreateBrowserPortsOptions } from './browser-host'
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
export * from './api'
export { createApiNamespace } from './api/api-namespace'

// ── Units ──
export {
  MM, CM, M, MICRON, INCH, FOOT, YARD,
  DEGREE, RADIAN,
  SCRIPT_UNIT_NAMES,
} from './units'
export type { DimName, DimDecl, DimSpec, BaseDimension, UnitName } from './units'

// ── 重名消歧：Vec3 双源（lang/types vs mesh/types），显式指定 lang 版 ──
export type { Vec3 } from './lang/types'
