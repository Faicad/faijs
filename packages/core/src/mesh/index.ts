/**
 * mesh — 纯数据几何内核（按模块组织的实现层）
 *
 * See docs/api-contract.md §1 (architecture layers) and §10 (api function catalog).
 *
 * 原则（§5.1）：
 * 1. 全部纯数据：输入输出是 Shape (ManifoldMeshData)，不碰 THREE 场景、不读 store
 * 2. 不可变：每个 API 返回新几何，不修改输入
 * 3. 同步签名、异步执行：API 签名同步（或 async）；worker 边界由 ScriptEngine 处理
 * 4. 坐标系：右手系 +Z 向上、毫米、角度用度
 *
 * ⚠️ B3 补正（2026-10-06）：本文件不导出任何聚合对象（`cad` / `meshCad` 已删除）。
 * 要内核实现就从对应模块具名导入。门面层经 `export * from './mesh'` 消费。
 */

// ── types ──
export type {
  Shape, BoundingBox, FaceDescriptor,
  BoxParams, SphereParams, CylinderParams, ConeParams, WedgeParams,
  TextParams, SvgExtrudeParams, SdfParams,
  DrillParams, ExtrudeParams, EngraveParams, KnurlParams,
  SplitPlane, SplitResult, DovetailSplitParams, TenonSplitParams,
} from './types'
export { NRAD_DEFAULT, NRAD_MIN, NRAD_MAX, clampNRad } from './types'
export { isMeshShape } from './types'

// ── stl-unit ──
export { guessStlUnit } from './stl-unit'

// ── decoration-provider ──
export { setEngraveDecorationProvider, getEngraveDecorationProvider } from './decoration-provider'
export type { EngraveDecorationProvider, EngraveDecorationParams } from './decoration-provider'

// ── manifold-loader ──
export { setManifoldWasmUrl, getManifoldWasmUrl, getManifoldModule } from './manifold-loader'

// ── query ──
export { faceAt } from './query'

// ── knurl ──
export { applyKnurlDisplacement, KNURL_DEFAULTS } from './knurl/KnurlGenerator'
export type { KnurlBounds } from './knurl/KnurlGenerator'
export { subdivide } from './knurl/subdivision'
export { loadKnurlingTexture, setKnurlTextureLoader } from './knurl/textureLoader'
export type { TextureData } from './knurl/textureLoader'
export { QuantizedPointMap, weldVertices } from './knurl/meshIndex'
export { computeUV, MODE_TRIPLANAR, getCubicBlendWeights, type MappingSettings } from './knurl/mapping'
export { applyDisplacement, type DisplacementSettings } from './knurl/displacement'

// ── import-model ──
export type {
  ImportModel, ImportPart, ImportAssemblyNode, ImportBambuViews,
} from './import-model'
