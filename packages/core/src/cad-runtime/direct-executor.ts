/**
 * direct-executor — 无 IR 执行器（.fai.js 源码直通 JS VM）
 *
 * 方案：docs/plans/2026-09-06-no-ir-dual-channel-runtime.md §4.2（D1 / P2）
 *
 * 核心语义：源码文本按**执行单元**（顶层语句，行号即语句边界）直接交给 JS VM
 * 执行——没有语句模型、没有 deps、没有表达式折叠、没有 outputs 投影、没有 IR
 * 编译（不 import parser.ts / compile.ts）。共享 `ctx` 是唯一持久状态。
 *
 * 每单元的文本变换（机械、语义保持，非 IR 编译）：
 * - `const/let x = <call>` / `x = <call>` → `__ctx.x = <call>`；实参里的裸标识符
 *   （已声明变量/参数）→ `__ctx.<name>`；
 * - 调用前插 `await`（与 compile 发射对每个 ns 调用 await 的语义一致；同步 op
 *   被 await 是合法 JS）；
 * - keep/keepHidden 尾随键剥离（行内 keep 由 MetadataExtractor 的 metadata.keep
 *   表另存，§4.4 消费判定用——执行侧不传）；
 * - 顶层函数定义提升到 `__ctx.<name>`（函数体 cad 等经命名空间绑定注入）；
 * - import 行不执行（库装载在 runtime 层；`ns.<binding>` 经命名空间对象访问）。
 *
 * 错误定位：单行单元失败记 failedAt（{ index, callee, message } + lineNo）。
 *
 * 本文件是 P2 新增组件；ModuleExecutor 路径（旧）在 P6 门禁前保留双路径共存。
 */

import { parse as acornParse } from 'acorn'
import type { Namespaces } from './module-executor'
import type { PartName } from '../identity'
import { asPartName } from '../identity'
import { ParseError } from '../lang/parse-error'
import { setCurrentStmt, setKeepSink, setName } from '../runtime-state'
import { ExecutionLimitError } from './execution-limit-error'
import type { StatementIR } from '../lang/types'

type ASTNode = any

// ── 结果类型 ──

/** 执行单元失败信息（与现状 failedAt 三字段兼容 + 新增 lineNo）。 */
export interface DirectExecFailedAt {
  index: number
  callee: string
  message: string
  lineNo?: number
}

/** 单轮执行产出：ctx 快照 + 失败信息 + 已执行行号。 */
export interface DirectExecOutcome {
  /** 语句执行后 ctx 全部键 */
  ctxKeys: string[]
  /** 失败信息（无失败为 undefined） */
  failedAt?: DirectExecFailedAt
  /** 本轮新执行的行号（append 增量边界回显） */
  executedLines: number[]
}

/** 单次执行的参数。 */
export interface DirectExecOpts {
  /** 参数表：执行前预置到 ctx（ExecuteOptions.params 同义；参数行不执行） */
  params?: Record<string, unknown>
  /** 单元序数起始（startIndex 语义：行号之前的单元不执行，产物假定已在 ctx） */
  startLine?: number
  /**
   * 单元执行前钩子（undo 逐单元快照；§4.10 E4）：每执行一个单元触发一次。
   * 第一参数 = 单元 id（`'s'+行号`，与 StatementSummary.id 同构——宿主按 id
   * 定位 summaries 不破裂）；第二参数 = 行号。append 只对新单元触发。
   */
  beforeStatement?: (stmtId: string, lineNo: number) => void
  /**
   * 整轮执行超时（§6.3 / D8，E_EXEC_LIMIT）：单元循环内逐单元检查 deadline，
   * 超时抛 {@link ExecutionLimitError}。不传则无超时（现状行为不变）。
   */
  executionTimeoutMs?: number
}

interface TransformedUnit {
  lineNo: number
  /** 变换后的可执行语句文本（嵌入 async wrapper 的 body） */
  body: string
  /** 本单元写入的 ctx 键 */
  writes: string[]
  /** 本单元引用的变量名（append 前缀校验；来自实参裸标识符） */
  refs: string[]
  callee?: string
}

