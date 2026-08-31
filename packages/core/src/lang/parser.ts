/**
 * parser — 文本 → ScriptIR（合法 JS 子集，设计文档 §2）
 *
 * 执行模型：`.faijs` 文本先用 acorn 解析（合法性证明 J-1），再 walk AST 还原为 ScriptIR。
 * 绝不 eval / new Function / import() 真执行。
 *
 * 支持的语法（合法 JS 子集）：
 * - `// apiVersion: N` — 版本声明（可选，默认 1）
 * - `export default async (cad) => { ... }` — 唯一合法容器
 * - `const <name> = <literal>` → ParamDef（参数声明，右侧仅字面量）
 * - `const part<N>_v<M> = [await] cad.<op>(<inputVar>?, { ...args })` → StatementIR
 * - `cad.union/subtract/intersect(inputVar, inputVar)` → boolean op
 * - `cad.faceCenter(var)` / `cad.faceNormal(var)` / `cad.bboxCenter(var)` / ... → GeomRef
 * - `return { shape: part<N>_v<M>, name, color, metalness, roughness }` → ScriptIR.meta
 *
 * 禁止（acorn 抛错或 AST walk 拒绝即 ParseError）：
 * - `param` / `with` 关键字、对象字面量用 `=`
 * - 循环 / 条件 / IIFE / try-catch / 模板字符串
 * - 多 default export、函数定义（除顶层箭头外）
 * - eval / new Function / 动态 import()
 */

import { parse as acornParse } from 'acorn'
import type {
  ArgIR,
  StatementIR,
  JsonValue,
  ParamDef,
  ParamRefIR,
  ScriptIR,
  ScriptMetaIR,
  TerminalShape,
  ImportIR,
  FunctionDefIR,
} from './types'
import { isParamRef, isVarRef, isCallRef } from './types'
import {
  asStmtId,
  asPartName,
  type PartName,
} from '../identity'

// ── 解析错误 ──

/**
 * 解析诊断码（F1：黑名单化后拒绝清单收敛，控制流给专用码）。
 * 宿主（CadRuntime.check）把 code 透传给 CheckError，AI 可据此精确修正。
 */
export type ParseErrorCode =
  /** 语法错误（acorn 闸门） */
  | 'E_SYNTAX'
  /** 控制流语句（if/for/while/do/switch/try/throw/break/continue/labeled/with + 动态 import()） */
  | 'E_CONTROL_FLOW'
  /** 不支持的语句形态（函数/类/export/new/eval 等） */
  | 'E_STATEMENT'
  /** 参数值表达式不合法（无法静态折叠 / 不支持的表达式节点） */
  | 'E_VALUE'
  /** import 声明位置/形态违规（F2） */
  | 'E_IMPORT'
  /** 引用错误（未知变量 / 未声明 receiver） */
  | 'E_REFERENCE'

/**
 * An error raised while parsing faijs source, carrying the offending line
 * number and a diagnostic code the host can forward for precise feedback.
 */
export class ParseError extends Error {
  /** The 1-based source line at which the parse error occurred. */
  line: number
  /** 诊断码（缺省 E_SYNTAX）。宿主 check() 透传；3d_editor 可据此给 AI 精确反馈。 */
  code: ParseErrorCode

  constructor(message: string, line: number, code: ParseErrorCode = 'E_SYNTAX') {
    super(`[parser] line ${line}: ${message}`)
    this.name = 'ParseError'
    this.line = line
    this.code = code
  }
}

// ── AST 辅助类型（acorn ESTree 兼容） ──

type ASTNode = any

function getLine(node: ASTNode): number {
  return node?.loc?.start?.line ?? 0
}

// ── AST 辅助常量 ──
// (none: the parser holds zero function-name knowledge — A1/A7 constants removed)

// ── AST 值解析 ──

// ── 常量表达式折叠（F1：编译期求值，normal-js-subset O1） ──
//
// 无控制流 → 参数（const x = <literal>）的值在 parse 期已知。
// Binary/Unary/Template/Conditional/Spread 全部按当前参数值静态折叠为字面量
// （IR 零改动，不发明运行时求值机制）；引用语句变量（shape）的表达式
// 无法静态求值 → parse 期明确报错 E_VALUE。

interface FoldOk {
  ok: true
  value: JsonValue
  /** 折叠结果是否引用了已声明的参数（决定 hasComputedArgs，F1-E1）。 */
  usedParam: boolean
}
interface FoldFail {
  ok: false
}
type FoldResult = FoldOk | FoldFail

/** 数值折叠：非有限值（NaN/Infinity）不是 JSON 安全字面量 → 不可折叠。 */
function numFold(v: number, usedParam = false): FoldResult {
  return Number.isFinite(v) ? { ok: true, value: v, usedParam } : { ok: false }
}

function numBin(a: JsonValue, b: JsonValue, op: (x: number, y: number) => number, usedParam = false): FoldResult {
  return typeof a === 'number' && typeof b === 'number' ? numFold(op(a, b), usedParam) : { ok: false }
}

function cmpBin(a: JsonValue, b: JsonValue, op: (x: number | string, y: number | string) => boolean, usedParam = false): FoldResult {
  if (typeof a === 'number' && typeof b === 'number') return { ok: true, value: op(a, b), usedParam }
  if (typeof a === 'string' && typeof b === 'string') return { ok: true, value: op(a, b), usedParam }
  return { ok: false }
}

/** JS `==` 的 JSON 值域近似（null/boolean/number/string，无对象）。 */
function looseEq(a: JsonValue, b: JsonValue): boolean {
  let x: JsonValue = a
  let y: JsonValue = b
  if (typeof x === 'boolean') x = x ? 1 : 0
  if (typeof y === 'boolean') y = y ? 1 : 0
  if (typeof x === 'number' && typeof y === 'string') return x === Number(y)
  if (typeof x === 'string' && typeof y === 'number') return Number(x) === y
  if (x === null || y === null) return x === null && y === null
  return x === y
}

/**
 * 静态折叠求值：仅接受可由「字面量 + 参数值」算出的表达式。
 * 引用语句变量 / 嵌套调用 / 成员访问 → 不可折叠（返回 ok:false，调用方报 E_VALUE）。
 */
