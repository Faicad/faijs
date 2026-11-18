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

// ── 局部注释（贴在应用处）──

/**
 * A **local note** — a note placed at the specific area or point of application
 * (ASME Y14.100 §4.26(b) "local notes"). Its requirement applies only to the
 * area or point indicated.
 *
 * Placement is what makes a note local: at least one of `target` / `anchor`
 * must be given. A requirement that applies to the whole drawing or part is a
 * `PmiGeneralNote` instead.
 */
export interface PmiLocalNote {
  readonly kind: 'localNote'
  /** Note text, verbatim from the drawing. */
  readonly text: string
  /** Attached TopoRef — the requirement applies to that topology only. */
  readonly target?: TopoRef
  /** Anchor point in world coordinates [x, y, z] — the requirement applies there. */
  readonly anchor?: Vec3
  /** Leader line direction (UI rendering hint). */
  readonly leaderDirection?: Vec3
}

// ── 通用注释（整张图 / 整个零件适用）──

/**
 * A single line inside a general-note block: one numbered clause, or one
 * unnumbered note.
 *
 * `index` is the clause number as printed on the drawing (1, 2, 3 …) and is
 * **optional** — a single general note that carries no printed number is
 * rendered without one; a number the drawing does not have is never invented.
 * `subItems` holds nested clauses such as "a) … / b) …".
 */
export interface PmiGeneralNoteLine {
  /** Clause number on the drawing (1 起), omitted when the drawing prints none. */
  readonly index?: number
  /** Clause text, verbatim from the drawing. */
  readonly text: string
  /** Nested sub-clauses, if any. */
  readonly subItems?: readonly string[]
}

/**
 * A **general note** — text that applies to the entire drawing or the whole
 * part (ASME Y14.100 §4.26(a) "general notes"). Two shapes share this type:
 *
 * - a numbered technical-requirement block ("技术要求") → `items` holds numbered clauses;
 * - a single unnumbered requirement ("锐边倒钝") → `items` holds one line without `index`.
 *
 * It deliberately has **no** `target` / `anchor`: it belongs in the drawing's
 * general-note area and is rendered once rather than once per view.
 *
 * Design: docs/plans/2026-10-31-faijs-pmi-thread-and-technotes-design.md §7
 */
export interface PmiGeneralNote {
  readonly kind: 'generalNote'
  /** Requirement lines, in drawing order. */
  readonly items: readonly PmiGeneralNoteLine[]
  /** Requirement family (optional classification, not part of identity). */
  readonly category?: 'general' | 'machining' | 'heatTreatment' | 'surface' | 'inspection'
  /** Block title, e.g. "技术要求". */
  readonly title?: string
}

// ── 螺纹孔（攻丝孔）──

/**
 * 螺纹（攻丝/螺纹）规格——螺纹孔标注的「后加工」一半。
 *
 * 螺纹本身不进入 `tapped` 孔的实体几何（几何只有底孔）；此分组描述
 * 攻丝/攻螺纹要形成的牙型与有效深度。
 */
export interface PmiThreadSpec {
  /** 螺纹标准：metric（公制 M）/ imperial（英制 UN）/ pipe（管螺纹 G/R）。 */
  readonly standard: 'metric' | 'imperial' | 'pipe'
  /** 公称直径（mm）。M6 → 6。 */
  readonly nominalDiameter: number
  /** 螺距（mm）。缺省由 standard + nominalDiameter 查表（见 `primitives/screw/screw-db`）。 */
  readonly pitch?: number
  /** 公差等级。内螺纹 metric：'6H'；imperial：'2B' / '3B'。 */
  readonly toleranceClass?: string
  /** 有效螺纹深度（mm）——攻丝形成的螺纹长度，不含孔底的无螺纹光底。 */
  readonly depth: number
  /** 旋向，缺省右旋。 */
  readonly handedness?: 'right' | 'left'
  /** 规格标签（显示用，不参与身份判定）。'M6' / 'M8×1' / '1/4"-20' / 'G1/2'。 */
  readonly specLabel?: string
}

/**
 * 底孔（原始几何）参数——螺纹孔标注的「几何」一半。
 *
 * 与 `PmiThreadSpec` 同属**一条**标注：显示时必须一起出现（用户契约：
 * "它们是整体，并不是只有后加工的才属于 PMI"）。
 */
export interface PmiPilotHole {
  /** 底孔直径（mm）。M6 粗牙 → 5。 */
  readonly diameter: number
  /** 底孔总深度（mm），≥ `thread.depth`；差值即孔底光底。 */
  readonly depth: number
  /** 钻尖锥角（度，标准麻花钻 118°）。**标注用**——当前几何为平底，不做锥尖。 */
  readonly drillPointAngle?: number
}

