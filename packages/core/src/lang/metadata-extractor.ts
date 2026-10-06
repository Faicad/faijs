/**
 * metadata-extractor — 无 IR 元数据提取器（UI 通道语义源）
 *
 * 方案：docs/plans/2026-09-06-no-ir-dual-channel-runtime.md §4.1（D3）
 *
 * 定位：从 .fai.js 源码（任意合法 JS）提取 **UI 通道需要的全部元数据**。
 * 输入 = 源码文本；输出 = UiMetadata。不生成可执行代码、不求值、不参与执行、
 * 不建执行中介 IR（已删除，只产宿主面类型）。
 *
 * lines 面 = StatementSummary[]（与现状 analyzeCode 产出逐字相等，A-16 对拍
 * 锁定；唯一语义差异：id = `'s' + lineNo`，append 场景稳定）。行分类：
 * op 行 → lines；param 行 → params；import 行 → imports；function 行 →
 * functions；循环/条件/switch 块 → blocks（只读节点，不分析内部语义，R8）。
 *
 * 本文件不 import parser.ts/compile.ts（P6 删除 IR 后唯一存活解析侧）。
 */

import { parse as acornParse } from 'acorn'
import type { StatementSummary } from './statement-summary'
import type { ScriptMetaIR, TerminalShape } from './types'
import { asStmtId, asPartName, type PartName, type StmtId } from '../identity'
import type { HostArg, HostCallRef, HostRef } from './host-arg'
import { isHostVarRef, isHostParamRef, isHostCallRef, isHostExprRef } from './host-arg'
import { ParseError } from './parse-error'
import { fnv1a32 } from './fnv-hash'
import { assertSecure, isSafeGlobalIdent, type SecurityPolicy } from './security-scanner'
import type { DimName } from '../units'
import { SCRIPT_UNIT_NAMES, UNIT_DIM, UNIT_SCALE, SCRIPT_UNIT_TO_NAME } from '../units'

// ── UiMetadata 类型（§4.1） ──

/** 参数表条目（参数面板：const X = <字面量> → 名字/值/是否计算表达式） */
export interface ParamEntry {
  name: string
  lineNo: number
  /** RHS 是纯字面量时为其值；表达式/引用（computed=true）时 value 缺省 */
  value?: unknown
  type: 'number' | 'vec3' | 'bool' | 'enum'
  /** RHS 是表达式/参数引用 → 面板只读 */
  computed: boolean
}

/**
 * 单个参数槽的源码来源信息（UI 通道新增，非 IR）。
 *
 * Timeline 参数表达式编辑方案（docs/plans/2026-09-08-timeline-param-expression-editing.md）：
 * 每个参数槽携带自己的源码区间，编辑 = 精确替换该区间（`editArgSource`），
 * 不重印整行。path 对宿主是不透明标识符——宿主只能从本记录读取后原样回传。
 */
export interface ArgSource {
  /** 所属语句 id（'s' + lineNo）；参数行的 rhs 槽同样使用 's' + lineNo */
  stmtId: StmtId
  /** 槽位路径（见 plans 文档 §4.2.1 的路径命名表；对宿主不透明） */
  path: string
  /** 该槽的源码原文（字面量 → `40`；表达式 → `w * 2`；引用 → `w`） */
  text: string
  /** 字符区间 [start, end)，相对 extractMetadata 的入参 code（含 codeOffset 归一化） */
  start: number
  end: number
  /** 依赖的参数名（命中 paramNames；表达式里的参数引用） */
  params: string[]
  /** 依赖的其它变量名（命中 declared，含 op 产出 / 派生常量） */
  refs: string[]
  /** 非平凡表达式（非字面量，负字面量视为字面量）→ UI 显示 fx 徽标 */
  isExpression: boolean
}

/** import 表条目（相对 specifier → moduleKey，裸 specifier → libLoader） */
export interface ImportEntry {
  lineNo: number
  specifier: string
  kind: 'named' | 'namespace' | 'default'
  bindings: string[]
  localName?: string
  packageName?: string
  moduleKey?: string
}

/** 函数表条目（本机函数） */
export interface FunctionEntry {
  name: string
  lineNo: number
  params: string[]
  /** 函数体原文区间（只读显示用；坐标相对原始 code 文本） */
  bodyRange: { start: number; end: number }
  /** 函数体原文（花括号内） */
  body: string
  bodyHash: string
}

/** 块结构条目（只读节点，R8） */
export interface BlockEntry {
  lineNo: number
  kind: 'loop' | 'condition' | 'switch' | 'other'
  astKind: string
  /** 块源码原文（含闭合括号的整段） */
  source: string
  range: { start: number; end: number }
}

/** keep 指令条目（行级，存活判定静态输入；hidden=true 为 keepHidden） */
export interface KeepEntry {
  target: string
  hidden: boolean
}

/** 元数据提取器输出：UI 通道的完整元数据面（§4.1）。 */
export interface UiMetadata {
  lines: StatementSummary[]
  params: ParamEntry[]
  imports: ImportEntry[]
  functions: FunctionEntry[]
  blocks: BlockEntry[]
  keep: Map<number, KeepEntry[]>
  meta?: ScriptMetaIR
  terminalShapes?: TerminalShape[]
  /**
   * 全语句参数槽的源码来源（按语句顺序；参数行的 RHS 槽 path 以 'rhs' 开头）。
   * 新增字段：P0-B（见 plans/2026-09-08-timeline-param-expression-editing.md）。
   */
  argSources: ArgSource[]
  /**
   * 本脚本内可被表达式引用的名字（词典序去重）：
   * paramNames ∪ declared ∪ nsBindings ∪ localFnParams ∪ 单位常量。
   * `validateExpression` / `editArgSource` 用它做 E_REFERENCE 判定。
   *
   * 注意：S4 免 import 安全全局（Math / JSON / Number / console / Infinity / …）**不**入此表——
   * 它们不属于脚本作用域，`collectExprIdentifiers` 已借 `isSafeGlobalIdent` 无条件放行；
   * 列进来反而会让宿主把它们当成脚本变量（联想/重命名都会误伤）。
   */
  names: string[]
}

// ── AST 辅助 ──

type ASTNode = any

const CONTROL_FLOW_TYPES = new Set([
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement',
  'ThrowStatement', 'BreakStatement', 'ContinueStatement', 'LabeledStatement',
  'WithStatement', 'BlockStatement',
])

function lineOf(node: ASTNode): number {
  return node?.loc?.start?.line ?? 1
}

function derivePackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  return specifier.split('/')[0]
}

// ── 提取器符号表 ──

/**
 * 提取器符号表：声明过的名字与绑定关系（参数、变量、命名空间、函数形参、keep 指令），
 * 供解析过程中判定标识符归属并做常量折叠。
 */
export interface SymbolTable {
  /** 参数名（const X = <literal>） */
  paramNames: Set<string>
  /** 参数名 → 字面量值（折叠依据） */
  paramValues: Map<string, unknown>
  /** 已声明变量名（参数 + op outputs + 函数名；含宽松透传名） */
  declared: Set<string>
  /** 命名空间绑定名 → packageName（import * as ns） */
  nsBindings: Map<string, string>
  /** 本机函数名 → 形参 */
  localFnParams: Map<string, string[]>
  /** 缺省命名空间绑定名（'cad'） */
  defaultNsName: string
  /** keep 指令表（lineNo → 调用点条目；行级存活判定静态输入） */
  keep: Map<number, KeepEntry[]>
}

// ── 常量折叠（与现状 parser.tryFoldConstExpr 同构；仅字面量 + 参数） ──

type FoldResult =
| { ok: true; value: unknown; usedParam: boolean; usedUnit: boolean }
| { ok: false }

function numFold(v: number, usedParam = false, usedUnit = false): FoldResult {
return Number.isFinite(v) ? { ok: true, value: v, usedParam, usedUnit } : { ok: false }
}

function looseEq(a: unknown, b: unknown): boolean {
  let x: unknown = a
  let y: unknown = b
  if (typeof x === 'boolean') x = x ? 1 : 0
  if (typeof y === 'boolean') y = y ? 1 : 0
  if (typeof x === 'number' && typeof y === 'string') return x === Number(y)
  if (typeof x === 'string' && typeof y === 'number') return Number(x) === y
  if (x === null || y === null) return x === null && y === null
  return x === y
}

/**
 * 引用解析失败时的错误分类（A3）：裸标识符既非参数也非已声明变量。
 *
 * - 若它是免 import 安全全局（`isSafeGlobalIdent`，即 `S4_SAFE_GLOBALS` 成员），给出独立错误码
 *   `E_GLOBAL_NOT_ADMITTED` 与诚实文案，指明「这是 faijs 的判定点缺陷，不是你的代码问题」，
 *   并指向统一入口（`S4_SAFE_GLOBALS` / 计划 A1）——错误信息不再把调用方引向「这语言没有 Math」
 *   的相反结论。
 * - 真未知标识符仍给 `E_REFERENCE`，语义不变。
 *
 * 各判定点（collectExprIdentifiers / parseValueExpr / shorthand / 位置实参）已优先放行安全全局；
 * 本函数是其兜底：若某个判定点漏放行，错误也必须是诚实的，而非误导性的「unknown identifier」。
 *
 * @param name 被拒绝的裸标识符名。
 * @param line 行号。
 * @param where 出错位置描述（拼进 E_REFERENCE 文案；安全全局分支忽略）。
 * @returns 永不返回（总是抛 ParseError）。
 */
export function throwReferenceError(name: string, line: number, where: string): never {
  if (isSafeGlobalIdent(name)) {
    throw new ParseError(
      `"${name}" 是免 import 安全全局（见统一入口 S4_SAFE_GLOBALS / 计划 A1），但本判定点未放行它——这是 faijs 判定点的缺陷，不是你的代码问题`,
      line,
      'E_GLOBAL_NOT_ADMITTED',
    )
  }
  throw new ParseError(`unknown identifier "${name}" ${where}`, line, 'E_REFERENCE')
}