function tryFoldConstExpr(
  node: ASTNode,
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
): FoldResult {
  switch (node.type) {
    case 'Literal':
      return { ok: true, value: node.value, usedParam: false }

    case 'Identifier': {
      if (!paramNames.has(node.name)) return { ok: false }
      const v = paramValues.get(node.name)
      return v === undefined ? { ok: false } : { ok: true, value: v, usedParam: true }
    }

    case 'UnaryExpression': {
      const operand = tryFoldConstExpr(node.argument, paramNames, paramValues)
      if (!operand.ok) return { ok: false }
      const v = operand.value
      switch (node.operator) {
        case '-': return typeof v === 'number' ? numFold(-v, operand.usedParam) : { ok: false }
        case '+': return typeof v === 'number' ? numFold(+v, operand.usedParam) : { ok: false }
        case '!': return { ok: true, value: !v, usedParam: operand.usedParam }
        case '~': return typeof v === 'number' ? { ok: true, value: ~v, usedParam: operand.usedParam } : { ok: false }
        case 'typeof': return { ok: true, value: typeof v, usedParam: operand.usedParam }
        default: return { ok: false }
      }
    }

    case 'BinaryExpression': {
      const left = tryFoldConstExpr(node.left, paramNames, paramValues)
      if (!left.ok) return { ok: false }
      const right = tryFoldConstExpr(node.right, paramNames, paramValues)
      if (!right.ok) return { ok: false }
      const a = left.value
      const b = right.value
      const usedParam = left.usedParam || right.usedParam
      switch (node.operator) {
        case '+': {
          if (typeof a === 'number' && typeof b === 'number') return numFold(a + b, usedParam)
          if (typeof a === 'string' || typeof b === 'string') return { ok: true, value: String(a) + String(b), usedParam }
          return { ok: false }
        }
        case '-': return numBin(a, b, (x, y) => x - y, usedParam)
        case '*': return numBin(a, b, (x, y) => x * y, usedParam)
        case '/': return numBin(a, b, (x, y) => x / y, usedParam)
        case '%': return numBin(a, b, (x, y) => x % y, usedParam)
        case '**': return numBin(a, b, (x, y) => x ** y, usedParam)
        case '<': return cmpBin(a, b, (x, y) => x < y, usedParam)
        case '<=': return cmpBin(a, b, (x, y) => x <= y, usedParam)
        case '>': return cmpBin(a, b, (x, y) => x > y, usedParam)
        case '>=': return cmpBin(a, b, (x, y) => x >= y, usedParam)
        case '==': return { ok: true, value: looseEq(a, b), usedParam }
        case '!=': return { ok: true, value: !looseEq(a, b), usedParam }
        case '===': return { ok: true, value: a === b, usedParam }
        case '!==': return { ok: true, value: a !== b, usedParam }
        default: return { ok: false }
      }
    }

    // acorn 把 && / || / ?? 解析为 LogicalExpression（ESTree 规范）
    case 'LogicalExpression': {
      const left = tryFoldConstExpr(node.left, paramNames, paramValues)
      if (!left.ok) return { ok: false }
      const right = tryFoldConstExpr(node.right, paramNames, paramValues)
      if (!right.ok) return { ok: false }
      const a = left.value
      const usedParam = left.usedParam || right.usedParam
      switch (node.operator) {
        case '&&': return { ok: true, value: a ? right.value : left.value, usedParam }
        case '||': return { ok: true, value: a ? left.value : right.value, usedParam }
        case '??': return { ok: true, value: a === null ? right.value : left.value, usedParam }
        default: return { ok: false }
      }
    }

    case 'TemplateLiteral': {
      const parts: string[] = []
      const quasis = node.quasis as ASTNode[]
      const exprs = node.expressions as ASTNode[]
      let usedParam = false
      for (let i = 0; i < quasis.length; i++) {
        const cooked = quasis[i].value?.cooked
        parts.push(cooked ?? '')
        if (i < exprs.length) {
          const r = tryFoldConstExpr(exprs[i], paramNames, paramValues)
          if (!r.ok) return { ok: false }
          usedParam = usedParam || r.usedParam
          parts.push(String(r.value))
        }
      }
      return { ok: true, value: parts.join(''), usedParam }
    }

    case 'ConditionalExpression': {
      const test = tryFoldConstExpr(node.test, paramNames, paramValues)
      if (!test.ok) return { ok: false }
      const chosen = tryFoldConstExpr(test.value ? node.consequent : node.alternate, paramNames, paramValues)
      if (!chosen.ok) return { ok: false }
      return { ok: true, value: chosen.value, usedParam: test.usedParam || chosen.usedParam }
    }

    default:
      return { ok: false }
  }
}

/** 折叠过程标记：某参数值被计算表达式产生（宿主据此降级编辑面板）。 */
interface ValueFlags {
  computed: boolean
}

/** 解析字面量 / 数组 / 对象 / ParamRefIR / GeomRef（F1：支持可静态折叠的表达式） */
function parseValueExpr(
  node: ASTNode,
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
  varToId: Map<string, PartName>,
  nsNames: ReadonlySet<string>,
  line: number,
  flags?: ValueFlags | null,
  looseVars = false,
): ArgIR {
  if (!node) throw new ParseError('missing value expression', line, 'E_VALUE')

  switch (node.type) {
    case 'Literal':
      return node.value

    case 'Identifier': {
      // 裸标识符：参数变量 → ParamRefIR；已声明变量 → VarRefIR（A7 消灭后通用）
      const name = node.name
      if (paramNames.has(name)) {
        const ref: ParamRefIR = { $param: name }
        return ref
      }
      const varId = varToId.get(name)
      if (varId) {
        return { $ref: varId } as ArgIR
      }
      // Loose mode (append passes only the newest statements): an external
      // variable passes through as its physical PartName; the caller validates
      // it against the persistent ctx (AppendPrefixError when missing).
      if (looseVars) {
        const external = asPartName(name)
        varToId.set(name, external)
        return { $ref: external } as ArgIR
      }
      throw new ParseError(`unknown identifier "${name}" in args value (not a declared param or variable)`, line, 'E_REFERENCE')
    }

    case 'ArrayExpression': {
      const out: ArgIR[] = []
      for (const el of node.elements) {
        if (el === null || el === undefined) {
          throw new ParseError('array holes are not supported in args', line, 'E_VALUE')
        }
        if (el.type === 'SpreadElement') {
          // [...parts]：parts 须为可折叠的数组参数/字面量
          const r = tryFoldConstExpr(el.argument, paramNames, paramValues)
          if (!r.ok || !Array.isArray(r.value)) {
            throw new ParseError('cannot statically evaluate spread in args (must reference an array param or literal)', line, 'E_VALUE')
          }
          if (flags) flags.computed = true
          out.push(...(r.value as ArgIR[]))
        } else {
          out.push(parseValueExpr(el, paramNames, paramValues, varToId, nsNames, line, flags, looseVars))
        }
      }
      return out as ArgIR
    }

    case 'ObjectExpression': {
      const obj: Record<string, ArgIR> = {}
      for (const prop of node.properties) {
        if (prop.type === 'SpreadElement') {
          // {...opts}：opts 须为可折叠的对象参数/字面量
          const r = tryFoldConstExpr(prop.argument, paramNames, paramValues)
          if (!r.ok || typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) {
            throw new ParseError('cannot statically evaluate object spread in args', line, 'E_VALUE')
          }
          if (flags) flags.computed = true
          Object.assign(obj, r.value)
          continue
        }
        // shorthand property: { size } → { size: size }
        const key = prop.key.type === 'Identifier' ? prop.key.name
          : prop.key.type === 'Literal' ? String(prop.key.value)
          : null
        if (key === null) {
          throw new ParseError(`invalid object key`, line, 'E_VALUE')
        }
        // shorthand: { size } → value is the same identifier
        if (prop.shorthand) {
          if (paramNames.has(key)) {
            obj[key] = { $param: key } as ParamRefIR
          } else {
            throw new ParseError(`unknown shorthand identifier "${key}" (not a declared param)`, line, 'E_REFERENCE')
          }
        } else {
          obj[key] = parseValueExpr(prop.value, paramNames, paramValues, varToId, nsNames, line, flags, looseVars)
        }
      }
      return obj as ArgIR
    }

    case 'CallExpression': {
      // 嵌套调用 → CallRefIR（A7 消灭后任意 <ns>.<ident>(...) 都合法；F2 放开命名空间）
      const callee = node.callee
      if (
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'Identifier' &&
        nsNames.has(callee.object.name) &&
        callee.property?.type === 'Identifier'
      ) {
        const nsName = callee.object.name
        const innerCallee = callee.property.name
        const innerArgs = node.arguments.map((a: ASTNode) => parseValueExpr(a, paramNames, paramValues, varToId, nsNames, line, flags, looseVars))
        return {
          $call: {
            callee: innerCallee,
            args: innerArgs,
            ...(nsName !== 'cad' ? { namespace: nsName } : {}),
          },
        } as ArgIR
      }
      throw new ParseError('nested calls in args must be <ns>.<ident>(...)', line, 'E_VALUE')
    }

    // F1 扩展：可静态折叠的表达式（无控制流 → 参数值已知，编译期求值）
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'TemplateLiteral':
    case 'ConditionalExpression': {
      const r = tryFoldConstExpr(node, paramNames, paramValues)
      if (!r.ok) {
        throw new ParseError(
          `cannot statically evaluate ${node.type} in args (must reference declared params or literals)`,
          line,
          'E_VALUE',
        )
      }
      // F1-E1：仅当折叠表达式引用了已声明的参数才标 computed。
      // 纯字面量（含负数字面量，acorn 用 UnaryExpression 表示 -10）不标 computed，
      // 避免宿主把普通字面量参数误判为「计算参数」而降级为只读（时间线无法回填编辑）。
      if (flags && r.usedParam) flags.computed = true
      return r.value
    }

    default:
      throw new ParseError(`unsupported value expression: ${node.type}`, line, 'E_VALUE')
  }
}

