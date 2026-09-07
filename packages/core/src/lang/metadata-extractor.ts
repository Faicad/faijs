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
import { asStmtId, asPartName, type PartName } from '../identity'
import type { HostArg, HostCallRef, HostRef } from './host-arg'
import { isHostVarRef, isHostParamRef, isHostCallRef, isHostExprRef } from './host-arg'
import { ParseError } from './parse-error'
import { fnv1a32 } from './fnv-hash'

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

/** import 表条目（模块图；relative specifier → moduleKey，裸 specifier → libLoader） */
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

interface SymbolTable {
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
  | { ok: true; value: unknown; usedParam: boolean }
  | { ok: false }

function numFold(v: number, usedParam = false): FoldResult {
  return Number.isFinite(v) ? { ok: true, value: v, usedParam } : { ok: false }
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

function tryFoldConstExpr(node: ASTNode, symbols: SymbolTable): FoldResult {
  switch (node.type) {
    case 'Literal':
      return { ok: true, value: node.value, usedParam: false }

    case 'Identifier': {
      if (!symbols.paramNames.has(node.name)) return { ok: false }
      const v = symbols.paramValues.get(node.name)
      return v === undefined ? { ok: false } : { ok: true, value: v, usedParam: true }
    }

    case 'UnaryExpression': {
      const operand = tryFoldConstExpr(node.argument, symbols)
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
      const left = tryFoldConstExpr(node.left, symbols)
      if (!left.ok) return { ok: false }
      const right = tryFoldConstExpr(node.right, symbols)
      if (!right.ok) return { ok: false }
      const a = left.value
      const b = right.value
      const usedParam = left.usedParam || right.usedParam
      const numBin = (op: (x: number, y: number) => number): FoldResult =>
        typeof a === 'number' && typeof b === 'number' ? numFold(op(a, b), usedParam) : { ok: false }
      const cmpBin = (op: (x: number | string, y: number | string) => boolean): FoldResult => {
        if (typeof a === 'number' && typeof b === 'number') return { ok: true, value: op(a, b), usedParam }
        if (typeof a === 'string' && typeof b === 'string') return { ok: true, value: op(a, b), usedParam }
        return { ok: false }
      }
      switch (node.operator) {
        case '+': {
          if (typeof a === 'number' && typeof b === 'number') return numFold(a + b, usedParam)
          if (typeof a === 'string' || typeof b === 'string') return { ok: true, value: String(a) + String(b), usedParam }
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
        case '==': return { ok: true, value: looseEq(a, b), usedParam }
        case '!=': return { ok: true, value: !looseEq(a, b), usedParam }
        case '===': return { ok: true, value: a === b, usedParam }
        case '!==': return { ok: true, value: a !== b, usedParam }
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
          const r = tryFoldConstExpr(exprs[i], symbols)
          if (!r.ok) return { ok: false }
          usedParam = usedParam || r.usedParam
          parts.push(String(r.value))
        }
      }
      return { ok: true, value: parts.join(''), usedParam }
    }

    case 'ConditionalExpression': {
      const test = tryFoldConstExpr(node.test, symbols)
      if (!test.ok) return { ok: false }
      const chosen = tryFoldConstExpr(test.value ? node.consequent : node.alternate, symbols)
      if (!chosen.ok) return { ok: false }
      return { ok: true, value: chosen.value, usedParam: test.usedParam || chosen.usedParam }
    }

    default:
      return { ok: false }
  }
}

// ── Expr 白名单（与现状 parser.isExprWhitelist 同构） ──

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

/** 递归收集表达式引用：参数 → params；已声明变量 → refs；未知 → E_REFERENCE。 */
function collectExprIdentifiers(
  node: ASTNode,
  symbols: SymbolTable,
  line: number,
  params: Set<string>,
  refs: Set<string>,
): void {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'Identifier': {
      const name = node.name
      if (symbols.paramNames.has(name)) {
        params.add(name)
      } else if (symbols.declared.has(name)) {
        refs.add(name)
      } else {
        throw new ParseError(`unknown identifier "${name}" in expression`, line, 'E_REFERENCE')
      }
      return
    }
    case 'UnaryExpression':
      collectExprIdentifiers(node.argument, symbols, line, params, refs)
      return
    case 'BinaryExpression':
    case 'LogicalExpression':
      collectExprIdentifiers(node.left, symbols, line, params, refs)
      collectExprIdentifiers(node.right, symbols, line, params, refs)
      return
    case 'ConditionalExpression':
      collectExprIdentifiers(node.test, symbols, line, params, refs)
      collectExprIdentifiers(node.consequent, symbols, line, params, refs)
      collectExprIdentifiers(node.alternate, symbols, line, params, refs)
      return
    case 'ArrayExpression':
      for (const el of node.elements) collectExprIdentifiers(el, symbols, line, params, refs)
      return
    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (prop?.type !== 'Property') continue
        collectExprIdentifiers(prop.value, symbols, line, params, refs)
      }
      return
    case 'MemberExpression': {
      // 命名空间绑定（import * as cfg / 模块命名空间）的成员 cfg.OUTX：对象名是外部
      // 命名空间，不收集为变量引用（§4.1 HostArg 引用形态；求值在 __ctx.cfg 侧）。
      const obj = node.object
      if (obj?.type === 'Identifier' && symbols.nsBindings.has(obj.name)) {
        if (node.computed) collectExprIdentifiers(node.property, symbols, line, params, refs)
        return
      }
      collectExprIdentifiers(node.object, symbols, line, params, refs)
      if (node.computed) collectExprIdentifiers(node.property, symbols, line, params, refs)
      return
    }
    case 'CallExpression':
      collectExprIdentifiers(node.callee, symbols, line, params, refs)
      for (const a of node.arguments as ASTNode[]) {
        collectExprIdentifiers(a.type === 'SpreadElement' ? a.argument : a, symbols, line, params, refs)
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
}

function parseValueExpr(node: ASTNode, ctx: ValueParseCtx): HostArg {
  if (!node) throw new ParseError('missing value expression', 1, 'E_VALUE')
  const line = lineOf(node)

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
      if (r.usedParam) ctx.computed.value = true
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
      if (ctx.looseVars) {
        ctx.symbols.declared.add(name)
        return { kind: 'var-ref', name } as unknown as HostArg
      }
      throw new ParseError(
        `unknown identifier "${name}" in args value (not a declared param or variable)`,
        line,
        'E_REFERENCE',
      )
    }

    case 'ArrayExpression': {
      const out: HostArg[] = []
      for (const el of node.elements) {
        if (el === null || el === undefined) {
          throw new ParseError('array holes are not supported in args', line, 'E_VALUE')
        }
        if (el.type === 'SpreadElement') {
          const r = tryFoldConstExpr(el.argument, ctx.symbols)
          if (!r.ok || !Array.isArray(r.value)) {
            throw new ParseError(
              'cannot statically evaluate spread in args (must reference an array param or literal)',
              line,
              'E_VALUE',
            )
          }
          ctx.computed.value = true
          out.push(...(r.value as HostArg[]))
          continue
        }
        out.push(parseValueExpr(el, ctx))
      }
      return out as unknown as HostArg
    }

    case 'ObjectExpression': {
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
          if (ctx.symbols.paramNames.has(name)) {
            obj[key] = { kind: 'param-ref', name } as unknown as HostArg
          } else if (ctx.looseVars) {
            ctx.symbols.declared.add(name)
            obj[key] = { kind: 'var-ref', name } as unknown as HostArg
          } else {
            throw new ParseError(
              `unknown shorthand identifier "${key}" (not a declared param)`,
              line,
              'E_REFERENCE',
            )
          }
        } else {
          obj[key] = parseValueExpr(prop.value, ctx)
        }
      }
      return obj as unknown as HostArg
    }

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
        const args = (node.arguments as ASTNode[]).map((a) => parseValueExpr(a, ctx))
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

/** 位置实参解析（与现状 parsePositionalArgs 同构）。 */
function parsePositionalArgs(argNodes: ASTNode[], ctx: ValueParseCtx, line: number): HostArg[] {
  const out: HostArg[] = []
  for (const argNode of argNodes) {
    if (argNode.type === 'Identifier') {
      const name = argNode.name
      if (ctx.symbols.declared.has(name)) {
        out.push({ kind: 'var-ref', name } as unknown as HostArg)
        continue
      }
      if (ctx.looseVars) {
        ctx.symbols.declared.add(name)
        out.push({ kind: 'var-ref', name } as unknown as HostArg)
        continue
      }
      throw new ParseError(`unknown variable "${name}" in inputs`, lineOf(argNode), 'E_REFERENCE')
    }
    if (argNode.type === 'SpreadElement') {
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
    out.push(parseValueExpr(argNode, ctx))
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
}

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
      codeOffset = 29 + defaultNsName.length
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
                : parseValueExpr(init, vctx) as unknown
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

  return { lines, params, imports, functions, blocks, keep: symbols.keep, meta, terminalShapes }
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
