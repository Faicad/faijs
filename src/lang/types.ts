/**
 * faijs 文本层类型定义 — 语句形式（L0 零依赖）
 *
 * 设计文档：docs/syntax-design.md §3.1
 *
 * 语句形式是唯一事实源，文本由语句序列确定性生成（pretty-print）。
 *
 * L0 边界：此文件仅依赖 TypeScript 内置类型，不 import 任何外部模块。
 */

// ── 值与引用 ──

export type Vec3 = [number, number, number]

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue }

/** 参数引用：语句参数中出现它时，执行前先从参数表求值 */
export interface ParamRef {
  $param: string
}

/** 资产引用：SVG/XML 等大段文本不进 faijs 文本，由 AssetResolver 按 key 解析 */
export interface AssetRef {
  $asset: string
}

/** 语义引用：对上游几何的派生位置（面心/包围盒中心等），重算时自动跟随 */
export interface GeomRef {
  $geom: {
    of: ShapeRef
    feature: 'bboxCenter' | 'faceCenter' | 'faceNormal' | 'bboxMin' | 'bboxMax'
    /** 面在上游形状 getSubShapes(shape,'face') 中的枚举序号（拓扑引用）。
     *  确定性重放下稳定（分析文档 §5.2）；优先于 anchor 用于面定位。
     *  undefined 时降级到 anchor 几何反查（兼容旧文本）。 */
    faceOrdinal?: number
    anchor?: { point: Vec3; normal?: Vec3 }
  }
}

export type Arg = JsonValue | ParamRef | GeomRef | AssetRef
export type ShapeRef = string

// ── 类型守卫（从 ops/geom-ref.ts 上提，斩断 codegen → occt 传递依赖） ──

/**
 * 检测 Arg 是否为 AssetRef
 */
export function isAssetRef(arg: Arg): arg is AssetRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$asset' in arg
}

/**
 * 检测 Arg 是否为 GeomRef
 */
export function isGeomRef(arg: Arg): arg is GeomRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$geom' in arg
}

/**
 * 检测 Arg 是否为 ParamRef
 */
export function isParamRef(arg: Arg): arg is ParamRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$param' in arg
}

// ── 特征元数据 ──

export type FeatureKind =
  | 'load'
  | 'primitive'
  | 'transform'
  | 'drill'
  | 'screwHole'
  | 'split'
  | 'extrude'
  | 'boolean'
  | 'engrave'
  | 'knurl'
  | 'sdf'
  | 'group'
  | 'assembly'

export interface FeatureMeta {
  kind: FeatureKind
  label: string
  createdBy: 'user' | 'ai' | 'script'
  alternateParams?: Partial<Record<FeatureKind, Record<string, Arg>>>
}

// ── 语句 ──

export interface CadStatement {
  id: string
  op: string
  args: Record<string, Arg>
  inputs: ShapeRef[]
  name?: string
  feature: FeatureMeta
  /** 标记型语句不参与 replayPart 的执行序列，仅用于 Timeline 展示。
   *  例如 split 在源 part 上记录的语句——执行它会把源几何替换成后半块（A-7 bug）。
   *  codegen 输出时也跳过标记语句（不写进 .faijs 文本）。 */
  isMarker?: boolean
  /** 所属模型号（设计文档 §3：id 前缀 partN，如 'part0'/'part1'）。
   *  多 mesh DAG 中，split/独立图元/布尔派生各拿独立模型号。 */
  model?: string
  /** 多输出 op 的输出 id 列表（设计文档 §3）。
   *  默认 [id]（普通 op）；split 多输出写入 ['part1_v0','part2_v0']。
   *  outputCache 按 output id 索引，下游用具体 output id 引用。 */
  outputs?: string[]
  /** 全局序列号 — 用于 timeline 跨 part 线性排序。
   *  在 appendStatement / insertStatementAt 时由 script-store 自动赋值。
   *  undo/redo 后随 partScripts 快照恢复，保持时间线顺序一致。 */
  seq?: number
  /** 组/装配 marker 专属：记录该 marker 对应的组/装配 scopedId。
   *  用于 sceneScript 单一 DAG 中关联 marker 与 model-store.groups。
   *  非 marker 语句不需要此字段。 */
  groupScopedId?: string
}

// ── 参数表 ──

export interface ParamDef {
  name: string
  type: 'number' | 'vec3' | 'bool' | 'enum'
  value: JsonValue
  default: JsonValue
  min?: number
  max?: number
  options?: string[]
  label?: string
}

// ── Part 脚本 ──

export interface PartScriptMeta {
  name?: string
  appearance?: { color?: string; metalness?: number; roughness?: number }
}

/** 终端 mesh：return 数组中列出的最终输出（设计文档 §2.2） */
export interface TerminalShape {
  /** 指向语句 id（如 'part1_v1'） */
  id: string
  /** 该终端 mesh 的独立 meta（name/appearance） */
  meta?: PartScriptMeta
}

export interface PartScript {
  source?:
    | { kind: 'load' }
    | { kind: 'sdf' }
  params: ParamDef[]
  statements: CadStatement[]
  /** 场景级模型属性（C-4/C-7）。
   *  缺省时由 SceneMutator 按 op 兜底派生（默认名 + nextPrimitiveColor()）。 */
  meta?: PartScriptMeta
  /** 多 mesh 终端集合（设计文档 §2.2：return [ { shape, meta }, ... ]）。
   *  单 mesh 简写时为 undefined（用 meta 代替）；
   *  多 mesh 时每个终端 mesh 有独立 meta。 */
  terminalShapes?: TerminalShape[]
}

// ── 语句工厂 ──

let _statementCounter = 0

/**
 * 生成稳定的语句 id。
 * 格式：st_<partId>_<n>，其中 n 是全局递增计数器。
 * 编辑参数/变更类型时 id 不变（S-2）。
 *
 * @deprecated 新代码请使用 `allocateStatementId`（partN_vM 格式）。
 *             此函数仅保留用于旧场景兼容。
 */
export function createStatementId(partId: string): string {
  return `st_${partId}_${++_statementCounter}`
}

/**
 * 创建一条新语句。
 */
export function createStatement(
  id: string,
  op: string,
  args: Record<string, Arg>,
  inputs: ShapeRef[],
  feature: FeatureMeta,
  name?: string,
): CadStatement {
  return { id, op, args, inputs, feature, name }
}

/**
 * 创建一个空 PartScript。
 */
export function createPartScript(): PartScript {
  return {
    params: [],
    statements: [],
  }
}