// ── StatementIR 解析 ──

interface ParsedStatement {
  stmt: StatementIR
  varName: string
  /** 词法声明的输出名（parser 收集，最终遍历经 varToId 解析为物理 partName 后写入 stmt.outputs） */
  declaredOutputs: string[]
}

/**
 * 解析一条 `const varName = [await] <ns>.<op>(...)` 语句。
 */
function parseCadStatement(
  declNode: ASTNode,
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
  varToId: Map<string, PartName>,
  nsNames: ReadonlySet<string>,
  looseVars = false,
): ParsedStatement {
  const line = getLine(declNode)

  // 提取变量名
  if (declNode.id?.type !== 'Identifier') {
    throw new ParseError('expected identifier on left side of const declaration', line, 'E_STATEMENT')
  }
  const varName = declNode.id.name

  // 提取 init（可能包在 AwaitExpression 里）
  let init = declNode.init
  if (init?.type === 'AwaitExpression') {
    init = init.argument
  }

  // init 必须是 CallExpression
  if (init?.type !== 'CallExpression') {
    throw new ParseError(`expected <ns>.<op>(...) call, got ${init?.type ?? 'null'}`, line, 'E_STATEMENT')
  }

  // callee 必须是 MemberExpression: <ns>.<op>（cad 或顶层 import 绑定名，F2 消灭硬编码）
  const callee = init.callee
  if (
    callee?.type !== 'MemberExpression' ||
    callee.object?.type !== 'Identifier' ||
    !nsNames.has(callee.object.name) ||
    callee.property?.type !== 'Identifier'
  ) {
    throw new ParseError('expected <ns>.<op>(...) call', line, 'E_STATEMENT')
  }

  const nsName = callee.object.name
  const opName = callee.property.name

  // 普通调用：callee 就是源码里的名字（A1 boolean 改写 / A4 load 收敛已删）
  let args: Record<string, ArgIR> = {}
  const inputs: PartName[] = []
  const flags: ValueFlags = { computed: false }
  for (const argNode of init.arguments) {
    if (argNode.type === 'Identifier') {
      // input 变量引用
      let inputId = varToId.get(argNode.name)
      if (!inputId) {
        // Loose mode: external variable passes through as its physical PartName
        // (the append prefix is validated by the caller against the persistent ctx).
        if (looseVars) {
          inputId = asPartName(argNode.name)
          varToId.set(argNode.name, inputId)
        } else {
          throw new ParseError(`unknown variable "${argNode.name}" in inputs`, getLine(argNode), 'E_REFERENCE')
        }
      }
      inputs.push(inputId)
    } else if (argNode.type === 'ObjectExpression') {
      // args 对象
      const parsed = parseValueExpr(argNode, paramNames, paramValues, varToId, nsNames, line, flags, looseVars)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        args = parsed as Record<string, ArgIR>
      } else {
        throw new ParseError('args must be an object', line, 'E_VALUE')
      }
    } else {
      throw new ParseError(`unexpected argument type: ${argNode.type}`, getLine(argNode), 'E_VALUE')
    }
  }

  // Phase 3：id 不再赋变量名，由最终遍历赋 sN；变量名记录到 declaredOutputs
  const stmt: StatementIR = {
    id: asStmtId('__pending__'), callee: opName, args, inputs,
    outputs: [],
    hasAssignment: true,
    ...(nsName !== 'cad' ? { namespace: nsName } : {}),
    ...(flags.computed ? { hasComputedArgs: true } : {}),
  }

  return { stmt, varName, declaredOutputs: [varName] }
}

// ── 通用解构解析（A2 消灭：任意 callee、任意键） ──

interface ParsedDestructuring {
  /** 语句列表（解构调用本身） */
  stmt: StatementIR
  /** 每个解构值的词法变量名（与 keys 一一对应） */
  valueNames: string[]
  /** 词法声明的输出名 */
  declaredOutputs: string[]
}

/**
 * 解析 `const { k1: v1, k2: v2 } = [await] <ns>.<any>(...)`。
 *
 * 任意键数（1..N）、任意 callee（不再限 split/front/back）。
 */
