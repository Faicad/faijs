/**
 * faijs 文本层类型定义 — 语句形式（L0 零依赖）
 *
 * 设计文档：docs/syntax-design.md §3.1
 *
 * 语句形式是唯一事实源，文本由语句序列确定性生成（pretty-print）。
 *
 * L0 边界：此文件仅依赖 TypeScript 内置类型 + identity（零依赖品牌模块）。
 */

import type { StmtId, PartName } from '../identity'

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
    /** 上游左值变量名（PartName，fai 语句名空间；7 带 brand） */
    of: PartName
    feature: 'bboxCenter' | 'faceCenter' | 'faceNormal' | 'bboxMin' | 'bboxMax'
    /** 面在上游形状 getSubShapes(shape,'face') 中的枚举序号（拓扑引用）。
     *  确定性重放下稳定（分析文档 §5.2）；优先于 anchor 用于面定位。
     *  undefined 时降级到 anchor 几何反查（兼容旧文本）。 */
    faceOrdinal?: number
    anchor?: { point: Vec3; normal?: Vec3 }
  }
}

export type Arg = JsonValue | ParamRef | GeomRef | AssetRef
/** 语句输入引用的左值变量名（PartName） */
export type ShapeRef = PartName

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

// ── 语句 ──

/** 语句返回值类型（四类）。
 *  - new_shape：返回新几何，必须赋值
 *  - same_shape：返回自身/上下文，可赋值可不赋值（用于链式调用）
 *  - scalar：返回非 shape 值，必须赋值
 *  - void：无返回值，不准赋值 */
export type ReturnType = 'new_shape' | 'same_shape' | 'scalar' | 'void'

export interface CadStatement {
  /** 语句 id（StmtId）——每条语句都有，无赋值语句（add_constraint/do_assemble）也有。
   *  fai 语句名空间；与 3d_editor 的 ScopedId（fileId:innerId）是两套命名空间。
   *  Phase 1 兼容期：id = 变量名（partN_vM）；独立 StmtId 见 `stmtId` 字段。 */
  id: StmtId
  op: string
  args: Record<string, Arg>
  inputs: ShapeRef[]
  name?: string
  /** 独立 StmtId（VM 执行方案 Phase 1 起分配，格式 s1..sN，参数语句占前段）。
   *  与 id=变量名 的兼容填充并存；Phase 3 把 StmtId 写回 CadStatement.id 后本字段退役。 */
  stmtId?: StmtId
  /** 本语句引用的变量名集合（inputs + args 中的 $param + $geom.of + group/assembly members）。
   *  parser 收集，编译期（compileToModule）据此翻译为 deps（定义这些变量的语句 id）。 */
  refs?: string[]
  /** 多输出 op 的输出 id 列表（设计文档 §3）。
   *  默认 [id]（普通 op）；split 多输出写入 ['part1_v0','part2_v0']。
   *  outputCache 按 output id 索引，下游用具体 output id 引用。 */
  outputs?: PartName[]
  /** 全局序列号 — 用于 timeline 跨 part 线性排序。
   *  在 appendStatement / insertStatementAt 时由 script-store 自动赋值。
   *  undo/redo 后随 partScripts 快照恢复，保持时间线顺序一致。 */
  seq?: number
  /** 装配链式调用专属：标记 `assem1.add_constraint(...)` / `assem1.do_assemble()` 的目标变量。
   *  指向 assembly 语句的变量名（= 语句 id，PartName）。 */
  assemblyTarget?: PartName

  /** 该语句是否有赋值（`const x = ...` 或 `let x = ...`）。
   *  parser 根据 AST 节点类型设置：VariableDeclaration → true，ExpressionStatement → false。
   *  用于 terminal shape 计算：有赋值的语句参与终端计算。 */
  hasAssignment?: boolean

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
  id: StmtId
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

/**
 * 创建一条新语句。
 */
export function createStatement(
  id: StmtId,
  op: string,
  args: Record<string, Arg>,
  inputs: ShapeRef[],
  name?: string,
): CadStatement {
  return { id, op, args, inputs, name }
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