/**
 * 孔的几何定位器（两链通用）。
 *
 * 坐标契约与 `fai_drill` 的 `position` 相同：**模型局部空间**。用轴定位而不用
 * `FaceTopoRef`，因为 mesh 链没有拓扑身份、`cad.faceRef` 又明确禁用于脚本生成
 * （序号跨内核漂移）。op 产出时参数即定位，改参重放可原样重算。
 */
export interface PmiHoleAxis {
  /** 孔口点（模型局部坐标）。 */
  readonly origin: Vec3
  /** 轴向（指向材料内部的单位向量）。 */
  readonly direction: Vec3
}

/**
 * 螺纹孔标注（攻丝孔的完整制造信息）。
 *
 * **一个条目承载两类信息**：
 * - `pilot`：原始几何（底孔 Φ5 ↓16）——实体几何只信任这一半；
 * - `thread`：后加工攻丝（M6-6H ↓14）——不是几何，是标注。
 *
 * 两类信息**同属 PMI**，显示时一并呈现（`formatThreadHole`）。这与
 * `holeType:'screw'` 的「建模螺纹」不冲突：后者把牙做进几何，`process`
 * 记为 `'modeled'`，标注仍产出，下游消费不必按 holeType 分叉。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-thread-and-technotes-design.md §3
 */
export interface PmiThreadHole {
  readonly kind: 'threadHole'
  /** 后加工：螺纹规格（M6-6H ↓14）。 */
  readonly thread: PmiThreadSpec
  /** 原始几何：底孔（Φ5 ↓16）。 */
  readonly pilot: PmiPilotHole
  /** 几何定位（两链通用的主定位；mesh 链唯一可用定位）。 */
  readonly axis: PmiHoleAxis
  /**
   * 螺纹来源：
   * - `'tapped'`：几何只有底孔，螺纹由攻丝形成（几何**不含**牙）
   * - `'modeled'`：几何已含实体螺旋牙（对应 `holeType:'screw'`）
   */
  readonly process: 'tapped' | 'modeled'
  /** 孔数量（如 4× 表示 4 个相同孔）。缺省 1。 */
  readonly count?: number
  /** BREP 链可选的面引用（op 内部产出的 `hole:N`）；mesh 链缺省。 */
  readonly target?: FaceTopoRef
  /** 显示文本缓存（缺省由 `formatThreadHole` 生成，不参与身份判定）。 */
  readonly label?: string
}

// ── PMI 统一类型 ──

/** Union of all PMI annotation kinds. */
export type PmiItem =
  | PmiDimension
  | PmiGdt
  | PmiDatum
  | PmiSurfaceFinish
  | PmiLocalNote
  | PmiGeneralNote
  | PmiThreadHole

/** Discriminator kind for PmiItem ('dimension' | 'gdt' | 'datum' | 'surfaceFinish' | 'localNote' | 'generalNote' | 'threadHole'). */
export type PmiItemKind = PmiItem['kind']

// ── PMI 集合 ──

/** Metadata for a PmiSet. */
export interface PmiSetMeta {
  /** `'drawing'` marks a PmiSet compiled from an engineering drawing (the drawing pipeline). */
  readonly source?: 'faijs' | 'drawing' | 'step-ap242' | 'manual'
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
 * Create a local note PMI item with `kind: 'localNote'` filled in.
 *
 * A local note must be placed at the area or point it applies to: pass a
 * `target` (topology) or an `anchor` (world coordinate). A requirement with no
 * placement belongs to the whole drawing — use `generalNote` for that.
 *
 * @param n - the local-note fields (without `kind`).
 * @returns a `PmiLocalNote` with `kind: 'localNote'`.
 * @throws Error when neither `target` nor `anchor` is given.
 */
export function localNote(n: Omit<PmiLocalNote, 'kind'>): PmiLocalNote {
  if (n.target === undefined && n.anchor === undefined) {
    throw new Error(
      '[localNote] a local note needs a target or an anchor; use generalNote for requirements that apply to the whole part',
    )
  }
  return { kind: 'localNote', ...n }
}

/**
 * Create a thread-hole PMI item with `kind: 'threadHole'` filled in.
 *
 * 一个条目 = 底孔（几何）+ 螺纹（后加工）两组信息，缺一不可。
 *
 * @param th - the thread-hole annotation fields (without `kind`).
 * @returns a `PmiThreadHole` with `kind: 'threadHole'`.
 */
export function threadHole(th: Omit<PmiThreadHole, 'kind'>): PmiThreadHole {
  return { kind: 'threadHole', ...th }
}

/**
 * Create a general note with `kind: 'generalNote'` filled in.
 *
 * One `items` entry = one unnumbered general note; several entries = a numbered
 * technical-requirement block. Give `index` only for numbers the drawing prints.
 *
 * @param n - the general-note fields (without `kind`).
 * @returns a `PmiGeneralNote` with `kind: 'generalNote'`.
 */
export function generalNote(n: Omit<PmiGeneralNote, 'kind'>): PmiGeneralNote {
  return { kind: 'generalNote', ...n }
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