/** 函数体 keep 登记（与 module-executor.internalKeep 同构；键 = 单元行号）。 */
export interface ExecKeepRecord {
  kept: Set<PartName>
  hidden: Map<PartName, boolean>
}

// ── DirectExecutor ──

/** DirectExecutor 构造选项：执行期可访问的已装配命名空间集合。 */
export interface DirectExecutorOptions {
  /** 已装配命名空间（cad + registerLib 注册库）；单元经 __ns.<binding> 访问 */
  namespaces: Namespaces
}

/**
 * DirectExecutor executes `.fai.js` source text directly in the JS VM. Each
 * top-level statement is transformed mechanically (ctx hoisting + await
 * insertion + keep stripping) and run in an async wrapper against a shared
 * persistent `ctx`. No statement model, no deps, no folding, no IR.
 */
export class DirectExecutor {
  /** 持久变量容器（跨 execute/append/update 存活；与 ModuleExecutor.ctx 同角色） */
  readonly ctx: Record<string, unknown> = {}
  private executedLines = new Set<number>()
  private namespaces: Namespaces
  /** 当前完整源码（append 拼接用） */
  private fullCode = ''
  /** 函数体 keep 登记（exec.keep/exec.keepHidden 执行期登记；键 = 单元行号） */
  private readonly keepByLine = new Map<number, ExecKeepRecord>()
  /** 当前正在执行的单元行号（keep 登记归属锚点） */
  private activeLine: number | undefined

  constructor(options: DirectExecutorOptions) {
    this.namespaces = options.namespaces
  }

  /**
   * 热更新命名空间集合（registerLib 后）。
   * @param namespaces - 新的命名空间集合（含 cad 与全部注册库绑定）。
   */
  setNamespaces(namespaces: Namespaces): void {
    this.namespaces = namespaces
  }

  /**
   * 函数体 keep 登记读（computeLiveShapes 的 KeepView.functionBody 输入；行号键）。
   * @param lineNo - 单元行号（exec.keep 执行期登记的归属锚点）。
   * @returns 该行号的函数体 keep 登记；无登记返回 undefined。
   */
  getKeepByLine(lineNo: number): ExecKeepRecord | undefined {
    return this.keepByLine.get(lineNo)
  }

  /**
   * 全部 keep 登记（调试/测试）。
   * @returns 已登记的行号列表（升序）。
   */
  listKeepLines(): number[] {
    return [...this.keepByLine.keys()].sort((a, b) => a - b)
  }

  /**
   * 读持久 ctx 变量。
   * @param name - 变量名。
   * @returns 当前值；未定义返回 undefined。
   */
  getCtxVar(name: string): unknown {
    return this.ctx[name]
  }

  /**
   * 写持久 ctx 变量（参数预置等）。
   * @param name - 变量名。
   * @param value - 待写入值。
   */
  setCtxVar(name: string, value: unknown): void {
    this.ctx[name] = value
  }

  /**
   * 持久 ctx 的全部键（append/执行结果组装扫描用）。
   * @returns 当前 ctx 键数组。
   */
  listCtxKeys(): string[] {
    return Object.keys(this.ctx)
  }

  /**
   * 已执行单元行号（append 增量边界回显）。
   * @returns 已执行行号升序数组。
   */
  get executedUnitLines(): number[] {
    return [...this.executedLines].sort((a, b) => a - b)
  }

  /** 清空 ctx 与状态（execute 全量 / dispose 用）。函数体 keep 登记一并清——全量重跑
   *  后行号键表只应含本场景的登记；不清理会泄漏上一场景的同行号登记（对拍红线）。 */
  reset(): void {
    for (const key of Object.keys(this.ctx)) delete this.ctx[key]
    this.executedLines.clear()
    this.fullCode = ''
    this.keepByLine.clear()
  }

  /**
   * 全量执行（R3 update 语义同：清 ctx 重跑）。
   * @param code - .fai.js 源码文本（扁平 op 行 / 容器体）。
   * @param opts - 参数与起始行。
   * @returns 执行产出（ctx 键快照 / failedAt / 已执行行号）。
   */
  async execute(code: string, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    this.reset()
    this.fullCode = code
    return this.runCode(code, opts)
  }

