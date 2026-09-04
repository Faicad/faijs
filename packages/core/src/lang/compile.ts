/**
 * compile — ScriptIR → 零 import ESM 模块（VM 执行方案 Phase 1）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.1 / §3.9
 *
 * `compileToModule(script)` 把校验过的 ScriptIR IR 编译为**不含任何 import 语句**的
 * ESM 文本（`export const statements = [...]`）。产物零 import 是关键决策——Node 的
 * `data:` URL 与浏览器的 Blob URL 动态 import 都无法解析裸说明符，零 import 使模块在
 * 两个平台都能直接 `import()`，无需 import map / 打包器 / 文件系统。
 *
 * 编译规则：
 * - 每条语句一个 `{ id, deps, fn }`：`id` 是独立 StmtId（参数语句占 s1..sK，语句 s(K+1)..s(K+N)）；
 *   `deps` 由 parser 收集的 `stmt.refs`（inputs + $param + $geom.of + members）翻译为定义语句的 id；
 *   `fn` 是 `async (ctx, ns) => {...}`（ns = 命名空间集合，无隐式参数）。
 * - 参数即变量：`const r = 20` 编译为普通语句 `ctx.r = 20`。
 * - 变量引用编译为 `ctx.x`（持久变量容器，跨增量执行存活）。
 * - $param → `ctx.<name>`；$geom → `ns.cad.<feature>(ctx.<of>, ...)`；$asset → `await ns.cad.asset(key)`。
 * - 编译输入只有 IR，用户原文不进 VM（先解析后执行红线）。
 */

import type {
  ArgIR,
  StatementIR,
  JsonValue,
  ParamRefIR,
  ScriptIR,
  VarRefIR,
  CallRefIR,
  ExprIR,
} from './types'
import { isParamRef, isVarRef, isCallRef, isExprRef, splitPositionalOptions } from './types'
import { withoutKeepDirectives, withoutKeepDirectivesFromPositional } from './keep'
import { fmtNum } from './codegen'
import { asStmtId, type StmtId } from '../identity'

// ── 编译产物类型 ──

/** 编译后单条语句的元数据（与模块文本中的 `{ id, deps, fn }` 并行）。 */
export interface CompiledStatementMeta {
  /** 独立 StmtId（模块语句 id） */
  id: StmtId
  /** 依赖语句 id（定义被引用变量的语句） */
  deps: StmtId[]
  /** 本语句写入 ctx 的键（变量名）：普通语句 [id]、split 双输出、参数 [paramName]、add_constraint/do_assemble 空 */
  writes: string[]
  /** 在 script.statements 中的下标（参数语句为 undefined） */
  sourceIndex?: number
}

/** compileToModule 的返回：模块文本 + 并行元数据（供 ModuleExecutor 建 sourceById / reconcileCtx）。 */
export interface CompiledModule {
  code: string
  statements: CompiledStatementMeta[]
}

// ── 值格式化（编译产物内部，非用户可读文本） ──

/** JsonValue（参数字面量）→ JS 表达式 */
function fmtJsonValue(v: JsonValue): string {
  if (typeof v === 'number') return fmtNum(v)
  return JSON.stringify(v)
}

/** 字符串转义（JSON 双引号形式，编译产物内部使用） */
function fmtStr(s: string): string {
  return JSON.stringify(s)
}

// ── ArgIR 翻译（$param / $ref / $call → 编译产物表达式） ──

/** ParamRefIR → `ctx.<name>` */
function translateParamRef(ref: ParamRefIR): string {
  return `ctx.${ref.$param}`
}

/** VarRefIR → `ctx.<name>` */
function translateVarRef(ref: VarRefIR): string {
  return `ctx.${ref.$ref}`
}

/** CallRefIR → `await ns.<ns>.<callee>(<args>)`（嵌套调用，统一 await：同步函数被 await 是合法 JS；F2 放开命名空间） */
function translateCallRef(ref: CallRefIR): string {
  const { callee, args, namespace } = ref.$call
  const inner = args.map((a) => translateArg(a)).join(', ')
  return `await ns.${namespace ?? 'cad'}.${callee}(${inner})`
}