function parseDestructuring(
  declNode: ASTNode,
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
  varToId: Map<string, PartName>,
  nsNames: ReadonlySet<string>,
  looseVars = false,
): ParsedDestructuring {
  const line = getLine(declNode)

  // id 必须是 ObjectPattern
  if (declNode.id?.type !== 'ObjectPattern') {
    throw new ParseError('expected object pattern for destructuring', line, 'E_STATEMENT')
  }

  const props = declNode.id.properties
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

  // 提取 init（可包 AwaitExpression），必须是 <ns>.<ident>(...) 调用
  let init = declNode.init
  if (init?.type === 'AwaitExpression') {
    init = init.argument
  }
  if (init?.type !== 'CallExpression') {
    throw new ParseError(`expected <ns>.<op>(...) call in destructuring, got ${init?.type ?? 'null'}`, line, 'E_STATEMENT')
  }

  const callee = init.callee
  if (
    callee?.type !== 'MemberExpression' ||
    callee.object?.type !== 'Identifier' ||
    !nsNames.has(callee.object.name) ||
    callee.property?.type !== 'Identifier'
  ) {
    throw new ParseError('destructuring is only allowed for <ns>.<op>(...) calls', line, 'E_STATEMENT')
  }

  const nsName = callee.object.name
  const opName = callee.property.name
  const args: Record<string, ArgIR> = {}
  const inputs: PartName[] = []
  const flags: ValueFlags = { computed: false }

  for (const argNode of init.arguments) {
    if (argNode.type === 'Identifier') {
      let inputId = varToId.get(argNode.name)
      if (!inputId) {
        // Loose mode: external variable passes through as its physical PartName
        // (the append prefix is validated by the caller against the persistent ctx).
        if (looseVars) {
          inputId = asPartName(argNode.name)
          varToId.set(argNode.name, inputId)
        } else {
          throw new ParseError(`unknown variable "${argNode.name}" in destructuring inputs`, getLine(argNode), 'E_REFERENCE')
        }
      }
      inputs.push(inputId)
    } else if (argNode.type === 'ObjectExpression') {
      const parsed = parseValueExpr(argNode, paramNames, paramValues, varToId, nsNames, line, flags, looseVars)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(args, parsed as Record<string, ArgIR>)
      } else {
        throw new ParseError('destructuring args must be an object', line, 'E_VALUE')
      }
    } else {
      throw new ParseError(`unexpected argument type in destructuring: ${argNode.type}`, getLine(argNode), 'E_VALUE')
    }
  }

  // Phase 3：id 不再赋变量名；outputs 在最终遍历经 varToId 解析后写入
  const stmt: StatementIR = {
    id: asStmtId('__pending__'), callee: opName, args, inputs, outputs: [],
    outputKeys: keys,
    hasAssignment: true,
    ...(nsName !== 'cad' ? { namespace: nsName } : {}),
    ...(flags.computed ? { hasComputedArgs: true } : {}),
  }

  return { stmt, valueNames, declaredOutputs: valueNames }
}

// ── meta 解析 ──

/**
 * 解析 return 语句，提取 terminal shape(s) 和 meta。
 *
 * 支持三种形式：
 * - `return part0`（裸标识符）→ 单终端，无 meta
 * - `return { shape: part0, name, color, ... }`（单终端 + meta）
 * - `return [ { shape: part1, name, ... }, { shape: part2, name, ... } ]`（多终端）
 */
function parseReturnStatement(
  node: ASTNode,
  varToId: Map<string, PartName>,
): { terminalShapeId: PartName | null; meta: ScriptMetaIR | undefined; terminalShapes: TerminalShape[] | undefined } {
  const line = getLine(node)
  const arg = node.argument

  if (!arg) {
    return { terminalShapeId: null, meta: undefined, terminalShapes: undefined }
  }

  // return part0（裸标识符）
  if (arg.type === 'Identifier') {
    const ref = varToId.get(arg.name)
    if (!ref) {
      throw new ParseError(`unknown variable "${arg.name}" in return`, line)
    }
    return { terminalShapeId: ref, meta: undefined, terminalShapes: undefined }
  }

  // return { shape: part0, name, color, ... }
  if (arg.type === 'ObjectExpression') {
    const result = parseReturnObject(arg, varToId, line)
    return { terminalShapeId: result.id, meta: result.meta, terminalShapes: undefined }
  }

  // return [ { shape: ... }, ... ]（多终端）
  if (arg.type === 'ArrayExpression') {
    const terminalShapes: TerminalShape[] = []
    for (const elem of arg.elements) {
      if (elem?.type !== 'ObjectExpression') {
        throw new ParseError('return array elements must be objects { shape, ... }', line)
      }
      const result = parseReturnObject(elem, varToId, line)
      if (result.id) {
        terminalShapes.push({ id: result.id, meta: result.meta })
      }
    }
    if (terminalShapes.length === 0) {
      throw new ParseError('return array must have at least one element', line)
    }
    // 单元素数组等价为单终端
    if (terminalShapes.length === 1) {
      return { terminalShapeId: terminalShapes[0].id, meta: terminalShapes[0].meta, terminalShapes: undefined }
    }
    return { terminalShapeId: null, meta: undefined, terminalShapes }
  }

  throw new ParseError(`unsupported return expression: ${arg.type}`, line)
}

/** 解析单个 return 元素 { shape: varName, name?, color?, metalness?, roughness? } */
function parseReturnObject(
  objNode: ASTNode,
  varToId: Map<string, PartName>,
  line: number,
): { id: PartName | null; meta: ScriptMetaIR | undefined } {
  let id: PartName | null = null
  const meta: ScriptMetaIR = {}

  for (const prop of objNode.properties) {
    const key = prop.key?.type === 'Identifier' ? prop.key.name
      : prop.key?.type === 'Literal' ? String(prop.key.value)
      : null
    if (!key) continue

    if (key === 'shape') {
      if (prop.value?.type === 'Identifier') {
        const ref = varToId.get(prop.value.name)
        if (!ref) {
          throw new ParseError(`unknown variable "${prop.value.name}" in return shape`, line)
        }
        id = ref
      }
    } else if (key === 'name') {
      if (prop.value?.type === 'Literal') {
        meta.name = prop.value.value as string
      }
    } else if (key === 'color') {
      if (prop.value?.type === 'Literal') {
        if (!meta.appearance) meta.appearance = {}
        meta.appearance.color = prop.value.value as string
      }
    } else if (key === 'metalness') {
      if (prop.value?.type === 'Literal') {
        if (!meta.appearance) meta.appearance = {}
        meta.appearance.metalness = prop.value.value as number
      }
    } else if (key === 'roughness') {
      if (prop.value?.type === 'Literal') {
        if (!meta.appearance) meta.appearance = {}
        meta.appearance.roughness = prop.value.value as number
      }
    }
  }

  return { id, meta: Object.keys(meta).length > 0 ? meta : undefined }
}

// ── 引用收集（Phase 1: VM 执行 deps 计算） ──

/** 递归收集 ArgIR 中的变量引用：$param → 参数名；$ref → 变量名；$call → 递归收集内部 args。 */
function collectRefsFromArg(value: ArgIR, out: Set<string>): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return
  if (isParamRef(value)) {
    out.add(value.$param)
    return
  }
  if (isVarRef(value)) {
    out.add(value.$ref)
    return
  }
  if (isCallRef(value)) {
    for (const a of value.$call.args) collectRefsFromArg(a, out)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefsFromArg(v as ArgIR, out)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectRefsFromArg(v as ArgIR, out)
  }
}

/**
 * 收集单条语句引用的全部变量名（inputs + args 中 $param / $ref / 嵌套调用 + receiver）。
 * 存入 stmt.refs，编译期据此翻译为 deps（定义这些变量的语句 id）。
 */
function collectStatementRefs(stmt: StatementIR): string[] {
  const refs = new Set<string>(stmt.inputs)
  for (const arg of Object.values(stmt.args)) {
    collectRefsFromArg(arg, refs)
  }
  // receiver：成员方法调用（add_constraint/do_assemble 等）依赖其 receiver 变量，
  // 不加入则成员调用对 compound 的依赖边缺失（连带 bug，见命名分层修复文档 §2.4）。
  if (stmt.receiver) refs.add(stmt.receiver)
  return [...refs]
}

// ── 语句黑名单（F1：白名单 → 黑名单） ──

/** 控制流语句（faijs 唯一禁令，V1.5 专用错误码）。 */
const CONTROL_FLOW_TYPES = new Set([
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement',
  'ThrowStatement', 'BreakStatement', 'ContinueStatement', 'LabeledStatement',
  'WithStatement',
])