  /**
   * append 增量执行：共享 ctx 只执行新单元（行号 > 旧行集合）。
   * 前置缺失（引用不在 ctx 的变量）由调用方校验（AppendPrefixError 语义保留在 runtime）。
   * @param code - 新增语句文本。
   * @param opts - 参数与起始行（可选）。
   * @returns 执行产出（ctx 键快照 / failedAt / 本轮新执行行号）。
   */
  async append(code: string, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    const fullCode = this.fullCode === '' ? code : `${this.fullCode}\n${code}`
    this.fullCode = fullCode
    return this.runCode(fullCode, opts)
  }

  /**
   * update：参数/文本变更 → 全量重跑（R3；用户接受）。
   * @param _oldCode - 变更前文本（签名兼容保留；全量重跑不使用）。
   * @param newCode - 变更后文本。
   * @param opts - 参数与起始行（可选）。
   * @returns 执行产出（ctx 键快照 / failedAt / 已执行行号）。
   */
  async update(_oldCode: string, newCode: string, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    return this.execute(newCode, opts)
  }

  // ── 主流程 ──

  private async runCode(code: string, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    // 参数预置（ExecuteOptions.params → ctx；参数行不执行，与现状语义一致）
    for (const [k, v] of Object.entries(opts?.params ?? {})) this.ctx[k] = v

    // keep 登记 sink（函数体 exec.keep / exec.keepHidden 执行期登记 → 行号键表；
    // 替代 ModuleExecutor.internalKeep 的 StmtId 键——DirectExecutor 无语句模型）
    setKeepSink((_stmtId, names, hidden) => this.registerKeepByLine(names, hidden))
    try {
      const units = this.parseAndTransform(code)
      const executedLines: number[] = []
      let failedAt: DirectExecFailedAt | undefined

      // 整轮超时（§6.3 / D8，E_EXEC_LIMIT）：单元循环内逐单元检查 deadline。
      // 自由 JS 块内部的单条死循环不在单元间插桩范围内 → 仍会卡死（R-7：v2 用
      // Worker 终止块内执行）；本次交付覆盖"逐单元执行"路径的超时护栏。
      const timeoutMs = opts?.executionTimeoutMs
      const deadline = timeoutMs !== undefined && timeoutMs > 0 ? Date.now() + timeoutMs : undefined

      let order = 0
      for (const unit of units) {
        const idx = order++
        if (opts?.startLine !== undefined && unit.lineNo < opts.startLine) continue
        if (this.executedLines.has(unit.lineNo)) continue
        if (deadline !== undefined && Date.now() >= deadline) {
          throw new ExecutionLimitError(timeoutMs ?? 0)
        }
        opts?.beforeStatement?.(`s${unit.lineNo}`, unit.lineNo)
        try {
          this.activeLine = unit.lineNo
          await this.runUnit(unit)
          // 写后登记 shape→name（与 ModuleExecutor.afterStatement 的 setName 同构）：
          // 库函数体 exec.keep/keepHidden 经 nameOf(shape) 反查变量名，缺少登记则输入
          // 保留声明静默失效（terminal 判定会误把 kept 输入当消费）。
          for (const w of unit.writes) {
            const v = this.ctx[w]
            if (v !== null && typeof v === 'object') setName(v, asPartName(w))
          }
          this.executedLines.add(unit.lineNo)
          executedLines.push(unit.lineNo)
        } catch (err) {
          if (err instanceof ParseError) throw err
          failedAt = {
            index: idx,
            callee: unit.callee ?? '',
            message: err instanceof Error ? err.message : String(err),
            lineNo: unit.lineNo,
          }
          break
        } finally {
          this.activeLine = undefined
        }
      }
      return { ctxKeys: Object.keys(this.ctx), failedAt, executedLines }
    } finally {
      // 任何路径（含 ExecutionLimitError / ParseError 中断）都清 sink，防泄漏到下一执行
      setKeepSink(undefined)
    }
  }