/**
 * ExprIR → 箭头包装发射（§5.4，零改写）：
 * `((${names}) => ${text})(${args})`，names = [...params, ...refs]（去重、保持声明顺序），
 * args = `ctx.<name>, ...` 与 names 一一对应。表达式原文 text 不重写，标识符经
 * 箭头参数绑定解析到 ctx.<name>；语法门禁在 parse 期完成（§3.3 白名单文法）。
 *
 * 失败语义标记（true-JS-subset D4）：表达式求值包在 try/catch IIFE 内，失败抛
 * `__FaiExprEvalError`（生成模块内联类，零 import）——ModuleExecutor 据此把
 * 表达式运行时错误包装为 OpError(E_EXPR) 归并 failedAt，而 op 实现的普通异常
 * （= bug，Result 体系契约）保持抛穿不受影响。
 */
function translateExprRef(ref: ExprIR): string {
  useExprEvalGuard = true
  const names = [...new Set([...ref.$expr.params, ...ref.$expr.refs])]
  const args = names.map((n) => `ctx.${n}`).join(', ')
  const inner = `((${names.join(', ')}) => ${ref.$expr.text})(${args})`
  return `(() => { try { return ${inner} } catch (__e) { throw new __FaiExprEvalError(__e) } })()`
}

/** 本轮 compileToModule 是否发射了 ExprIR（决定是否内联 __FaiExprEvalError 类）。 */
let useExprEvalGuard = false

/** 生成模块内联的表达式求值错误标记类（零 import；与 module-executor 的识别契约见类名）。 */
const EXPR_EVAL_ERROR_CLASS =
  `class __FaiExprEvalError extends Error { constructor(cause) {` +
  ` super('expression evaluation failed: ' + (cause && cause.message ? cause.message : String(cause)));` +
  ` this.name = 'FaiExprEvalError'; this.isExprEvalError = true; this.exprCause = cause } }`

/** 递归翻译单个 ArgIR 值为编译产物表达式。 */
function translateArg(value: ArgIR): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return fmtNum(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return fmtStr(value)
  if (isParamRef(value)) return translateParamRef(value)
  if (isVarRef(value)) return translateVarRef(value)
  if (isCallRef(value)) return translateCallRef(value)
  if (isExprRef(value)) return translateExprRef(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => translateArg(v as ArgIR)).join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, ArgIR>)
    return `{ ${entries.map(([k, v]) => `${k}: ${translateArg(v)}`).join(', ')} }`
  }
  return String(value)
}

/** 语句 args 表 → 编译产物对象字面量。 */
function translateArgs(args: Record<string, ArgIR>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return '{}'
  return `{ ${entries.map(([k, v]) => `${k}: ${translateArg(v)}`).join(', ')} }`
}

// ── 语句 fn 体生成 ──

/**
 * 获取语句引用的变量名集合。
 *
 * 优先用 parser 填充的 stmt.refs（positional + args + receiver 的全量递归收集）；
 * 手工构造的 ScriptIR（测试等）无 refs 时，从 positional + args + receiver 兜底扫描计算。
 */
function getStatementRefs(stmt: StatementIR): string[] {
  if (stmt.refs) return stmt.refs
  const refs = new Set<string>()
  // receiver：成员方法调用（do_assemble 等）依赖其 receiver 变量
  if (stmt.receiver) refs.add(stmt.receiver)
  const scan = (value: ArgIR): void => {
    if (value === null || typeof value !== 'object') return
    if (isParamRef(value)) {
      refs.add(value.$param)
      return
    }
    if (isVarRef(value)) {
      refs.add(value.$ref)
      return
    }
    if (isCallRef(value)) {
      for (const a of value.$call.args) scan(a)
      return
    }
    if (isExprRef(value)) {
      for (const p of value.$expr.params) refs.add(p)
      for (const r of value.$expr.refs) refs.add(r)
      return
    }
    if (Array.isArray(value)) {
      for (const v of value) scan(v)
      return
    }
    for (const v of Object.values(value)) scan(v)
  }
  for (const arg of stmt.positional ?? []) scan(arg)
  for (const arg of Object.values(stmt.args ?? {})) scan(arg)
  // 兼容旧手工构造 IR：group/assembly members 可能是裸字符串变量名
  if (stmt.callee === 'group' || stmt.callee === 'assembly') {
    const members = stmt.args?.members
    if (Array.isArray(members)) {
      for (const m of members) if (typeof m === 'string') refs.add(m)
    }
  }
  return [...refs]
}

