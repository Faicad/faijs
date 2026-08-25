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
  AssetRef,
  CadStatement,
  GeomRef,
  JsonValue,
  ParamRef,
  PartScript,
} from './types'
import { isAssetRef, isGeomRef, isParamRef } from './types'
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

/** vec3 → `[x,y,z]` */
function fmtVec3(v: readonly number[]): string {
  return `[${v.map((n) => fmtNum(n)).join(',')}]`
}

/** JsonValue（参数字面量）→ JS 表达式 */
function fmtJsonValue(v: JsonValue): string {
  if (typeof v === 'number') return fmtNum(v)
  return JSON.stringify(v)
}

/** 字符串转义（JSON 双引号形式，编译产物内部使用） */
function fmtStr(s: string): string {
  return JSON.stringify(s)
}

// ── Arg 翻译（$param / $geom / $asset → 编译产物表达式） ──

/** GeomRef → `cad.<feature>(ctx.<of>, [anchor], ordinal, exec)` */
function translateGeomRef(ref: GeomRef): string {
  const { of, feature, anchor, faceOrdinal } = ref.$geom
  let expr = `cad.${feature}(ctx.${of}`
  if (anchor) {
    expr += `, ${fmtVec3(anchor.point)}`
  } else if (faceOrdinal !== undefined) {
    expr += `, null`
  }
  if (faceOrdinal !== undefined) {
    expr += `, ${faceOrdinal}`
  }
  expr += `, exec)`
  return expr
}

/** ParamRef → `ctx.<name>` */
function translateParamRef(ref: ParamRef): string {
  return `ctx.${ref.$param}`
}

/** AssetRef → `await cad.asset(key, exec)`（fn 是 async，实参位置可 await） */
function translateAssetRef(ref: AssetRef): string {
  return `await cad.asset(${fmtStr(ref.$asset)}, exec)`
}

/** 递归翻译单个 Arg 值为编译产物表达式。 */
function translateArg(value: Arg): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return fmtNum(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return fmtStr(value)
  if (isParamRef(value)) return translateParamRef(value)
  if (isGeomRef(value)) return translateGeomRef(value)
  if (isAssetRef(value)) return translateAssetRef(value)
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
 * 优先用 parser 填充的 stmt.refs（inputs + $param + $geom.of + members）；
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
    if (isGeomRef(value)) {
      refs.add(value.$geom.of)
      return
    }
    if (isAssetRef(value)) return
    if (Array.isArray(value)) {
      for (const v of value) scan(v)
      return
    }
    for (const v of Object.values(value)) scan(v)
  }
  for (const arg of Object.values(stmt.args)) scan(arg)
  if (stmt.op === 'group' || stmt.op === 'assembly') {
    const members = stmt.args?.members
    if (Array.isArray(members)) {
      for (const m of members) if (typeof m === 'string') refs.add(m)
    }
  }
  return [...refs]
}

/** 生成单条语句的 fn 体（缩进 6 空格，嵌入模块文本）。 */
function buildStatementFnBody(stmt: CadStatement): string {
  // 结构型无赋值语句
  if (stmt.op === 'add_constraint') {
    // Phase 1：约束由 assembly 语句 args.constraints 读取，add_constraint 无合并逻辑（已知缺口，Phase 2 修复）
    return `      // no-op (Phase 1: constraints read from assembly statement args)`
  }
  if (stmt.op === 'do_assemble') {
    // Phase 1：委托 exec 触发装配变换 pass（executeAssemblyPassForStmt）
    return `      await exec.doAssemble(exec)`
  }

  const inputs = stmt.inputs.map((inp) => `ctx.${inp}`).join(', ')
  const argsStr = translateArgs(stmt.args)

  // split：多输出解构（无输入时省略 inputs 槽；无 outputs 时退化为单输出取 front）
  if (stmt.op === 'split') {
    const callArgs = inputs ? `${inputs}, ${argsStr}` : argsStr
    const out0 = stmt.outputs?.[0]
    const out1 = stmt.outputs?.[1]
    if (out0 && out1) {
      return [
        `      const { front, back } = await cad.split(${callArgs}, exec)`,
        `      ctx.${out0} = front`,
        `      ctx.${out1} = back`,
      ].join('\n')
    }
    // 无 outputs：退化为单输出（取 front，与旧 executeSplit 返回 front/back 的语义一致）
    return `      ctx.${stmt.id} = (await cad.split(${callArgs}, exec)).front`
  }

  // boolean：多输入 + operation 参数（cad.boolean(input1, input2, { operation }, exec)）
  let call: string
  if (stmt.op === 'boolean') {
    call = `cad.boolean(${inputs}${inputs ? ', ' : ''}${argsStr}, exec)`
  } else if (inputs) {
    call = `cad.${stmt.op}(${inputs}, ${argsStr}, exec)`
  } else {
    call = `cad.${stmt.op}(${argsStr}, exec)`
  }

  return `      ctx.${stmt.id} = await ${call}`
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

  // 2. 脚本语句（s(K+1)..s(K+N)，用 parser 分配的 stmtId）
  script.statements.forEach((stmt, i) => {
    const id = stmt.stmtId ?? asStmtId(`s${script.params.length + i + 1}`)
    let writes: string[]
    if (stmt.op === 'add_constraint' || stmt.op === 'do_assemble') {
      writes = []
    } else if (stmt.outputs && stmt.outputs.length >= 2) {
      writes = stmt.outputs
    } else {
      writes = [stmt.id]
    }
    metas.push({ id, deps: [], writes, sourceIndex: i })
    for (const w of writes) varToStmtId.set(w, id)
  })

  // 3. deps：refs（变量名）→ 定义语句 id
  for (const meta of metas) {
    if (meta.sourceIndex === undefined) continue
    const stmt = script.statements[meta.sourceIndex]
    const deps = new Set<StmtId>()
    for (const ref of getStatementRefs(stmt)) {
      const depId = varToStmtId.get(ref)
      if (depId) deps.add(depId)
    }
    meta.deps = [...deps]
  }

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
