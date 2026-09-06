/**
 * parser — 文本 → ScriptIR（合法 JS 子集，设计文档 §2）
 *
 * 执行模型：`.fai.js` 文本先用 acorn 解析（合法性证明 J-1），再 walk AST 还原为 ScriptIR。
 * 绝不 eval / new Function / import() 真执行。
 *
 * 支持的语法（合法 JS 子集）：
 * - `// apiVersion: N` — 版本声明（可选，默认 1）
 * - `export default async (cad) => { ... }` — 唯一合法容器
 * - `const <name> = <literal>` → ParamDef（参数声明，右侧仅字面量）
 * - `const part<N>_v<M> = [await] cad.<op>(<inputVar>?, { ...args })` → StatementIR
 * - `cad.union/subtract/intersect(inputVar, inputVar)` → boolean op
 * - `cad.faceNormal(var)` / `cad.bboxCenter(var)` / ... → GeomRef
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
  ExprIR,
} from './types'
import { isParamRef, isVarRef, isCallRef, isExprRef, splitPositionalOptions } from './types'
import {
  asStmtId,
  asPartName,
  type PartName,
} from '../identity'

// ── 解析错误 ──
// ParseError / ParseErrorCode 的唯一家在 parse-error.ts（无 IR 方案下 MetadataExtractor
// / SyntaxGate 复用同一类；此处重导出保持历史 import 面兼容）。

import { ParseError } from './parse-error'
import { fnv1a32 } from './fnv-hash'
export type { ParseErrorCode } from './parse-error'
export { ParseError } from './parse-error'

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

// ── ExprIR（运行时表达式，控制流放松方案 §3.3 / §4.3） ──
// 折叠失败（引用了语句变量等）且节点 ∈ 白名单文法时，把表达式原文 + 引用名
// 集合降级为 ExprIR，由编译期箭头包装发射、JS 引擎运行时求值（§5.4）。

/**
 * ExprIR 白名单文法（§3.3，true-JS-subset 方案 D2 扩展）：Literal / Identifier /
 * Unary / Binary / Logical / Conditional / Array（元素递归走白名单）/
 * **MemberExpression**（非可选链的全形态，computed 与否均收）/
 * **CallExpression**（方法调用 `a.b(c)` 归入 ExprIR；命名空间根调用在调用方
 * 先被截为 CallRefIR，不会到达此处）。
 *
 * ObjectExpression 不整体降级：对象属性值引用变量时本就是 VarRefIR（现状路径），
 * 属性值为折叠失败的表达式时由属性值递归各自降级为 ExprIR——整体降级语义等价
 * 且会误伤 args 顶层容器（`cad.op({ size: ... })` 的整个 args 对象不能被降级）。
 *
 * 命名空间限制（§4.2.2）：ExprIR 文本由箭头包装在语句 fn 体内求值，命名空间
 * 绑定名（cad / import 绑定名）在该作用域不可见——含命名空间根调用的复合表达式
 * 由调用方（containsNsRootedCall 守卫）显式报 E_VALUE，不会进入 ExprIR。
 */
function isExprWhitelist(node: ASTNode): boolean {
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
      return (
        isExprWhitelist(node.test) &&
        isExprWhitelist(node.consequent) &&
        isExprWhitelist(node.alternate)
      )
    case 'ArrayExpression':
      return node.elements.every(
        (el: ASTNode) => el !== null && el !== undefined && isExprWhitelist(el),
      )
    case 'MemberExpression':
      // 可选链（a?.b / a?.[b]）不在子集内
      if (node.optional) return false
      if (!isExprWhitelist(node.object)) return false
      return node.computed ? isExprWhitelist(node.property) : true
    case 'CallExpression': {
      if (node.optional) return false
      if (!isExprWhitelist(node.callee)) return false
      return (node.arguments as ASTNode[]).every(
        (a) => a.type !== 'SpreadElement' && isExprWhitelist(a),
      )
    }
    default:
      return false
  }
}

/**
 * 守卫：表达式树中是否含「命名空间根调用」（callee 链根标识符 ∈ nsNames 的
 * CallExpression）。这类子表达式无法在语句 fn 体的箭头包装作用域内解析
 * （命名空间经 ns.<name> 访问，非词法绑定）→ 调用方显式报 E_VALUE；
 * 整体作为单个实参的命名空间调用仍走 CallRefIR（现状路径，不受影响）。
 */
function containsNsRootedCall(node: ASTNode, nsNames: ReadonlySet<string>): boolean {
  if (!node || typeof node !== 'object') return false
  switch (node.type) {
    case 'CallExpression': {
      const root = rootIdentifierOfCallee(node.callee)
      if (root !== null && nsNames.has(root)) return true
      if (containsNsRootedCall(node.callee, nsNames)) return true
      return (node.arguments as ASTNode[]).some((a) => containsNsRootedCall(a, nsNames))
    }
    case 'MemberExpression':
      return containsNsRootedCall(node.object, nsNames) ||
        (node.computed ? containsNsRootedCall(node.property, nsNames) : false)
    case 'UnaryExpression':
      return containsNsRootedCall(node.argument, nsNames)
    case 'BinaryExpression':
    case 'LogicalExpression':
      return containsNsRootedCall(node.left, nsNames) || containsNsRootedCall(node.right, nsNames)
    case 'ConditionalExpression':
      return (
        containsNsRootedCall(node.test, nsNames) ||
        containsNsRootedCall(node.consequent, nsNames) ||
        containsNsRootedCall(node.alternate, nsNames)
      )
    case 'ArrayExpression':
      return (node.elements as ASTNode[]).some((el) => containsNsRootedCall(el, nsNames))
    default:
      return false
  }
}