function tryFoldConstExpr(node: ASTNode, symbols: SymbolTable): FoldResult {
  switch (node.type) {
    case 'Literal':
      return { ok: true, value: node.value, usedParam: false, usedUnit: false }

    case 'Identifier': {
      // P7/D10.4: unit constants (MM, INCH, DEGREE, …) are recognized as
      // foldable constants. Their values come from UNIT_SCALE (the single
      // source of truth). The `usedUnit` flag is set so that `parseValueExpr`
      // can mark the line as computed (host read-only downgrade), preventing
      // the folded base value (e.g. 254) from being written back to source.
      if (SCRIPT_UNIT_NAMES.has(node.name)) {
        const unitName = SCRIPT_UNIT_TO_NAME[node.name]
        if (unitName) {
          return { ok: true, value: UNIT_SCALE[unitName], usedParam: false, usedUnit: true }
        }
      }
      if (!symbols.paramNames.has(node.name)) return { ok: false }
      const v = symbols.paramValues.get(node.name)
      return v === undefined ? { ok: false } : { ok: true, value: v, usedParam: true, usedUnit: false }
    }

    case 'UnaryExpression': {
      const operand = tryFoldConstExpr(node.argument, symbols)
      if (!operand.ok) return { ok: false }
      const v = operand.value
      switch (node.operator) {
        case '-': return typeof v === 'number' ? numFold(-v, operand.usedParam, operand.usedUnit) : { ok: false }
        case '+': return typeof v === 'number' ? numFold(+v, operand.usedParam, operand.usedUnit) : { ok: false }
        case '!': return { ok: true, value: !v, usedParam: operand.usedParam, usedUnit: operand.usedUnit }
        case '~': return typeof v === 'number' ? { ok: true, value: ~v, usedParam: operand.usedParam, usedUnit: operand.usedUnit } : { ok: false }
        case 'typeof': return { ok: true, value: typeof v, usedParam: operand.usedParam, usedUnit: operand.usedUnit }
        default: return { ok: false }
      }
    }

    case 'BinaryExpression': {
      const left = tryFoldConstExpr(node.left, symbols)
      if (!left.ok) return { ok: false }
      const right = tryFoldConstExpr(node.right, symbols)
      if (!right.ok) return { ok: false }
      const a = left.value
      const b = right.value
      const usedParam = left.usedParam || right.usedParam
      const usedUnit = left.usedUnit || right.usedUnit
      const numBin = (op: (x: number, y: number) => number): FoldResult =>
        typeof a === 'number' && typeof b === 'number' ? numFold(op(a, b), usedParam, usedUnit) : { ok: false }
      const cmpBin = (op: (x: number | string, y: number | string) => boolean): FoldResult => {
        if (typeof a === 'number' && typeof b === 'number') return { ok: true, value: op(a, b), usedParam, usedUnit }
        if (typeof a === 'string' && typeof b === 'string') return { ok: true, value: op(a, b), usedParam, usedUnit }
        return { ok: false }
      }
      switch (node.operator) {
        case '+': {
          if (typeof a === 'number' && typeof b === 'number') return numFold(a + b, usedParam, usedUnit)
          if (typeof a === 'string' || typeof b === 'string') return { ok: true, value: String(a) + String(b), usedParam, usedUnit }
          return { ok: false }
        }
        case '-': return numBin((x, y) => x - y)
        case '*': return numBin((x, y) => x * y)
        case '/': return numBin((x, y) => x / y)
        case '%': return numBin((x, y) => x % y)
        case '**': return numBin((x, y) => x ** y)
        case '<': return cmpBin((x, y) => x < y)
        case '<=': return cmpBin((x, y) => x <= y)
        case '>': return cmpBin((x, y) => x > y)
        case '>=': return cmpBin((x, y) => x >= y)
        case '==': return { ok: true, value: looseEq(a, b), usedParam, usedUnit }
        case '!=': return { ok: true, value: !looseEq(a, b), usedParam, usedUnit }
        case '===': return { ok: true, value: a === b, usedParam, usedUnit }
        case '!==': return { ok: true, value: a !== b, usedParam, usedUnit }
        default: return { ok: false }
      }
    }

    case 'LogicalExpression': {
      const left = tryFoldConstExpr(node.left, symbols)
      if (!left.ok) return { ok: false }
      const right = tryFoldConstExpr(node.right, symbols)
      if (!right.ok) return { ok: false }
      const a = left.value
      const usedParam = left.usedParam || right.usedParam
      const usedUnit = left.usedUnit || right.usedUnit
      switch (node.operator) {
        case '&&': return { ok: true, value: a ? right.value : left.value, usedParam, usedUnit }
        case '||': return { ok: true, value: a ? left.value : right.value, usedParam, usedUnit }
        case '??': return { ok: true, value: a === null ? right.value : left.value, usedParam, usedUnit }
        default: return { ok: false }
      }
    }

    case 'TemplateLiteral': {
      const parts: string[] = []
      const quasis = node.quasis as ASTNode[]
      const exprs = node.expressions as ASTNode[]
      let usedParam = false
      let usedUnit = false
      for (let i = 0; i < quasis.length; i++) {
        const cooked = quasis[i].value?.cooked
        parts.push(cooked ?? '')
        if (i < exprs.length) {
          const r = tryFoldConstExpr(exprs[i], symbols)
          if (!r.ok) return { ok: false }
          usedParam = usedParam || r.usedParam
          usedUnit = usedUnit || r.usedUnit
          parts.push(String(r.value))
        }
      }
      return { ok: true, value: parts.join(''), usedParam, usedUnit }
    }

    case 'ConditionalExpression': {
      const test = tryFoldConstExpr(node.test, symbols)
      if (!test.ok) return { ok: false }
      const chosen = tryFoldConstExpr(test.value ? node.consequent : node.alternate, symbols)
      if (!chosen.ok) return { ok: false }
      return { ok: true, value: chosen.value, usedParam: test.usedParam || chosen.usedParam, usedUnit: test.usedUnit || chosen.usedUnit }
    }

    default:
      return { ok: false }
  }
}

// ── Expr 白名单（与现状 parser.isExprWhitelist 同构） ──
//
// 本函数与 collectExprIdentifiers 是「唯一实现」——expr-validate.ts / source-edit.ts
// 直接 import 复用，不复制（见 plans/2026-09-08-timeline-param-expression-editing.md §3.4.1）。

/**
 * <Ns>.fn(...) 等「白名单表达式」结构判定（无可选链、无 spread、成员非计算）。
 * @param node 待判定的表达式 AST 节点；nil 或非法输入按非白名单处理。
 * @returns 节点自身及其全部子表达式均在白名单结构内 → true，否则 false。
 */
export function isExprWhitelist(node: ASTNode): boolean {
  if (!node || typeof node !== 'object') return false
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
      return true
    case 'UnaryExpression':
      return isExprWhitelist(node.argument)
    case 'BinaryExpression':
    case 'LogicalExpression':
      return isExprWhitelist(node.left) && isExprWhitelist(node.right)
    case 'ConditionalExpression':
      return isExprWhitelist(node.test) && isExprWhitelist(node.consequent) && isExprWhitelist(node.alternate)
    case 'ArrayExpression':
      return node.elements.every((el: ASTNode) => el !== null && el !== undefined && isExprWhitelist(el))
    case 'MemberExpression':
      if (node.optional) return false
      if (!isExprWhitelist(node.object)) return false
      return node.computed ? isExprWhitelist(node.property) : true
    case 'CallExpression': {
      if (node.optional) return false
      if (!isExprWhitelist(node.callee)) return false
      return (node.arguments as ASTNode[]).every((a) => a.type !== 'SpreadElement' && isExprWhitelist(a))
    }
    default:
      return false
  }
}

/**
 * 递归收集表达式引用：参数 → params；已声明变量 → refs；
 * 免 import 安全全局/单位常量 → 只放行、不记入（见下方分支注释）；未知 → E_REFERENCE。
 *
 * opts（可选扩展；缺省时行为与历史完全一致）：
 * - `lenient: true`：未知标识符不抛错（静默跳过）——ArgSource 记录路径用，
 *   保证提取本身绝不抛新错；
 * - `defaultNs`：把默认命名空间（'cad'）视同 nsBindings 成员——`cad.faceNormal(p)`
 *   作为参数槽整条记录时，不会把 'cad' 当作未知标识符。
 *
 * 本函数与 isExprWhitelist 是「唯一实现」——expr-validate.ts / source-edit.ts
 * 直接 import 复用，不复制（见 plans/2026-09-08-timeline-param-expression-editing.md §3.4.1）。
 *
 * @param node 表达式的 AST 根节点；nil 或非对象直接返回。
 * @param symbols 提取器符号表（判定 Identifier 是参数/已声明/未知）。
 * @param line 当前语句行号（未知标识符报错时的行号）。
 * @param params 收集命中参数名的输出集合。
 * @param refs 收集命中已声明变量的输出集合。
 * @param opts 可选扩展；`lenient` 静默跳过未知标识符，`defaultNs` 把默认命名空间视同绑定成员。
 */