/** 文本仅含注释与空白（import 头部连续段约束用）。 */
function onlyWhitespaceAndComments(text: string): boolean {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim() === ''
}

/** 文本行数（空文本 = 0；含 n 个换行的文本 = n+1 行）。 */
function countLines(text: string): number {
  if (text === '') return 0
  return (text.match(/\n/g) ?? []).length + 1
}

/** 由 specifier 推导包名：@scope/pkg/sub → @scope/pkg；mech-lib → mech-lib。 */
function derivePackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  return specifier.split('/')[0]
}

/** ImportDeclaration → ImportIR（F2）。 */
function importDeclToIR(decl: ASTNode, line: number): ImportIR {
  const specifier = decl.source?.value
  if (typeof specifier !== 'string' || specifier === '') {
    throw new ParseError('import must have a string specifier', line, 'E_IMPORT')
  }
  const packageName = derivePackageName(specifier)
  const specifiers = decl.specifiers ?? []
  if (specifiers.length === 0) {
    throw new ParseError('side-effect imports are not supported (use import * as ns from "pkg")', line, 'E_IMPORT')
  }
  const first = specifiers[0]
  if (first.type === 'ImportNamespaceSpecifier') {
    const localName = first.local?.name
    if (typeof localName !== 'string') throw new ParseError('invalid namespace import binding', line, 'E_IMPORT')
    return { specifier, kind: 'namespace', localName, packageName }
  }
  if (first.type === 'ImportDefaultSpecifier') {
    const localName = first.local?.name
    if (typeof localName !== 'string') throw new ParseError('invalid default import binding', line, 'E_IMPORT')
    return { specifier, kind: 'default', localName, packageName }
  }
  // ImportSpecifier（named）
  const bindings: string[] = (specifiers as ASTNode[]).map((s) => s.local?.name as string)
  if (bindings.some((b) => typeof b !== 'string')) {
    throw new ParseError('invalid named import bindings', line, 'E_IMPORT')
  }
  return { specifier, kind: 'named', localName: bindings[0], bindings, packageName }
}

/**
 * 默认分支：黑名单式拒绝（normal-js-subset P1）。
 * 除控制流（专用 E_CONTROL_FLOW 码）与安全红线（eval/new/export）外，
 * 未识别的语句形态一律 E_STATEMENT。
 */
function throwUnsupportedStatement(node: ASTNode, line: number): never {
  if (CONTROL_FLOW_TYPES.has(node.type)) {
    throw new ParseError(
      `control flow statement "${node.type}" is not allowed in faijs`,
      line,
      'E_CONTROL_FLOW',
    )
  }
  if (node.type === 'ImportDeclaration') {
    throw new ParseError('import statements must be at the top level, before any statements', line, 'E_IMPORT')
  }
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
    throw new ParseError('export statements are not allowed (faijs auto-exports the default module)', line, 'E_STATEMENT')
  }
  if (node.type === 'ClassDeclaration') {
    throw new ParseError('class declarations are not allowed in faijs', line, 'E_STATEMENT')
  }
  if (node.type === 'NewExpression') {
    throw new ParseError('"new" expressions are not allowed in faijs (new Function is a safety red line)', line, 'E_STATEMENT')
  }
  throw new ParseError(`unsupported statement: ${node.type}`, line, 'E_STATEMENT')
}

// ── 顶层函数定义（A1） ──

/**
 * 解析顶层 `function name(params) { ... }` 为 FunctionDefIR（A1）。
 *
 * 函数定义**不是几何语句**：不进 statements、不参与 DAG 终端判定；
 * 函数体原文按 acorn 坐标从 parseCode 切片保留，codegen 原样打印回文件（往返保真）。
 *
 * 函数体同样受黑名单约束（与顶层一致）：
 * - 控制流 → E_CONTROL_FLOW；
 * - eval / new / export / class → E_STATEMENT；
 * - import 只允许在文件头 → E_IMPORT。
 */
function parseFunctionDeclaration(
  node: ASTNode,
  line: number,
  functions: FunctionDefIR[],
  parseCode: string,
): void {
  const name = node.id?.name
  if (typeof name !== 'string' || name === '') {
    throw new ParseError('function declaration must have a name', line, 'E_STATEMENT')
  }

  // 形参：只允许简单 Identifier（解构/默认值/rest 参数不在子集内）
  const params: string[] = []
  for (const p of node.params ?? []) {
    if (p?.type !== 'Identifier') {
      throw new ParseError('function params must be plain identifiers', line, 'E_STATEMENT')
    }
    params.push(p.name)
  }

  // 函数体必须是 BlockStatement（acorn 对合法函数声明必然如此，防御性校验）
  if (node.body?.type !== 'BlockStatement') {
    throw new ParseError('function body must be a block statement', line, 'E_STATEMENT')
  }

  // 函数体黑名单校验（与顶层同语义）
  validateFunctionBody(node.body, line)

  // 函数体原文（花括号内的完整文本，含换行/缩进）——坐标相对 parseCode
  const body = parseCode.slice(node.body.start + 1, node.body.end - 1)
  functions.push({ name, params, body })
}

/**
 * 校验函数体内的黑名单（A1）：控制流 / eval / new / export / class / import。
 * 递归遍历全部节点——函数体（含嵌套函数体）必须保持无控制流的合法子集。
 */
function validateFunctionBody(body: ASTNode, line: number): void {
  const stack: ASTNode[] = [body]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (CONTROL_FLOW_TYPES.has(n.type)) {
      throw new ParseError(
        `control flow statement "${n.type}" is not allowed inside function bodies`,
        line,
        'E_CONTROL_FLOW',
      )
    }
    if (n.type === 'ImportDeclaration') {
      throw new ParseError('import statements are not allowed inside function bodies', line, 'E_IMPORT')
    }
    if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') {
      throw new ParseError('export statements are not allowed in faijs (faijs auto-exports the default module)', line, 'E_STATEMENT')
    }
    if (n.type === 'ClassDeclaration') {
      throw new ParseError('class declarations are not allowed in faijs', line, 'E_STATEMENT')
    }
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'eval') {
      throw new ParseError('eval is not allowed in faijs', line, 'E_STATEMENT')
    }
    if (n.type === 'NewExpression') {
      throw new ParseError('"new" expressions are not allowed in faijs (new Function is a safety red line)', line, 'E_STATEMENT')
    }
    // 子节点入栈（跳过元数据字段）
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'parent') continue
      const v = n[key]
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && typeof item.type === 'string') stack.push(item)
        }
      } else if (v && typeof v === 'object' && typeof v.type === 'string') {
        stack.push(v)
      }
    }
  }
}

// ── 主解析函数 ──

/**
 * The result of parsing a faijs source text: the ScriptIR plus supporting
 * line and variable mappings.
 */
export interface ParseResult {
  script: ScriptIR
  /** 语句 id → 变量名映射（新格式下为恒等映射） */
  varToId: Map<string, string>
  /** 每条语句在源码中的行号（1-based，与 script.statements 一一对应；analyzeCode 用） */
  statementLines: number[]
}

