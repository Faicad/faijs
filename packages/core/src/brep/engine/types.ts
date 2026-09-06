/**
 * engine/types — BREP 引擎中立类型（零具体实现依赖，不 import 任何内核包）
 *
 *
 * 契约（对应 brepjs 的 KernelShape 约定）：
 * - L1 及以上代码永远不对句柄调用任何方法，只把它传回产生它的那个引擎；
 * - 句柄不得跨引擎传递——跨引擎必须先经 mesh 层（§8.3 的结构保证）。
 * - OCCT 适配器的句柄运行时就是 number，加 brand 是零成本的类型层转换。
 */

declare const BrepHandleBrand: unique symbol

/**
 * BREP 实体句柄——不透明值。
 *
 * 与 occt-wasm 的 ShapeHandle 同构（number & brand）。OCCT 适配器
 * （occt-kernel/）内部以 `as unknown as` 双向转换，跨适配器边界零运行时成本。
 */
export type BrepHandle = number & { readonly [BrepHandleBrand]: never }

/** 三维点/向量（与内核无关的中立形态）。 */
export interface BrepVec3 {
  x: number
  y: number
  z: number
}

/** 轴对齐包围盒。 */
export interface BrepBoundingBox {
  xmin: number
  ymin: number
  zmin: number
  xmax: number
  ymax: number
  zmax: number
}

/** BRepMesh 三角化输出（镜像 occt-wasm Mesh 的中立形态）。 */
export interface BrepMeshResult {
  /** XYZ 交错顶点坐标，长度 = vertexCount * 3 */
  positions: Float32Array
  /** XYZ 交错顶点法线，长度 = vertexCount * 3 */
  normals: Float32Array
  /** 三角形索引 */
  indices: Uint32Array
  /** 顶点数（positions.length / 3） */
  vertexCount: number
  /** 三角形数（indices.length / 3） */
  triangleCount: number
  /** 面组：[triStart, triCount, faceHash] 三元组（meshShape 时存在） */
  faceGroups?: Int32Array
  /** 面组数（meshShape 时存在） */
  faceCount?: number
}

/** 三角化精度选项。 */
export interface BrepTessellateOptions {
  /** 最大弦偏差（mm），默认 0.1 */
  linearDeflection?: number
  /** 最大角偏差（弧度），默认 0.5 */
  angularDeflection?: number
  /** 按每条边长度相对解释 linearDeflection */
  relative?: boolean
}

/** 边折线数据（wireframe 输出）。 */
export interface BrepEdgeData {
  /** XYZ 交错边采样点 */
  points: Float32Array
  /** 每边分组：[pointStart, pointCount, edgeHash] 三元组 */
  edgeGroups: Int32Array
  /** points 中的浮点数总数（= XYZ 坐标数） */
  pointCount: number
  /** 不同边的数量 */
  edgeCount: number
}

/** *WithHistory 面演化数据（modified/generated/deleted 用面 hash 编码）。 */
export interface BrepEvolutionData {
  /** 结果句柄 */
  result: BrepHandle
  /** 输入面中被修改的面 hash */
  modified: number[]
  /** 操作新生成的面 hash */
  generated: number[]
  /** 输入面中已不存在的面 hash */
  deleted: number[]
}

/** 曲线参数区间（与内核 curveParameters 返回同构：first/last）。 */
export interface BrepCurveParameters {
  first: number
  last: number
}

/** 曲面 UV 边界。 */
export interface BrepUvBounds {
  uMin: number
  uMax: number
  vMin: number
  vMax: number
}

/** 子形状类型（getSubShapes / subShapeHashes 等）。 */
export type BrepSubShapeType = 'vertex' | 'edge' | 'wire' | 'face' | 'shell' | 'solid'

/**
 * XCAF 装配文档句柄（可选能力槽 AssemblyCapability 的文档形态）。
 *
 * 形态来自 occt-wasm XCAFDocumentImpl 的被调用子集（step.ts / occt-kernel 装配链）。
 */
export interface BrepXcafDocument {
  addShape(shape: BrepHandle, opts?: { name?: string; color?: [number, number, number] }): void
  exportSTEP(): string
  close(): void
}

/**
 * 曲面细分精度控制模型（与 brepjs KernelCapabilities.tessellationModel 同构的中立镜像，
 * P7 并入；faijs 侧零内核依赖，不 import vendored 树——D8 反向只允许发生在 api/）。
 *
 * - `'build-time'`  — 网格在实体构造时固定（如 manifold 全局分段设置）；质量参数须在构造前应用。
 * - `'extract-time'`— 形状是精确的，按需以每调用 deflection 细分（如 OCCT）；质量是
 *                    `mesh()`/导出时的默认 deflection。
 * - `'none'`        — 无细分控制（或非网格内核）。
 */
export type BrepTessellationModel = 'build-time' | 'extract-time' | 'none'

/**
 * 可选能力槽声明（§7.5，Phase 1 钉死成员）。
 *
 * 缺失的能力 → 依赖它的功能静态降级走 mesh（§8.4），绝不伪造。
 *
 * P7 并入（D4）：移植 brepjs `KernelCapabilities` 的数据字段（exact/brepExport/
 * exactMeasurement/tessellationModel）进本模型，由适配器在注册时如实声明；分派逻辑
 * （backend-dispatch 的 BrepCapabilityName 路由）不改——新字段是引擎本质描述，不是
 * 逐 op 路由键。
 *
 * 未并入 `disposalModel`（D5 决策，与 vendored port 一致）：faijs 的句柄释放由
 * `cad-runtime` 顶替释放统一编排（增量失败回滚前提），brepjs 的 DisposalScope/arena
 * 语义不强制统一，故不作为能力位记录。
 */
export interface BrepCapabilities {
  /** *WithHistory 面演化族 */
  evolution?: boolean
  /** 修复族（healSolid/fixShape/fixFaceOrientations/...） */
  heal?: boolean
  /** 直接编辑族（C1：moveFace/replaceFace/...） */
  directEdit?: boolean
  /** 高级曲面族（C1：boundarySurface/fillSurface/...） */
  advSurface?: boolean
  /** XCAF 装配族 */
  assembly?: boolean
  /** mesh→BREP 提升（buildTriFace/sewAndSolidify） */
  meshLift?: boolean
  /** 精确 B-rep 几何（vs mesh 近似）——brepjs KernelCapabilities.exact 并入 */
  exact?: boolean
  /** 可序列化为 B-rep 交换格式（BREP/STEP）——brepjs brepExport 并入 */
  brepExport?: boolean
  /** 体积/面积/长度匹配解析值（vs mesh 近似）——brepjs exactMeasurement 并入 */
  exactMeasurement?: boolean
  /** 细分精度控制模型——brepjs tessellationModel 并入 */
  tessellationModel?: BrepTessellationModel
}
