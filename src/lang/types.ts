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
export interface ParamRefIR {
  $param: string
}

/** 变量引用：args 内出现的已声明变量（如 group/assembly 的 members 元素）。编译为 ctx.<name>。 */
export interface VarRefIR {
  $ref: string
}

/** 嵌套调用：args 内的 cad.<callee>(...)。编译为 cad.<callee>(…, exec)。 */
export interface CallRefIR {
  $call: {
    callee: string
    args: ArgIR[]
  }
}

export type ArgIR = JsonValue | ParamRefIR | VarRefIR | CallRefIR

// ── 类型守卫（L0 零依赖） ──

/**
 * 检测 ArgIR 是否为 ParamRefIR
 */
export function isParamRef(arg: ArgIR): arg is ParamRefIR {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$param' in arg
}

/**
 * 检测 ArgIR 是否为 VarRefIR
 */
export function isVarRef(arg: ArgIR): arg is VarRefIR {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$ref' in arg
}

/**
 * 检测 ArgIR 是否为 CallRefIR
 */
export function isCallRef(arg: ArgIR): arg is CallRefIR {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$call' in arg
}

// ── 语句 ──

export interface StatementIR {
  /** 语句 id（StmtId）——顺序稳定的语句身份（格式 s1..sN，参数语句占前段）。
   *  每条语句都有，无赋值语句（add_constraint/do_assemble）也有。
   *  fai 语句名空间；与 3d_editor 的 ScopedId（fileId:innerId）是两套命名空间。
   *  Phase 3：id = 顺序 sN（不再是变量名）；变量名只存 outputs。 */
  id: StmtId
  callee: string
  args: Record<string, ArgIR>
  inputs: PartName[]
  name?: string
  /** 本语句引用的变量名集合（inputs + args 中的 $param + $geom.of + group/assembly members）。
   *  parser 收集，编译期（compileToModule）据此翻译为 deps（定义这些变量的语句 id）。 */
  refs?: string[]
  /** 本语句产出的变量名列表（PartName）。
   *  单输出 op = [partName]；split = [front, back]；void op（add_constraint/do_assemble）= []。 */
  outputs: PartName[]
  /** 解构键：`const {front: a, back: b} = ...` → ['front','back']。与 outputs 一一对应。 */
  outputKeys?: string[]
  /** 全局序列号 — 用于 timeline 跨 part 线性排序。
   *  在 appendStatement / insertStatementAt 时由 script-store 自动赋值。
   *  undo/redo 后随 partScripts 快照恢复，保持时间线顺序一致。 */
  seq?: number
  /** 成员方法调用的接收者变量（`asm1.add_constraint(...)` / `asm1.do_assemble()`）。
   *  指向成员调用语句的接收者变量名（PartName）。 */
  receiver?: PartName

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

export interface ScriptMetaIR {
  name?: string
  appearance?: { color?: string; metalness?: number; roughness?: number }
}

/** 终端 shape：return 数组/DAG 叶子判定列出的最终输出（设计文档 §2.2 / §4.1） */
export interface TerminalShape {
  /** 终端左值变量名（PartName，如 'part0'）——终端按变量名（outputs）标识，非语句 id */
  id: PartName
  /** 该终端 mesh 的独立 meta（name/appearance） */
  meta?: ScriptMetaIR
}

export interface ScriptIR {
  source?:
    | { kind: 'load' }
    | { kind: 'sdf' }
  params: ParamDef[]
  statements: StatementIR[]
  /** 场景级模型属性（C-4/C-7）。
   *  缺省时由 SceneMutator 按 op 兜底派生（默认名 + nextPrimitiveColor()）。 */
  meta?: ScriptMetaIR
  /** 多 mesh 终端集合（设计文档 §2.2：return [ { shape, meta }, ... ]）。
   *  单 mesh 简写时为 undefined（用 meta 代替）；
   *  多 mesh 时每个终端 mesh 有独立 meta。 */
  terminalShapes?: TerminalShape[]
}

// ── 语句工厂 ──

/**
 * 创建一条新语句。
 */
export function createStatementIR(
  id: StmtId,
  callee: string,
  args: Record<string, ArgIR>,
  inputs: PartName[],
  outputs: PartName[],
  name?: string,
): StatementIR {
  return { id, callee, args, inputs, outputs, name }
}

/**
 * 创建一个空 ScriptIR。
 */
export function createScriptIR(): ScriptIR {
  return {
    params: [],
    statements: [],
  }
}