/** 取 callee 链（MemberExpression.object 逐层下钻）的根标识符名；非链形态返回 null。 */
function rootIdentifierOfCallee(callee: ASTNode): string | null {
  let cur = callee
  while (cur && typeof cur === 'object') {
    if (cur.type === 'Identifier') return cur.name
    if (cur.type === 'MemberExpression') {
      cur = cur.object
      continue
    }
    return null
  }
  return null
}

/**
 * 预检：节点是否「需整体降级为 ExprIR」——数组内出现折叠失败（引用变量）且自身
 * ∈ 白名单的表达式元素。折叠成功 / 纯字面量 / 参数 / 变量引用 / 嵌套调用均返回
 * false（维持现状路径）；未知标识符等非法形态也返回 false（由现状路径报错）。
 * 对象不整体降级（属性值各自递归降级，见 isExprWhitelist 注释）。
 */
function needsExprFallback(
  node: ASTNode,
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
): boolean {
  if (!node || typeof node !== 'object') return false
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
    case 'ObjectExpression':
      return false
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'TemplateLiteral':
    case 'ConditionalExpression': {
      if (tryFoldConstExpr(node, paramNames, paramValues).ok) return false
      return isExprWhitelist(node)
    }
    case 'ArrayExpression':
      return node.elements.some(
        (el: ASTNode) => el !== null && el !== undefined && needsExprFallback(el, paramNames, paramValues),
      )
    default:
      return false
  }
}

/**
 * 递归收集 ExprIR 引用的参数名 / 变量名：Identifier → 参数进 params（ctx 键）、
 * 已声明变量进 refs（VarRef 语义）、未知标识符 → E_REFERENCE（loose 模式透传为 partName）。
 */
function collectExprIdentifiers(
  node: ASTNode,
  paramNames: Set<string>,
  varToId: Map<string, PartName>,
  line: number,
  params: Set<string>,
  refs: Set<string>,
  looseVars: boolean,
): void {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'Identifier': {
      const name = node.name
      if (paramNames.has(name)) {
        params.add(name)
      } else if (varToId.has(name)) {
        refs.add(String(varToId.get(name)))
      } else if (looseVars) {
        // Loose mode: external variable passes through as its physical PartName
        // (the append prefix is validated by the caller against the persistent ctx).
        refs.add(String(asPartName(name)))
        varToId.set(name, asPartName(name))
      } else {
        throw new ParseError(`unknown identifier "${name}" in expression`, getLine(node), 'E_REFERENCE')
      }
      return
    }
    case 'UnaryExpression':
      collectExprIdentifiers(node.argument, paramNames, varToId, line, params, refs, looseVars)
      return
    case 'BinaryExpression':
    case 'LogicalExpression':
      collectExprIdentifiers(node.left, paramNames, varToId, line, params, refs, looseVars)
      collectExprIdentifiers(node.right, paramNames, varToId, line, params, refs, looseVars)
      return
    case 'ConditionalExpression':
      collectExprIdentifiers(node.test, paramNames, varToId, line, params, refs, looseVars)
      collectExprIdentifiers(node.consequent, paramNames, varToId, line, params, refs, looseVars)
      collectExprIdentifiers(node.alternate, paramNames, varToId, line, params, refs, looseVars)
      return
    case 'ArrayExpression':
      for (const el of node.elements) {
        collectExprIdentifiers(el, paramNames, varToId, line, params, refs, looseVars)
      }
      return
    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (prop?.type !== 'Property') continue
        // shorthand { w } 的 value 即 Identifier(w)，直接收集即可
        collectExprIdentifiers(prop.value, paramNames, varToId, line, params, refs, looseVars)
      }
      return
    case 'MemberExpression': {
      // 成员链：沿 .object 走到根标识符收为 ref（p0.solid → refs=['p0']；
      // p0.holes[0].center → refs=['p0']）；computed 属性表达式递归收集。
      collectExprIdentifiers(node.object, paramNames, varToId, line, params, refs, looseVars)
      if (node.computed) {
        collectExprIdentifiers(node.property, paramNames, varToId, line, params, refs, looseVars)
      }
      return
    }
    case 'CallExpression': {
      // 方法调用 a.b(c)：callee 链与实参递归收集（命名空间根调用已被 buildExprIR 守卫拦截）
      collectExprIdentifiers(node.callee, paramNames, varToId, line, params, refs, looseVars)
      for (const a of node.arguments as ASTNode[]) {
        collectExprIdentifiers(a.type === 'SpreadElement' ? a.argument : a, paramNames, varToId, line, params, refs, looseVars)
      }
      return
    }
    default:
      return
  }
}

/** 构建 ExprIR：原文切片（acorn 坐标相对 sourceText）+ 引用名集合；置 hasComputedArgs。
 *  守卫：含命名空间根调用的表达式显式 E_VALUE（命名空间绑定在语句 fn 体箭头包装
 *  作用域内不可见，整体单实参的命名空间调用应走 CallRefIR）。 */