export function collectExprIdentifiers(
  node: ASTNode,
  symbols: SymbolTable,
  line: number,
  params: Set<string>,
  refs: Set<string>,
  opts?: { lenient?: boolean; defaultNs?: string },
): void {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'Identifier': {
      const name = node.name
      if (symbols.paramNames.has(name)) {
        params.add(name)
      } else if (symbols.declared.has(name)) {
        refs.add(name)
      } else if (SCRIPT_UNIT_NAMES.has(name)) {
        // P6/D7: unit constants (MM, INCH, DEGREE, …) are global read-only constants.
        // Treat as a known reference — do not throw E_REFERENCE.
        refs.add(name)
      } else if (isSafeGlobalIdent(name)) {
        // 2026-10-06 修复：先前的白名单只内联了单位常量，漏掉 S4_SAFE_GLOBALS 的其余
        // 免 import 安全全局（Math / JSON / Number / console / Infinity / undefined / …），
        // 导致 `cad.box(Math.max(x, 20), 1, 1)` 在提取阶段就抛 E_REFERENCE —— 与 S4 门禁
        // 「Math 合法」直接矛盾，整个脚本连执行都进不去。
        // 这里只判定「合法」，**不**记入 params/refs：它们是 JS 全局，不是脚本作用域变量，
        // 记入会让宿主依赖分析（summary.refs / ArgSource.refs）产生幻影依赖。
      } else if (opts?.lenient === true) {
        // lenient：未知标识符跳过（ArgSource 记录路径，保证提取不抛新错）
      } else {
        throw throwReferenceError(name, line, 'in expression')
      }
      return
    }
    case 'UnaryExpression':
      collectExprIdentifiers(node.argument, symbols, line, params, refs, opts)
      return
    case 'BinaryExpression':
    case 'LogicalExpression':
      collectExprIdentifiers(node.left, symbols, line, params, refs, opts)
      collectExprIdentifiers(node.right, symbols, line, params, refs, opts)
      return
    case 'ConditionalExpression':
      collectExprIdentifiers(node.test, symbols, line, params, refs, opts)
      collectExprIdentifiers(node.consequent, symbols, line, params, refs, opts)
      collectExprIdentifiers(node.alternate, symbols, line, params, refs, opts)
      return
    case 'ArrayExpression':
      for (const el of node.elements) collectExprIdentifiers(el, symbols, line, params, refs, opts)
      return
    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (prop?.type !== 'Property') continue
        collectExprIdentifiers(prop.value, symbols, line, params, refs, opts)
      }
      return
    case 'TemplateLiteral':
      for (const expr of node.expressions) collectExprIdentifiers(expr, symbols, line, params, refs, opts)
      return
    case 'MemberExpression': {
      // 命名空间绑定（import * as cfg / 模块命名空间）的成员 cfg.OutX：对象名是外部
      // 命名空间，不收集为变量引用（§4.1 HostArg 引用形态；求值在内部 ctx.cfg 侧）。
      // opts.defaultNs（缺省命名空间 'cad'）同样跳过——cad.faceNormal(p) 整条作为
      // 参数槽记录时不会把 'cad' 当未知标识符。
      const obj = node.object
      if (obj?.type === 'Identifier' && (symbols.nsBindings.has(obj.name) || obj.name === opts?.defaultNs)) {
        if (node.computed) collectExprIdentifiers(node.property, symbols, line, params, refs, opts)
        return
      }
      collectExprIdentifiers(node.object, symbols, line, params, refs, opts)
      if (node.computed) collectExprIdentifiers(node.property, symbols, line, params, refs, opts)
      return
    }
    case 'CallExpression':
      collectExprIdentifiers(node.callee, symbols, line, params, refs, opts)
      for (const a of node.arguments as ASTNode[]) {
        collectExprIdentifiers(a.type === 'SpreadElement' ? a.argument : a, symbols, line, params, refs, opts)
      }
      return
    default:
      return
  }
}

// ── 值解析 → HostArg（与现状 parseValueExpr/parsePositionalArgs 语义同构） ──

interface ValueParseCtx {
  symbols: SymbolTable
  /** 宽松模式（append 单行提取/引用前段变量）：未知标识符透传为外部名 */
  looseVars: boolean
  /** 宽松本机调用（codeToArgs）：裸 callee 不在函数集也放行 */
  looseLocalCalls: boolean
  sourceText: string
  /** 折叠/computed 累积标记：本语句是否引用了参数表达式/spread（hasComputedArgs） */
  computed: { value: boolean }
  /** P0-B：当前语句 id（'s' + 归一化行号；argSources 记录的 stmtId） */
  stmtId: StmtId
  /** P0-B：parseCode 的 codeOffset（ArgSource.start/end 归一化到原 code 坐标） */
  codeOffset: number
  /** P0-B：参数槽源码记录累积（语句顺序追加） */
  argSources: ArgSource[]
  /** P6/D8: callee → 量纲声明（dimension pass 用） */
  opDims?: OpDimMap
  /** P6/D8: dimension 校验错误累积 */
  dimErrors: ParseError[]
}

/** 是否非平凡表达式：非 Literal（负字面量视为字面量）→ UI 显示 fx 徽标 */
function isExpressionNode(node: ASTNode): boolean {
  if (!node || node.type === 'Literal') return false
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'Literal') return false
  return true
}

// ── P6/D8: 静态量纲校验（dimension pass） ──

/**
 * P6/D8 R4: Determine the dimension of an AST expression node.
 *
 * Returns the DimName if the expression can be statically determined to carry
 * a dimension, `'bare'` for a bare number literal, or `null` if it cannot be
 * determined (R5: pass through).
 */
function inferDim(node: ASTNode): DimName | 'bare' | null {
  if (!node) return null

  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'number') return 'bare'
      return null

    case 'UnaryExpression':
      if (node.operator === '-' || node.operator === '+' || node.operator === '~') {
        return inferDim(node.argument)
      }
      return null

    case 'Identifier':
      // Unit constant? → its dimension
      if (SCRIPT_UNIT_NAMES.has(node.name)) {
        const unitName = SCRIPT_UNIT_TO_NAME[node.name]
        return unitName ? (UNIT_DIM[unitName] ?? null) : null
      }
      // Declared variable or parameter → cannot determine (R5: pass through)
      return null

    case 'BinaryExpression': {
      const left = inferDim(node.left)
      const right = inferDim(node.right)

      switch (node.operator) {
        case '*': {
          // number * unitConst → unit's dim; unitConst * number → same
          if (left === 'bare' && right && right !== 'bare') return right
          if (right === 'bare' && left && left !== 'bare') return left
          // both bare → bare (dimensionless multiply)
          if (left === 'bare' && right === 'bare') return 'bare'
          // both have dims → compound (length * length → area); pass through
          return null
        }
        case '/': {
          // same dim / same dim → dimensionless (bare)
          if (left && right && left === right && left !== 'bare') return 'bare'
          // dim / bare → dim
          if (left && left !== 'bare' && right === 'bare') return left
          // bare / dim → 1/dim (not a simple dim); pass through
          if (left === 'bare' && right && right !== 'bare') return null
          if (left === 'bare' && right === 'bare') return 'bare'
          return null
        }
        case '+':
        case '-': {
          // Both sides must have the same dimension (R3)
          if (left === right) return left
          // R3: if both sides are determinable but differ → mismatch.
          // But inferDim can't report errors — it returns the dim or null.
          // We return a special sentinel 'mismatch' to signal checkDim.
          if (left && right && left !== 'bare' && right !== 'bare' && left !== right) {
            return 'mismatch' as unknown as DimName
          }
          // If one is bare and the other has a dim → the result has that dim
          if (left === 'bare' && right && right !== 'bare') return right
          if (right === 'bare' && left && left !== 'bare') return left
          // If either is null (unknown), pass through (R5)
          return null
        }
        default:
          return null
      }
    }

    case 'ParenthesizedExpression':
      return inferDim(node.expression)

    case 'ArrayExpression':
      // vec3 — check first element for dimensionality
      if (node.elements && node.elements.length > 0 && node.elements[0]) {
        return inferDim(node.elements[0])
      }
      return null

    default:
      return null
  }
}

/**
 * P6/D8: Check if an argument expression has the required dimension.
 *
 * - R2: bare number literal on a dimensioned slot → E_DIM_BARE_NUMBER
 * - R3: mismatched dimensions → E_DIM_MISMATCH
 * - R5: cannot determine → pass (no error)
 *
 * Appends errors to ctx.dimErrors (does not throw — extraction continues).
 */
function checkDim(node: ASTNode, expectedDim: DimName, ctx: ValueParseCtx): void {
  const actualDim = inferDim(node)

  // R5: cannot determine → pass through
  if (actualDim === null) return

  // R3: mismatched dimensions within the expression (e.g. mm + degree)
  if (actualDim === 'mismatch' as unknown as string) {
    ctx.dimErrors.push(new ParseError(
      `dimension mismatch in expression: "${ctx.sourceText.slice(node.start, node.end)}"`,
      lineOf(node),
      'E_DIM_MISMATCH',
    ))
    return
  }

  // R2: bare number on dimensioned slot
  if (actualDim === 'bare') {
    ctx.dimErrors.push(new ParseError(
      `bare number literal requires unit suffix (expected ${expectedDim}): "${ctx.sourceText.slice(node.start, node.end)}"`,
      lineOf(node),
      'E_DIM_BARE_NUMBER',
    ))
    return
  }

  // R3: dimension mismatch with expected
  if (actualDim !== expectedDim) {
    ctx.dimErrors.push(new ParseError(
      `dimension mismatch: expected ${expectedDim}, got ${actualDim} in "${ctx.sourceText.slice(node.start, node.end)}"`,
      lineOf(node),
      'E_DIM_MISMATCH',
    ))
    return
  }
}

/**
 * 在折叠之前记录一条参数槽（ArgSource）。
 *
 * - start/end 相对 extractMetadata 的入参 code（减 codeOffset，含封装归一化）；
 * - text = parseCode 原文切片（E_RANGE_STALE 用 `code.slice(start,end) === text` 断言）；
 * - params/refs 用 collectExprIdentifiers 的 lenient 模式（未知标识符跳过，
 *   保证提取不抛新错——与 main parse 的 E_REFERENCE 例外保持解耦）。
 */
function recordArgSource(node: ASTNode, ctx: ValueParseCtx, path: string): void {
  if (!node || typeof node !== 'object' || node.start == null || node.end == null || node.end < node.start) return
  const isExpr = isExpressionNode(node)
  const params = new Set<string>()
  const refs = new Set<string>()
  if (isExpr) {
    collectExprIdentifiers(node, ctx.symbols, lineOf(node), params, refs, {
      lenient: true,
      defaultNs: ctx.symbols.defaultNsName,
    })
  }
  ctx.argSources.push({
    stmtId: ctx.stmtId,
    path,
    text: ctx.sourceText.slice(node.start, node.end),
    start: node.start - ctx.codeOffset,
    end: node.end - ctx.codeOffset,
    params: [...params],
    refs: [...refs],
    isExpression: isExpr,
  })
}

/**
 * 裸全局标识符实参解析（单位常量 + S4 免 import 安全全局）。
 *
 * 分别收口 `parseValueExpr` 与 `parsePositionalArgs` 的 Identifier 分支：两者此前
 * 都把「不在 paramNames/declared 里」的裸标识符直接判为未声明变量（E_REFERENCE），
 * 于是连 `cad.box(MM, 1, 1)` 这种合法写法也被拒。
 *
 * 返回 undefined 表示「不是全局名字」，交由调用方按变量引用/报错处理。
 *
 * 单位常量（MM/INCH/DEGREE/…）走静态折叠（与 `10 * MM` 同一路径，得折叠字面量 +
 * computed 标记，源文本不回写，见 P7/D10.4）；其余安全全局（Math/JSON/console/
 * Infinity/…）保留原文交给运行时求值（expr-ref），两个执行后端都能从 globalThis 解析。
 * @param name 标识符名（须已判定为全局名字）。
 * @param node 该标识符的 AST 节点（取源码区间做 expr-ref 文本）。
 * @param ctx 值解析上下文（符号表 / computed 累积 / 源文本）。
 * @returns 对应的 HostArg。
 */
