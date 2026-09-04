/**
 * faijs 文本层类型定义 — 语句形式（L0 零依赖）
 *
 * 设计文档：docs/syntax-design.md §3.1
 *
 * 代码文本是唯一事实源；IR（本文件类型）只是 parser 从文本编译出的内部表示，
 * 属内部细节，可随时变更。codegen 的打印只是宿主编辑器/测试的便利工具，
 * 不构成"文本由 IR 生成"的关系。
 *
 * L0 边界：此文件仅依赖 TypeScript 内置类型 + identity（零依赖品牌模块）。
 */

import { asPartName, type PartName, type StmtId } from '../identity'

// ── 值与引用 ──

/** A 3-component vector. */
export type Vec3 = [number, number, number]

/** A JSON-serializable value, used for parameter literals and wire-shaped args. */
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

/** 嵌套调用：args 内的 cad.<callee>(...) 或 <ns>.<callee>(...)。编译为 ns.<callee>(...)。 */
export interface CallRefIR {
  $call: {
    callee: string
    args: ArgIR[]
    /** 调用所在命名空间（F2：`mech.helper(...)` 嵌套调用的 namespace='mech'；缺省 = 'cad'） */
    namespace?: string
  }
}

/**
 * 运行时表达式（ExprIR，控制流放松方案 §4.3）：折叠失败且节点 ∈ 白名单文法
 * （Literal/Identifier/Unary/Binary/Logical/Conditional/Array/Object 递归）时，
 * 表达式原文 + 引用名集合作为值进入 args；编译期用箭头包装发射（§5.4），
 * 由 JS 引擎求值，不做编译期折叠。不存 AST、不重写文本（R13 保持）。
 *
 * 值语义：求值结果**不限制为 JSON 值**（白名单内 Identifier 可引用 Shape 变量，
 * 求值可得到 Shape）——args 槽收到 Shape 值原样传给 op，op 自行校验参数。
 */
export interface ExprIR {
  $expr: {
    /** 表达式原文（acorn 坐标切片；语法门禁已过） */
    text: string
    /** 引用的顶层变量名（VarRef 语义 → deps / terminal 消费判定） */
    refs: string[]
    /** 引用的参数名（ParamRef 语义 → deps；参数本身是 ctx 键） */
    params: string[]
  }
}

/**
 * An argument value in the IR: a literal, or one of the reference/call/expr shapes.
 */
export type ArgIR = JsonValue | ParamRefIR | VarRefIR | CallRefIR | ExprIR

// ── 类型守卫（L0 零依赖） ──

/**
 * 检测 ArgIR 是否为 ParamRefIR
 * @param arg - the argument value to test.
 * @returns true when the value is a ParamRefIR, narrowing the type.
 */
export function isParamRef(arg: ArgIR): arg is ParamRefIR {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$param' in arg
}

/**
 * 检测 ArgIR 是否为 VarRefIR
 * @param arg - the argument value to test.
 * @returns true when the value is a VarRefIR, narrowing the type.
 */
export function isVarRef(arg: ArgIR): arg is VarRefIR {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$ref' in arg
}

/**
 * 检测 ArgIR 是否为 CallRefIR
 * @param arg - the argument value to test.
 * @returns true when the value is a CallRefIR, narrowing the type.
 */
export function isCallRef(arg: ArgIR): arg is CallRefIR {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$call' in arg
}

/**
 * 检测 ArgIR 是否为 ExprIR（运行时表达式）
 * @param arg - the argument value to test.
 * @returns true when the value is an ExprIR, narrowing the type.
 */
export function isExprRef(arg: ArgIR): arg is ExprIR {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$expr' in arg
}

// ── 语句 ──

/**
 * The statement-form IR: a single faijs statement, mechanically derived from
 * its source text and mechanically printed back.
 */