function buildExprIR(
  node: ASTNode,
  paramNames: Set<string>,
  varToId: Map<string, PartName>,
  line: number,
  flags: ValueFlags | null | undefined,
  looseVars: boolean,
  sourceText: string,
  nsNames: ReadonlySet<string>,
): ExprIR {
  if (containsNsRootedCall(node, nsNames)) {
    throw new ParseError(
      'namespace calls are only supported as a whole argument value (CallRefIR), not inside a larger expression',
      line,
      'E_VALUE',
    )
  }
  const params = new Set<string>()
  const refs = new Set<string>()
  collectExprIdentifiers(node, paramNames, varToId, line, params, refs, looseVars)
  if (flags) flags.computed = true
  return {
    $expr: {
      text: sourceText.slice(node.start, node.end),
      refs: [...refs],
      params: [...params],
    },
  }
}

/** 解析字面量 / 数组 / 对象 / ParamRefIR / GeomRef（F1：支持可静态折叠的表达式） */
function parseValueExpr(
  node: ASTNode,
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
  varToId: Map<string, PartName>,
  nsNames: ReadonlySet<string>,
  defaultNsName: string,
  line: number,
  flags?: ValueFlags | null,
  looseVars = false,
  sourceText = '',
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
      // ExprIR 降级：数组含折叠失败（引用变量）的白名单表达式元素 → 整体作为运行时表达式
      if (needsExprFallback(node, paramNames, paramValues)) {
        return buildExprIR(node, paramNames, varToId, line, flags, looseVars, sourceText, nsNames)
      }
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
          out.push(parseValueExpr(el, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, sourceText))
        }
      }
      return out as ArgIR
    }

    case 'ObjectExpression': {
      // ExprIR 降级：对象含折叠失败（引用变量）的白名单表达式属性值 → 整体作为运行时表达式
      if (needsExprFallback(node, paramNames, paramValues)) {
        return buildExprIR(node, paramNames, varToId, line, flags, looseVars, sourceText, nsNames)
      }
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
          obj[key] = parseValueExpr(prop.value, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, sourceText)
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
        const innerArgs = node.arguments.map((a: ASTNode) => parseValueExpr(a, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, sourceText))
        return {
          $call: {
            callee: innerCallee,
            args: innerArgs,
            ...(nsName !== defaultNsName ? { namespace: nsName } : {}),
          },
        } as ArgIR
      }
      // D2 扩展：非命名空间调用（方法调用 a.b(c) / 裸调用）∈ 白名单 → ExprIR；
      // 白名单外（new/箭头/可选链等红线或语义空白）→ E_VALUE（显式禁止而非默认拒绝）
      if (isExprWhitelist(node)) {
        return buildExprIR(node, paramNames, varToId, line, flags, looseVars, sourceText, nsNames)
      }
      throw new ParseError('nested calls in args must be <ns>.<ident>(...) or a whitelisted expression', line, 'E_VALUE')
    }

    // D2 扩展：成员访问（p0.solid / p0.holes[0].center）∈ 白名单 → ExprIR（原文切片运行时求值）
    case 'MemberExpression': {
      if (isExprWhitelist(node)) {
        return buildExprIR(node, paramNames, varToId, line, flags, looseVars, sourceText, nsNames)
      }
      throw new ParseError(`unsupported member expression in args: optional chaining is not allowed`, line, 'E_VALUE')
    }

    // F1 扩展：可静态折叠的表达式（无控制流 → 参数值已知，编译期求值）
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'TemplateLiteral':
    case 'ConditionalExpression': {
      const r = tryFoldConstExpr(node, paramNames, paramValues)
      if (!r.ok) {
        // ExprIR 降级：折叠失败（引用了语句变量等）且节点 ∈ 白名单文法
        // → 运行时求值（§3.3 / §4.3）；白名单外 → E_VALUE
        if (isExprWhitelist(node)) {
          return buildExprIR(node, paramNames, varToId, line, flags, looseVars, sourceText, nsNames)
        }
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

// ── 位置实参解析（true-JS-subset 方案 §4.2.1：五种顶层调用形态统一入口） ──

/**
 * 解析一条顶层调用语句的全部位置实参（true-JS-subset 方案 §4.2.1）。
 *
 * 位置实参槽接受任意合法 JS 表达式：变量引用（Identifier → VarRefIR，参数也在
 * varToId 中）、字面量、数组、对象（尾随对象同时投影为 args 选项槽）、
 * `<ns>.<fn>(...)` 嵌套调用（CallRefIR）、可折叠运算、白名单表达式（ExprIR，
 * 含 MemberExpression / 方法调用）。SpreadElement 仅接受可静态折叠的数组参数/
 * 字面量（展开为多个位置实参）。红线形态（new / 箭头函数 / await 等）由
 * parseValueExpr 的 default 分支显式 E_VALUE。
 *
 * @param argNodes - the raw AST argument nodes of the call.
 * @param label - error-message context (e.g. 'inputs', 'destructuring inputs', 'myFn() call').
 * @returns the positional ArgIR list in call order.
 */
function parsePositionalArgs(
  argNodes: ASTNode[],
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
  varToId: Map<string, PartName>,
  nsNames: ReadonlySet<string>,
  defaultNsName: string,
  line: number,
  flags: ValueFlags,
  looseVars: boolean,
  sourceText: string,
  label: string,
): ArgIR[] {
  const out: ArgIR[] = []
  for (const argNode of argNodes) {
    if (argNode.type === 'Identifier') {
      // 位置变量引用：varToId 统一解析（参数声明也在表中，与原 inputs 语义一致）
      const inputId = varToId.get(argNode.name)
      if (inputId) {
        out.push({ $ref: inputId } as ArgIR)
        continue
      }
      // Loose mode: external variable passes through as its physical PartName
      // (the append prefix is validated by the caller against the persistent ctx).
      if (looseVars) {
        const external = asPartName(argNode.name)
        varToId.set(argNode.name, external)
        out.push({ $ref: external } as ArgIR)
        continue
      }
      throw new ParseError(`unknown variable "${argNode.name}" in ${label}`, getLine(argNode), 'E_REFERENCE')
    }
    if (argNode.type === 'SpreadElement') {
      // [...parts]：parts 须为可折叠的数组参数/字面量（展开为多个位置实参）
      const r = tryFoldConstExpr(argNode.argument, paramNames, paramValues)
      if (!r.ok || !Array.isArray(r.value)) {
        throw new ParseError('cannot statically evaluate spread in arguments (must reference an array param or literal)', line, 'E_VALUE')
      }
      flags.computed = true
      out.push(...(r.value as ArgIR[]))
      continue
    }
    out.push(parseValueExpr(argNode, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, sourceText))
  }
  return out
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
/**
 * ABI 绑定校验（§3.6 / D11 / true-JS-subset §4.2.4）：本机函数调用 `myFn(a1..aM, { key1: v1, ... })`，
 * 设形参表 [p1..pk]：
 * 1. 位置实参 a1..aM 按序绑定 p1..pM（M ≤ k，超出 → E_ARG）；位置实参可为任意
 *    合法 JS 表达式形态（只数个数，不再要求 Identifier——true-JS-subset 放开）；
 * 2. 尾部对象键绑定剩余形参 p_{M+1}..p_k（按名）；未知键 / 与位置占用冲突 → E_ARG；
 * 3. 未被绑定的形参 → undefined（JS 语义，不报错）；
 * 4. keep/keepHidden 键先剥离，不参与形参校验（§3.6 第 4 条）。
 * @param callee - 函数名（错误消息用）。
 * @param params - 函数形参表（来自 parseScript 预扫描的 localFnParams）。
 * @param positionalCount - 位置实参个数（M）。
 * @param args - 尾部对象键值（keep/keepHidden 可能仍在其中，校验时跳过）。
 * @param line - 报错行号。
 */
function validateLocalAbi(
  callee: string,
  params: string[],
  positionalCount: number,
  args: Record<string, ArgIR>,
  line: number,
): void {
  const M = positionalCount
  if (M > params.length) {
    throw new ParseError(
      `function "${callee}" takes at most ${params.length} positional argument(s), got ${M}`,
      line,
      'E_ARG',
    )
  }
  for (const key of Object.keys(args)) {
    if (key === 'keep' || key === 'keepHidden') continue
    const idx = params.indexOf(key)
    if (idx === -1) {
      throw new ParseError(`function "${callee}" has no parameter named "${key}"`, line, 'E_ARG')
    }
    if (idx < M) {
      throw new ParseError(
        `function "${callee}" parameter "${key}" is already bound by a positional argument`,
        line,
        'E_ARG',
      )
    }
  }
}

function parseCadStatement(
  declNode: ASTNode,
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
  varToId: Map<string, PartName>,
  nsNames: ReadonlySet<string>,
  defaultNsName: string,
  looseVars = false,
  sourceText = '',
  localFnParams?: ReadonlyMap<string, string[]>,
  looseLocalCalls = false,
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
    throw new ParseError(`expected <ns>.<op>(...) or local function call, got ${init?.type ?? 'null'}`, line, 'E_STATEMENT')
  }

  const callee = init.callee
  // 命名空间调用：callee 是 MemberExpression <ns>.<op>（cad 或顶层 import 绑定名，F2 消灭硬编码）
  const isNsCall =
    callee?.type === 'MemberExpression' &&
    callee.object?.type === 'Identifier' &&
    nsNames.has(callee.object.name) &&
    callee.property?.type === 'Identifier'
  // 本机函数调用：callee 是裸标识符且 ∈ 脚本函数集（§3.4 / §4.2）
  const isLocalCall =
    callee?.type === 'Identifier' && (localFnParams?.has(callee.name) ?? false)
  // 宽松本机调用（单行提取 codeToArgs）：裸 callee 不在函数集时也放行，
  // 视为 local 调用候选（ABI 形态未知 → 跳过绑定校验），由调用方在完整上下文校验。
  const looseLocalCall = !isLocalCall && looseLocalCalls && callee?.type === 'Identifier'
  if (!isNsCall && !isLocalCall && !looseLocalCall) {
    // 裸 callee 且不在函数集 → 「函数不存在」（E_REFERENCE，§3.4 / D15）；其余形态 → E_STATEMENT
    if (callee?.type === 'Identifier') {
      throw new ParseError(
        `function "${callee.name}" does not exist in this script`,
        line,
        'E_REFERENCE',
      )
    }
    throw new ParseError('expected <ns>.<op>(...) or local function call', line, 'E_STATEMENT')
  }

  const nsName = isNsCall ? callee.object.name : undefined
  const opName = isNsCall ? callee.property.name : callee.name
  const local = isLocalCall || looseLocalCall

  // 位置实参统一解析（true-JS-subset §4.2.1）：变量/字面量/对象/嵌套调用/表达式任意混排；
  // 尾随纯对象同时投影为 args 选项槽。不再有"args = parsed 覆盖赋值"静默坑（D5：多对象按位置如实传递）。
  const flags: ValueFlags = { computed: false }
  const positional = parsePositionalArgs(init.arguments, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, sourceText, 'inputs')
  const args = splitPositionalOptions(positional).named

  // 本机调用：ABI 绑定校验（§3.6，parse 期拦截 E_ARG）
  // 位置实参个数校验（形态校验已删——任意合法 JS 表达式均可占位，§4.2.4）。
  // 宽松本机调用（codeToArgs 单行提取）形参未知 → 跳过绑定校验，由调用方在完整上下文校验。
  if (local && localFnParams && !looseLocalCall) {
    const { values, named } = splitPositionalOptions(positional)
    validateLocalAbi(opName, localFnParams.get(opName) ?? [], values.length, named, line)
  }

  // Phase 3：id 不再赋变量名，由最终遍历赋 sN；变量名记录到 declaredOutputs
  const stmt: StatementIR = {
    id: asStmtId('__pending__'),
    callee: opName,
    args,
    positional,
    outputs: [],
    hasAssignment: true,
    ...(local ? { local: true } : nsName !== defaultNsName ? { namespace: nsName } : {}),
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
 * 解析 `const { k1: v1, k2: v2 } = [await] <ns>.<any>(...)` 或本机函数调用（§3.4）。
 *
 * 任意键数（1..N）、任意 callee（不再限 split/front/back）；本机函数调用走 local 分支。
 */
function parseDestructuring(
  declNode: ASTNode,
  paramNames: Set<string>,
  paramValues: Map<string, JsonValue>,
  varToId: Map<string, PartName>,
  nsNames: ReadonlySet<string>,
  defaultNsName: string,
  looseVars = false,
  sourceText = '',
  localFnParams?: ReadonlyMap<string, string[]>,
  looseLocalCalls = false,
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

  // 提取 init（可包 AwaitExpression），必须是调用（命名空间或本机函数）
  let init = declNode.init
  if (init?.type === 'AwaitExpression') {
    init = init.argument
  }
  if (init?.type !== 'CallExpression') {
    throw new ParseError(`expected <ns>.<op>(...) or local function call in destructuring, got ${init?.type ?? 'null'}`, line, 'E_STATEMENT')
  }

  const callee = init.callee
  const isNsCall =
    callee?.type === 'MemberExpression' &&
    callee.object?.type === 'Identifier' &&
    nsNames.has(callee.object.name) &&
    callee.property?.type === 'Identifier'
  const isLocalCall =
    callee?.type === 'Identifier' && (localFnParams?.has(callee.name) ?? false)
  // 宽松本机调用（单行提取 codeToArgs）：裸 callee 不在函数集时也放行，
  // 视为 local 调用候选（ABI 形态未知 → 跳过绑定校验），由调用方在完整上下文校验。
  const looseLocalCall = !isLocalCall && looseLocalCalls && callee?.type === 'Identifier'
  if (!isNsCall && !isLocalCall && !looseLocalCall) {
    if (callee?.type === 'Identifier') {
      throw new ParseError(
        `function "${callee.name}" does not exist in this script`,
        line,
        'E_REFERENCE',
      )
    }
    throw new ParseError('destructuring is only allowed for <ns>.<op>(...) or local function calls', line, 'E_STATEMENT')
  }

  const nsName = isNsCall ? callee.object.name : undefined
  const opName = isNsCall ? callee.property.name : callee.name
  const local = isLocalCall || looseLocalCall
  // 位置实参统一解析（true-JS-subset §4.2.1）；尾随纯对象同时投影为 args 选项槽。
  // 旧 Object.assign 合并已删（D5：多对象按位置如实传递，不合并不覆盖）。
  const flags: ValueFlags = { computed: false }
  const positional = parsePositionalArgs(init.arguments, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, sourceText, 'destructuring inputs')
  const args = splitPositionalOptions(positional).named

  // 本机调用：ABI 绑定校验（§3.6，parse 期拦截 E_ARG）
  // 宽松本机调用（codeToArgs 单行提取）形参未知 → 跳过绑定校验，由调用方在完整上下文校验。
  if (local && localFnParams && !looseLocalCall) {
    const { values, named } = splitPositionalOptions(positional)
    validateLocalAbi(opName, localFnParams.get(opName) ?? [], values.length, named, line)
  }

  // Phase 3：id 不再赋变量名；outputs 在最终遍历经 varToId 解析后写入
  const stmt: StatementIR = {
    id: asStmtId('__pending__'),
    callee: opName,
    args,
    positional,
    outputs: [],
    outputKeys: keys,
    hasAssignment: true,
    ...(local ? { local: true } : nsName !== defaultNsName ? { namespace: nsName } : {}),
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

/** 递归收集 ArgIR 中的变量引用：$param → 参数名；$ref → 变量名；$call → 递归收集内部 args；$expr → refs/params 并入（§4.3）。 */
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
  if (isExprRef(value)) {
    for (const p of value.$expr.params) out.add(p)
    for (const r of value.$expr.refs) out.add(r)
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
 * 收集单条语句引用的全部变量名（positional + args 中 $param / $ref / 嵌套调用 /
 * ExprIR refs/params + receiver）。positional 与 args 都扫：args 是尾随对象投影
 * （真源 positional 已含它，重复扫描幂等）；手工构造 IR 可能只填 args。
 * 存入 stmt.refs，编译期据此翻译为 deps（定义这些变量的语句 id）。
 */
function collectStatementRefs(stmt: StatementIR): string[] {
  const refs = new Set<string>()
  for (const arg of stmt.positional) collectRefsFromArg(arg, refs)
  for (const arg of Object.values(stmt.args)) collectRefsFromArg(arg, refs)
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

/** 由 specifier 推导包名：@scope/pkg/sub → @scope/pkg；gear-lib-demo → gear-lib-demo。 */
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

// ── 顶层函数定义（A1 / 控制流放松方案 Phase 2） ──
// bodyHash 哈希的唯一家在 fnv-hash.ts（无 IR 方案下 metadata-extractor 复用）。

/**
 * 解析顶层 `function name(params) { ... }` 为 FunctionDefIR（A1 / Phase 2）。
 *
 * 函数定义**不是几何语句**：不进 statements、不参与 DAG 终端判定；
 * 函数体原文按 acorn 坐标从 parseCode 切片保留，codegen 原样打印回文件（往返保真）。
 *
 * 函数体校验（Phase 2 放行控制流，§3.1 / §3.2）：
 * - 控制流（if/for/while/switch/try/throw/break/continue/labeled）放行；
 * - eval / new / export / class / import / with / 动态 import() 仍拒（P5 安全红线）；
 * - 体内禁止调用本机函数（裸 callee 调用 → E_STATEMENT，D10）；
 * - var 允许（D12，不新增收紧）。
 *
 * @param codeOffset parseCode 相对原始 code 的字符偏移（扁平封装前缀；容器格式为 0）。
 *                   函数体坐标经此换算为相对原始文本，供宿主 bodyRange 使用。
 */
function parseFunctionDeclaration(
  node: ASTNode,
  line: number,
  functions: FunctionDefIR[],
  parseCode: string,
  codeOffset = 0,
): void {
  const name = node.id?.name
  if (typeof name !== 'string' || name === '') {
    throw new ParseError('function declaration must have a name', line, 'E_STATEMENT')
  }

  // 查重（D14）：localFns 发射与 bodyHash 按名查表要求函数名唯一
  if (functions.some((f) => f.name === name)) {
    throw new ParseError(`function "${name}" is already defined (duplicate function names are not allowed)`, line, 'E_STATEMENT')
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

  // 函数体校验（Phase 2：放行控制流，保留安全红线，禁体内本机调用）
  validateFunctionBody(node.body, line)

  // 函数体原文（花括号内的完整文本，含换行/缩进）——坐标相对 parseCode
  const body = parseCode.slice(node.body.start + 1, node.body.end - 1)
  functions.push({
    name,
    params,
    body,
    bodyHash: fnv1a32(body),
    bodyRange: { start: node.body.start + 1 - codeOffset, end: node.body.end - 1 - codeOffset },
  })
}

/**
 * 校验函数体（Phase 2，§3.1 / §3.2 / D10 / D12）：
 * - **放行**控制流（if/for/while/switch/try/throw/break/continue/labeled）与 var；
 * - **仍拒**（安全红线 P5）：import 声明 / export / class / eval / new / with / 动态 import()；
 * - **体内禁止本机函数调用**（裸标识符 callee，D10）——递归遍历全部节点（含嵌套函数体）。
 */
function validateFunctionBody(body: ASTNode, line: number): void {
  const stack: ASTNode[] = [body]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === 'ImportDeclaration') {
      throw new ParseError('import statements are not allowed inside function bodies', line, 'E_IMPORT')
    }
    if (n.type === 'ImportExpression') {
      throw new ParseError('dynamic import() is not allowed in faijs', line, 'E_CONTROL_FLOW')
    }
    if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') {
      throw new ParseError('export statements are not allowed in faijs (faijs auto-exports the default module)', line, 'E_STATEMENT')
    }
    if (n.type === 'ClassDeclaration') {
      throw new ParseError('class declarations are not allowed in faijs', line, 'E_STATEMENT')
    }
    if (n.type === 'WithStatement') {
      throw new ParseError('"with" statements are not allowed in faijs (strict mode)', line, 'E_CONTROL_FLOW')
    }
    if (n.type === 'NewExpression') {
      throw new ParseError('"new" expressions are not allowed in faijs (new Function is a safety red line)', line, 'E_STATEMENT')
    }
    if (n.type === 'CallExpression') {
      // eval 安全红线（与顶层一致）
      if (n.callee?.type === 'Identifier' && n.callee.name === 'eval') {
        throw new ParseError('eval is not allowed in faijs', line, 'E_STATEMENT')
      }
      // D10：体内禁止调用本机函数（裸标识符 callee）——顶层 ABI 与 verbatim 函数体语义冲突
      if (n.callee?.type === 'Identifier') {
        throw new ParseError(
          `calling local function "${n.callee.name}" inside a function body is not allowed (D10): local functions are callable from the top level only`,
          line,
          'E_STATEMENT',
        )
      }
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
   * 脚本内对「默认注入命名空间」的引用标识符（U10/R2）。缺省 'cad'——
   * 与根门面 registerLib('cad', …, {default: true}) 声明一致；宿主换默认绑定名
   * （如 registerLib('g', …, {default: true})）时须传入同名的 defaultNs，容器形参
   * 与语句命名空间判定才与该声明一致。
   */
  defaultNs?: string
  /**
   * Loose variable resolution for partial code text (CadRuntime.append receives
   * only the newest statements). Unknown references resolve to their physical
   * PartName instead of throwing; the caller validates them against the
   * persistent ctx (AppendPrefixError when missing).
   */
  looseVars?: boolean
  /**
   * Loose local-function calls for single-line extraction (codeToArgs).
   * A bare callee that is not in the script's function set is accepted as a
   * local call candidate instead of throwing E_REFERENCE (D15) — the caller
   * validates it against the full script context. ABI shape is unknown for
   * such callees, so the binding check (validateLocalAbi) is skipped.
   */
  looseLocalCalls?: boolean
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
  const looseLocalCalls = options?.looseLocalCalls === true
  // 默认注入命名空间名（U10/R2）：缺省 'cad'；宿主换默认绑定名时经 options.defaultNs 声明。
  const defaultNsName = options?.defaultNs ?? 'cad'

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
  // codeOffset：parseCode 坐标 → 原始 code 坐标的字符偏移（函数体 bodyRange 用；容器格式为 0）。
  let lineOffset = code.includes('export default') ? 0 : 1
  let codeOffset = 0
  if (lineOffset) {
    if (importBlock) {
      const prefix = code.slice(0, importBlock.start)
      const importText = code.slice(importBlock.start, importBlock.end)
      const rest = code.slice(importBlock.end)
      parseCode = `${prefix}${importText}\nexport default async (${defaultNsName}) => {\n${rest}\n}`
      lineOffset = countLines(prefix + importText) + 1
      // import 段之后的代码（函数定义所在）偏移 = 封装前缀长度（`\nexport default async (<ns>) => {\n` = 29 + len）
      codeOffset = 29 + defaultNsName.length
    } else {
      parseCode = `export default async (${defaultNsName}) => {\n${code}\n}`
      lineOffset = 1
      codeOffset = `export default async (${defaultNsName}) => {\n`.length
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

  // export default 必须是 async 箭头函数。
  // 容器形参名即脚本内对「默认注入命名空间」的引用标识符（U10/R2：缺省约定 'cad'，
  // 宿主换默认绑定名 g 时经 parseScript options.defaultNs 传入，容器形参须与之一致）。
  const arrowFn = exportDecl.declaration
  if (
    arrowFn?.type !== 'ArrowFunctionExpression' ||
    !arrowFn.async ||
    arrowFn.params.length !== 1 ||
    arrowFn.params[0]?.type !== 'Identifier' ||
    arrowFn.params[0].name !== defaultNsName
  ) {
    throw new ParseError(`expected \`export default async (${defaultNsName}) => { ... }\``, getLine(exportDecl))
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
  /** 命名空间绑定名 → 包名（`import * as mech from 'gear-lib-demo'` → mech → gear-lib-demo）。
   *  只有 namespace 形态的 import 构成语句命名空间（cad 是缺省命名空间）。 */
  const importBindings = new Map<string, string>()
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    const imp = importDeclToIR(node, getLine(node))
    scriptImports.push(imp)
    if (imp.kind === 'namespace') importBindings.set(imp.localName, imp.packageName)
  }

  /** 命名空间判定：'cad'（缺省）或顶层 import 绑定名（F2 消灭硬编码）。 */
  const isNamespaceName = (name: string): boolean => name === defaultNsName || importBindings.has(name)
  /** 合法命名空间名集合（parseValueExpr/parseCadStatement/parseDestructuring 共用）。 */
  const nsNames: ReadonlySet<string> = new Set([defaultNsName, ...importBindings.keys()])

  // ── 3.2 本机函数集预扫描（Phase 2 / §3.4） ──
  // 函数声明**提升**（可被其后语句调用），且未知函数名 parse 期报 E_REFERENCE——
  // 故解析语句前预扫描全部顶层 FunctionDeclaration，收集函数名 → 形参表（ABI 校验用）。
  // 仅顶层函数构成「本机函数集」；函数体内嵌套函数不参与（D10 禁体内调用，体内容器不透明）。
  const localFnParams = new Map<string, string[]>()
  for (const topNode of body.body) {
    if (topNode.type !== 'FunctionDeclaration' || topNode.id?.type !== 'Identifier') continue
    const params: string[] = []
    for (const p of topNode.params ?? []) {
      if (p?.type === 'Identifier') params.push(p.name)
    }
    localFnParams.set(topNode.id.name, params)
  }

  for (const stmtNode of body.body) {
    const line = getLine(stmtNode)

    switch (stmtNode.type) {
      case 'FunctionDeclaration': {
        // A1/Phase 2：顶层函数定义。函数定义不是几何语句——不进 statements、
        // 不参与 DAG 终端判定（不污染终端集），codegen 原样打印回文件（往返保真）。
        // Phase 2：函数体放行控制流（§3.1），保留安全红线，禁体内本机调用（D10）。
        parseFunctionDeclaration(stmtNode, line, functions, parseCode, codeOffset)
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
            const { stmt, valueNames } = parseDestructuring(decl, paramNames, paramValues, varToId, nsNames, defaultNsName, looseVars, parseCode, localFnParams, looseLocalCalls)
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
            (
              // 命名空间调用：<ns>.<op>(...)（F2：cad 或顶层 import 绑定名）
              (init.callee?.type === 'MemberExpression' &&
                init.callee.object?.type === 'Identifier' &&
                isNamespaceName(init.callee.object.name)) ||
              // 裸标识符 callee（本机函数或未知函数名——parseCadStatement 内判 local / E_REFERENCE，§3.4）
              init.callee?.type === 'Identifier'
            )
          ) {
            // 语句：const partN = [await] <ns>.op(...) 或 const partN = [await] localFn(...)
            const { stmt, varName } = parseCadStatement(decl, paramNames, paramValues, varToId, nsNames, defaultNsName, looseVars, parseCode, localFnParams, looseLocalCalls)
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
            // F1：参数也可作为 input（cad.fai_drill(p, {...})），加入 varToId 供输入/接收者解析
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
            (
              // 命名空间调用：<ns>.<op>(...)
              (init.callee?.type === 'MemberExpression' &&
                init.callee.object?.type === 'Identifier' &&
                isNamespaceName(init.callee.object.name) &&
                init.callee.property?.type === 'Identifier') ||
              // 裸标识符 callee（本机函数或未知函数名——parseCadStatement 内判 local / E_REFERENCE，§3.4）
              init.callee?.type === 'Identifier'
            )
          ) {
            // 复用 parseCadStatement 的内部逻辑
            const fakeDecl = {
              id: { type: 'Identifier', name: varName } as const,
              init: expr.right,
              loc: stmtNode.loc,
            }
            const { stmt, varName: parsedVar } = parseCadStatement(fakeDecl, paramNames, paramValues, varToId, nsNames, defaultNsName, looseVars, parseCode, localFnParams, looseLocalCalls)
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

        // ── 本机函数无赋值调用（§3.4 四形态之四：副作用调用） ──
        // myFn(part0, { ... }) —— callee 是裸标识符且 ∈ 函数集；未知函数名 → E_REFERENCE
        // 宽松本机调用（codeToArgs 单行提取）：裸 callee 不在函数集时也放行，
        // 视为 local 调用候选（ABI 形态未知 → 跳过绑定校验），由调用方在完整上下文校验。
        if (expr?.type === 'CallExpression' && expr.callee?.type === 'Identifier') {
          const fnName = expr.callee.name
          const looseLocal = looseLocalCalls && !localFnParams.has(fnName)
          if (localFnParams.has(fnName) || looseLocal) {
            const flags: ValueFlags = { computed: false }
            const positional = parsePositionalArgs(expr.arguments, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, parseCode, `${fnName}() call`)
            const args = splitPositionalOptions(positional).named
            // 宽松本机调用（codeToArgs 单行提取）形参未知 → 跳过绑定校验，由调用方在完整上下文校验。
            if (!looseLocal) {
              const { values, named } = splitPositionalOptions(positional)
              validateLocalAbi(fnName, localFnParams.get(fnName) ?? [], values.length, named, line)
            }
            const localStmt: StatementIR = {
              id: asStmtId('__pending__'),
              callee: fnName,
              args,
              positional,
              outputs: [],
              local: true,
              hasAssignment: false,
              ...(flags.computed ? { hasComputedArgs: true } : {}),
            }
            statements.push(localStmt)
            statementLines.push(line)
            break
          }
          // 裸 callee 不在函数集 → 「函数不存在」（E_REFERENCE，§3.4 / D15）
          throw new ParseError(`function "${fnName}" does not exist in this script`, line, 'E_REFERENCE')
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
            const flags: ValueFlags = { computed: false }
            const positional = parsePositionalArgs(expr.arguments, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, parseCode, `${nsName}.${methodName}() call`)
            const args = splitPositionalOptions(positional).named
            const nsStmt: StatementIR = {
              id: asStmtId('__pending__'),
              callee: methodName,
              args,
              positional,
              outputs: [],
              hasAssignment: false,
              ...(nsName !== defaultNsName ? { namespace: nsName } : {}),
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
          const flags: ValueFlags = { computed: false }
          const positional = parsePositionalArgs(expr.arguments, paramNames, paramValues, varToId, nsNames, defaultNsName, line, flags, looseVars, parseCode, `.${methodName}() call`)
          const args = splitPositionalOptions(positional).named
          const memberStmt: StatementIR = {
            id: asStmtId('__pending__'),
            callee: methodName,
            args,
            positional,
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