function parseGlobalIdentArg(name: string, node: ASTNode, ctx: ValueParseCtx): HostArg | undefined {
  if (!isSafeGlobalIdent(name)) return undefined
  if (SCRIPT_UNIT_NAMES.has(name)) {
    const r = tryFoldConstExpr(node, ctx.symbols)
    if (r.ok) {
      ctx.computed.value = true
      return r.value as HostArg
    }
  }
  ctx.computed.value = true
  return {
    kind: 'expr-ref',
    text: ctx.sourceText.slice(node.start, node.end),
    refs: [],
    params: [],
  } as unknown as HostArg
}

function parseValueExpr(node: ASTNode, ctx: ValueParseCtx, path: string | null): HostArg {
  if (!node) throw new ParseError('missing value expression', 1, 'E_VALUE')
  const line = lineOf(node)

  // P0-B：在折叠之前记录一条 ArgSource（path === null 忽略——参数行 RHS 由
  // recordArgSource 显式记录，不再双记）。
  if (path !== null) recordArgSource(node, ctx, path)

  // 折叠优先：Unary/Binary/Logical/Template/Conditional 可静态折叠（字面量 + 参数）
  if (
    node.type === 'UnaryExpression' ||
    node.type === 'BinaryExpression' ||
    node.type === 'LogicalExpression' ||
    node.type === 'TemplateLiteral' ||
    node.type === 'ConditionalExpression'
  ) {
    const r = tryFoldConstExpr(node, ctx.symbols)
    if (r.ok) {
      // F1-E1：仅折叠表达式引用参数才标 computed；纯字面量（负字面量）不标
      // P7/D10.4: unit constants (usedUnit) also mark computed — the folded
      // base value (e.g. 254 for `10 * INCH`) must NOT be written back to
      // source code (would lose the unit and change geometry in non-base contexts).
      if (r.usedParam || r.usedUnit) ctx.computed.value = true
      return r.value as unknown as HostArg
    }
    // 折叠失败且 ∈ 白名单 → expr-ref（运行时求值）
    if (isExprWhitelist(node)) {
      const params = new Set<string>()
      const refs = new Set<string>()
      collectExprIdentifiers(node, ctx.symbols, line, params, refs)
      ctx.computed.value = true
      return {
        kind: 'expr-ref',
        text: ctx.sourceText.slice(node.start, node.end),
        refs: [...refs],
        params: [...params],
      } as unknown as HostArg
    }
    throw new ParseError(
      `cannot statically evaluate ${node.type} in args (must reference declared params or literals)`,
      line,
      'E_VALUE',
    )
  }

  switch (node.type) {
    case 'Literal':
      return node.value as HostArg

    case 'Identifier': {
      const name = node.name
      if (ctx.symbols.paramNames.has(name)) {
        return { kind: 'param-ref', name } as unknown as HostArg
      }
      if (ctx.symbols.declared.has(name)) {
        return { kind: 'var-ref', name } as unknown as HostArg
      }
      const globalArg = parseGlobalIdentArg(name, node, ctx)
      if (globalArg !== undefined) return globalArg
      if (ctx.looseVars) {
        ctx.symbols.declared.add(name)
        return { kind: 'var-ref', name } as unknown as HostArg
      }
      throw throwReferenceError(name, line, 'in args value (not a declared param or variable)')
    }

    case 'ArrayExpression': {
      const out: HostArg[] = []
      for (let i = 0; i < node.elements.length; i++) {
        const el = node.elements[i]
        if (el === null || el === undefined) {
          throw new ParseError('array holes are not supported in args', line, 'E_VALUE')
        }
        const childPath = path === null ? null : `${path}[${i}]`
        if (el.type === 'SpreadElement') {
          if (childPath !== null) recordArgSource(el.argument, ctx, childPath)
          const r = tryFoldConstExpr(el.argument, ctx.symbols)
          if (!r.ok || !Array.isArray(r.value)) {
            throw new ParseError(
              'cannot statically evaluate spread in args (expected an array param or literal)',
              line,
              'E_VALUE',
            )
          }
          ctx.computed.value = true
          out.push(...(r.value as HostArg[]))
          continue
        }
        out.push(parseValueExpr(el, ctx, childPath))
      }
      return out as unknown as HostArg
    }

    case 'ObjectExpression':
      return parseObjectValue(node, ctx, path)

    case 'CallExpression': {
      const callee = node.callee
      // <ns>.<fn>(...) → call-ref（只读查询）
      if (
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'Identifier' &&
        (ctx.symbols.nsBindings.has(callee.object.name) ||
          callee.object.name === ctx.symbols.defaultNsName) &&
        callee.property?.type === 'Identifier'
      ) {
        const nsName = callee.object.name
        const args = (node.arguments as ASTNode[]).map((a, i) =>
          parseValueExpr(a, ctx, path === null ? null : `${path}[${i}]`))
        const callRef: HostCallRef = {
          kind: 'call-ref',
          callee: callee.property.name,
          args,
          ...(nsName !== ctx.symbols.defaultNsName ? { namespace: nsName } : {}),
        }
        return callRef as unknown as HostArg
      }
      if (isExprWhitelist(node)) {
        const params = new Set<string>()
        const refs = new Set<string>()
        collectExprIdentifiers(node, ctx.symbols, line, params, refs)
        ctx.computed.value = true
        return {
          kind: 'expr-ref',
          text: ctx.sourceText.slice(node.start, node.end),
          refs: [...refs],
          params: [...params],
        } as unknown as HostArg
      }
      throw new ParseError(
        'nested calls in args must be <ns>.<ident>(...) or a whitelisted expression',
        line,
        'E_VALUE',
      )
    }

    case 'MemberExpression': {
      if (isExprWhitelist(node)) {
        const params = new Set<string>()
        const refs = new Set<string>()
        collectExprIdentifiers(node, ctx.symbols, line, params, refs)
        ctx.computed.value = true
        return {
          kind: 'expr-ref',
          text: ctx.sourceText.slice(node.start, node.end),
          refs: [...refs],
          params: [...params],
        } as unknown as HostArg
      }
      throw new ParseError('unsupported member expression in args: optional chaining is not allowed', line, 'E_VALUE')
    }

    default:
      throw new ParseError(`unsupported value expression: ${node.type}`, line, 'E_VALUE')
  }
}

/** 对象字面量参数解析 + 参数槽记录（属性值路径 = `<base>.<key>`；shorthand 以来源名为 text 记一条）。 */
function parseObjectValue(node: ASTNode, ctx: ValueParseCtx, path: string | null): HostArg {
  const line = lineOf(node)
  const obj: Record<string, HostArg> = {}
  for (const prop of node.properties) {
    if (prop.type === 'SpreadElement') {
      const r = tryFoldConstExpr(prop.argument, ctx.symbols)
      if (!r.ok || typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) {
        throw new ParseError('cannot statically evaluate object spread in args', line, 'E_VALUE')
      }
      ctx.computed.value = true
      Object.assign(obj, r.value as Record<string, unknown>)
      continue
    }
    const key = prop.key?.type === 'Identifier' ? prop.key.name
      : prop.key?.type === 'Literal' ? String(prop.key.value)
      : null
    if (key === null) throw new ParseError('invalid object key', line, 'E_VALUE')
    if (prop.shorthand) {
      // shorthand { size } → { size: param-ref }；已声明变量 shorthand 现状报 E_REFERENCE
      const name = key
      let slotParams: string[] = []
      let slotRefs: string[] = []
      if (ctx.symbols.paramNames.has(name)) {
        obj[key] = { kind: 'param-ref', name } as unknown as HostArg
        slotParams = [name]
      } else if (isSafeGlobalIdent(name)) {
        // 与 longhand `{ q: Math }`（parseValueExpr → parseGlobalIdentArg）一致：免 import 安全全局放行，
        // 不再误报 E_REFERENCE / E_GLOBAL_NOT_ADMITTED（A3：同值 Math 在 longhand 已放行）。
        obj[key] = parseGlobalIdentArg(name, prop.key, ctx) as unknown as HostArg
      } else if (ctx.looseVars) {
        ctx.symbols.declared.add(name)
        obj[key] = { kind: 'var-ref', name } as unknown as HostArg
        slotRefs = [name]
      } else {
        throw throwReferenceError(name, line, 'in shorthand object key (not a declared param)')
      }
      // P0-B：shorthand 槽（以属性名 == 变量名作 text，path = <base>.<key>，isExpression=false）
      if (path !== null) {
        ctx.argSources.push({
          stmtId: ctx.stmtId,
          path: `${path}.${key}`,
          text: ctx.sourceText.slice(prop.start, prop.end),
          start: prop.start - ctx.codeOffset,
          end: prop.end - ctx.codeOffset,
          params: slotParams,
          refs: slotRefs,
          isExpression: false,
        })
      }
    } else {
      obj[key] = parseValueExpr(prop.value, ctx, path === null ? null : `${path}.${key}`)
    }
  }
  return obj as unknown as HostArg
}