/** 生成单条语句的 fn 体（缩进 6 空格，嵌入模块文本）。纯机械：按 IR 形态发射，无 callee 分支（A9 消灭）。
 *  @param localParams 本机函数名 → 形参表（ABI 发射用；local 语句按形参序补位）。 */
function buildStatementFnBody(stmt: StatementIR, localParams?: Map<string, string[]>): string {
  // ── 本机函数调用（local，§3.4 / §5.3）：ABI 按形参序发射 ──
  // 发射形态（§3.6）：`await <name>(ctx, ns, <pos1>, …, <posM>, <v_{M+1}>, …, <vk>)`
  // - 位置实参（splitPositionalOptions 切出的 values，可为任意表达式形态）占前 M 位
  // - 尾随选项对象（positional 末位纯对象；手工 IR 兜底用 stmt.args）键按形参名补到剩余位
  //   （缺失形参 → undefined；parse 期 ABI 已拦截未知/占用键）
  // - keep/keepHidden 先剥离（与命名空间调用一致）
  if (stmt.local) {
    const params = localParams?.get(stmt.callee) ?? []
    const { values, named } = splitPositionalOptions(stmt.positional ?? [])
    const M = values.length
    const callArgs: string[] = ['ctx', 'ns']
    for (const v of values) callArgs.push(translateArg(v))
    // 尾随对象为空时回退 args 槽（手工构造 IR 只填 args 的兼容路径；解析产物二者一致）
    const namedSrc = Object.keys(named).length > 0 ? named : withoutKeepDirectives(stmt.args)
    const runtimeArgs = withoutKeepDirectives(namedSrc)
    for (let i = M; i < params.length; i++) {
      const p = params[i]
      const v = runtimeArgs[p]
      callArgs.push(v !== undefined ? translateArg(v) : 'undefined')
    }
    const call = `await localFns.${stmt.callee}(${callArgs.join(', ')})`
    // 1) 对象解构赋值（本机函数多返回值：return { front, back }）
    if (stmt.outputKeys && stmt.outputKeys.length > 0) {
      const keys = stmt.outputKeys.join(', ')
      const assigns = stmt.outputs.map((out, i) => `      ctx.${out} = ${stmt.outputKeys![i]}`).join('\n')
      return [`      const { ${keys} } = ${call}`, assigns].join('\n')
    }
    // 2) 无赋值调用（副作用）
    if (stmt.outputs.length === 0) {
      return `      await ${call}`
    }
    // 3) 普通赋值（单输出）
    return `      ctx.${stmt.outputs[0]} = ${call}`
  }

  // P7：按命名空间发射（`import * as mech from 'gear-lib-demo'` → ns.mech.<callee>；缺省 cad）
  const nsExpr = `ns.${stmt.namespace ?? 'cad'}`

  // 位置实参发射（true-JS-subset §4.3.1）：全部位置实参按序翻译；尾随纯对象的
  // keep/keepHidden 指令发射前剥离（keep-syntax 设计 §7.1）。剥离后若尾随对象为空
  // （如 `union(a, b, { keep: [a, b] })`），整个对象不再发射——与 `union(a, b)` 无选项槽一致。
  const positionalStripped = withoutKeepDirectivesFromPositional(stmt.positional ?? [])
  const lastArg = positionalStripped[positionalStripped.length - 1]
  if (
    lastArg !== null &&
    typeof lastArg === 'object' &&
    !Array.isArray(lastArg) &&
    !isVarRef(lastArg) &&
    !isCallRef(lastArg) &&
    !isExprRef(lastArg) &&
    Object.keys(lastArg as Record<string, ArgIR>).length === 0
  ) {
    positionalStripped.pop()
  }
  const positionalArgs = positionalStripped
  const positionalStr = positionalArgs.map((v) => translateArg(v)).join(', ')

  // 兼容兜底：positional 为空但 args 非空（手工构造 IR 只填 args 的旧形态）
  // → 退回 args 槽发射。解析产物中 args 非空 ⇒ positional 必含尾随对象，不会走此分支。
  const lastIsPlainObject =
    positionalArgs.length > 0 &&
    (() => {
      const a = positionalArgs[positionalArgs.length - 1]
      return (
        a !== null && typeof a === 'object' && !Array.isArray(a) &&
        !isVarRef(a) && !isCallRef(a) && !isExprRef(a)
      )
    })()
  let callArgs: string
  if (positionalStr !== '') {
    if (lastIsPlainObject) {
      // 尾随纯对象已含选项（args 是其投影），不重复发射
      callArgs = positionalStr
    } else {
      // 手工构造 IR 的过渡兼容：positional 尾位不是纯对象而 args 槽非空 → args 作为
      // 独立选项槽追加（keep 指令同步剥离）
      const legacyArgs = withoutKeepDirectives(stmt.args)
      const legacyStr = Object.keys(legacyArgs).length > 0 ? `, ${translateArgs(legacyArgs)}` : ''
      callArgs = positionalStr + legacyStr
    }
  } else if (stmt.receiver) {
    const legacyArgs = withoutKeepDirectives(stmt.args)
    callArgs = Object.keys(legacyArgs).length > 0 ? translateArgs(legacyArgs) : ''
  } else {
    const legacyArgs = withoutKeepDirectives(stmt.args)
    callArgs = Object.keys(legacyArgs).length > 0 ? translateArgs(legacyArgs) : '{}'
  }

  // 1) 对象解构赋值：outputKeys 存在（任意 callee）
  if (stmt.outputKeys && stmt.outputKeys.length > 0) {
    const keys = stmt.outputKeys.join(', ')
    const assigns = stmt.outputs.map((out, i) => `      ctx.${out} = ${stmt.outputKeys![i]}`).join('\n')
    return [
      `      const { ${keys} } = await ${nsExpr}.${stmt.callee}(${callArgs})`,
      assigns,
    ].join('\n')
  }

  // 2) 成员调用（表达式语句）：receiver 存在（add_constraint/do_assemble 挂 compound 方法）
  if (stmt.receiver) {
    // 空 args 不发射 `{}`：`do_assemble()` 而不是 `do_assemble({})`（§5.2 成员方法签名）
    return `      await ctx.${stmt.receiver}.${stmt.callee}(${callArgs})`
  }

  // 3) 无赋值调用（表达式语句，outputs 为空且无 receiver）
  if (stmt.outputs.length === 0) {
    return `      await ${nsExpr}.${stmt.callee}(${callArgs})`
  }

  // 4) 普通赋值（单输出）
  return `      ctx.${stmt.outputs[0]} = await ${nsExpr}.${stmt.callee}(${callArgs})`
}

