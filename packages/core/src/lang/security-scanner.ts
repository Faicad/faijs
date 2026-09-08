/**
 * security-scanner — .fai.js 静态安全门禁（纵深防御第一层）
 *
 * 方案：docs/plans/2026-09-08-faijs-security-gate.md（§5）
 *
 * 定位：在 MetadataExtractor（UI 通道）与 DirectExecutor（执行通道）之前
 * 对源码做 **AST 全量递归遍历**，覆盖函数体、控制流块、嵌套函数——消除
 * 当前"只扫顶层"的盲区。规则表与功能代码解耦（R6）：新增 op / 新增语法
 * 形态不需要改扫描器，只有"新增被禁能力"才改规则表（数据）。
 *
 * 判定模型 = 能力黑名单（S1）+ 危险语法（S2）+ 危险成员名（S3）+
 * 自由标识符白名单（S4）+ 结构上限（S5）+ 命名空间保护（S7）。
 *
 * 诚实边界（D9）：静态门禁 ≠ 沙箱。无法拦截拼接属性名 `g['ev'+'al']`、
 * 字符串内代码、已获引用二次调用。本方案通过切断能力来源（S4）使残留
 * 失去立足点，但不宣称等价隔离。
 */

import { parse as acornParse } from 'acorn'
import type { Program } from 'acorn'
import { ParseError } from './parse-error'

// ── 类型 ──

/** 安全策略档位。strict = 默认（全规则）；balanced = 本机 CLI；off = 受控调试。 */
export type SecurityPolicy = 'strict' | 'balanced' | 'off'

/** SecurityScanner 规则 ID（封闭集合，禁止自造；测试按此断言）。 */
export type SecurityRuleId =
  | 'SEC_IDENT'
  | 'SEC_SYNTAX'
  | 'SEC_MEMBER'
  | 'SEC_FREE_IDENT'
  | 'SEC_LIMIT'
  | 'SEC_NS_ASSIGN'

/** 违规条目。 */
export interface SecurityViolation {
  /** 规则 ID（见 SecurityRuleId 枚举） */
  ruleId: SecurityRuleId
  /** 1-based 行号，相对传入的原始源码文本（Scanner 不做任何包裹/偏移） */
  lineNo: number
  /** 命中的标识符名 / 属性名 / 节点类型（无则省略） */
  name?: string
  /** 人类可读消息（AI 自纠用） */
  message: string
}

/** 扫描选项。 */
export interface SecurityScanOptions {
  /**
   * 策略档位。**必填**——不允许缺省，调用方必须显式声明（防止无意间关闭门禁）。
   */
  policy: SecurityPolicy
  /**
   * 额外合法名字（S4 判定用：不在 knownNames 也不在 S4_SAFE_GLOBALS → SEC_FREE_IDENT）。
   * 调用方可不传——Scanner 始终自动收集：
   * ① 源码内全部 `ImportDeclaration` 的本地绑定名（named / namespace / default）；
   * ② `opts.defaultNs ?? 'cad'`。
   * 本字段只用于补充"源码里看不到的名字"。
   */
  knownNames?: string[]
  /**
   * 命名空间保护名（S7 判定用：对此列表中的名字做赋值 → SEC_NS_ASSIGN）。
   * 缺省 = knownNames（即所有 knownNames 都受 S7 保护）。
   * 调用方在 append 场景中可传一个更小的集合（仅命名空间名，不含 ctx 普通变量）。
   */
  nsNames?: string[]
  /** 默认命名空间名，缺省 'cad'（自动进入 knownNames） */
  defaultNs?: string
}

/** 扫描结果。 */
export interface SecurityScanResult {
  /** true 当且仅当 violations 为空 */
  ok: boolean
  /** 命中即拒的条目；非空 → 调用方拒绝 */
  violations: SecurityViolation[]
  /** 只告警不拒（目前只有 S5 无界循环） */
  warnings: SecurityViolation[]
}

// ── 规则表（数据驱动，新增规则不改遍历器） ──

/**
 * S1 危险标识符黑名单（引用即拒，不区分读写、不区分声明位置）。
 * S1 优先于一切：即使用户用这些名字声明了自己的变量，也照样拒绝。
 */