/** 位置实参解析（与现状 parsePositionalArgs 同构）；P0-B 附带参数槽记录（pathBase 缺省 'positional'）。 */
function parsePositionalArgs(
  argNodes: ASTNode[],
  ctx: ValueParseCtx,
  line: number,
  pathBase = 'positional',
): HostArg[] {
  const out: HostArg[] = []
  for (let i = 0; i < argNodes.length; i++) {
    const argNode = argNodes[i]
    const isLast = i === argNodes.length - 1
    const isTrailingOptions = isLast && argNode?.type === 'ObjectExpression'
    if (isTrailingOptions) {
      // 尾随选项对象：只按 'args.<key>' 记录属性值，不把整对象再记一个 positional 槽
      out.push(parseObjectValue(argNode, ctx, 'args'))
      continue
    }
    const slotPath = `${pathBase}[${i}]`
    if (argNode.type === 'Identifier') {
      recordArgSource(argNode, ctx, slotPath)
      const name = argNode.name
      if (ctx.symbols.declared.has(name)) {
        out.push({ kind: 'var-ref', name } as unknown as HostArg)
        continue
      }
      const globalArg = parseGlobalIdentArg(name, argNode, ctx)
      if (globalArg !== undefined) {
        out.push(globalArg)
        continue
      }
      if (ctx.looseVars) {
        ctx.symbols.declared.add(name)
        out.push({ kind: 'var-ref', name } as unknown as HostArg)
        continue
      }
      throw throwReferenceError(name, lineOf(argNode), 'in inputs')
    }
    if (argNode.type === 'SpreadElement') {
      recordArgSource(argNode.argument, ctx, slotPath)
      const r = tryFoldConstExpr(argNode.argument, ctx.symbols)
      if (!r.ok || !Array.isArray(r.value)) {
        throw new ParseError(
          'cannot statically evaluate spread in arguments (must reference an array param or literal)',
          line,
          'E_VALUE',
        )
      }
      ctx.computed.value = true
      out.push(...(r.value as HostArg[]))
      continue
    }
    out.push(parseValueExpr(argNode, ctx, slotPath))
  }
  return out
}

// ── 行摘要组装 ──

/** 位置实参末位是否为纯数据对象（非引用形态）→ args 投影真源。
 *  与现状 splitPositionalOptions 同构：引用形态 = var-ref/param-ref/call-ref/expr-ref
 *  （kind 值 ∈ HOST_REF_KINDS 且完整匹配变体形状）；字面量对象的 kind 字段是普通数据。 */
function isPlainDataObject(v: unknown): v is Record<string, HostArg> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !isHostVarRef(v as HostRef) &&
    !isHostParamRef(v as HostRef) &&
    !isHostCallRef(v as HostRef) &&
    !isHostExprRef(v as HostRef)
  )
}

interface LineSummarySpec {
  callee: string
  line: number
  ctx: ValueParseCtx
  /** 位置实参槽（含尾随对象；positional 与 HostArg 面同构） */
  positional: HostArg[]
  namespace?: string
  local?: boolean
  receiver?: string
  outputs: string[]
  outputKeys?: string[]
  hasAssignment: boolean
}

/**
 * 从单条调用组装 StatementSummary：
 * - positional = 全量位置实参（末位纯对象保留，与现状一致）
 * - args = 末位纯对象的投影（keep/keepHidden 键原样保留——compile 期才剥离）
 */
function buildLineSummary(spec: LineSummarySpec): StatementSummary {
  const last = spec.positional[spec.positional.length - 1]
  const args: Record<string, HostArg> =
    isPlainDataObject(last) ? { ...(last as Record<string, HostArg>) } : {}

  const refs = new Set<string>()
  for (const a of spec.positional) collectRefsFromHostArg(a, refs)
  if (spec.receiver !== undefined) refs.add(spec.receiver)

  const summary: StatementSummary = {
    id: asStmtId(`s${spec.line}`),
    callee: spec.callee,
    ...(spec.local
      ? { local: true }
      : spec.namespace !== undefined
        ? {
            namespace: spec.namespace,
            ...(spec.ctx.symbols.nsBindings.get(spec.namespace) !== undefined
              ? { packageName: spec.ctx.symbols.nsBindings.get(spec.namespace) }
              : {}),
          }
        : {}),
    ...(spec.receiver !== undefined ? { receiver: asPartName(spec.receiver) } : {}),
    positional: spec.positional,
    args,
    outputs: spec.outputs.map((o) => asPartName(o)),
    ...(spec.outputKeys !== undefined ? { outputKeys: spec.outputKeys } : {}),
    hasAssignment: spec.hasAssignment,
    hasComputedArgs: spec.ctx.computed.value,
    line: spec.line,
  }
  if (refs.size > 0) summary.refs = [...refs]
  else summary.refs = []
  return summary
}

function collectRefsFromHostArg(value: HostArg, out: Set<string>): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return
  const kind = (value as { kind?: string }).kind
  if (kind === 'var-ref') {
    out.add((value as { name: string }).name)
    return
  }
  if (kind === 'param-ref') {
    out.add((value as { name: string }).name)
    return
  }
  if (kind === 'call-ref') {
    for (const a of (value as HostCallRef).args) collectRefsFromHostArg(a, out)
    return
  }
  if (kind === 'expr-ref') {
    const e = value as { params: string[]; refs: string[] }
    for (const p of e.params) out.add(p)
    for (const r of e.refs) out.add(r)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefsFromHostArg(v as HostArg, out)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, HostArg>)) collectRefsFromHostArg(v, out)
  }
}

// ── return / meta 解析 ──

function parseReturnStatement(
  node: ASTNode,
  ctx: ValueParseCtx,
): { meta?: ScriptMetaIR; terminalShapes?: TerminalShape[] } {
  const line = lineOf(node)
  const arg = node.argument
  if (!arg) return {}

  const resolveVar = (idNode: ASTNode): PartName => {
    if (idNode?.type !== 'Identifier') throw new ParseError('unknown variable in return', line)
    const name = idNode.name
    if (!ctx.symbols.declared.has(name) && !ctx.symbols.paramNames.has(name)) {
      throw new ParseError(`unknown variable "${name}" in return`, line)
    }
    return asPartName(name)
  }

  const parseOne = (objNode: ASTNode): { id: PartName | null; meta?: ScriptMetaIR } => {
    let id: PartName | null = null
    const meta: ScriptMetaIR = {}
    for (const prop of objNode.properties) {
      const key = prop.key?.type === 'Identifier' ? prop.key.name
        : prop.key?.type === 'Literal' ? String(prop.key.value)
        : null
      if (!key) continue
      if (key === 'shape') {
        if (prop.value?.type === 'Identifier') id = resolveVar(prop.value)
      } else if (key === 'name') {
        if (prop.value?.type === 'Literal') meta.name = prop.value.value as string
      }
      // 其余 key（含旧死特性 color/metalness/roughness，2026-10-05 v2 已删除）
      // 静默忽略：return 对象不是 op 参数，未知 key 不做参数校验（宽容语义）。
    }
    return { id, meta: Object.keys(meta).length > 0 ? meta : undefined }
  }

  if (arg.type === 'Identifier') return { terminalShapes: [{ id: resolveVar(arg) }] }
  if (arg.type === 'ObjectExpression') {
    const r = parseOne(arg)
    return { meta: r.meta, terminalShapes: r.id !== null ? [{ id: r.id, meta: r.meta }] : undefined }
  }
  if (arg.type === 'ArrayExpression') {
    const terminalShapes: TerminalShape[] = []
    for (const elem of arg.elements) {
      if (elem?.type !== 'ObjectExpression') {
        throw new ParseError('return array elements must be objects { shape, ... }', line)
      }
      const r = parseOne(elem)
      if (r.id) terminalShapes.push({ id: r.id, meta: r.meta })
    }
    if (terminalShapes.length === 0) throw new ParseError('return array must have at least one element', line)
    return { terminalShapes }
  }
  throw new ParseError(`unsupported return expression: ${arg.type}`, line)
}

// ── keep 指令提取（行级 keep/keepHidden → metadata.keep） ──

function extractKeepEntries(
  positional: HostArg[],
  line: number,
  symbols: SymbolTable,
): void {
  const last = positional[positional.length - 1]
  if (!isPlainDataObject(last)) return
  const entries: Array<{ target: string; hidden?: boolean }> = []
  const keepArg = last.keep
  if (Array.isArray(keepArg)) {
    for (const entry of keepArg) {
      const parsed = parseKeepEntry(entry)
      if (parsed) entries.push(parsed)
    }
  }
  const statementDefault = last.keepHidden === true
  const normalized = entries.map((e): KeepEntry => {
    // e.hidden 为显式 hidden 值（undefined → 未指定）；未指定时用语句级 keepHidden 兜底
    return { target: e.target, hidden: e.hidden ?? statementDefault }
  })
  if (normalized.length > 0) {
    const list = symbols.keep.get(line) ?? []
    list.push(...normalized)
    symbols.keep.set(line, list)
  }
}

function parseKeepEntry(entry: HostArg): { target: string; hidden?: boolean } | undefined {
  // 与现状 keep.ts parseKeepEntry 同构：字符串条目 / 裸 var-ref 条目不携带 hidden
  // （语句级 keepHidden 兜底）；{ shape, hidden } 显式条目携带 hidden（false 也显式）。
  if (typeof entry === 'string') return { target: entry }
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const obj = entry as Record<string, unknown>
    const shape = obj.shape
    if (typeof shape === 'string') return { target: shape, hidden: obj.hidden === true }
    if (shape !== null && typeof shape === 'object') {
      const s = shape as { kind?: string; name?: string }
      if (s.kind === 'var-ref' && typeof s.name === 'string') {
        return { target: s.name, hidden: obj.hidden === true }
      }
    }
    const self = entry as { kind?: string; name?: string }
    // 顶层 var-ref 条目（keep: [part0] → part0 是 var-ref 形态）：不携带 hidden
    if (self.kind === 'var-ref' && typeof self.name === 'string') {
      return { target: self.name }
    }
  }
  return undefined
}

// ── 主入口 ──

/** extractMetadata 的选项（全部可选；影响宽松引用与缺省命名空间解析）。 */
export interface ExtractMetadataOptions {
  /** 缺省命名空间绑定名（默认 'cad'；registerLib default 绑定改名时传入） */
  defaultNs?: string
  /** 宽松变量（append：未知引用按外部变量透传，由调用方对 ctx 校验） */
  looseVars?: boolean
  /** 宽松本机函数调用（codeToArgs 单行提取：裸 callee 不在函数集也放行） */
  looseLocalCalls?: boolean
  /** 顶层 import 绑定名（单行提取时宿主从脚本 imports 提供） */
  namespaces?: string[]
  /** 安全策略档位（缺省 'strict'；A1 接入点：extractMetadata 第一行过 Scanner） */
  security?: SecurityPolicy
  /** S7 命名空间保护名（缺省 = namespaces；append 场景可指定更小集合仅命名空间名） */
  nsNames?: string[]
  /**
   * P4/P6 (unit-system D8): callee → 量纲声明的映射，供 dimension pass 做静态
   * 量纲校验。调用方从 op 注册表取出透传（lang 不碰 op 注册表铁律）。
   */
  opDims?: OpDimMap
}