/**
 * 解析合法 JS 子集文本为 ScriptIR。
 *
 * 步骤：
 * 1. acorn.parse — 合法性闸门（J-1），抛 SyntaxError 即文本非法
 * 2. AST walk — 只接受允许的节点形状，遇违规即 ParseError
 * 3. 构建 ScriptIR
 *
 * 零函数知识：parser 不接收任何 schemas/函数元数据（A5/A14 已删），
 * 对 callee 名字完全均匀处理。
 *
 * @param code - the faijs valid-JS-subset source text to parse.
 * @returns the parsed ScriptIR plus line and variable mappings.
 * @throws ParseError — 含行号
 */
export interface ParseScriptOptions {
  /**
   * Loose variable resolution for partial code text (CadRuntime.append receives
   * only the newest statements). Unknown references resolve to their physical
   * PartName instead of throwing; the caller validates them against the
   * persistent ctx (AppendPrefixError when missing).
   */
  looseVars?: boolean
}

/**
 * Parse CAD script code text into a ScriptIR.
 *
 * @param code    - the script text to parse.
 * @param options - optional parse options (looseVars enables loose variable
 *                  resolution for partial append text).
 * @returns the parse result (script IR + parse diagnostics).
 */
export function parseScript(code: string, options?: ParseScriptOptions): ParseResult {
  const looseVars = options?.looseVars === true

  // ── 0. 顶层 import/export 预扫描（F1 黑名单化 + F2 import 提升） ──
  // 用 module 模式解析原始文本：
  // - 顶层 export（非默认导出容器）→ 明确 E_STATEMENT（扁平包装会先被 acorn 以
  //   SyntaxError 拒绝：'import' and 'export' may appear only at top level）。
  // - 顶层 import → 收集声明，校验「文件头部连续段」约束（F2），供扁平代码包装提升。
  let importBlock: { start: number; end: number } | null = null
  const prescanImports: ASTNode[] = []
  {
    const topLevel: ASTNode[] = []
    try {
      topLevel.push(...acornParse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true }).body)
    } catch {
      // 原始文本非合法 module（如含 return）→ 交给主解析报错
    }
    for (const n of topLevel) {
      if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') {
        throw new ParseError(
          `export statements are not allowed (faijs auto-exports the default module)`,
          getLine(n) ?? 1,
          'E_STATEMENT',
        )
      }
      if (n.type === 'ImportDeclaration') prescanImports.push(n)
    }
    if (prescanImports.length > 0) {
      const first = prescanImports[0]
      const last = prescanImports[prescanImports.length - 1]
      // 约束 1：import 之前只能有注释/空白（头部连续段）
      if (!onlyWhitespaceAndComments(code.slice(0, first.start))) {
        throw new ParseError('import statements must appear as a contiguous block at the top of the file', getLine(first) ?? 1, 'E_IMPORT')
      }
      // 约束 2：import 之间只能有注释/空白
      for (let i = 1; i < prescanImports.length; i++) {
        const gap = code.slice(prescanImports[i - 1].end, prescanImports[i].start)
        if (!onlyWhitespaceAndComments(gap)) {
          throw new ParseError('import statements must be contiguous (no statements between imports)', getLine(prescanImports[i]) ?? 1, 'E_IMPORT')
        }
      }
      importBlock = { start: first.start, end: last.end }
    }
  }

  // ── 0.5 扁平代码检测与封装 ──
  // 如果代码不含 `export default`，则自动封装为合法容器。
  // 含顶层 import 时把 import 段提到 `export default async (cad) => {...}` 之外
  // （import 不能出现在函数体内，否则 acorn SyntaxError —— D4）。
  let parseCode = code
  // 扁平封装后首行代码在 parseCode 中位于第 2 行；statementLines 须扣掉封装偏移，
  // 使行号始终相对宿主原始文本（analyzeCode 契约）。
  let lineOffset = code.includes('export default') ? 0 : 1
  if (lineOffset) {
    if (importBlock) {
      const prefix = code.slice(0, importBlock.start)
      const importText = code.slice(importBlock.start, importBlock.end)
      const rest = code.slice(importBlock.end)
      parseCode = `${prefix}${importText}\nexport default async (cad) => {\n${rest}\n}`
      lineOffset = countLines(prefix + importText) + 1
    } else {
      parseCode = `export default async (cad) => {\n${code}\n}`
      lineOffset = 1
    }
  }

  // ── 1. acorn 解析（合法性闸门） ──
  let ast: ASTNode
  try {
    ast = acornParse(parseCode, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    })
  } catch (err) {
    const syntaxErr = err as { message?: string; loc?: { line: number } }
    const line = syntaxErr.loc?.line ?? 1
    const msg = syntaxErr.message ?? String(err)
    throw new ParseError(`SyntaxError: ${msg}`, line, 'E_SYNTAX')
  }

  // ── 2. 验证 AST 结构 ──
  // 顶层必须是 Program，且仅含一个 ExportDefaultDeclaration
  if (ast.type !== 'Program') {
    throw new ParseError('expected a module', 1)
  }

  const exportDecl = ast.body.find((n: ASTNode) => n.type === 'ExportDefaultDeclaration')
  if (!exportDecl) {
    throw new ParseError('missing `export default`', 1)
  }

  // export default 必须是 async 箭头函数
  const arrowFn = exportDecl.declaration
  if (
    arrowFn?.type !== 'ArrowFunctionExpression' ||
    !arrowFn.async ||
    arrowFn.params.length !== 1 ||
    arrowFn.params[0]?.type !== 'Identifier' ||
    arrowFn.params[0].name !== 'cad'
  ) {
    throw new ParseError('expected `export default async (cad) => { ... }`', getLine(exportDecl))
  }

  // 箭头函数体必须是 BlockStatement
  const body = arrowFn.body
  if (body?.type !== 'BlockStatement') {
    throw new ParseError('expected arrow function body to be a block statement { ... }', getLine(arrowFn))
  }

  // ── 3. walk body ──
  const params: ParamDef[] = []
  const statements: StatementIR[] = []
  const statementLines: number[] = []
  /** 顶层函数定义（A1；无函数时保持空数组，ScriptIR 构建时省略） */
  const functions: FunctionDefIR[] = []
  const paramNames = new Set<string>()
  /** 参数名 → 字面量值（F1 表达式折叠依据；仅声明在前面的参数可折叠） */
  const paramValues = new Map<string, JsonValue>()
  const varToId = new Map<string, PartName>()
  let meta: ScriptMetaIR | undefined
  let terminalShapes: TerminalShape[] | undefined

  // ── 3.1 顶层 import → ScriptIR.imports + 命名空间绑定表（F2） ──
  // import 已提升到模块顶层（扁平包装之外）；主解析的 ast.body 顶层直接可取。
  const scriptImports: ImportIR[] = []
  /** 命名空间绑定名 → 包名（`import * as mech from 'mech-lib'` → mech → mech-lib）。
   *  只有 namespace 形态的 import 构成语句命名空间（cad 是缺省命名空间）。 */
  const importBindings = new Map<string, string>()
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    const imp = importDeclToIR(node, getLine(node))
    scriptImports.push(imp)
    if (imp.kind === 'namespace') importBindings.set(imp.localName, imp.packageName)
  }

  /** 命名空间判定：'cad'（缺省）或顶层 import 绑定名（F2 消灭硬编码）。 */
  const isNamespaceName = (name: string): boolean => name === 'cad' || importBindings.has(name)
  /** 合法命名空间名集合（parseValueExpr/parseCadStatement/parseDestructuring 共用）。 */
  const nsNames: ReadonlySet<string> = new Set(['cad', ...importBindings.keys()])

  for (const stmtNode of body.body) {
    const line = getLine(stmtNode)

    switch (stmtNode.type) {
      case 'FunctionDeclaration': {
        // A1：顶层函数定义（V1.3/P4）。函数定义不是几何语句——不进 statements、
        // 不参与 DAG 终端判定（不污染终端集），codegen 原样打印回文件（往返保真）。
        // 函数体同样受黑名单约束：控制流仍报 E_CONTROL_FLOW，eval/new/export/class 仍被拒。
        parseFunctionDeclaration(stmtNode, line, functions, parseCode)
        break
      }

      case 'VariableDeclaration': {
        // 允许 const 和 let（let 仅用于装配变量）；var 保持拒绝（O2 排后）
        if (stmtNode.kind !== 'const' && stmtNode.kind !== 'let') {
          throw new ParseError(`only 'const' or 'let' declarations allowed, got '${stmtNode.kind}'`, line, 'E_STATEMENT')
        }
        // F1 黑名单化：多声明器逐个处理（const a = 1, b = 2）
        for (const decl of stmtNode.declarations) {
          const dline = getLine(decl)

          // 通用解构：const { k1: v1, k2: v2 } = [await] <ns>.<any>(...)（A2 消灭：任意 callee、任意键）
          if (decl.id?.type === 'ObjectPattern') {
            if (stmtNode.kind !== 'const') {
              throw new ParseError('destructuring requires const', line, 'E_STATEMENT')
            }
            const { stmt, valueNames } = parseDestructuring(decl, paramNames, paramValues, varToId, nsNames, looseVars)
            // 命名服务不再由 parser 调用：parser 只做语法分析，保留词法变量名（设计 §5.1）
            stmt.outputs = valueNames.map((n) => asPartName(n))
            statements.push(stmt)
            statementLines.push(dline)
            // varToId 仅用于作用域校验，恒等映射（词法名 → 词法名）
            valueNames.forEach((n) => varToId.set(n, asPartName(n)))
            continue
          }

          // 判断是参数还是语句
          let init = decl.init
          const isAwait = init?.type === 'AwaitExpression'
          if (isAwait) init = init.argument

          // 动态 import() → 控制流专用错误码（V1.5；`await import("mod")` 走声明路径）
          if (init?.type === 'ImportExpression') {
            throw new ParseError('dynamic import() is not allowed in faijs (no control flow)', line, 'E_CONTROL_FLOW')
          }

          // Phase 3: let 允许用于普通 cad.op() 语句（单入单出复用名时 codegen 产生 let 重赋值）

          if (
            init?.type === 'CallExpression' &&
            init.callee?.type === 'MemberExpression' &&
            init.callee.object?.type === 'Identifier' &&
            isNamespaceName(init.callee.object.name)
          ) {
            // 语句：const partN = [await] <ns>.op(...)
            const { stmt, varName } = parseCadStatement(decl, paramNames, paramValues, varToId, nsNames, looseVars)
            // 命名服务不再由 parser 调用：parser 只做语法分析，保留词法变量名（设计 §5.1）
            stmt.outputs = [asPartName(varName)]
            statements.push(stmt)
            statementLines.push(dline)
            // varToId 仅用于作用域校验，恒等映射（词法名 → 词法名）
            varToId.set(varName, asPartName(varName))
          } else if (
            init?.type === 'Literal' ||
            init?.type === 'ArrayExpression' ||
            init?.type === 'ObjectExpression'
          ) {
            // 参数：const name = literal
            if (decl.id?.type !== 'Identifier') {
              throw new ParseError('param declaration must have identifier name', line, 'E_STATEMENT')
            }
            const name = decl.id.name
            // 解析字面量值（不允许 ParamRefIR / GeomRef / 标识符）
            const value = parseLiteralOnly(init, dline)
            params.push({
              name,
              type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : 'vec3',
              value: value as never,
              default: value as never,
            })
            paramNames.add(name)
            paramValues.set(name, value)
            // F1：参数也可作为 input（cad.drill(p, {...})），加入 varToId 供输入/接收者解析
            varToId.set(name, asPartName(name))
          } else {
            throw new ParseError(
              `unsupported const declaration: init type = ${init?.type ?? 'null'}`,
              line,
              'E_STATEMENT',
            )
          }
        }
        break
      }

      case 'ReturnStatement': {
        const result = parseReturnStatement(stmtNode, varToId)
        meta = result.meta
        terminalShapes = result.terminalShapes
        break
      }

      case 'ExpressionStatement': {
        const expr = stmtNode.expression

        // 动态 import() → 控制流专用错误码（V1.5）
        if (expr?.type === 'ImportExpression') {
          throw new ParseError('dynamic import() is not allowed in faijs (no control flow)', line, 'E_CONTROL_FLOW')
        }
        // eval / new Function 安全红线
        if (expr?.type === 'CallExpression' && expr.callee?.type === 'Identifier' && expr.callee.name === 'eval') {
          throw new ParseError('eval is not allowed in faijs', line, 'E_STATEMENT')
        }
        if (expr?.type === 'NewExpression') {
          throw new ParseError('"new" expressions are not allowed in faijs (new Function is a safety red line)', line, 'E_STATEMENT')
        }

        // ── Phase 3: 裸重赋值 part0 = [await] cad.op(...) ──
        // codegen 对已声明变量的重赋值不使用 let/const，产生裸赋值表达式
        if (
          expr?.type === 'AssignmentExpression' &&
          expr.operator === '=' &&
          expr.left?.type === 'Identifier'
        ) {
          const varName = expr.left.name
          // 验证变量已声明（loose 模式下外部变量透传，由 append 前缀校验兜底）
          if (!varToId.has(varName)) {
            if (looseVars) {
              varToId.set(varName, asPartName(varName))
            } else {
              throw new ParseError(`unknown variable "${varName}" in re-assignment`, line, 'E_REFERENCE')
            }
          }
          let init = expr.right
          if (init?.type === 'AwaitExpression') init = init.argument
          if (
            init?.type === 'CallExpression' &&
            init.callee?.type === 'MemberExpression' &&
            init.callee.object?.type === 'Identifier' &&
            isNamespaceName(init.callee.object.name) &&
            init.callee.property?.type === 'Identifier'
          ) {
            // 复用 parseCadStatement 的内部逻辑
            const fakeDecl = {
              id: { type: 'Identifier', name: varName } as const,
              init: expr.right,
              loc: stmtNode.loc,
            }
            const { stmt, varName: parsedVar } = parseCadStatement(fakeDecl, paramNames, paramValues, varToId, nsNames, looseVars)
            // 命名服务不再由 parser 调用：裸重赋值保留词法变量名（设计 §5.1）
            stmt.outputs = [asPartName(parsedVar)]
            statements.push(stmt)
            statementLines.push(line)
            // varToId 仅用于作用域校验，恒等映射（词法名 → 词法名）
            varToId.set(parsedVar, asPartName(parsedVar))
            break
          }
          throw new ParseError(`re-assignment must be a cad.op() call`, line, 'E_STATEMENT')
        }

        // ── 成员方法调用（A6 消灭：任意方法名；receiver 须已声明） ──
        // assem1.add_constraint({ ... }) / assem1.do_assemble() / assem1.myMethod()
        if (
          expr?.type === 'CallExpression' &&
          expr.callee?.type === 'MemberExpression' &&
          expr.callee.object?.type === 'Identifier' &&
          expr.callee.property?.type === 'Identifier'
        ) {
          const objName = expr.callee.object.name
          const methodName = expr.callee.property.name

          // F1 黑名单化 + F2：命名空间调用（<ns>.<op>() 裸调用，无赋值）——对象是 'cad'
          // 或顶层 import 绑定名（第三方命名空间调用）
          if (isNamespaceName(objName)) {
            const nsName = objName
            const args: Record<string, ArgIR> = {}
            const inputs: PartName[] = []
            const flags: ValueFlags = { computed: false }
            for (const argNode of expr.arguments) {
              if (argNode.type === 'Identifier') {
                let inputId = varToId.get(argNode.name)
                if (!inputId) {
                  // Loose mode: external variable passes through as its physical PartName
                  if (looseVars) {
                    inputId = asPartName(argNode.name)
                    varToId.set(argNode.name, inputId)
                  } else {
                    throw new ParseError(`unknown variable "${argNode.name}" in ${nsName}.${methodName}() call`, getLine(argNode), 'E_REFERENCE')
                  }
                }
                inputs.push(inputId)
              } else if (argNode.type === 'ObjectExpression') {
                const parsed = parseValueExpr(argNode, paramNames, paramValues, varToId, nsNames, line, flags, looseVars)
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                  Object.assign(args, parsed as Record<string, ArgIR>)
                } else {
                  throw new ParseError(`${methodName} args must be an object`, line, 'E_VALUE')
                }
              } else if (argNode.type !== 'undefined') {
                throw new ParseError(`unexpected argument type in ${methodName}: ${argNode.type}`, getLine(argNode), 'E_VALUE')
              }
            }
            const nsStmt: StatementIR = {
              id: asStmtId('__pending__'),
              callee: methodName,
              args,
              inputs,
              outputs: [],
              hasAssignment: false,
              ...(nsName !== 'cad' ? { namespace: nsName } : {}),
              ...(flags.computed ? { hasComputedArgs: true } : {}),
            }
            statements.push(nsStmt)
            statementLines.push(line)
            break
          }

          // 成员方法调用：receiver 须已声明
          const targetVar = objName
          // 验证 targetVar 已声明（变量作用域检查，非 op 知识）
          if (!varToId.has(targetVar)) {
            // Loose mode: external receiver passes through (append text may call
            // do_assemble() on an assembly created by an earlier statement).
            if (looseVars) {
              varToId.set(targetVar, asPartName(targetVar))
            } else {
              throw new ParseError(`unknown variable "${targetVar}" in .${methodName}() call`, line, 'E_REFERENCE')
            }
          }
          const args: Record<string, ArgIR> = {}
          const flags: ValueFlags = { computed: false }
          for (const argNode of expr.arguments) {
            if (argNode.type === 'ObjectExpression') {
              const parsed = parseValueExpr(argNode, paramNames, paramValues, varToId, nsNames, line, flags, looseVars)
              if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                Object.assign(args, parsed as Record<string, ArgIR>)
              } else {
                throw new ParseError(`${methodName} args must be an object`, line, 'E_VALUE')
              }
            } else if (argNode.type !== 'undefined') {
              throw new ParseError(`unexpected argument type in ${methodName}: ${argNode.type}`, getLine(argNode), 'E_VALUE')
            }
          }
          const memberStmt: StatementIR = {
            id: asStmtId('__pending__'),
            callee: methodName,
            args,
            inputs: [],
            outputs: [],
            receiver: targetVar,
            hasAssignment: false,
            ...(flags.computed ? { hasComputedArgs: true } : {}),
          }
          statements.push(memberStmt)
          statementLines.push(line)
          break
        }

        // 其余裸表达式语句：黑名单化后仍拒绝（无意义的表达式）
        throw new ParseError(
          `bare expression statements not allowed; use 'const part0 = cad.op(...)' instead`,
          line,
          'E_STATEMENT',
        )
      }

      default:
        throwUnsupportedStatement(stmtNode, line)
    }
  }

  // ── 3.5 独立 StmtId 分配 + 引用收集（Phase 3: id = sN） ──
  // StmtId 按语句顺序分配 s(K+1)..s(K+N)，K = params.length——参数在编译产物中占 s1..sK，
  // 使 parser 分配的 id 与 compileToModule 生成的模块语句 id 一致。
  const stmtIdBase = params.length
  let stmtIdx = 0
  for (const stmt of statements) {
    const sN = asStmtId(`s${stmtIdBase + (++stmtIdx)}`)
    stmt.id = sN
    stmt.refs = collectStatementRefs(stmt)
  }
  const sourceLines = lineOffset ? statementLines.map((l) => l - lineOffset) : statementLines

  // ── 4. terminal shapes ──
  // Phase 3：终端判定移入执行收尾（runtime.collectResult），parser 不再计算。
  // 显式 return [...] 的 terminalShapes 优先；否则运行期从 result.outputs 过滤。
  const finalTerminalShapes = terminalShapes

  // ── 5. 构建 ScriptIR ──
  const script: ScriptIR = {
    params,
    statements,
    ...(scriptImports.length > 0 ? { imports: scriptImports } : {}),
    ...(functions.length > 0 ? { functions } : {}),
    meta,
    terminalShapes: finalTerminalShapes,
  }

  return { script, varToId, statementLines: sourceLines }
}