// ── 主编译函数 ──

/**
 * 把 ScriptIR 编译为零 import ESM 模块文本 + 语句元数据。
 *
 * 同一份 ScriptIR 编译结果确定（StmtId 按语句顺序稳定分配）。
 */
/**
 * Compile a validated ScriptIR into a zero-import ESM module text plus parallel
 * statement metadata. The output of compiling the same ScriptIR is
 * deterministic (StmtIds are assigned stably in statement order).
 * @param script - the validated ScriptIR to compile.
 * @returns the compiled module code and its statement metadata.
 */
export function compileToModule(script: ScriptIR): CompiledModule {
  useExprEvalGuard = false
  const metas: CompiledStatementMeta[] = []
  const varToStmtId = new Map<string, StmtId>()
  // 本机函数名 → 形参表（ABI 发射：位置实参占前 M 位，args 键按形参名补剩余位）
  const localParams = new Map<string, string[]>()
  for (const fn of script.functions ?? []) localParams.set(fn.name, fn.params)

  // 1. 参数语句（s1..sK）
  script.params.forEach((p, i) => {
    const id = asStmtId(`s${i + 1}`)
    metas.push({ id, deps: [], writes: [p.name] })
    varToStmtId.set(p.name, id)
  })

  // 2. 脚本语句（s(K+1)..s(K+N)，Phase 3: id 即 sN）
  //    顺序处理：先算 deps（用已有 varToStmtId），再写 varToStmtId，
  //    这样单入单出复用名的变量能正确解析到上游定义语句（而非自己）。
  script.statements.forEach((stmt, i) => {
    const id = stmt.id
    // A11 消灭：writes = outputs（无赋值语句 outputs 本来就是 []，机械写法天然正确）
    const writes = stmt.outputs
    // 先算 deps（用已有 varToStmtId，此时还未被本语句的 writes 覆盖）
    const deps = new Set<StmtId>()
    for (const ref of getStatementRefs(stmt)) {
      const depId = varToStmtId.get(ref)
      if (depId) deps.add(depId)
    }
    metas.push({ id, deps: [...deps], writes, sourceIndex: i })
    // 再写 varToStmtId（后续语句引用本语句的输出时能找到）
    for (const w of writes) varToStmtId.set(w, id)
  })

  // 4. 生成模块文本
  const bodyLines: string[] = []
  let stmtCursor = 0
  for (const meta of metas) {
    let fnBody: string
    if (meta.sourceIndex === undefined) {
      // 参数语句：ctx.<name> = <literal>
      const p = script.params[stmtCursor]
      fnBody = `      ctx.${p.name} = ${fmtJsonValue(p.value as JsonValue)}`
    } else {
      fnBody = buildStatementFnBody(script.statements[meta.sourceIndex], localParams)
    }
    stmtCursor++
    const depsStr = meta.deps.length > 0 ? meta.deps.map((d) => `'${d}'`).join(', ') : ''
    bodyLines.push(`  { id: '${meta.id}', deps: [${depsStr}],`)
    bodyLines.push(`    fn: async (ctx, ns) => {`)
    bodyLines.push(fnBody)
    bodyLines.push(`    } },`)
  }

  // 5. 本机函数段（§5.1 / §5.2，ABI 方案 A / D7）：
  //    包装器 = `async function <name>(__ctx, __ns, <用户形参按名>) { <命名空间绑定> <用户函数体原文> }`。
  //    命名空间绑定：`const cad = __ns.cad` + 每个顶层 import 绑定名（函数体内裸 cad./mech. 可解析）。
  //    函数体原文嵌入（语法门禁后，P3/P5）；不注入 ctx / 兄弟函数名（D10 禁体内本机调用）。
  const fnLines: string[] = []
  for (const fn of script.functions ?? []) {
    const bindNames = new Set<string>(['cad'])
    for (const imp of script.imports ?? []) {
      bindNames.add(imp.localName)
      for (const b of imp.bindings ?? []) bindNames.add(b)
    }
    const binds = [...bindNames].map((n) => `  const ${n} = __ns.${n}`).join('\n')
    const params = fn.params.length > 0 ? `, ${fn.params.join(', ')}` : ''
    fnLines.push(`async function ${fn.name}(__ctx, __ns${params}) {`)
    fnLines.push(binds)
    fnLines.push(fn.body)
    fnLines.push('}')
  }
  const localFnsExport =
    (script.functions ?? []).length > 0
      ? `export const localFns = { ${(script.functions ?? []).map((f) => f.name).join(', ')} }\n`
      : ''
  const fnSection = fnLines.length > 0 ? `${fnLines.join('\n')}\n` : ''
  // D4：发射过 ExprIR 时内联表达式求值错误标记类（零 import；ModuleExecutor 据此包装 E_EXPR）
  const exprClassSection = useExprEvalGuard ? `${EXPR_EVAL_ERROR_CLASS}\n` : ''

  const code = `${exprClassSection}${fnSection}${localFnsExport}export const statements = [\n${bodyLines.join('\n')}\n]\n`
  return { code, statements: metas }
}