/**
 * P4/P6 (unit-system D8): 一个 op 的脚本面量纲声明，供静态 dimension 检查使用。
 * 由调用方（CadRuntime/CLI/codeToArgs）从 op 注册表取出透传，`lang/` 本身不碰
 * op 注册表（铁律：lang 不得依赖 op 注册表）。
 */
export interface OpDimDecl {
  /** 参数名 → 量纲；缺省键视为无量纲。 */
  paramDims?: Record<string, DimName>
  /** 函数调用结果的量纲。 */
  retDim?: DimName
  /** D11 slot-map（positional→object 装箱表）；位置形态校验用。 */
  slotMap?: { keys: string[]; vec3Keys?: string[]; shapeArity?: number }
}

/** P4/P6: callee 名 → 量纲声明（供 extractMetadata 的 dimension pass 消费）。 */
export type OpDimMap = Record<string, OpDimDecl>

/**
 * 从源码文本提取 UI 通道元数据（UiMetadata）。
 *
 * 兼容面：analyzeCode/codeToArgs 实现建立在本函数之上（statement-summary.ts /
 * code-to-args.ts），lines 面与 MetadataExtractor 投影逐字相等（A-16 对拍，
 * id 兼容 's'+lineNo 规则：其余字段逐字相等）。不参与执行、不生成可执行代码。
 *
 * 行号语义与 MetadataExtractor 完全一致：
 * - 容器代码（含 export default）→ 取容器箭头函数体，行号 = 原文行号；
 * - 扁平代码 → 按 MetadataExtractor 同款封装（import 段提升到 export default 之外，
 *   `export default async (ns) => {\n...` 包裹），行号扣封装偏移后 = analyzeCode
 *   报告的 line。
 *
 * @param code - the .fai.js source text.
 * @param options - optional extraction options.
 * @returns the full UI metadata surface.
 * @throws ParseError — 含行号（analyzeCode 抛错契约不变）。
 */
export function extractMetadata(code: string, options?: ExtractMetadataOptions): UiMetadata {
  // A1：安全门禁前置——在 acornParse 之前对原始 code 扫描，行号与用户编辑器一致。
  // security 与 looseVars 正交：安全规则不受 looseVars 影响。
  assertSecure(code, {
    policy: options?.security ?? 'strict',
    knownNames: [options?.defaultNs ?? 'cad', ...(options?.namespaces ?? [])],
    ...(options?.nsNames ? { nsNames: options.nsNames } : {}),
    defaultNs: options?.defaultNs,
  })

  const defaultNsName = options?.defaultNs ?? 'cad'

  // 符号表（每行提取共享：参数名/值、已声明变量、命名空间绑定、函数集、keep 表）
  const symbols: SymbolTable = {
    paramNames: new Set<string>(),
    paramValues: new Map<string, unknown>(),
    declared: new Set<string>(),
    nsBindings: new Map<string, string>(),
    localFnParams: new Map<string, string[]>(),
    defaultNsName,
    keep: new Map<number, KeepEntry[]>(),
  }

  // ── 0. 顶层 import 预扫描（与 MetadataExtractor 同构；容器/扁平都允许头部 import） ──
  let importBlock: { start: number; end: number } | null = null
  {
    const seen: ASTNode[] = []
    try {
      const prescan = acornParse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true })
      for (const n of prescan.body) {
        if (n.type === 'ImportDeclaration') seen.push(n)
      }
    } catch {
      // 原始文本非合法 module（如含 return）→ 交给主解析报错
    }
    if (seen.length > 0) {
      const first = seen[0]
      if (!onlyWhitespaceAndComments(code.slice(0, first.start))) {
        throw new ParseError('import statements must appear as a contiguous block at the top of the file', lineOf(first) ?? 1, 'E_IMPORT')
      }
      for (let i = 1; i < seen.length; i++) {
        const gap = code.slice(seen[i - 1].end, seen[i].start)
        if (!onlyWhitespaceAndComments(gap)) {
          throw new ParseError('import statements must be contiguous (no statements between imports)', lineOf(seen[i]) ?? 1, 'E_IMPORT')
        }
      }
      importBlock = { start: seen[0].start, end: seen[seen.length - 1].end }
    }
  }

  // ── 0.5 扁平代码封装（与 MetadataExtractor 逐字同款；容器零封装） ──
  // lineOffset：封装头占用的行数（语句行号 = acorn loc 行号 − lineOffset）。
  // codeOffset：封装头字符长度（函数体原文区间坐标换算；容器格式为 0）。
  let parseCode = code
  let lineOffset = code.includes('export default') ? 0 : 1
  let codeOffset = 0
  if (lineOffset) {
    if (importBlock) {
      const prefix = code.slice(0, importBlock.start)
      const importText = code.slice(importBlock.start, importBlock.end)
      const rest = code.slice(importBlock.end)
      parseCode = `${prefix}${importText}\nexport default async (${defaultNsName}) => {\n${rest}\n}`
      lineOffset = countLines(prefix + importText) + 1
      // 字符偏移 = 注入的 '\n'（importText 后）+ 封装头长度。原实现 29+len 少算 1
      //（未计入 importText 与封装间的换行），导致 import 场景的区间坐标错位——
      // bodyRange/ArgSource.start/end 等归一化要落到原 code 坐标。
      codeOffset = 1 + `export default async (${defaultNsName}) => {\n`.length
    } else {
      parseCode = `export default async (${defaultNsName}) => {\n${code}\n}`
      lineOffset = 1
      codeOffset = `export default async (${defaultNsName}) => {\n`.length
    }
  }

  // ── 1. 主解析（acorn module） ──
  let ast: ASTNode
  try {
    ast = acornParse(parseCode, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      ranges: true,
    })
  } catch (err) {
    const syntaxErr = err as { message?: string; loc?: { line: number } }
    const loc = syntaxErr.loc?.line ?? 1
    throw new ParseError(`SyntaxError: ${syntaxErr.message ?? String(err)}`, loc, 'E_SYNTAX')
  }

  // 顶层 import（模块级，封装外）→ ImportEntry 表
  const imports: ImportEntry[] = []
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration') continue
    const imp = classifyImport(n)
    imports.push(imp)
    if (imp.kind === 'namespace' && imp.localName) {
      symbols.nsBindings.set(imp.localName, imp.packageName ?? imp.localName)
    }
    if (imp.kind === 'named') {
      for (const b of imp.bindings) symbols.declared.add(b)
    }
  }
  // 宿主显式提供的命名空间绑定（codeToArgs 单行提取场景）
  for (const n of options?.namespaces ?? []) symbols.nsBindings.set(n, n)

  // 顶层 export default → 容器箭头函数体（封装文本下必存在）
  const exportDecl = ast.body.find((n: ASTNode) => n.type === 'ExportDefaultDeclaration')
  if (!exportDecl) {
    throw new ParseError('missing `export default`', 1)
  }
  const arrowFn = exportDecl.declaration
  if (
    arrowFn?.type !== 'ArrowFunctionExpression' ||
    !arrowFn.async ||
    arrowFn.params.length !== 1 ||
    arrowFn.params[0]?.type !== 'Identifier' ||
    arrowFn.params[0].name !== defaultNsName
  ) {
    throw new ParseError(`expected \`export default async (${defaultNsName}) => { ... }\``, lineOf(exportDecl))
  }
  const body = arrowFn.body
  if (body?.type !== 'BlockStatement') {
    throw new ParseError('expected arrow function body to be a block statement { ... }', lineOf(arrowFn))
  }
  const bodyNodes = body.body

  // 顶层函数预扫描（本机函数集）
  for (const n of bodyNodes) {
    if (n.type === 'FunctionDeclaration' && n.id?.type === 'Identifier') {
      const fparams: string[] = []
      for (const p of n.params ?? []) {
        if (p?.type === 'Identifier') fparams.push(p.name)
        else throw new ParseError('function params must be plain identifiers', lineOf(n), 'E_STATEMENT')
      }
      symbols.localFnParams.set(n.id.name, fparams)
      symbols.declared.add(n.id.name)
    }
  }

  const lines: StatementSummary[] = []
  const params: ParamEntry[] = []
  const functions: FunctionEntry[] = []
  const blocks: BlockEntry[] = []
  let meta: ScriptMetaIR | undefined
  let terminalShapes: TerminalShape[] | undefined
  // P0-B：参数槽记录累积（跨语句共享，语句顺序追加）
  const argSources: ArgSource[] = []
  // P6/D8: dimension 校验错误累积（跨语句共享）
  const allDimErrors: ParseError[] = []

  // ── 逐顶层语句分类 ──
  for (const stmtNode of bodyNodes) {
    const rawLine = lineOf(stmtNode)
    const line = lineOffset ? rawLine - lineOffset : rawLine
    const vctx: ValueParseCtx = {
      symbols,
      looseVars: options?.looseVars === true,
      looseLocalCalls: options?.looseLocalCalls === true,
      sourceText: parseCode,
      computed: { value: false },
      stmtId: asStmtId(`s${line}`),
      codeOffset,
      argSources,
      opDims: options?.opDims,
      dimErrors: allDimErrors,
    }

    switch (stmtNode.type) {
      case 'ImportDeclaration':
        break // 已在顶部收集（封装文本下 import 不在此层）

      case 'FunctionDeclaration': {
        const name = stmtNode.id?.name
        const fparams: string[] = symbols.localFnParams.get(name) ?? []
        const bodyStart = stmtNode.body.start + 1 - codeOffset
        const bodyEnd = stmtNode.body.end - 1 - codeOffset
        const bodyText = parseCode.slice(stmtNode.body.start + 1, stmtNode.body.end - 1)
        functions.push({
          name,
          lineNo: line,
          params: fparams,
          bodyRange: { start: bodyStart, end: bodyEnd },
          body: bodyText,
          bodyHash: fnv1a32(bodyText),
        })
        break
      }

      case 'VariableDeclaration': {
        if (stmtNode.kind !== 'const' && stmtNode.kind !== 'let') {
          throw new ParseError(`only 'const' or 'let' declarations allowed, got '${stmtNode.kind}'`, line, 'E_STATEMENT')
        }
        for (const decl of stmtNode.declarations) {
          const dline = lineOf(decl)
          const dlineSrc = lineOffset ? dline - lineOffset : dline

          // 解构 op 行
          if (decl.id?.type === 'ObjectPattern') {
            const summary = classifyDestructure(decl, dlineSrc, vctx)
            lines.push(summary)
            for (const out of summary.outputs) symbols.declared.add(String(out))
            continue
          }
          if (decl.id?.type !== 'Identifier') {
            throw new ParseError('expected identifier on left side of const declaration', dlineSrc, 'E_STATEMENT')
          }
          const name = decl.id.name
          let init = decl.init
          if (init?.type === 'AwaitExpression') init = init.argument
          if (init?.type === 'ImportExpression') {
            throw new ParseError('dynamic import() is not allowed in faijs (no control flow)', dlineSrc, 'E_CONTROL_FLOW')
          }

          // op 行：const x = <ns>.<op>(...) / <localFn>(...)
          if (init?.type === 'CallExpression' && isOpCallCallee(init, vctx)) {
            const summary = classifyOpCall(init, dlineSrc, vctx, { output: name, hasAssignment: true })
            lines.push(summary)
            symbols.declared.add(name)
            continue
          }

          // P0-B：参数行 RHS 槽——整条 init 源码区间记一条
          //（path：单声明行 'rhs'；一行多参声明行 'rhs:<name>' 区分）。
          if (init) {
            const rhsPath = stmtNode.declarations.length > 1 ? `rhs:${name}` : 'rhs'
            recordArgSource(init, vctx, rhsPath)
          }

          // 参数行：const x = <literal> / <纯字面量折叠>（值已知）
          const isLiteral =
            init?.type === 'Literal' ||
            init?.type === 'ArrayExpression' ||
            init?.type === 'ObjectExpression'
          const isNegLiteral =
            init?.type === 'UnaryExpression' && init.operator === '-' && init.argument?.type === 'Literal'
          if (isLiteral || isNegLiteral) {
            const value = isNegLiteral
              ? -init.argument.value as number
              : isLiteralValue(init)
                ? parseLiteralValue(init)
                : parseValueExpr(init, vctx, null) as unknown
            const literalLike = isNegLiteral || init.type === 'Literal'
            params.push({
              name,
              lineNo: dlineSrc,
              value,
              type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : 'vec3',
              computed: !literalLike,
            })
            symbols.paramNames.add(name)
            symbols.declared.add(name)
            if (literalLike) symbols.paramValues.set(name, value)
            continue
          }

          // 其余 const 形态：computed 参数（派生常量 / 引用表达式）——A-11 语法自由
          if (init) {
            params.push({ name, lineNo: dlineSrc, value: undefined, type: 'vec3', computed: true })
            symbols.declared.add(name)
            continue
          }
          throw new ParseError(`unsupported const declaration: init type = ${init?.type ?? 'null'}`, line, 'E_STATEMENT')
        }
        break
      }

      case 'ExpressionStatement': {
        classifyExpression(stmtNode.expression, line, vctx, lines)
        break
      }

      case 'ReturnStatement': {
        const r = parseReturnStatement(stmtNode, vctx)
        meta = r.meta
        terminalShapes = r.terminalShapes
        break
      }

      default: {
        // 控制流/块 → 只读块节点（R8）
        if (CONTROL_FLOW_TYPES.has(stmtNode.type)) {
          blocks.push({
            lineNo: line,
            kind: blockKind(stmtNode.type),
            astKind: stmtNode.type,
            source: parseCode.slice(stmtNode.start, stmtNode.end),
            range: { start: stmtNode.start - codeOffset, end: stmtNode.end - codeOffset },
          })
          break
        }
        if (stmtNode.type === 'ClassDeclaration') {
          throw new ParseError('class declarations are not allowed in faijs', line, 'E_STATEMENT')
        }
        if (stmtNode.type === 'NewExpression') {
          throw new ParseError('"new" expressions are not allowed in faijs (new Function is a safety red line)', line, 'E_STATEMENT')
        }
        if (stmtNode.type === 'WithStatement') {
          throw new ParseError('"with" statements are not allowed in faijs (strict mode)', line, 'E_CONTROL_FLOW')
        }
        // 其余未知顶层语句 → 只读块
        blocks.push({
          lineNo: line,
          kind: 'other',
          astKind: stmtNode.type,
          source: parseCode.slice(stmtNode.start, stmtNode.end),
          range: { start: stmtNode.start - codeOffset, end: stmtNode.end - codeOffset },
        })
        break
      }
    }
  }

  // P0-B：名称集合 = 参数 ∪ 已声明变量 ∪ 命名空间绑定 ∪ 本地函数名 ∪ 单位常量（字典序去重）。
  // 宿主把「参数表达式」中的未知标识符当作参数名（期望名）处理时用它做联想。
  // P6/D7：单位常量名（MM, INCH, DEGREE, …）加入 knownNames，使表达式实时校验通过。
  // 2026-10-06：其余 S4 安全全局（Math / JSON / console / …）不入此表——引用合法性由
  // collectExprIdentifiers + isSafeGlobalIdent 判定，与 knownNames 无关（见 names 字段注释）。
  const names = [
    ...new Set([
      ...symbols.paramNames,
      ...symbols.declared,
      ...symbols.nsBindings.keys(),
      ...symbols.localFnParams.keys(),
      ...SCRIPT_UNIT_NAMES,
    ]),
  ].sort()

  // P6/D8: dimension 校验——如果有错误，抛出第一个（用 stage='dimension' 包装）
  if (allDimErrors.length > 0) {
    throw allDimErrors[0]
  }

  return { lines, params, imports, functions, blocks, keep: symbols.keep, meta, terminalShapes, argSources, names }
}

