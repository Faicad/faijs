/**
 * api/pmi/types — PMI (Product Manufacturing Information) data model
 *
 *定位（与 api/appearance.ts / api/meta.ts 同款方法模式）：
 * - PMI 类型是**引擎无关、JSON 可序列化**的纯数据，随 Shape 走 mesh/brep 双链路。
 * - PMI 标注的 target/targets 使用 `TopoRef`（已有拓扑命名系统），实现 3D 原生 PMI
 *   （附着在拓扑元素上而非 2D 图纸）。
 * - 本文件零依赖（唯一 import 是 type-only 的 TopoRef / Vec3）。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-design.md §2
 */

import type { TopoRef, FaceTopoRef } from '../../topology/naming/types'
import type { Vec3 } from '../../mesh/types'

// ── 尺寸公差 ──

/** Dimension type (aligned with FreeCAD DrawViewDimension::DimensionType). */
export type PmiDimensionType =
  | 'linear'       // linear distance between two points
  | 'linearX'      // X-axis projected distance
  | 'linearY'      // Y-axis projected distance
  | 'linearZ'      // Z-axis projected distance
  | 'diameter'     // diameter of a cylindrical face
  | 'radius'       // radius of an arc/cylindrical face
  | 'angle'        // angle between two edges
  | 'angle3pt'     // angle defined by three points

/**
 * Dimensional tolerance annotation.
 *
 * The nominal value is **not stored** — it is dynamically recomputed from the
 * 3D geometry at query/export time (same as FreeCAD's `execute()` re-evaluation).
 * Tolerance values are engineering specifications set by the user and do not
 * change with geometry modifications.
 */
export interface PmiDimension {
  readonly kind: 'dimension'
  /** Dimension type. */
  readonly dimType: PmiDimensionType
  /** TopoRef targets (1-3 depending on dimType: diameter=1, linear=2, angle3pt=3). */
  readonly targets: readonly TopoRef[]
  /**
   * Nominal value (mm or degrees). When omitted, the runtime recomputes from
   * geometry. When present (e.g. imported from STEP), it is a cached snapshot.
   */
  readonly nominal?: number
  /** Upper tolerance (mm or degrees). */
  readonly upperTolerance?: number
  /** Lower tolerance (mm or degrees). */
  readonly lowerTolerance?: number
  /** Symmetric tolerance (upper = -lower; displayed as +/-T). */
  readonly symmetric?: boolean
  /** Theoretically exact dimension (boxed display, no tolerance). */
  readonly theoreticalExact?: boolean
  /** Format spec (e.g. "%.2f" or "%.2f H7"; free-form string). */
  readonly formatSpec?: string
  /** Display label (UI only; not part of identity). */
  readonly label?: string
}

// ── 几何公差（GD&T）──

/** GD&T characteristic type (ISO 1101 / ASME Y14.5). */
export type PmiGdtType =
  | 'straightness'     // 直线度
  | 'flatness'         // 平面度
  | 'circularity'      // 圆度
  | 'cylindricity'     // 圆柱度
  | 'parallelism'      // 平行度
  | 'perpendicularity' // 垂直度
  | 'angularity'       // 倾斜度
  | 'position'         // 位置度
  | 'concentricity'    // 同轴度
  | 'symmetry'         // 对称度
  | 'circularRunout'   // 圆跳动
  | 'totalRunout'      // 全跳动
  | 'profileLine'      // 线轮廓度
  | 'profileSurface'   // 面轮廓度

/** Material condition modifier. */
export type PmiMaterialCondition = 'MMC' | 'LMC' | 'RFS' | null

/** Projected tolerance zone. */
export interface PmiProjectedToleranceZone {
  readonly length: number
  readonly direction: Vec3
}

/**
 * Geometric Dimensioning & Tolerancing feature control frame.
 *
 * Structured representation (unlike FreeCAD which encodes GD&T symbols as
 * Unicode characters in a format string). The `datums` field references
 * `PmiDatum.identifier` values (A/B/C).
 */