  /**
   * Append 前缀校验（runtime 层 AppendPrefixError 语义保留，E2）：把待 append 的
   * 新语句拼到 fullCode 后解析，对「尚未执行」的单元逐个校验 refs——引用必须已由
   * 持久 ctx（先前执行产出）或本批更早单元产出。与 module-executor 的
   * assertAppendPrefix 同语义；缺引用 → 返回首个 {unitLine, varName}。
   * @param code - 待 append 的新语句文本（runtime 传新行）。
   * @returns 首个缺失引用；无缺失返回 undefined。
   */
  missingPrefixVar(code: string): { unitLine: number; varName: string } | undefined {
    const fullCode = this.fullCode === '' ? code : `${this.fullCode}\n${code}`
    const units = this.parseAndTransform(fullCode)
    const available = new Set<string>(Object.keys(this.ctx))
    for (const unit of units) {
      if (!this.executedLines.has(unit.lineNo)) {
        for (const ref of unit.refs) {
          if (!available.has(ref)) return { unitLine: unit.lineNo, varName: ref }
        }
      }
      for (const w of unit.writes) available.add(w)
    }
    return undefined
  }

  /** 单单元执行：变换文本嵌入 async fn，以 __ctx/__ns 实参调用。 */
  private async runUnit(unit: TransformedUnit): Promise<void> {
    const src = `return (async () => {\n${unit.body}\n})()`
    const fn = new Function('__ctx', '__ns', src)
    // 执行锚点：库函数体 exec.keep / primitive 命名读 getCurrentStmt()?.outputs
    // ——DirectExecutor 无 StatementIR，用「行号 + 本单元写键」的轻量锚点（P4 过渡，
    // 不构造 IR 语句；库只读 id/outputs 两个字段，见 runtime-state / api）。
    const anchor = {
      id: `s${unit.lineNo}`,
      outputs: unit.writes,
      hasAssignment: unit.writes.length > 0,
    } as unknown as StatementIR
    setCurrentStmt(anchor)
    try {
      await fn(this.ctx, this.namespaces)
    } finally {
      setCurrentStmt(undefined)
    }
  }

  /** 行号 → 函数体 keep 登记（exec.keep/exec.keepHidden；与 live-shapes KeepView 对齐）。 */
  private registerKeepByLine(names: PartName[], hidden: boolean): void {
    if (this.activeLine === undefined) return
    let rec = this.keepByLine.get(this.activeLine)
    if (!rec) {
      rec = { kept: new Set(), hidden: new Map() }
      this.keepByLine.set(this.activeLine, rec)
    }
    for (const n of names) {
      rec.kept.add(n)
      rec.hidden.set(n, hidden)
    }
  }

  // ── 解析与变换 ──