function isLiteralValue(init: ASTNode): boolean {
  return init.type === 'Literal'
}

/** 字面量（非数组/对象）直接取值。 */
function parseLiteralValue(init: ASTNode): unknown {
  return init.value
}

function countLines(text: string): number {
  if (text === '') return 0
  return (text.match(/\n/g) ?? []).length + 1
}

function onlyWhitespaceAndComments(text: string): boolean {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim() === ''
}

function blockKind(type: string): BlockEntry['kind'] {
  switch (type) {
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
      return 'loop'
    case 'IfStatement':
      return 'condition'
    case 'SwitchStatement':
      return 'switch'
    default:
      return 'other'
  }
}

function classifyImport(decl: ASTNode): ImportEntry {
  const line = lineOf(decl)
  const specifier = decl.source?.value
  if (typeof specifier !== 'string' || specifier === '') {
    throw new ParseError('import must have a string specifier', line, 'E_IMPORT')
  }
  const packageName = derivePackageName(specifier)
  const specs = decl.specifiers ?? []
  if (specs.length === 0) {
    throw new ParseError('side-effect imports are not supported (use import * as ns from "pkg")', line, 'E_IMPORT')
  }
  const first = specs[0]
  if (first.type === 'ImportNamespaceSpecifier') {
    return { lineNo: line, specifier, kind: 'namespace', bindings: [first.local?.name], localName: first.local?.name, packageName }
  }
  if (first.type === 'ImportDefaultSpecifier') {
    return { lineNo: line, specifier, kind: 'default', bindings: [first.local?.name], localName: first.local?.name, packageName }
  }
  const bindings: string[] = specs.map((s: ASTNode) => s.local?.name as string)
  return { lineNo: line, specifier, kind: 'named', bindings, localName: bindings[0], packageName }
}

/** init 是否为 op 调用 callee（<ns>.<op> / 裸本机函数）。 */
function isOpCallCallee(init: ASTNode, ctx: ValueParseCtx): boolean {
  const callee = init.callee
  if (callee?.type === 'MemberExpression') {
    return (
      callee.object?.type === 'Identifier' &&
      callee.property?.type === 'Identifier' &&
      (ctx.symbols.nsBindings.has(callee.object.name) ||
        callee.object.name === ctx.symbols.defaultNsName ||
        ctx.symbols.declared.has(callee.object.name) ||
        ctx.looseVars)
    )
  }
  if (callee?.type === 'Identifier') {
    return ctx.symbols.localFnParams.has(callee.name) || ctx.looseLocalCalls
  }
  return false
}

/** 从调用表达式构造 op 行（output 单输出 / 副作用无输出）。 */
function classifyOpCall(
  call: ASTNode,
  line: number,
  vctx: ValueParseCtx,
  opts: { output?: string; hasAssignment: boolean },
): StatementSummary {
  const calleeNode = call.callee
  let callee: string
  let namespace: string | undefined
  let local: boolean | undefined
  let receiver: string | undefined

  if (calleeNode?.type === 'MemberExpression' && calleeNode.object?.type === 'Identifier' && calleeNode.property?.type === 'Identifier') {
    const objName = calleeNode.object.name
    if (vctx.symbols.nsBindings.has(objName) || objName === vctx.symbols.defaultNsName) {
      namespace = objName === vctx.symbols.defaultNsName ? undefined : objName
      callee = calleeNode.property.name
    } else {
      receiver = objName
      callee = calleeNode.property.name
    }
  } else if (calleeNode?.type === 'Identifier') {
    local = true
    callee = calleeNode.name
  } else {
    throw new ParseError('expected <ns>.<op>(...) or local function call', line, 'E_STATEMENT')
  }

  const positional = parsePositionalArgs(call.arguments ?? [], vctx, line)

  // P6/D8: dimension pass — check each argument against declared paramDims
  if (vctx.opDims && call.arguments) {
    // Build the full callee key for opDims lookup: 'cad.box' for default ns,
    // 'otherNs.box' for non-default ns, or just 'box' for local fn.
    const dimKey = namespace !== undefined ? `${namespace}.${callee}` : `${vctx.symbols.defaultNsName}.${callee}`
    const localKey = local ? callee : dimKey
    checkOpCallDims(call, local ? localKey : dimKey, vctx)
  }

  const summary = buildLineSummary({
    callee,
    line,
    ctx: vctx,
    positional,
    namespace,
    local,
    receiver,
    outputs: opts.output !== undefined ? [opts.output] : [],
    hasAssignment: opts.hasAssignment,
  })
  extractKeepEntries(positional, line, vctx.symbols)
  attachAssemblySummary(summary)
  return summary
}

