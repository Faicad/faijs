/**
 * cad-core 类型定义 — 纯数据几何 API 的类型契约
 *
 * 设计原则（§5.1）：
 * - 全部纯数据：输入输出是 ManifoldMeshData 或 JSON 值，不碰 THREE 场景、不读 store
 * - 不可变：每个 API 返回新几何，不修改输入
 * - 坐标系：右手系 +Z 向上、毫米、角度用度
 * - 坐标空间：所有 API 输入/输出均为**世界空间** ManifoldMeshData
 *   （局部↔世界变换由执行器负责，cad-core 不感知 mesh.matrixWorld）
 *
 * P1 阶段 Shape = ManifoldMeshData（无 worker）。
 * P3+ 阶段 Shape 将变为 worker 内 Manifold 对象的句柄。
 */

// ── 基础类型 ──

export type Vec3 = [number, number, number]

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue }

// ── Shape ──

/**
 * 几何形状 — cad-core 的核心数据类型。
 *
 * 定义已移至 L1 层（@/brep/ops/types.ts），此处重新导出以保持向后兼容。
 * L3 代码可继续从 @/engine/cad-core/types 导入 Shape。
 */
import type { Shape } from '../brep/ops/types'
export type { Shape }

// ── 创建参数 ──

/** nRad 默认值及约束 */
export const NRAD_DEFAULT = 32
export const NRAD_MIN = 3
export const NRAD_MAX = 128

/** 将 nRad 钳位到合法范围 */
export function clampNRad(n: number | undefined): number {
  if (n === undefined) return NRAD_DEFAULT
  return Math.max(NRAD_MIN, Math.min(NRAD_MAX, Math.round(n)))
}

export interface BoxParams {
  size: Vec3 | number
  center?: Vec3
  nRad?: number
}

export interface SphereParams {
  radius: number
  segments?: number
  center?: Vec3
  nRad?: number
}

export interface CylinderParams {
  radius: number
  height: number
  segments?: number
  center?: Vec3
  nRad?: number
}

export interface ConeParams {
  radiusBottom: number
  radiusTop: number
  height: number
  segments?: number
  center?: Vec3
  nRad?: number
}

export interface WedgeParams {
  /** 底边宽度 (mm)，沿 Y 轴 */
  width: number
  /** 梯形高 (mm)，沿 Z 轴 */
  height: number
  /** 底边与斜边的夹角 (度) */
  angle: number
  /** 拉伸总长 (mm)，沿 X 轴 */
  length: number
  center?: Vec3
  nRad?: number
}

export interface TextParams {
  text: string
  size: number
  depth: number
}

export interface SvgExtrudeParams {
  svg: string
  depth: number
  targetLongSide: number
  naturalWidth?: number
  naturalHeight?: number
}

export interface SdfParams {
  code: string
  box?: [Vec3, Vec3]
  resolution?: number
  params?: Record<string, number>
}

// ── 变换参数 ──

export interface TranslateParams {
  offset: Vec3
}

export interface RotateParams {
  anglesDeg: Vec3
  pivot?: Vec3
}

export interface ScaleParams {
  factor: number | Vec3
}

// ── 布尔参数 ──

export type BooleanOperation = 'union' | 'subtract' | 'intersect'

// ── 分割参数 ──

export interface SplitPlane {
  normal: Vec3
  offset: number
}

export interface DovetailSplitParams {
  plane: SplitPlane
  planeCenter: Vec3
  widthDir: Vec3
  bboxWidthOnWidthDir: number
  groove: {
    depth: number
    depthTolerance: number
    width: number
    widthTolerance: number
    flapsAngle: number
  }
}

export interface DowelSplitParams {
  plane: SplitPlane
  planeCenter: Vec3
  widthDir: Vec3
  dowel: {
    diameter: number
    diameterTolerance: number
    height: number
    heightTolerance: number
  }
  selectedSections?: number[] | null
}

export interface TenonSplitParams {
  plane: SplitPlane
  planeCenter: Vec3
  widthDir: Vec3
  tenon: {
    sideLength: number
    sideLengthTolerance: number
    height: number
    heightTolerance: number
  }
  selectedSections?: number[] | null
}

export interface SplitResult {
  front: Shape
  back: Shape
  wedge: Shape | null
}

// ── 钻孔参数 ──

export interface DrillParams {
  diameter: number
  depth?: number
  type: 'through' | 'blind'
  position: Vec3
  direction: Vec3
  faceNormal: Vec3
  tolerance?: number
  holeType?: 'simple' | 'screw'
  screwSystem?: string
  screwSpecIdx?: number
  screwThread?: string
  screwHead?: string
}

// ── 拉伸参数 ──

export interface ExtrudeParams {
  normal: Vec3
  originOffset: number
  length: number
  mode?: 'centered' | 'forward' | 'backward'
}

// ── 雕刻参数 ──

export interface EngraveParams {
  mode: 'convex' | 'concave'
  depth: number
  face: {
    center: Vec3
    normal: Vec3
  }
  text?: string
  textSize?: number
  svg?: string
  svgNaturalWidth?: number
  svgNaturalHeight?: number
  svgSize?: number
}

export interface KnurlParams {
  face: {
    center: Vec3
    normal: Vec3
  }
  knurlTextureHeight: number
  knurlInvertDisplacement: boolean
  knurlRefineLength: number
  knurlScaleU: number
  knurlScaleV: number
  knurlMappingMode: number
}

// ── 查询结果 ──

export interface BoundingBox {
  min: Vec3
  max: Vec3
}

export interface FaceDescriptor {
  center: Vec3
  normal: Vec3
  area: number
}