export interface StatementIR {
  /** 语句 id（StmtId）——顺序稳定的语句身份（格式 s1..sN，参数语句占前段）。
   *  每条语句都有，无赋值语句（add_constraint/do_assemble）也有。
   *  fai 语句名空间；与 3d_editor 的 ScopedId（fileId:innerId）是两套命名空间。
   *  Phase 3：id = 顺序 sN（不再是变量名）；变量名只存 outputs。 */
  id: StmtId
  /** 调用所在命名空间（P7 第三方库通道：`import * as mech from 'gear-lib-demo'` 后 `mech.makeHeadstock(...)` 的 namespace='mech'；缺省 = 'cad'）。 */
  namespace?: string
  /** 本机函数调用：callee 是脚本内函数名（区别于命名空间调用）。缺省 = 命名空间调用。
   *  local: true 时 namespace 缺省，callee 即函数名；调用约定见 §3.6 ABI（位置实参 → 前 M 形参 + 尾随选项对象按名补剩余）。 */
  local?: boolean
  callee: string
  /**
   * 位置实参槽（true-JS-subset 方案 §4.1，取代原 inputs: PartName[]）：每个位置实参
   * 是一个 ArgIR——Identifier → VarRefIR、字面量 → JsonValue、对象 → JsonValue 对象
   * （属性值递归为 ArgIR）、<ns>.<fn>(...) → CallRefIR、其余白名单表达式 → ExprIR。
   * 任意顺序/数量混排；多对象实参按位置如实传递（不合并、不覆盖）。
   * 单一真源：原 inputs 语义由 statementInputs()（VarRefIR 投影）派生。
   */
  positional: ArgIR[]
  /**
   * 尾随选项对象槽（投影）：解析时最后一个纯对象位置实参同时投影到此
   * （keep/keepHidden 指令键仍在其中）；无对象尾随实参时为 {}。
   * 只读便利槽——真源是 positional；宿主面（statement-summary / codeToArgs）读此槽。
   */
  args: Record<string, ArgIR>
  name?: string
  /** 本语句引用的变量名集合（positional + args 中的 $param / $ref / 嵌套调用 / ExprIR refs + receiver）。
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

  /** 参数是否含计算表达式（binary/template/conditional/spread，F1 编译期折叠）。
   *  parser 折叠表达式为字面量时置 true；宿主据此将编辑面板降级为只读/代码编辑
   *  （防止把折叠值写回、丢失原表达式）。折叠后重解析为纯字面量时为 undefined/false。 */
  hasComputedArgs?: boolean

}

// ── 参数表 ──

/**
 * A parameter declaration (`const name = <literal>`), with its value and
 * optional schema metadata.
 */
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

/**
 * Scene-level model metadata (name and appearance) carried by a script.
 */
export interface ScriptMetaIR {
  name?: string
  appearance?: { color?: string; metalness?: number; roughness?: number }
}

/** 终端变量类型（keep-syntax 设计 §6：运行时登记，缺省 'shape'）。 */
export type VarKind = 'shape' | 'compound' | 'value'

/** 终端 shape：return 数组/DAG 叶子判定列出的最终输出（设计文档 §2.2 / §4.1） */
export interface TerminalShape {
  /** 终端左值变量名（PartName，如 'part0'）——终端按变量名（outputs）标识，非语句 id */
  id: PartName
  /** 该终端 mesh 的独立 meta（name/appearance） */
  meta?: ScriptMetaIR
  /** 变量类型（'shape' | 'compound' | 'value'），运行时登记，缺省 'shape' */
  kind?: VarKind
  /** 保留但 canvas 不渲染（keep-syntax 设计 §6），缺省 undefined → 可见 */
  hidden?: boolean
}

// ── 顶层 import（F2 / roadmap V1.1） ──

/**
 * 顶层 import 声明（`import * as mech from 'gear-lib-demo'` 等）。
 * 模块声明非控制流 → 合法子集成员；codegen 打印回文件头（往返保真）。
 */
export interface ImportIR {
  /** 原始说明符，如 'gear-lib-demo' / '@scope/pkg/sub' */
  specifier: string
  /** import 形态 */
  kind: 'namespace' | 'named' | 'default'
  /** 本地绑定名（namespace → `import * as X` 的 X；default → `import X from` 的 X；named → 首个绑定） */
  localName: string
  /** named 形态的全部绑定名（`import { a, b } from '...'` → ['a','b']；其余形态 = [localName]） */
  bindings?: string[]
  /** 由 specifier 推导的包名（@scope/pkg/sub → @scope/pkg；gear-lib-demo → gear-lib-demo）。statementKey 包名前缀 / 宿主 getFeatureByOp 用。 */
  packageName: string
}

