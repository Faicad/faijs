/**
 * engine/types — BREP 引擎中立类型（零具体实现依赖，不 import 任何内核包）
 *
 * 设计：docs/plans/2026-08-30-brep-engine-switch.md §6.3 / §7.4
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
 * 可选能力槽声明（§7.5，Phase 1 钉死成员）。
 *
 * 缺失的能力 → 依赖它的功能静态降级走 mesh（§8.4），绝不伪造。
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
}