export interface PmiGdt {
  readonly kind: 'gdt'
  /** GD&T characteristic type. */
  readonly gdtType: PmiGdtType
  /** TopoRef of the tolerated feature. */
  readonly target: TopoRef
  /** Tolerance value (mm or degrees). */
  readonly tolerance: number
  /** Tolerance zone shape. */
  readonly toleranceZone?: 'diameter' | 'width' | 'radial'
  /** Material condition modifier. */
  readonly materialCondition?: PmiMaterialCondition
  /** Datum references (A/B/C; point to PmiDatum.identifier). */
  readonly datums?: readonly string[]
  /** Projected tolerance zone. */
  readonly projectedToleranceZone?: PmiProjectedToleranceZone
  /**
   * Composite tolerance segments (ISO 1101 / ASME Y14.5 composite feature control frame).
   *
   * A composite tolerance has multiple rows (segments) sharing the same GD&T type
   * but with different tolerance values and datum references:
   * - Row 1 (PLTZF): Pattern-Locating Tolerance Zone Framework — larger tolerance,
   *   constrains pattern location/orientation relative to datums.
   * - Row 2+ (FRTZF): Feature-Relating Tolerance Zone Framework — smaller tolerance,
   *   constrains feature-to-feature relationships within the pattern.
   *
   * When `compositeSegments` is present, `tolerance` and `datums` are the first row
   * (PLTZF); `compositeSegments` contains the additional rows (FRTZF).
   */
  readonly compositeSegments?: readonly PmiCompositeSegment[]
  /** Display label. */
  readonly label?: string
}

/**
 * A single segment in a composite tolerance feature control frame.
 *
 * Each segment has its own tolerance value and optional datum references.
 * The first segment (PLTZF) is the primary; subsequent segments (FRTZF)
 * refine the tolerance with smaller zones and fewer datums.
 */
export interface PmiCompositeSegment {
  /** Tolerance value for this segment (mm or degrees). */
  readonly tolerance: number
  /** Material condition modifier for this segment. */
  readonly materialCondition?: PmiMaterialCondition
  /** Datum references for this segment (may differ from primary segment). */
  readonly datums?: readonly string[]
}

// ── 基准 ──

/** Datum type. */
export type PmiDatumType = 'datumPlane' | 'datumAxis' | 'datumPoint' | 'datumTarget'

/** Datum target parameters (for datum target points/areas on a face). */
export interface PmiDatumTargetParams {
  readonly u?: number
  readonly v?: number
  readonly radius?: number
  readonly width?: number
  readonly height?: number
}

/**
 * Datum annotation (A/B/C reference frame).
 *
 * The `identifier` is the user-assigned letter (A/B/C); `target` is the
 * TopoRef of the datum feature (face/edge/vertex).
 */
export interface PmiDatum {
  readonly kind: 'datum'
  /** Datum identifier (A/B/C, user-assigned). */
  readonly identifier: string
  /** Datum type. */
  readonly datumType: PmiDatumType
  /** TopoRef of the datum feature. */
  readonly target: TopoRef
  /** Datum target parameters (for datum targets on a face). */
  readonly datumTargetParams?: PmiDatumTargetParams
}

// ── 表面粗糙度 ──

/** Surface roughness parameter type. */
export type PmiSurfaceParameter = 'Ra' | 'Rz' | 'Rt' | 'Rq' | 'Rmax'

/** Surface texture direction. */
export type PmiTextureDirection =
  | 'parallel'
  | 'perpendicular'
  | 'cross'
  | 'multidirectional'
  | 'circular'
  | 'radial'
  | 'particulate'

/**
 * Surface finish annotation.
 *
 * The `target` is always a `FaceTopoRef` (surface finish applies to faces).
 */
export interface PmiSurfaceFinish {
  readonly kind: 'surfaceFinish'
  /** Target face reference. */
  readonly target: FaceTopoRef
  /** Roughness parameter type. */
  readonly parameter: PmiSurfaceParameter
  /** Roughness value (µm). */
  readonly value: number
  /** Manufacturing method. */
  readonly method?: string
  /** Surface texture direction. */
  readonly textureDirection?: PmiTextureDirection
}