// ── 顶层函数定义（A1 / roadmap V1.3） ──

/**
 * 顶层函数定义（`function foo(params) { ... }`，A1 语言层收尾）。
 * 模块声明非控制流 → 合法子集成员；codegen 打印回文件（往返保真）。
 *
 * 语义：函数定义**不是几何语句**——不进 `statements`、不参与 DAG 终端判定
 * （函数定义不污染终端集），执行时由编译产物原样保留供宿主调用。
 */
export interface FunctionDefIR {
  /** 函数名（feature = `包名.函数名` 的 callee 侧） */
  name: string
  /** 形参名列表 */
  params: string[]
  /** 函数体原文（acorn 定位的 body 区间切片，含花括号内的完整文本） */
  body: string
  /** 函数体文本的稳定哈希（P4 内容寻址；statementKey 用，编辑函数体 → 下游失效重算） */
  bodyHash: string
  /** 函数体在原始代码文本中的 [start, end) 区间（parser 用 acorn 坐标换算；宿主命名/高亮用） */
  bodyRange?: { start: number; end: number }
}

/**
 * The whole-script IR: parameters, statements, and optional imports, function
 * definitions, meta, and terminal shapes.
 */
export interface ScriptIR {
  source?:
    | { kind: 'load' }
    | { kind: 'sdf' }
  params: ParamDef[]
  statements: StatementIR[]
  /** 顶层 import 段（F2；无 import 时为 undefined）。编译产物仍零 import（宿主 registerLib 注入）。 */
  imports?: ImportIR[]
  /** 顶层函数定义段（A1；无函数时为 undefined）。 */
  functions?: FunctionDefIR[]
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
 * Create a new statement IR with the given identity and content.
 * @param id - the statement's StmtId.
 * @param callee - the operation name being called.
 * @param args - the statement's trailing options-object slot (projection of the
 *               last plain-object positional element when present).
 * @param positional - the positional argument slot (ArgIR elements in call order).
 * @param outputs - the produced variable names.
 * @param name - an optional statement name.
 * @returns the constructed statement IR.
 */
export function createStatementIR(
  id: StmtId,
  callee: string,
  args: Record<string, ArgIR>,
  positional: ArgIR[],
  outputs: PartName[],
  name?: string,
): StatementIR {
  return { id, callee, args, positional, outputs, name }
}

/**
 * 位置实参槽中的纯变量引用投影（原 inputs 语义，true-JS-subset 方案 §4.1）：
 * 依次取 positional 中的 VarRefIR.$ref（PartName）。ExprIR/CallRefIR 内的引用
 * 不在此列——它们经 stmt.refs / terminal-dag 的递归扫描参与消费判定（D3）。
 * @param stmt - the statement to project.
 * @returns the VarRefIR $ref list in positional order.
 */
export function statementInputs(stmt: StatementIR): PartName[] {
  const out: PartName[] = []
  for (const arg of stmt.positional) {
    if (isVarRef(arg)) out.push(asPartName(arg.$ref))
  }
  return out
}

/**
 * 本机函数 ABI 槽位切分（§3.6 约定）：最后一个"纯对象"位置实参是命名选项槽
 * （按形参名补位），其余位置实参按序占前 M 个形参。非对象 IR 变体
 * （ParamRef/VarRef/CallRef/ExprIR）不算对象槽。
 * @param positional - the positional argument slot.
 * @returns the positional values and the trailing named-options object ({} when absent).
 */
export function splitPositionalOptions(
  positional: ArgIR[],
): { values: ArgIR[]; named: Record<string, ArgIR> } {
  const last = positional[positional.length - 1]
  if (
    positional.length > 0 &&
    last !== null &&
    typeof last === 'object' &&
    !Array.isArray(last) &&
    !isParamRef(last) &&
    !isVarRef(last) &&
    !isCallRef(last) &&
    !isExprRef(last)
  ) {
    return { values: positional.slice(0, -1), named: last as Record<string, ArgIR> }
  }
  return { values: positional, named: {} }
}

/**
 * Create an empty script IR with no parameters or statements.
 * @returns an empty ScriptIR.
 */
export function createScriptIR(): ScriptIR {
  return {
    params: [],
    statements: [],
  }
}