const S1_IDENTS = new Set<string>([
  // 执行任意代码
  'eval', 'Function', 'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction',
  // 全局逃逸
  'globalThis', 'window', 'self', 'top', 'parent', 'frames',
  // Node 宿主
  'process', 'require', 'module', 'exports', '__dirname', '__filename',
  // 网络
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator', 'sendBeacon',
  // 浏览器存储/DOM
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'document', 'location', 'cookie',
  // 动态装载
  'importScripts', 'Worker', 'SharedWorker', 'WebAssembly',
  // 定时器/微任务（混淆与延时外发）——仅 strict
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'requestAnimationFrame',
  // 元编程（原型污染族）——仅 strict
  'Reflect', 'Proxy', 'crypto',
])

/** S1 中仅在 strict 档生效的标识符集合。 */
const S1_STRICT_ONLY = new Set<string>([
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'requestAnimationFrame',
  'Reflect', 'Proxy', 'crypto',
])

/**
 * S2 危险语法节点黑名单。
 * key = AST node type；value = true 表示仅 strict 档生效。
 */
const S2_SYNTAX: Record<string, boolean> = {
  ImportExpression: false,       // 动态 import() — strict + balanced
  WithStatement: false,          // with — strict + balanced
  DebuggerStatement: false,      // debugger — strict + balanced
  TaggedTemplateExpression: true, // 标签模板 — 仅 strict
  MetaProperty: false,            // import.meta / new.target — strict + balanced
}

/**
 * S3 危险成员属性名黑名单（MemberExpression.property 的名字命中即拒）。
 */
const S3_MEMBERS = new Set<string>([
  // 原型污染
  '__proto__', 'constructor', 'prototype',
  // getter/setter 注入
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
  // 对象元编程
  'setPrototypeOf', 'defineProperty', 'defineGetter', 'defineSetter',
  // 求值（x.eval 形式）
  'eval',
])

/**
 * S4 安全全局白名单（固定清单，strict 与 balanced 相同）。
 * 不在此名单且不在已声明/knownNames 中的标识符 → SEC_FREE_IDENT 拒绝。
 */
const S4_SAFE_GLOBALS = new Set<string>([
  'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Date',
  'Map', 'Set', 'Promise', 'Symbol', 'RegExp', 'Error',
  'Infinity', 'NaN', 'undefined',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'console',
])

// S5 结构上限
const S5_MAX_SOURCE_LEN = 1 * 1024 * 1024  // 1 MiB
const S5_MAX_TOP_STATEMENTS = 5000
const S5_MAX_NODES = 200_000
const S5_MAX_DEPTH = 100

// S6 子模块装载上限

/** S6 子模块装载深度上限（A3：ModuleRegistry 静态守卫）。 */
export const S6_MAX_DEPTH = 16
/** S6 子模块装载总数上限（A3：ModuleRegistry 静态守卫）。 */
export const S6_MAX_MODULES = 64

// ── 作用域管理 ──

interface Scope {
  /** 本层已声明的名字（var/let/const、函数参数、函数名、解构名、catch 参数、循环绑定） */
  names: Set<string>
  /** 子作用域 */
  parent: Scope | null
}

function createScope(parent: Scope | null): Scope {
  return { names: new Set<string>(), parent }
}

function scopeHas(scope: Scope | null, name: string): boolean {
  let s: Scope | null = scope
  while (s) {
    if (s.names.has(name)) return true
    s = s.parent
  }
  return false
}

// ── 收集 import 绑定名 ──

/** 从 Program.body 收集全部 ImportDeclaration 的本地绑定名。 */
function collectImportBindings(ast: Program): string[] {
  const out: string[] = []
  const body = (ast as unknown as { body: unknown[] }).body
  for (const node of body) {
    const n = node as { type?: string; specifiers?: unknown[] }
    if (n.type !== 'ImportDeclaration') continue
    for (const spec of n.specifiers ?? []) {
      const s = spec as { local?: { name?: string } }
      if (s.local?.name) out.push(s.local.name)
    }
  }
  return out
}

// ── 主扫描器 ──

/**
 * 全量扫描源码文本（返回全部违规）。
 * policy==='off' 时直接返回 `{ ok:true, violations:[], warnings:[] }`。
 * 解析失败时（acorn SyntaxError）不包装不抛——交给调用方的主 acornParse 路径
 * 包装为 E_SYNTAX（Scanner 不重复定义语法错误）。
 *
 * @param code - the .fai.js source text (raw, un-wrapped).
 * @param opts - scan options (policy is required).
 * @returns the full scan result (violations + warnings).
 */
