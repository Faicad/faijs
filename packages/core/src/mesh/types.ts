/**
 * mesh 类型定义 — 纯数据几何 API 的类型契约
 *
 * 设计原则（§5.1）：
 * - 全部纯数据：输入输出是 ManifoldMeshData 或 JSON 值，不碰 THREE 场景、不读 store
 * - 不可变：每个 API 返回新几何，不修改输入
 * - 坐标系：右手系 +Z 向上、毫米、角度用度
 * - 坐标空间：所有 API 输入/输出均为**世界空间** ManifoldMeshData
 *   （局部↔世界变换由执行器负责，mesh 不感知 mesh.matrixWorld）
 *
 * P1 阶段 Shape = ManifoldMeshData（无 worker）。
 * P3+ 阶段 Shape 将变为 worker 内 Manifold 对象的句柄。
 */

import type { PbrAppearance } from '../api/appearance'

// ── 基础类型 ──

/** 三维坐标 / RGB 颜色元组（分量 sRGB 0–1）。 */
export type Vec3 = [number, number, number]

/**
 * A JSON-serializable value: scalar, null, array, or plain object.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue }

// ── Shape ──

/**
 * A mesh shape — the core data type of the mesh API.
 *
 * Shape is defined directly in mesh/types.ts rather than re-exported from
 * ops/types.ts; ops/types.ts imports it from here, removing the type cycle.
 *
 * 外观（PBR）：`appearance` 为可选数据字段（设计文档 2026-10-05 v2 §4.2），
 * 双链路产物自解释、可序列化；外观设置是 Shape **方法**（非 op，见
 * `api/appearance.ts` 的 `ShapeAppearanceMethods` / `attachAppearanceMethods`），
 * 方法只挂载在产物构造点（solid/curve）返回的实例上，基础 Shape 保持纯数据
 * 契约——因此本接口**不** extends 方法接口，`isMeshShape` 鸭子判定不受影响。
 */
export interface Shape {
  positions: Float32Array
  indices: Uint32Array
  /** 可选：形状级外观（mesh/brep 双链路产物自解释；worker 序列化保留字段、不保留方法）。 */
  appearance?: PbrAppearance
  /** Phase 2：面级外观分组 [三角形起始, 数量, 外观]；存在时优先于 appearance 作为未分组默认。 */
  materialGroups?: Array<{ start: number; count: number; appearance: PbrAppearance }>
  /** Phase 2：顶点颜色（3MF colorgroup / 面级 mesh 链），sRGB 0–1，长度 = positions 长度。 */
  vertexColors?: Float32Array
  /**
   * 面结构元数据：面序号 → 三角形区间 [start, count)（start/count 为三角形索引，
   * 对应 positions/indices 焊接后的三角形序列）。仅参数化 primitives 构造时记录
   * （面结构构造时已知、三角形顺序固定）；manifold 布尔/组合/导入后无 CAD 面
   * 概念，本字段不存在。`setFaceColor`/`setFaceMaterial` 依赖本字段把面序号映射
   * 到三角形区间并写入 materialGroups。
   */
  faceRanges?: Array<{ start: number; count: number }>
}

/**
 * Structural guard: returns true when the value looks like a mesh Shape
 * (duck-typed via positions/indices, with no requirements on third-party
 * types).
 *
 * Per the keep-syntax design, hosts use this guard to distinguish mesh Shapes
 * from compounds when consuming ExecutionResult.outputs, in the same style as
 * the runtime-internal isShapeLike.
 * @param v - the value to test.
 * @returns true when the value is a mesh Shape.
 */
export function isMeshShape(v: unknown): v is Shape {
  return !!v && typeof v === 'object' && 'positions' in v && 'indices' in v
}

// ── 创建参数 ──

/** Default radial segment count used for rounded geometry. */
export const NRAD_DEFAULT = 64
/** Minimum allowed radial segment count. */
export const NRAD_MIN = 3
/** Maximum allowed radial segment count. */
export const NRAD_MAX = 128

/**
 * Clamp an nRad value into the legal range [NRAD_MIN, NRAD_MAX], rounding to
 * the nearest integer; undefined falls back to NRAD_DEFAULT.
 * @param n - the requested radial segment count, or undefined.
 * @returns the clamped radial segment count.
 */
export function clampNRad(n: number | undefined): number {
  if (n === undefined) return NRAD_DEFAULT
  return Math.max(NRAD_MIN, Math.min(NRAD_MAX, Math.round(n)))
}

/**
 * Parameters for creating a box (brepjs `box(width, depth, height, {at?, centered?, segments?})`
 * contract, §4.1 A 决策). Default: min-corner at the origin. `centered: true` shifts so the
 * box is centered at the origin; `at` is CENTER semantics and takes precedence over `centered`.
 */
