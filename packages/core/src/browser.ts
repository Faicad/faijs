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

// 共享面（env-agnostic：identity + runtime-state + lang/*）——手写清单已收敛，
// 三处 umbrella（index/browser/weapp）统一 re-export，防漂移。
export * from './env-agnostic'

// ═══════════════════════════════════════════════════════════
// B 类：cad-runtime/ + createBrowserPorts + 外部资源注入点
// ═══════════════════════════════════════════════════════════

// D1（2026-09-19）：浏览器入口同样自注册 cad（与 index.ts 同源包装，避免门面注入）。
export { CadRuntime, createRuntime, AppendPrefixError } from './cad-runtime/createRuntimeWithCad'
export { createPreviewExec } from './cad-runtime/preview-exec'
export type { PreviewExec } from './cad-runtime/preview-exec'
export type { ExecutionResult, ExecuteOptions, CheckResult, CheckError, PartTopology, TopologySource } from './cad-runtime/runtime'
export type {
  HostPorts,
  CsgBackend, SdfBackend, FontProvider, TextureSampler,
  AssetResolver, EventSink, ExecutionMode, LibLoader,
  MeshData, PlaneParams, SplitResult as CsgSplitResult,
  DovetailGrooveParams as PortDovetailGrooveParams,
  DowelSplitParams as PortDowelSplitParams,
  StraightTenonSplitParams as PortStraightTenonSplitParams,
} from './cad-runtime/ports'

// 外部资源注入点
export { setManifoldWasmUrl, getManifoldWasmUrl } from './mesh/manifold-loader'
export { setOcctWasmInitFn } from './occt-kernel/occtKernel'
// brepkit（weapp 专用 BREP 引擎）不在此导出——见 weapp.ts 与
// docs/plans/2026-09-20-weapp-host-entry-design.md。
export { setFontLoader, getFontLoader, loadFont, ensureDefaultFont, ensureFont, getFont, clearFonts } from './brep/text/fontRegistry'
export type { FontLoader } from './brep/text/fontRegistry'
export { setKnurlTextureLoader } from './mesh/knurl/textureLoader'

// L3 Browser Host 工厂
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
  registerMeshEngine, getMeshEngine, getActiveMeshEngineId, isMeshEngineRegistered, getMeshSolidBackend,
} from './brep/engine/registry'
export type { BrepEngine, BrepEngineProvider, MeshEngine } from './brep/engine/registry'
// 网格实体（近似拓扑的载体）：端口 + 注册表 + 驱动。
// 注意：**brepkit 网格适配器不在 browser umbrella**——与 BREP 适配器同因
// （`brepkitWasm` 的 node 分支 `import('brepkit-wasm')` 会被 vite 静态解析，
// 该包在 web 侧不存在；见 entry-boundary.test.ts）。浏览器宿主需要网格实体时，
// 从根入口 `@faicad/faijs` 或 `weapp` 取 `ensureBrepkitMeshBackend`，或自备后端。
export { MeshSolidRegistry, normalizeMeshSolid, describeMeshSolid, buildMeshSolidTopology, weldToleranceFor } from './brep/mesh-solid'
export type {
  MeshSolidBackend, MeshSolidResult, MeshSolidKernelOps, MeshSolidInput, MeshSolidNormalizeOptions,
} from './brep/mesh-solid'
export { assertShapeSlotExclusive } from './cad-runtime/backend-dispatch'
export type { BrepEngineApi } from './brep/engine/primitives'
export type {
  BrepHandle, BrepMeshResult, BrepBoundingBox, BrepVec3, BrepCapabilities,
  BrepEvolutionData, BrepXcafDocument,
} from './brep/engine/types'
export { buildTopologyAdjacency, type TopologyAdjacency } from './occt-kernel/topologyExt'

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
// B 组（svg 挤出 / 3D 文字几何链）已随 @faicad/faijs-extra 迁出；留 core 的是
// 零 three 的 CJK 字符判定与系统字体装载。
export type { CjkFontResult } from './primitives/text/cjk-font'
export { loadSystemCjkFont, containsCjk, isCjkChar } from './primitives/text/cjk-font'

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
// B3 correction (2026-10-06): no `cad` / `meshCad` aggregate is exported from the library
// face; `cad` belongs to the script face (host-injected ops) — TS consumers import
// per-module from `@faicad/faijs/mesh/*`.
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
// 宿主注入的 mesh 装饰几何（cad.engrave 的文字/SVG 几何链在 @faicad/faijs-extra）
export { setEngraveDecorationProvider, getEngraveDecorationProvider } from './mesh/decoration-provider'
export type { EngraveDecorationProvider, EngraveDecorationParams } from './mesh/decoration-provider'
export { runSdfInline } from './sdf/sdf-core'
export { runSdf as runSdfMain } from './sdf/sdf-runner'
export type { SdfMeshData as PreviewSdfMesh } from './sdf/sdf-runner'

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

// ── L3 API 面（api/ 层）──
export * from './api'
// Vec3 双源消歧：env-agnostic（lang/types）与 api（mesh/types）均有 Vec3，
// 显式 re-export 定为 lang 版（与收敛前 browser.ts 的具名导出一致）。
export type { Vec3 } from './lang/types'