  /** 顶层 import/export 之外的容器体（扁平/容器归一）：取 export default 箭头体。 */
  private parseBody(code: string): { nodes: ASTNode[]; lineOffset: number; parseText: string } {
    let parseCode = code
    let lineOffset = 0
    if (!code.includes('export default')) {
      parseCode = `export default async (__nsArg) => {\n${code}\n}`
      lineOffset = 1
    }
    let ast: ASTNode
    try {
      ast = acornParse(parseCode, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true })
    } catch (err) {
      const e = err as { message?: string; loc?: { line?: number } }
      throw new ParseError(`SyntaxError: ${e.message ?? String(err)}`, (e.loc?.line ?? 1) - lineOffset, 'E_SYNTAX')
    }
    const exportDecl = ast.body.find((n: ASTNode) => n.type === 'ExportDefaultDeclaration')
    if (!exportDecl) throw new ParseError('missing `export default`', 1)
    const arrow = exportDecl.declaration
    if (arrow?.type !== 'ArrowFunctionExpression' || arrow.body?.type !== 'BlockStatement') {
      throw new ParseError('expected async arrow container body', 1)
    }
    return { nodes: arrow.body.body as ASTNode[], lineOffset, parseText: parseCode }
  }

  /** 解析并变换全部顶层单元。 */
  private parseAndTransform(code: string): TransformedUnit[] {
    const { nodes, lineOffset, parseText } = this.parseBody(code)
    const declared = new Set<string>() // 累积：参数名 + outputs + 函数名
    const units: TransformedUnit[] = []
    for (const node of nodes) {
      if (node.type === 'ImportDeclaration') continue // import 行不执行
      const rawLine = (node?.loc?.start?.line ?? 1) - lineOffset
      const unit = this.transformTopNode(node, parseText, declared, rawLine)
      if (unit) units.push(unit)
    }
    return units
  }

  private transformTopNode(
    node: ASTNode,
    code: string,
    declared: Set<string>,
    lineNo: number,
  ): TransformedUnit | null {
    switch (node.type) {
      case 'FunctionDeclaration':
        return this.transformFunction(node, code, declared, lineNo)
      case 'VariableDeclaration':
        return this.transformVariable(node, code, declared, lineNo)
      case 'ExpressionStatement':
        return this.transformExpressionStatement(node, code, declared, lineNo)
      case 'ReturnStatement':
        // 容器/自由 JS 的顶层 return（AI 手写 .fai.js）：return 只表达 UI meta /
        // 显式终端，不构成执行单元（几何产物都写在 ctx）。忽略执行。
        return null
      default:
        throw new ParseError(
          `DirectExecutor v1 supports flat op-line code only; "${node.type}" execution is not supported yet (see P5 free-JS blocks)`,
          lineNo,
          'E_CONTROL_FLOW',
        )
    }
  }

  /** 顶层函数提升：`__ctx.<name> = async function <name>(...) { 命名空间绑定; 体 }`。 */
  private transformFunction(node: ASTNode, code: string, declared: Set<string>, lineNo: number): TransformedUnit {
    const name = node.id?.name
    if (!name) throw new ParseError('function declaration must have a name', lineNo, 'E_STATEMENT')
    const params = (node.params ?? []).map((p: ASTNode) => p?.name).filter((x: unknown): x is string => typeof x === 'string')
    const bodyText = code.slice(node.body.start + 1, node.body.end - 1)
    const nsNames = Object.keys(this.namespaces).filter((k) => k !== 'contractVersion')
    const binds = nsNames.map((n) => `  const ${n} = __ns.${n}`).join('\n')
    const body = [
      `__ctx.${name} = async function ${name}(${params.join(', ')}) {`,
      binds,
      bodyText,
      '}',
    ].join('\n')
    // 本机函数体引用其它本机函数/变量走 __ctx（与顶层一致）
    declared.add(name)
    return { lineNo, body, writes: [name], refs: [], callee: name }
  }

  /** const/let 行：参数（字面量）直接进 ctx；op 行变换调用；派生常量求值。 */
  private transformVariable(node: ASTNode, code: string, declared: Set<string>, lineNo: number): TransformedUnit {
    if (node.kind !== 'const' && node.kind !== 'let') {
      throw new ParseError(`only 'const' or 'let' declarations allowed, got '${node.kind}'`, lineNo, 'E_STATEMENT')
    }
    if (node.declarations.length !== 1) {
      throw new ParseError('multi-declarator const statements are not supported yet', lineNo, 'E_STATEMENT')
    }
    const d = node.declarations[0]
    const dLine = (d?.loc?.start?.line ?? lineNo)
    // 解构 op 行：const { front: a } = cad.fai_split(...)
    if (d?.id?.type === 'ObjectPattern') {
      const props = d.id.properties as ASTNode[]
      const keys: string[] = []
      const binds: string[] = []
      for (const prop of props) {
        if (prop.type !== 'Property') throw new ParseError('unsupported destructuring property', dLine, 'E_STATEMENT')
        keys.push(String(prop.key?.name ?? prop.key?.value))
        binds.push(String(prop.value?.name))
      }
      let init = d.init
      if (init?.type === 'AwaitExpression') init = init.argument
      const call = this.emitCall(init, code, declared, dLine)
      const writes = binds.map((b) => `__ctx.${b} = ${b}`)
      const pair = keys.map((k, i) => `${k}: ${binds[i]}`).join(', ')
      const body = [`const { ${pair} } = ${call}`, ...writes].join('\n')
      for (const b of binds) declared.add(b)
      return { lineNo, body, writes: binds, refs: this.collectRefs(init), callee: this.calleeOf(init) }
    }
    if (d?.id?.type !== 'Identifier') {
      throw new ParseError('expected identifier on left side of const declaration', dLine, 'E_STATEMENT')
    }
    const name = d.id.name
    let init = d.init
    if (init?.type === 'AwaitExpression') init = init.argument

    if (init?.type === 'CallExpression') {
      const call = this.emitCall(init, code, declared, dLine)
      declared.add(name)
      return { lineNo, body: `__ctx.${name} = ${call}`, writes: [name], refs: this.collectRefs(init), callee: this.calleeOf(init) }
    }
    if (init) {
      // 参数行（字面量/数组/对象）或派生常量：求值后写入 ctx（引用走 __ctx 提升）
      const exprText = this.hoistText(code.slice(init.start, init.end), declared)
      declared.add(name)
      return { lineNo, body: `__ctx.${name} = ${exprText}`, writes: [name], refs: [], callee: undefined }
    }
    throw new ParseError('unsupported const declaration', dLine, 'E_STATEMENT')
  }

  /** 表达式语句：裸重赋值 / 命名空间裸调用 / 成员方法调用。 */
  private transformExpressionStatement(
    node: ASTNode,
    code: string,
    declared: Set<string>,
    lineNo: number,
  ): TransformedUnit {
    const expr = node.expression
    if (expr?.type === 'AssignmentExpression' && expr.operator === '=' && expr.left?.type === 'Identifier') {
      const varName = expr.left.name
      if (!declared.has(varName)) throw new ParseError(`unknown variable "${varName}" in re-assignment`, lineNo, 'E_REFERENCE')
      let init = expr.right
      if (init?.type === 'AwaitExpression') init = init.argument
      if (init?.type === 'CallExpression') {
        const call = this.emitCall(init, code, declared, lineNo)
        return { lineNo, body: `__ctx.${varName} = ${call}`, writes: [varName], refs: this.collectRefs(init), callee: this.calleeOf(init) }
      }
      // 变量→变量重赋值 / 表达式重赋值（`bp = bp2` / `x = a + b`）：合法 JS，
      // 直接提升自由标识符写回 ctx（A-15 最后写者语义）。
      const rhsText = this.hoistText(code.slice(init?.start ?? expr.right.start, expr.right.end), declared)
      return { lineNo, body: `__ctx.${varName} = ${rhsText}`, writes: [varName], refs: [], callee: undefined }
    }
    if (expr?.type === 'CallExpression') {
      const call = this.emitCall(expr, code, declared, lineNo)
      // 命名空间裸调用 / 成员方法 / 本机函数副作用调用：都 await（无写入）
      return { lineNo, body: `await ${call}`, writes: [], refs: this.collectRefs(expr), callee: this.calleeOf(expr) }
    }
    throw new ParseError('bare expression statements not allowed', lineNo, 'E_STATEMENT')
  }

  /** 调用发射：<ns>.<fn>(args) / <receiver>.<method>(args) / <localFn>(args) → await 形态。 */
  private emitCall(callNode: ASTNode, code: string, declared: Set<string>, lineNo: number): string {
    if (callNode?.type !== 'CallExpression') {
      throw new ParseError('expected call expression', lineNo, 'E_STATEMENT')
    }
    const callee = callNode.callee
    let head: string
    if (callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.property?.type === 'Identifier') {
      const objName = callee.object.name
      head = declared.has(objName)
        ? `await __ctx.${objName}.${callee.property.name}`
        : `await __ns.${objName}.${callee.property.name}`
    } else if (callee?.type === 'Identifier') {
      if (declared.has(callee.name) || this.hasCtxFn(callee.name)) {
        head = `await __ctx.${callee.name}`
      } else {
        // 本机函数尚未在 declared（append 前缀场景由调用方校验）→ 仍按 ctx 函数调用
        head = `await __ctx.${callee.name}`
      }
    } else {
      throw new ParseError('expected <ns>.<op>(...) or local function call', lineNo, 'E_STATEMENT')
    }
    const args = (callNode.arguments ?? []).map((a: ASTNode) => this.transformArg(a, code, declared, lineNo))
    return `${head}(${args.join(', ')})`
  }

  private hasCtxFn(name: string): boolean {
    return typeof this.ctx[name] === 'function'
  }

  /** 实参变换：Literal → JSON；Identifier → __ctx.name；调用递归；对象/数组递归；
   *  表达式 → 自由标识符提升（文本级，词边界替换已声明名）。 */
  private transformArg(node: ASTNode, code: string, declared: Set<string>, lineNo: number): string {
    if (!node) return 'undefined'
    switch (node.type) {
      case 'Literal':
        return JSON.stringify(node.value)
      case 'Identifier':
        return `__ctx.${node.name}`
      case 'CallExpression':
        return this.emitCall(node, code, declared, lineNo)
      case 'ArrayExpression': {
        const items = (node.elements ?? []).map((el: ASTNode) =>
          el === null ? 'null' : el?.type === 'SpreadElement'
            ? `...${this.transformArg(el.argument, code, declared, lineNo)}`
            : this.transformArg(el, code, declared, lineNo))
        return `[${items.join(', ')}]`
      }
      case 'ObjectExpression': {
        const parts: string[] = []
        for (const prop of node.properties ?? []) {
          if (prop.type === 'SpreadElement') {
            parts.push(`...${this.transformArg(prop.argument, code, declared, lineNo)}`)
            continue
          }
          const key = prop.key?.type === 'Identifier' ? prop.key.name
            : prop.key?.type === 'Literal' ? JSON.stringify(String(prop.key.value))
            : null
          if (key === null) throw new ParseError('invalid object key', lineNo, 'E_VALUE')
          parts.push(prop.shorthand
            ? `${key}: __ctx.${key}`
            : `${key}: ${this.transformArg(prop.value, code, declared, lineNo)}`)
        }
        return `{ ${parts.join(', ')} }`
      }
      case 'UnaryExpression':
        return `${node.operator}${this.transformArg(node.argument, code, declared, lineNo)}`
      case 'BinaryExpression':
      case 'LogicalExpression':
        return `${this.transformArg(node.left, code, declared, lineNo)} ${node.operator} ${this.transformArg(node.right, code, declared, lineNo)}`
      case 'ConditionalExpression':
        return `${this.transformArg(node.test, code, declared, lineNo)} ? ${this.transformArg(node.consequent, code, declared, lineNo)} : ${this.transformArg(node.alternate, code, declared, lineNo)}`
      case 'MemberExpression':
        return this.hoistText(code.slice(node.start, node.end), declared)
      default:
        return this.hoistText(code.slice(node.start, node.end), declared)
    }
  }

  /** 文本级自由标识符提升：把已声明变量名替换为 __ctx.<name>（词边界）。 */
  private hoistText(text: string, declared: Set<string>): string {
    let out = text
    for (const name of declared) {
      out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), `__ctx.${name}`)
    }
    return out
  }

  private calleeOf(callNode: ASTNode | undefined): string | undefined {
    if (!callNode || callNode.type !== 'CallExpression') return undefined
    const c = callNode.callee
    if (c?.type === 'MemberExpression' && c.property?.type === 'Identifier') return c.property.name
    if (c?.type === 'Identifier') return c.name
    return undefined
  }

  /** 收集调用实参里的裸标识符（append 前缀校验输入）。 */
  private collectRefs(callNode: ASTNode | undefined): string[] {
    const refs = new Set<string>()
    if (!callNode || callNode.type !== 'CallExpression') return []
    const walk = (n: ASTNode): void => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'Identifier') {
        if (!['undefined', 'NaN', 'Infinity'].includes(n.name)) refs.add(n.name)
        return
      }
      if (n.type === 'MemberExpression') {
        walk(n.object)
        if (n.computed) walk(n.property)
        return
      }
      if (n.type === 'CallExpression') {
        // 嵌套调用内不视为本语句 input 引用（只读查询），与现状 collectStatementRefs 语义对齐——
        // 但 keep/依赖仍需要……现状是递归含 call args；这里保守按参数收集：
        for (const a of n.arguments ?? []) walk(a)
        return
      }
      if (n.type === 'Property') {
        walk(n.value)
        return
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'parent' || k === 'type') continue
        const v = n[k]
        if (Array.isArray(v)) for (const item of v) walk(item)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    for (const a of callNode.arguments ?? []) walk(a)
    return [...refs]
  }
}