export interface BoxParams {
  /** Side length along X (mm). */
  width: number
  /** Side length along Y (mm). */
  depth: number
  /** Side length along Z (mm). */
  height: number
  /** Center position (brepjs `at`, CENTER semantics); takes precedence over `centered`. */
  at?: Vec3
  /** Center the box at the origin when `at` is absent. Default: false (min-corner at origin). */
  centered?: boolean
  /** Tessellation segment count (box: affects only brep/mesh tessellation, not topology). */
  segments?: number
  /** Internal historical alias for `segments` (accepted by clampNRad, §5.1). */
  nRad?: number
}

/** Parameters for creating a sphere. */
export interface SphereParams {
  radius: number
  segments?: number
  center?: Vec3
  nRad?: number
}

/** Parameters for creating a cylinder (brepjs contract, §4.3 A). */
export interface CylinderParams {
  /** Radius (mm). */
  radius: number
  /** Height along +Z (mm). */
  height: number
  /** Base circle center (brepjs `at`, BASE semantics; default [0, 0, 0]). */
  at?: Vec3
  /** Center the cylinder (base at −h/2 / center at `at`) instead of base at `at`/origin. */
  centered?: boolean
  /** Tessellation segment count (cylinder: affects only tessellation, not topology). */
  segments?: number
  /** Internal historical alias for `segments` (accepted by clampNRad, §5.1). */
  nRad?: number
}

/** Parameters for creating a cone (or a truncated cone). */
export interface ConeParams {
  /** Radius at the base (mm). */
  radiusBottom: number
  /** Radius at the top (mm); 0 for a pointed cone, === radiusBottom for a cylinder. */
  radiusTop: number
  /** Height along +Z (mm). */
  height: number
  /** Base circle center (brepjs `at`, BASE semantics; default [0, 0, 0]). */
  at?: Vec3
  /** Center the cone (base at −h/2 / center at `at`) instead of base at `at`/origin. */
  centered?: boolean
  /** Tessellation segment count (cone: affects only mere tessellation, not topology). */
  segments?: number
  /** Internal historical alias for `segments` (accepted by clampNRad, §5.1). */
  nRad?: number
}

/**
 * Parameters for creating a wedge (trapezoidal prism).
 */
export interface WedgeParams {
  /** Width of the base edge (mm), along the Y axis. */
  width: number
  /** Height of the trapezoid (mm), along the Z axis. */
  height: number
  /** Angle between the base edge and the slope (degrees). */
  angle: number
  /** Total extrusion length (mm), along the X axis. */
  length: number
  center?: Vec3
  nRad?: number
}

/** Parameters for creating 3D text. */
export interface TextParams {
  text: string
  size: number
  depth: number
}

/** Parameters for extruding an SVG into a solid. */
export interface SvgExtrudeParams {
  svg: string
  depth: number
  targetLongSide: number
  naturalWidth?: number
  naturalHeight?: number
}

/** Parameters for building a solid from an SDF (signed distance function). */
export interface SdfParams {
  code: string
  box?: [Vec3, Vec3]
  resolution?: number
  params?: Record<string, number>
}

// ── 变换参数 ──

/** Parameters for translating a shape. */
export interface TranslateParams {
  offset: Vec3
}

/** Parameters for rotating a shape. */
export interface RotateParams {
  angles: Vec3
  pivot?: Vec3
}

/** Parameters for scaling a shape. */
export interface ScaleParams {
  factor: number | Vec3
}

// ── 布尔参数 ──

/** Kinds of binary boolean operations. */
export type BooleanOperation = 'union' | 'subtract' | 'intersect'

// ── 分割参数 ──

/** A cutting plane defined by a unit normal and a signed offset. */
export interface SplitPlane {
  normal: Vec3
  offset: number
}

/** Parameters for a dovetail split, including the cutting plane setup. */
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

/** Parameters for a dowel-pin split, including the cutting plane setup. */
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

/** Parameters for a straight-tenon split, including the cutting plane setup. */
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

/** Result of a joinery split: the two halves plus the cut-out wedge. */
export interface SplitResult {
  front: Shape
  back: Shape
  wedge: Shape | null
}

// ── 钻孔参数 ──

/** Parameters for drilling a hole. */
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

/** Parameters for extruding a face bounded by a plane. */
export interface ExtrudeParams {
  normal: Vec3
  planeDistance: number
  length: number
  mode?: 'centered' | 'forward' | 'backward'
}

// ── 雕刻参数 ──

/** Parameters for engraving text or an SVG onto a face. */
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

/** Parameters for applying a knurl texture to a face. */
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

/** Axis-aligned bounding box in world space. */
export interface BoundingBox {
  min: Vec3
  max: Vec3
}

/** Description of a face on a shape: center, normal and area. */
export interface FaceDescriptor {
  center: Vec3
  normal: Vec3
  area: number
}