// ── 字面量解析（仅允许字面量，不允许标识符/调用） ──

function parseLiteralOnly(node: ASTNode, line: number): JsonValue {
  switch (node.type) {
    case 'Literal':
      return node.value
    case 'ArrayExpression':
      return node.elements.map((el: ASTNode) => parseLiteralOnly(el, line))
    case 'ObjectExpression': {
      const obj: Record<string, JsonValue> = {}
      for (const prop of node.properties) {
        const key = prop.key?.type === 'Identifier' ? prop.key.name
          : prop.key?.type === 'Literal' ? String(prop.key.value)
          : null
        if (!key) throw new ParseError('invalid object key in param literal', line)
        obj[key] = parseLiteralOnly(prop.value, line)
      }
      return obj
    }
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument?.type === 'Literal') {
        return -node.argument.value
      }
      throw new ParseError(`unsupported unary in param literal`, line)
    default:
      throw new ParseError(`param value must be a literal (number/string/boolean/null/array/object), got ${node.type}`, line)
  }
}

// ── 版本迁移 ──

/**
 * Read the `// apiVersion: N` declaration from the top of a faijs source text,
 * defaulting to 1 when absent.
 * @param code - the faijs source text to inspect.
 * @returns the declared API version number, or 1 when none is present.
 */
export function getApiVersion(code: string): number {
  const match = code.match(/^\/\/\s*apiVersion:\s*(\d+)/m)
  return match ? parseInt(match[1], 10) : 1
}