/**
 * P6/D8: Check dimension constraints on op call arguments.
 *
 * Handles both object-form (`cad.box({ width: 10 * MM })`) and positional-form
 * (`cad.box(10 * MM, 10 * MM, 10 * MM)`). For positional form, uses slotMap
 * to map positional args to parameter names. For vec3 params, checks each element.
 *
 * Errors are accumulated in `ctx.dimErrors` (does not throw).
 */
function checkOpCallDims(call: ASTNode, calleeKey: string, ctx: ValueParseCtx): void {
  const decl = ctx.opDims?.[calleeKey]
  if (!decl || !decl.paramDims) return

  const args = call.arguments ?? []
  if (args.length === 0) return

  const slotMap = decl.slotMap
  const shapeArity = slotMap?.shapeArity ?? 0

  // ── Object form ──
  // Look for an ObjectExpression arg that contains keys matching paramDims.
  // It could be at position `shapeArity` (with slotMap) or at any position
  // (without slotMap — e.g. fai_extrude(shape, { length: 5 })).
  if (slotMap) {
    const firstNonShape = args[shapeArity]
    if (firstNonShape?.type === 'ObjectExpression') {
      const hasDimKeys = firstNonShape.properties.some(
        (p: ASTNode) => p?.type === 'Property' && p.key?.type === 'Identifier' && p.key.name in decl.paramDims!,
      )
      if (hasDimKeys) {
        for (const prop of firstNonShape.properties) {
          if (prop?.type !== 'Property') continue
          const keyNode = prop.key
          if (keyNode?.type !== 'Identifier') continue
          const paramName = keyNode.name
          const dim = decl.paramDims[paramName]
          if (!dim) continue

          checkDim(prop.value, dim, ctx)

          if (slotMap.vec3Keys?.includes(paramName) && prop.value?.type === 'ArrayExpression') {
            for (const el of prop.value.elements ?? []) {
              if (el) checkDim(el, dim, ctx)
            }
          }
        }
        return
      }
    }
  } else {
    // No slotMap — scan all args for ObjectExpression with dim keys
    for (const arg of args) {
      if (arg?.type !== 'ObjectExpression') continue
      const hasDimKeys = arg.properties.some(
        (p: ASTNode) => p?.type === 'Property' && p.key?.type === 'Identifier' && p.key.name in decl.paramDims!,
      )
      if (!hasDimKeys) continue
      for (const prop of arg.properties) {
        if (prop?.type !== 'Property') continue
        const keyNode = prop.key
        if (keyNode?.type !== 'Identifier') continue
        const paramName = keyNode.name
        const dim = decl.paramDims[paramName]
        if (!dim) continue

        checkDim(prop.value, dim, ctx)
      }
      return
    }
  }

  // ── Positional form ──
  if (!slotMap) return
  const keys = slotMap.keys
  const vec3Keys = new Set(slotMap.vec3Keys ?? [])
  let keyIdx = 0
  for (let i = shapeArity; i < args.length && keyIdx < keys.length; i++) {
    const arg = args[i]
    if (arg?.type === 'ObjectExpression') break // trailing options object

    const paramName = keys[keyIdx]
    const dim = decl.paramDims[paramName]
    keyIdx++

    if (!dim) continue

    if (vec3Keys.has(paramName) && arg?.type === 'ArrayExpression') {
      for (const el of arg.elements ?? []) {
        if (el) checkDim(el, dim, ctx)
      }
    } else if (arg) {
      checkDim(arg, dim, ctx)
    }
  }
}

/**
 * P2-f4：装配语句摘要附加（cad.assembly / asmN.do_assemble / asmN.solve）。
 *
 * - `cad.assembly`（缺省命名空间，namespace===undefined）→ isAssembly + assembly 摘要。
 *   摘要只含 {name?, memberCount, constraintTypes}；约束全文不提取（宿主 args 通道
 *   保留，model-store.ts:973 继续从 structuralStmtArgs(stmt).constraints 取）。
 * - `asmN.do_assemble` / `asmN.solve`（receiver 调用）→ isAssembly（装配行为语句）。
 */
function attachAssemblySummary(summary: StatementSummary): void {
  if (summary.callee === 'assembly' && summary.namespace === undefined) {
    const members = summary.args.members
    const constraints = summary.args.constraints
    if (!Array.isArray(members) || !Array.isArray(constraints)) return
    const constraintTypes: string[] = []
    for (const c of constraints) {
      if (c && typeof c === 'object' && typeof (c as { type?: unknown }).type === 'string') {
        constraintTypes.push((c as { type: string }).type)
      }
    }
    const name = summary.args.name
    summary.isAssembly = true
    summary.assembly = {
      ...(typeof name === 'string' ? { name } : {}),
      memberCount: members.length,
      constraintTypes,
    }
    return
  }
  if ((summary.callee === 'do_assemble' || summary.callee === 'solve') && summary.receiver !== undefined) {
    summary.isAssembly = true
  }
}

/** 从解构调用构造 op 行（const { k1: v1, k2 } = <ns>.<op>(...)）。 */
function classifyDestructure(decl: ASTNode, line: number, vctx: ValueParseCtx): StatementSummary {
  const props = decl.id.properties
  if (props.length === 0) {
    throw new ParseError('destructuring must have at least one property', line, 'E_STATEMENT')
  }
  const keys: string[] = []
  const valueNames: string[] = []
  for (const prop of props) {
    if (prop.type !== 'Property' || prop.key?.type !== 'Identifier') {
      throw new ParseError('destructuring properties must be identifiers', line, 'E_STATEMENT')
    }
    if (prop.value?.type !== 'Identifier') {
      throw new ParseError(`destructuring value for "${prop.key.name}" must be an identifier`, line, 'E_STATEMENT')
    }
    keys.push(prop.key.name)
    valueNames.push(prop.value.name)
  }
  let init = decl.init
  if (init?.type === 'AwaitExpression') init = init.argument
  if (init?.type !== 'CallExpression') {
    throw new ParseError(`expected <ns>.<op>(...) or local function call in destructuring, got ${init?.type ?? 'null'}`, line, 'E_STATEMENT')
  }

  const calleeNode = init.callee
  let callee: string
  let namespace: string | undefined
  let local: boolean | undefined
  let receiver: string | undefined
  if (calleeNode?.type === 'MemberExpression' && calleeNode.object?.type === 'Identifier' && calleeNode.property?.type === 'Identifier') {
    const objName = calleeNode.object.name
    if (vctx.symbols.nsBindings.has(objName) || objName === vctx.symbols.defaultNsName) {
      namespace = objName === vctx.symbols.defaultNsName ? undefined : objName
      callee = calleeNode.property.name
    } else {
      receiver = objName
      callee = calleeNode.property.name
    }
  } else if (calleeNode?.type === 'Identifier') {
    local = true
    callee = calleeNode.name
  } else {
    throw new ParseError('destructuring is only allowed for <ns>.<op>(...) or local function calls', line, 'E_STATEMENT')
  }

  const positional = parsePositionalArgs(init.arguments ?? [], vctx, line)
  const summary = buildLineSummary({
    callee,
    line,
    ctx: vctx,
    positional,
    namespace,
    local,
    receiver,
    outputs: valueNames,
    outputKeys: keys,
    hasAssignment: true,
  })
  extractKeepEntries(positional, line, vctx.symbols)
  return summary
}

/** ExpressionStatement 分类（重赋值 / 本机副作用调用 / 成员方法 / 命名空间裸调用）。 */
function classifyExpression(
  expr: ASTNode,
  line: number,
  vctx: ValueParseCtx,
  lines: StatementSummary[],
): void {
  if (expr?.type === 'ImportExpression') {
    throw new ParseError('dynamic import() is not allowed in faijs (no control flow)', line, 'E_CONTROL_FLOW')
  }
  if (expr?.type === 'CallExpression' && expr.callee?.type === 'Identifier' && expr.callee.name === 'eval') {
    throw new ParseError('eval is not allowed in faijs', line, 'E_STATEMENT')
  }
  if (expr?.type === 'NewExpression') {
    throw new ParseError('"new" expressions are not allowed in faijs (new Function is a safety red line)', line, 'E_STATEMENT')
  }

  // 裸重赋值 part0 = [await] cad.op(...)
  if (expr?.type === 'AssignmentExpression' && expr.operator === '=' && expr.left?.type === 'Identifier') {
    const varName = expr.left.name
    if (!vctx.symbols.declared.has(varName)) {
      if (vctx.looseVars) {
        vctx.symbols.declared.add(varName)
      } else {
        throw new ParseError(`unknown variable "${varName}" in re-assignment`, line, 'E_REFERENCE')
      }
    }
    let init = expr.right
    if (init?.type === 'AwaitExpression') init = init.argument
    if (init?.type === 'CallExpression' && isOpCallCallee(init, vctx)) {
      const summary = classifyOpCall(init, line, vctx, { output: varName, hasAssignment: true })
      lines.push(summary)
      return
    }
    throw new ParseError('re-assignment must be a cad.op() call', line, 'E_STATEMENT')
  }

  // 成员方法 / 命名空间裸调用（无赋值）
  if (expr?.type === 'CallExpression' && expr.callee?.type === 'MemberExpression' &&
    expr.callee.object?.type === 'Identifier' && expr.callee.property?.type === 'Identifier') {
    const objName = expr.callee.object.name
    const isNs = vctx.symbols.nsBindings.has(objName) || objName === vctx.symbols.defaultNsName
    const isReceiver = vctx.symbols.declared.has(objName)
    if (isNs || isReceiver || vctx.looseVars) {
      const summary = classifyOpCall(expr, line, vctx, { hasAssignment: false })
      lines.push(summary)
      return
    }
    throw new ParseError(`unknown variable "${objName}" in .${expr.callee.property.name}() call`, line, 'E_REFERENCE')
  }

  // 本机函数副作用调用 myFn(part0, {...})
  if (expr?.type === 'CallExpression' && expr.callee?.type === 'Identifier') {
    const fnName = expr.callee.name
    if (vctx.symbols.localFnParams.has(fnName) || vctx.looseLocalCalls) {
      const summary = classifyOpCall(expr, line, vctx, { hasAssignment: false })
      lines.push(summary)
      return
    }
    throw new ParseError(`function "${fnName}" does not exist in this script`, line, 'E_REFERENCE')
  }

  throw new ParseError(
    `bare expression statements not allowed; use 'const part0 = cad.op(...)' instead`,
    line,
    'E_STATEMENT',
  )
}
