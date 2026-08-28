/**
 * compile — PartScript → 零 import ESM 模块（VM 执行方案 Phase 1）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.1 / §3.9
 *
 * `compileToModule(script)` 把校验过的 PartScript IR 编译为**不含任何 import 语句**的
 * ESM 文本（`export const statements = [...]`）。产物零 import 是关键决策——Node 的
 * `data:` URL 与浏览器的 Blob URL 动态 import 都无法解析裸说明符，零 import 使模块在
 * 两个平台都能直接 `import()`，无需 import map / 打包器 / 文件系统。
 *
 * 编译规则：
 * - 每条语句一个 `{ id, deps, fn }`：`id` 是独立 StmtId（参数语句占 s1..sK，语句 s(K+1)..s(K+N)）；
 *   `deps` 由 parser 收集的 `stmt.refs`（inputs + $param + $geom.of + members）翻译为定义语句的 id；
 *   `fn` 是 `async (ctx, cad, exec) => {...}`。
 * - 参数即变量：`const r = 20` 编译为普通语句 `ctx.r = 20`。
 * - 变量引用编译为 `ctx.x`（持久变量容器，跨增量执行存活）。
 * - $param → `ctx.<name>`；$geom → `cad.<feature>(ctx.<of>, ...)`；$asset → `await cad.asset(key, exec)`。
 * - 编译输入只有 IR，用户原文不进 VM（先解析后执行红线）。
 */

import type {
  Arg,
  CadStatement,
  JsonValue,
  ParamRef,
  PartScript,
  VarRef,
  CallRef,
} from './types'
import { isParamRef, isVarRef, isCallRef } from './types'
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

// ── Arg 翻译（$param / $ref / $call → 编译产物表达式） ──

/** ParamRef → `ctx.<name>` */
function translateParamRef(ref: ParamRef): string {
  return `ctx.${ref.$param}`
}

/** VarRef → `ctx.<name>` */
function translateVarRef(ref: VarRef): string {
  return `ctx.${ref.$ref}`
}

/** CallRef → `await cad.<callee>(<args>, exec)`（嵌套调用，统一 await：同步函数被 await 是合法 JS） */
function translateCallRef(ref: CallRef): string {
  const { callee, args } = ref.$call
  const inner = args.map((a) => translateArg(a)).join(', ')
  return `await cad.${callee}(${inner}, exec)`
}

/** 递归翻译单个 Arg 值为编译产物表达式。 */
function translateArg(value: Arg): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return fmtNum(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return fmtStr(value)
  if (isParamRef(value)) return translateParamRef(value)
  if (isVarRef(value)) return translateVarRef(value)
  if (isCallRef(value)) return translateCallRef(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => translateArg(v as Arg)).join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, Arg>)
    return `{ ${entries.map(([k, v]) => `${k}: ${translateArg(v)}`).join(', ')} }`
  }
  return String(value)
}

/** 语句 args 表 → 编译产物对象字面量。 */
function translateArgs(args: Record<string, Arg>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return '{}'
  return `{ ${entries.map(([k, v]) => `${k}: ${translateArg(v)}`).join(', ')} }`
}

// ── 语句 fn 体生成 ──

/**
 * 获取语句引用的变量名集合。
 *
 * 优先用 parser 填充的 stmt.refs（inputs + $param + $ref + 嵌套调用）；
 * 手工构造的 PartScript（测试等）无 refs 时，从 inputs + args 扫描兜底计算。
 */
function getStatementRefs(stmt: CadStatement): string[] {
  if (stmt.refs) return stmt.refs
  const refs = new Set<string>(stmt.inputs)
  const scan = (value: Arg): void => {
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
    if (Array.isArray(value)) {
      for (const v of value) scan(v)
      return
    }
    for (const v of Object.values(value)) scan(v)
  }
  for (const arg of Object.values(stmt.args)) scan(arg)
  // 兼容旧手工构造 IR：group/assembly members 可能是裸字符串变量名
  if (stmt.callee === 'group' || stmt.callee === 'assembly') {
    const members = stmt.args?.members
    if (Array.isArray(members)) {
      for (const m of members) if (typeof m === 'string') refs.add(m)
    }
  }
  return [...refs]
}

/** 生成单条语句的 fn 体（缩进 6 空格，嵌入模块文本）。纯机械：按 IR 形态发射，无 callee 分支（A9 消灭）。 */
function buildStatementFnBody(stmt: CadStatement): string {
  const inputs = stmt.inputs.map((inp) => `ctx.${inp}`).join(', ')
  const argsStr = translateArgs(stmt.args)
  const hasArgs = Object.keys(stmt.args).length > 0

  // 调用实参序列：有 inputs 则前置；有 args 则后置（空 args 不发射，§5.1 空槽规则）
  const callArgs = inputs
    ? (hasArgs ? `${inputs}, ${argsStr}` : inputs)
    : (hasArgs ? argsStr : '{}')

  // 1) 对象解构赋值：outputKeys 存在（任意 callee）
  if (stmt.outputKeys && stmt.outputKeys.length > 0) {
    const keys = stmt.outputKeys.join(', ')
    const assigns = stmt.outputs.map((out, i) => `      ctx.${out} = ${stmt.outputKeys![i]}`).join('\n')
    return [
      `      const { ${keys} } = await cad.${stmt.callee}(${callArgs}, exec)`,
      assigns,
    ].join('\n')
  }

  // 2) 成员调用（表达式语句）：receiver 存在（add_constraint/do_assemble 挂 compound 方法）
  if (stmt.receiver) {
    // 空 args 不发射 `{}`：`do_assemble(exec)` 而不是 `do_assemble({}, exec)`（§5.2 成员方法签名）
    const mArgs = hasArgs ? `${argsStr}, ` : ''
    return `      await ctx.${stmt.receiver}.${stmt.callee}(${mArgs}exec)`
  }

  // 3) 无赋值调用（表达式语句，outputs 为空且无 receiver）
  if (stmt.outputs.length === 0) {
    return `      await cad.${stmt.callee}(${callArgs}, exec)`
  }

  // 4) 普通赋值（单输出）
  return `      ctx.${stmt.outputs[0]} = await cad.${stmt.callee}(${callArgs}, exec)`
}

// ── 主编译函数 ──

/**
 * 把 PartScript 编译为零 import ESM 模块文本 + 语句元数据。
 *
 * 同一份 PartScript 编译结果确定（StmtId 按语句顺序稳定分配）。
 */
export function compileToModule(script: PartScript): CompiledModule {
  const metas: CompiledStatementMeta[] = []
  const varToStmtId = new Map<string, StmtId>()

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
      fnBody = buildStatementFnBody(script.statements[meta.sourceIndex])
    }
    stmtCursor++
    const depsStr = meta.deps.length > 0 ? meta.deps.map((d) => `'${d}'`).join(', ') : ''
    bodyLines.push(`  { id: '${meta.id}', deps: [${depsStr}],`)
    bodyLines.push(`    fn: async (ctx, cad, exec) => {`)
    bodyLines.push(fnBody)
    bodyLines.push(`    } },`)
  }

  const code = `export const statements = [\n${bodyLines.join('\n')}\n]\n`
  return { code, statements: metas }
}