// ── 注释 ──

/**
 * Text note annotation.
 *
 * Can be attached to a TopoRef (floating note if `target` omitted).
 * `anchor` is a world-coordinate position for UI rendering.
 */
export interface PmiNote {
  readonly kind: 'note'
  /** Note text. */
  readonly text: string
  /** Attached TopoRef (optional: floating note has no target). */
  readonly target?: TopoRef
  /** Anchor point in world coordinates [x, y, z]. */
  readonly anchor?: Vec3
  /** Leader line direction (UI rendering hint). */
  readonly leaderDirection?: Vec3
}

// ── PMI 统一类型 ──

/** Union of all PMI annotation kinds. */
export type PmiItem = PmiDimension | PmiGdt | PmiDatum | PmiSurfaceFinish | PmiNote

/** Discriminator kind for PmiItem ('dimension' | 'gdt' | 'datum' | 'surfaceFinish' | 'note'). */
export type PmiItemKind = PmiItem['kind']

// ── PMI 集合 ──

/** Metadata for a PmiSet. */
export interface PmiSetMeta {
  readonly source?: 'faijs' | 'step-ap242' | 'manual'
  readonly standard?: 'ISO' | 'ASME' | 'GB'
  readonly created?: string
}

/**
 * A complete set of PMI annotations on a part.
 *
 * JSON-serializable; can be written into `.fai.js` scripts, 3MF metadata,
 * or STEP AP242 PMI entities.
 */
export interface PmiSet {
  /** Annotation list. */
  readonly items: readonly PmiItem[]
  /** Metadata (version, source, etc.). */
  readonly meta?: PmiSetMeta
}

// ── 工厂函数（Omit<..., 'kind'> -> PmiItem，供 methods.ts 使用）──

/**
 * Create a dimension PMI item with `kind: 'dimension'` filled in.
 * @param dim - the dimension annotation fields (without `kind`).
 * @returns a `PmiDimension` with `kind: 'dimension'`.
 */
export function dimension(dim: Omit<PmiDimension, 'kind'>): PmiDimension {
  return { kind: 'dimension', ...dim }
}

/**
 * Create a GD&T PMI item with `kind: 'gdt'` filled in.
 * @param g - the GD&T annotation fields (without `kind`).
 * @returns a `PmiGdt` with `kind: 'gdt'`.
 */
export function gdt(g: Omit<PmiGdt, 'kind'>): PmiGdt {
  return { kind: 'gdt', ...g }
}

/**
 * Create a datum PMI item with `kind: 'datum'` filled in.
 * @param d - the datum annotation fields (without `kind`).
 * @returns a `PmiDatum` with `kind: 'datum'`.
 */
export function datum(d: Omit<PmiDatum, 'kind'>): PmiDatum {
  return { kind: 'datum', ...d }
}

/**
 * Create a surface finish PMI item with `kind: 'surfaceFinish'` filled in.
 * @param sf - the surface finish annotation fields (without `kind`).
 * @returns a `PmiSurfaceFinish` with `kind: 'surfaceFinish'`.
 */
export function surfaceFinish(sf: Omit<PmiSurfaceFinish, 'kind'>): PmiSurfaceFinish {
  return { kind: 'surfaceFinish', ...sf }
}

/**
 * Create a note PMI item with `kind: 'note'` filled in.
 * @param n - the note annotation fields (without `kind`).
 * @returns a `PmiNote` with `kind: 'note'`.
 */
export function note(n: Omit<PmiNote, 'kind'>): PmiNote {
  return { kind: 'note', ...n }
}

// ── ExecutionResult 中的 PMI 行 ──

/**
 * Per-part PMI entry in ExecutionResult.pmi.
 *
 * `part` is the PartName; `items` is the list of PMI annotations on that part.
 */
export interface PmiEntry {
  readonly part: string
  readonly items: readonly PmiItem[]
}