export function scanSource(code: string, opts: SecurityScanOptions): SecurityScanResult {
  if (opts.policy === 'off') {
    return { ok: true, violations: [], warnings: [] }
  }

  // S5: source length check (before parsing)
  if (code.length > S5_MAX_SOURCE_LEN) {
    return {
      ok: false,
      violations: [{
        ruleId: 'SEC_LIMIT',
        lineNo: 1,
        message: `source too long (${code.length} > ${S5_MAX_SOURCE_LEN} bytes)`,
      }],
      warnings: [],
    }
  }

  let ast: Program
  try {
    ast = acornParse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    }) as unknown as Program
  } catch {
    // acorn SyntaxError → 交给调用方的主 acornParse 路径包装为 E_SYNTAX。
    // Scanner 返回 ok=true（无安全违规），让语法错误路径正常处理。
    return { ok: true, violations: [], warnings: [] }
  }
  return scanAst(ast, opts)
}

/**
 * 复用已解析的 AST 进行扫描（避免二次解析）。语义与 scanSource 完全一致。
 *
 * @param ast - the pre-parsed Program AST (with locations enabled).
 * @param opts - scan options (policy is required).
 * @returns the full scan result (violations + warnings).
 */
export function scanAst(ast: Program, opts: SecurityScanOptions): SecurityScanResult {
  if (opts.policy === 'off') {
    return { ok: true, violations: [], warnings: [] }
  }

  const policy = opts.policy
  const defaultNs = opts.defaultNs ?? 'cad'
  const violations: SecurityViolation[] = []
  const warnings: SecurityViolation[] = []

  // 自动收集 import 绑定名 + defaultNs
  const importNames = collectImportBindings(ast)
  const knownNames = new Set<string>([defaultNs, ...importNames])
  for (const n of opts.knownNames ?? []) knownNames.add(n)

  // S7 命名空间保护名：缺省 = knownNames（即所有 knownNames 都受 S7 保护）；
  // 调用方可通过 nsNames 指定更小的集合（仅命名空间名，不含 ctx 普通变量）。
  const s7Names = opts.nsNames ? new Set(opts.nsNames) : knownNames

  // S5 结构上限 —— 判定在遍历前
  const body = (ast as unknown as { body: unknown[] }).body
  if (body.length > S5_MAX_TOP_STATEMENTS) {
    violations.push({
      ruleId: 'SEC_LIMIT',
      lineNo: 1,
      message: `too many top-level statements (${body.length} > ${S5_MAX_TOP_STATEMENTS})`,
    })
  }

  // 准备 strict-only 集合
  const s1Idents = new Set<string>()
  for (const id of S1_IDENTS) {
    if (S1_STRICT_ONLY.has(id) && policy !== 'strict') continue
    s1Idents.add(id)
  }

  const s2Syntax: Record<string, boolean> = {}
  for (const [k, strictOnly] of Object.entries(S2_SYNTAX)) {
    if (strictOnly && policy !== 'strict') continue
    s2Syntax[k] = strictOnly
  }

  let nodeCount = 0

  // 顶层作用域：收集 import 绑定名（已在 knownNames），以及 body 级声明
  const globalScope = createScope(null)
  for (const n of importNames) globalScope.names.add(n)

  // 遍历 AST
  walkNode(ast as unknown as ASTNode, null, 0)

  if (nodeCount > S5_MAX_NODES) {
    violations.push({
      ruleId: 'SEC_LIMIT',
      lineNo: 1,
      message: `too many AST nodes (${nodeCount} > ${S5_MAX_NODES})`,
    })
  }

  return {
    ok: violations.length === 0,
    violations,
    warnings,
  }

  // ── 递归 walker ──

  function lineOf(node: ASTNode): number {
    return node?.loc?.start?.line ?? 1
  }

  function addViolation(ruleId: SecurityRuleId, lineNo: number, name: string, message: string): void {
    violations.push({ ruleId, lineNo, name, message })
  }

  /**
   * 收集函数参数中的声明名（含默认参数、解构）。
   */
  function collectParamNames(params: ASTNode[], scope: Scope): void {
    for (const p of params ?? []) {
      collectPatternNames(p, scope)
    }
  }

  /**
   * 从解构/标识符模式收集名字（用于作用域登记）。
   */
  function collectPatternNames(pattern: ASTNode, scope: Scope): void {
    if (!pattern) return
    switch (pattern.type) {
      case 'Identifier':
        scope.names.add(pattern.name)
        return
      case 'ObjectPattern':
        for (const prop of pattern.properties ?? []) {
          if (prop?.type === 'Property') collectPatternNames(prop.value, scope)
          else if (prop?.type === 'RestElement') collectPatternNames(prop.argument, scope)
        }
        return
      case 'ArrayPattern':
        for (const el of pattern.elements ?? []) {
          if (el) collectPatternNames(el, scope)
        }
        return
      case 'AssignmentPattern':
        collectPatternNames(pattern.left, scope)
        return
      case 'RestElement':
        collectPatternNames(pattern.argument, scope)
        return
      default:
        return
    }
  }

  /**
   * 收集一个节点体内全部声明名（VariableDeclarator + FunctionDeclaration 等）。
   * 用于函数体 / 块体遍历前先登记声明（提升语义）。
   */
  function collectDeclarations(body: ASTNode[], scope: Scope): void {
    for (const node of body ?? []) {
      if (!node) continue
      switch (node.type) {
        case 'VariableDeclaration':
          for (const decl of node.declarations ?? []) {
            collectPatternNames(decl?.id, scope)
          }
          break
        case 'FunctionDeclaration':
        case 'ClassDeclaration':
          if (node.id?.type === 'Identifier') scope.names.add(node.id.name)
          break
        default:
          break
      }
    }
  }

  function walkNode(node: ASTNode, scope: Scope | null, depth: number): void {
    if (!node || typeof node !== 'object') return

    nodeCount++
    if (depth > S5_MAX_DEPTH) {
      addViolation('SEC_LIMIT', lineOf(node), node.type ?? 'unknown', `AST nesting depth exceeds ${S5_MAX_DEPTH}`)
      return
    }

    // ── S2 危险语法节点 ──
    if (s2Syntax[node.type] !== undefined) {
      addViolation('SEC_SYNTAX', lineOf(node), node.type, `[security] dangerous syntax: ${node.type}`)
      // 继续遍历子节点（可能内部有更多违规），但不中断
    }

    // 按节点类型处理
    switch (node.type) {
      // ── Program ──
      case 'Program': {
        const programBody = node.body as ASTNode[]
        collectDeclarations(programBody, scope ?? globalScope)
        for (const child of programBody) walkNode(child, scope ?? globalScope, depth + 1)
        return
      }

      // ── Import 声明：不遍历（绑定已自动收集） ──
      case 'ImportDeclaration':
        return

      // ── Export 声明 ──
      case 'ExportDefaultDeclaration':
        walkNode(node.declaration, scope, depth + 1)
        return
      case 'ExportNamedDeclaration':
        if (node.declaration) walkNode(node.declaration, scope, depth + 1)
        return

      // ── 函数声明 ──
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        // 函数名在父作用域（FunctionDeclaration 提升到父层）
        if (node.type === 'FunctionDeclaration' && node.id?.name && scope) {
          scope.names.add(node.id.name)
        }
        const fnScope = createScope(scope)
        collectParamNames(node.params ?? [], fnScope)
        // 函数体提升：先收集体内全部声明
        if (node.body?.type === 'BlockStatement') {
          collectDeclarations(node.body.body ?? [], fnScope)
        }
        // 遍历参数（含默认值）
        for (const p of node.params ?? []) walkNode(p, fnScope, depth + 1)
        // 遍历函数体
        if (node.body) walkNode(node.body, fnScope, depth + 1)
        return
      }

      // ── 变量声明 ──
      case 'VariableDeclaration': {
        for (const decl of node.declarations ?? []) {
          // 声明名登记（pattern 里的名字入当前 scope）
          if (scope) collectPatternNames(decl?.id, scope)
          // 遍历初始化表达式
          if (decl?.init) walkNode(decl.init, scope, depth + 1)
          // 遍历 pattern 本身（解构默认值等）
          walkPattern(decl?.id, scope, depth + 1)
        }
        return
      }

      // ── 块语句 ──
      case 'BlockStatement': {
        const blockScope = createScope(scope)
        collectDeclarations(node.body ?? [], blockScope)
        for (const child of node.body ?? []) walkNode(child, blockScope, depth + 1)
        return
      }

      // ── 控制流 ──
      case 'IfStatement':
        walkNode(node.test, scope, depth + 1)
        walkNode(node.consequent, scope, depth + 1)
        if (node.alternate) walkNode(node.alternate, scope, depth + 1)
        return

      case 'ForStatement': {
        const forScope = createScope(scope)
        if (node.init) {
          // for(let i=...) 的 i 入 forScope
          if (node.init.type === 'VariableDeclaration') {
            for (const decl of node.init.declarations ?? []) {
              collectPatternNames(decl?.id, forScope)
              walkNode(decl, forScope, depth + 1)
            }
          } else {
            walkNode(node.init, forScope, depth + 1)
          }
        }
        if (node.test) walkNode(node.test, forScope, depth + 1)
        if (node.update) walkNode(node.update, forScope, depth + 1)
        // S5: 无界循环告警
        if (node.test === null || node.test === undefined) {
          warnings.push({
            ruleId: 'SEC_LIMIT',
            lineNo: lineOf(node),
            name: 'for(;;)',
            message: 'unbounded for loop (no test condition) — may hang',
          })
        }
        if (node.body) walkNode(node.body, forScope, depth + 1)
        return
      }

      case 'ForInStatement':
      case 'ForOfStatement': {
        const forScope = createScope(scope)
        if (node.left?.type === 'VariableDeclaration') {
          for (const decl of node.left.declarations ?? []) {
            collectPatternNames(decl?.id, forScope)
            walkNode(decl, forScope, depth + 1)
          }
        } else if (node.left?.type === 'Identifier') {
          forScope.names.add(node.left.name)
        }
        if (node.right) walkNode(node.right, forScope, depth + 1)
        if (node.body) walkNode(node.body, forScope, depth + 1)
        return
      }

      case 'WhileStatement':
        walkNode(node.test, scope, depth + 1)
        // S5: while(true) 告警
        if (node.test?.type === 'Literal' && node.test.value === true) {
          warnings.push({
            ruleId: 'SEC_LIMIT',
            lineNo: lineOf(node),
            name: 'while(true)',
            message: 'unbounded while(true) loop — may hang',
          })
        }
        if (node.body) walkNode(node.body, scope, depth + 1)
        return

      case 'DoWhileStatement':
        if (node.body) walkNode(node.body, scope, depth + 1)
        walkNode(node.test, scope, depth + 1)
        if (node.test?.type === 'Literal' && node.test.value === true) {
          warnings.push({
            ruleId: 'SEC_LIMIT',
            lineNo: lineOf(node),
            name: 'do...while(true)',
            message: 'unbounded do...while(true) loop — may hang',
          })
        }
        return

      case 'SwitchStatement': {
        const swScope = createScope(scope)
        walkNode(node.discriminant, scope, depth + 1)
        for (const c of node.cases ?? []) {
          if (c.test) walkNode(c.test, swScope, depth + 1)
          for (const stmt of c.consequent ?? []) walkNode(stmt, swScope, depth + 1)
        }
        return
      }

      case 'TryStatement': {
        walkNode(node.block, scope, depth + 1)
        if (node.handler) {
          const handlerScope = createScope(scope)
          if (node.handler.param) collectPatternNames(node.handler.param, handlerScope)
          if (node.handler.param) walkNode(node.handler.param, handlerScope, depth + 1)
          walkNode(node.handler.body, handlerScope, depth + 1)
        }
        if (node.finalizer) walkNode(node.finalizer, scope, depth + 1)
        return
      }

      case 'CatchClause': {
        const catchScope = createScope(scope)
        if (node.param) {
          collectPatternNames(node.param, catchScope)
          walkNode(node.param, catchScope, depth + 1)
        }
        collectDeclarations(node.body?.body ?? [], catchScope)
        if (node.body) walkNode(node.body, catchScope, depth + 1)
        return
      }

      // ── LabeledStatement ──
      case 'LabeledStatement':
        if (node.body) walkNode(node.body, scope, depth + 1)
        return

      // ── Return / Throw ──
      case 'ReturnStatement':
      case 'ThrowStatement':
        if (node.argument) walkNode(node.argument, scope, depth + 1)
        return

      // ── ExpressionStatement ──
      case 'ExpressionStatement':
        walkNode(node.expression, scope, depth + 1)
        return

      // ── 表达式 ──
      case 'Identifier': {
        const name = node.name
        // S1 危险标识符黑名单
        if (s1Idents.has(name)) {
          addViolation('SEC_IDENT', lineOf(node), name, `[security] SEC_IDENT line ${lineOf(node)}: "${name}" is not allowed`)
          return
        }
        // S4 自由标识符白名单判定
        if (scopeHas(scope, name) || knownNames.has(name) || S4_SAFE_GLOBALS.has(name)) {
          return
        }
        // 未声明的自由标识符
        addViolation('SEC_FREE_IDENT', lineOf(node), name, `[security] SEC_FREE_IDENT line ${lineOf(node)}: unknown identifier "${name}" (not declared, not a known namespace)`)
        return
      }

      case 'MemberExpression': {
        // S1 优先于一切：先遍历 object（让 Identifier 先命中 S1/S4），
        // 再检查 S3 危险成员名。这样 globalThis.eval 先命中 SEC_IDENT(globalThis)。
        walkNode(node.object, scope, depth + 1)
        if (node.computed && node.property?.type !== 'Literal') {
          walkNode(node.property, scope, depth + 1)
        }
        // S3 危险成员名（在 object 遍历后检查，确保 S1 优先级）
        const propName = node.property?.type === 'Identifier' ? node.property.name
          : node.property?.type === 'Literal' ? String(node.property.value)
          : null
        if (propName && S3_MEMBERS.has(propName)) {
          addViolation('SEC_MEMBER', lineOf(node), propName, `[security] SEC_MEMBER line ${lineOf(node)}: dangerous member "${propName}"`)
        }
        return
      }

      case 'CallExpression':
        walkNode(node.callee, scope, depth + 1)
        for (const arg of node.arguments ?? []) walkNode(arg, scope, depth + 1)
        return

      case 'NewExpression':
        walkNode(node.callee, scope, depth + 1)
        for (const arg of node.arguments ?? []) walkNode(arg, scope, depth + 1)
        return

      case 'AssignmentExpression': {
        // S7 命名空间保护：禁止对 s7Names 中的名字做赋值
        const target = node.left
        if (target?.type === 'Identifier' && s7Names.has(target.name)) {
          addViolation('SEC_NS_ASSIGN', lineOf(node), target.name, `[security] SEC_NS_ASSIGN line ${lineOf(node)}: cannot assign to namespace "${target.name}"`)
        }
        // MemberExpression 赋值：cad.box = ...
        if (target?.type === 'MemberExpression' && target.object?.type === 'Identifier' && s7Names.has(target.object.name)) {
          addViolation('SEC_NS_ASSIGN', lineOf(node), target.object.name, `[security] SEC_NS_ASSIGN line ${lineOf(node)}: cannot assign to member of namespace "${target.object.name}"`)
        }
        walkNode(node.left, scope, depth + 1)
        walkNode(node.right, scope, depth + 1)
        return
      }

      case 'BinaryExpression':
      case 'LogicalExpression':
        walkNode(node.left, scope, depth + 1)
        walkNode(node.right, scope, depth + 1)
        return

      case 'UnaryExpression':
      case 'UpdateExpression':
        walkNode(node.argument, scope, depth + 1)
        return

      case 'ConditionalExpression':
        walkNode(node.test, scope, depth + 1)
        walkNode(node.consequent, scope, depth + 1)
        walkNode(node.alternate, scope, depth + 1)
        return

      case 'ArrayExpression':
        for (const el of node.elements ?? []) {
          if (el) walkNode(el, scope, depth + 1)
        }
        return

      case 'ObjectExpression':
        for (const prop of node.properties ?? []) {
          if (prop?.type === 'Property') {
            // key 是标识符且非 computed → 不需要检查（对象字面量 key 不是标识符引用）
            if (prop.computed && prop.key) walkNode(prop.key, scope, depth + 1)
            if (prop.value) walkNode(prop.value, scope, depth + 1)
          } else {
            // SpreadElement 等
            walkNode(prop, scope, depth + 1)
          }
        }
        return

      case 'TemplateLiteral':
        for (const expr of node.expressions ?? []) walkNode(expr, scope, depth + 1)
        return

      case 'TaggedTemplateExpression':
        // S2 已在上方判定；仍遍历 tag 与 quasi
        walkNode(node.tag, scope, depth + 1)
        if (node.quasi) walkNode(node.quasi, scope, depth + 1)
        return

      case 'AwaitExpression':
        if (node.argument) walkNode(node.argument, scope, depth + 1)
        return

      case 'YieldExpression':
        if (node.argument) walkNode(node.argument, scope, depth + 1)
        return

      case 'SpreadElement':
        if (node.argument) walkNode(node.argument, scope, depth + 1)
        return

      case 'SequenceExpression':
        for (const expr of node.expressions ?? []) walkNode(expr, scope, depth + 1)
        return

      case 'ParenthesizedExpression':
        if (node.expression) walkNode(node.expression, scope, depth + 1)
        return

      case 'ChainExpression':
        if (node.expression) walkNode(node.expression, scope, depth + 1)
        return

      case 'MetaProperty':
        // S2 已在上方判定（import.meta / new.target）
        return

      case 'ImportExpression':
        // S2 已在上方判定（动态 import()）
        for (const arg of node.arguments ?? []) walkNode(arg, scope, depth + 1)
        return

      case 'ClassDeclaration':
      case 'ClassExpression': {
        if (node.id?.name && scope) scope.names.add(node.id.name)
        const clsScope = createScope(scope)
        if (node.superClass) walkNode(node.superClass, clsScope, depth + 1)
        if (node.body) walkNode(node.body, clsScope, depth + 1)
        return
      }

      case 'ClassBody':
        for (const method of node.body ?? []) {
          walkNode(method, scope, depth + 1)
        }
        return

      case 'MethodDefinition':
      case 'PropertyDefinition':
        if (node.key && node.computed) walkNode(node.key, scope, depth + 1)
        if (node.value) walkNode(node.value, scope, depth + 1)
        return

      case 'WithStatement':
        // S2 已判定
        walkNode(node.object, scope, depth + 1)
        if (node.body) walkNode(node.body, scope, depth + 1)
        return

      case 'DebuggerStatement':
        // S2 已判定
        return

      case 'ContinueStatement':
      case 'BreakStatement':
        return

      case 'EmptyStatement':
        return

      case 'Literal':
        return

      case 'Super':
        return

      case 'ThisExpression':
        return

      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        return

      case 'ExportSpecifier':
        return

      default:
        // 未知节点：递归遍历其子属性
        walkChildren(node, scope, depth)
        return
    }
  }

  function walkPattern(pattern: ASTNode, scope: Scope | null, depth: number): void {
    if (!pattern) return
    switch (pattern.type) {
      case 'Identifier':
        return // 已在 collectPatternNames 中登记
      case 'ObjectPattern':
        for (const prop of pattern.properties ?? []) {
          if (prop?.type === 'Property') {
            if (prop.computed && prop.key) walkNode(prop.key, scope, depth + 1)
            if (prop.value) walkPattern(prop.value, scope, depth + 1)
          } else if (prop?.type === 'RestElement') {
            walkPattern(prop.argument, scope, depth + 1)
          }
        }
        return
      case 'ArrayPattern':
        for (const el of pattern.elements ?? []) {
          if (el) walkPattern(el, scope, depth + 1)
        }
        return
      case 'AssignmentPattern':
        if (pattern.right) walkNode(pattern.right, scope, depth + 1)
        walkPattern(pattern.left, scope, depth + 1)
        return
      case 'RestElement':
        walkPattern(pattern.argument, scope, depth + 1)
        return
      default:
        return
    }
  }

  function walkChildren(node: ASTNode, scope: Scope | null, depth: number): void {
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'parent' || key === 'type') continue
      const v = (node as Record<string, unknown>)[key]
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && 'type' in item) {
            walkNode(item as ASTNode, scope, depth + 1)
          }
        }
      } else if (v && typeof v === 'object' && 'type' in v) {
        walkNode(v as ASTNode, scope, depth + 1)
      }
    }
  }
}

// ── 类型别名 ──
type ASTNode = any

// ── 门禁断言 ──

/**
 * 门禁断言：violations 非空则抛 ParseError（code='E_SECURITY'，ruleId 挂 ParseError.ruleId）。
 * 三处接入点（A1/A2/A3）统一用它。
 *
 * @param code - the .fai.js source text (raw, un-wrapped).
 * @param opts - scan options (policy is required).
 * @throws ParseError — when violations are non-empty (code='E_SECURITY').
 */
export function assertSecure(code: string, opts: SecurityScanOptions): void {
  const result = scanSource(code, opts)
  if (result.violations.length > 0) {
    const v = result.violations[0]
    throw new ParseError(
      v.message,
      v.lineNo,
      'E_SECURITY',
      undefined,
      v.ruleId,
    )
  }
}
