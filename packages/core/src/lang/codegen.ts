/**
 * codegen — 语句 → 文本 确定性生成器（S-5 不变式）（L0，仅依赖 ./types）
 *
 * 设计文档：docs/syntax-design.md §2（扁平代码格式）
 *          docs/plans/2026-08-27-faijs-language-normalization-design.md §4.4（通用打印机）
 *
 * 职责：
 * - statementToLine(stmt)：按 IR 机械打印单行语句（用于 TimelinePanel 显示和导出）
 * - scriptToCode(script)：按语句顺序拼接为代码文本（无 export/return 封装）
 *
 * 扁平代码格式（无 export default / async / await / return / apiVersion）：
 * ```js
 * let part0 = cad.box({ size: 20 })
 * part0 = cad.translate(part0, { offset: [1, 2, 3] })
 * ```
 *
 * 约束（语言正常化后）：
 * - 纯函数、无副作用，便于单测
 * - 无 per-callee 分支（A12 消灭）：按 IR 形态机械打印，IR 里有什么打印什么
 * - terminal shapes 自动推导：不被任何其他语句引用的输出即终端
 *
 * 值格式约定（确定性输出，parser 按此反解）：
 * - vec3 → `[1,2,3]`（紧凑无空格）
 * - 数字 → 整数直出；小数最多保留 6 位有效小数并去尾零
 * - 字符串 → 单引号包裹
 * - ParamRefIR → 裸标识符 `name`（无 $ 前缀）
 * - VarRefIR → 裸变量名（members 元素）
 * - CallRefIR → `cad.faceCenter(part0)`（嵌套调用）
 * - 对象字面量 → `{key:value}`（冒号，合法 JS）
 */

import type { ArgIR, StatementIR, ScriptIR, ParamRefIR, VarRefIR, CallRefIR, ImportIR, FunctionDefIR } from './types'
import type { PartName } from '../identity'
import { isParamRef, isVarRef, isCallRef } from './types'

// ── 数值格式化 ──

/** 数字 → 文本：整数直出，小数保留最多 6 位有效小数并去尾零 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(6)
  return s.replace(/\.?0+$/, '')
}

/** 参数值 → 文本（递归） */
function fmtValue(value: ArgIR, varNames?: Map<string, string>): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return fmtNum(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return `'${escapeStr(value)}'`
  if (isParamRef(value)) return fmtParamRef(value)
  if (isVarRef(value)) return fmtVarRef(value, varNames)
  if (isCallRef(value)) return fmtCallRef(value, varNames)
  if (Array.isArray(value)) return `[${value.map(v => fmtValue(v, varNames)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, ArgIR>)
    return `{${entries.map(([k, v]) => `${k}:${fmtValue(v, varNames)}`).join(', ')}}`
  }
  return String(value)
}

/** 字符串转义：转义反斜杠、单引号与控制字符（多行 SDF code 等字符串参数用）。
 *  逐一字符映射（避开 regex 控制字符字面量，满足 eslint no-control-regex），
 *  保证 fmtValue ⇄ analyzeCode 往返一致：嵌入 '…' 后仍是合法 JS，可被 parser 精确还原。 */
const STRING_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\u0008': '\\b', // backspace
  '\u000C': '\\f', // form feed
  '\u000A': '\\n', // line feed
  '\u000D': '\\r', // carriage return
  '\u0009': '\\t', // tab
  '\u000B': '\\v', // vertical tab
}

function escapeStr(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const esc = STRING_ESCAPES[s[i]]
    out += esc ?? s[i]
  }
  return out
}

/** ParamRefIR → 裸标识符 `name`（文本形式中无 $ 前缀，合法 JS） */
function fmtParamRef(ref: ParamRefIR): string {
  return ref.$param
}

/** VarRefIR → 裸变量名（已声明变量，如 group/assembly 的 members 元素） */
function fmtVarRef(ref: VarRefIR, varNames?: Map<string, string>): string {
  return varNames?.get(ref.$ref) ?? ref.$ref
}

/** CallRefIR → `<ns>.<callee>(<args>)`（嵌套调用，如 cad.faceCenter(part0)；F2 放开命名空间） */
function fmtCallRef(ref: CallRefIR, varNames?: Map<string, string>): string {
  const { callee, args, namespace } = ref.$call
  const inner = args.map((a) => fmtValue(a, varNames)).join(', ')
  return `${namespace ?? 'cad'}.${callee}(${inner})`
}

// ── 语句 args → key:value 片段数组 ──

/**
 * 通用 args 打印机（A12 消灭）：IR 里的每个键按原样打印，无 callee 分支、无默认值省略。
 * 设计文档 §4.4：比现状更忠实（现状会把显式写的 nRad: 32 吞掉）。
 */
export function buildArgsParts(stmt: StatementIR, varNames?: Map<string, string>): string[] {
  return Object.entries(stmt.args).map(([k, v]) => `${k}:${fmtValue(v, varNames)}`)
}

// ── 语句 → 代码行 ──

/** 从语句获取主输出变量名（单输出取 outputs[0]；无输出回退 stmt.id） */
function primaryOutput(stmt: StatementIR): string {
  return stmt.outputs[0] ?? stmt.id
}

/**
 * 按 IR 形态机械打印单条语句（A12 消灭：无 callee 分支）。
 *
 * 1) 解构：outputKeys + outputs 一一对应
 * 2) 成员调用：receiver
 * 3) 无赋值调用
 * 4) 赋值：outputs[0] 已声明 → 裸重赋值；未声明 → let 声明
 */
function printStatement(stmt: StatementIR, declared: Set<string>, varNames: Map<string, string>): string {
  const argsParts = buildArgsParts(stmt, varNames)
  const argsObj = argsParts.length > 0 ? `{ ${argsParts.join(', ')} }` : ''
  const inputVars = stmt.inputs.map((id) => {
    const mapped = varNames.get(id)
    if (mapped === undefined) {
      throw new Error(`[codegen] unresolved input reference "${id}" — ScriptIR is not self-contained`)
    }
    return mapped
  }).join(', ')
  const callArgs = [inputVars, argsObj].filter((s) => s.length > 0).join(', ')
  // F2：命名空间前缀（缺省 cad）
  const nsExpr = `${stmt.namespace ?? 'cad'}.${stmt.callee}`

  // 1) 解构：outputKeys + outputs 一一对应
  if (stmt.outputKeys && stmt.outputKeys.length > 0) {
    const destructure = stmt.outputKeys.map((k, i) => `${k}: ${stmt.outputs[i]}`).join(', ')
    return `const { ${destructure} } = ${nsExpr}(${callArgs})`
  }

  // 2) 成员调用
  if (stmt.receiver) {
    return `${stmt.receiver}.${stmt.callee}(${argsParts.length > 0 ? `{ ${argsParts.join(', ')} }` : ''})`
  }

  // 3) 无赋值调用
  if (stmt.outputs.length === 0) {
    return `${nsExpr}(${callArgs})`
  }

  // 4) 赋值：outputs[0] 已声明 → 裸重赋值；未声明 → let 声明
  const out = stmt.outputs[0]
  if (declared.has(out)) return `${out} = ${nsExpr}(${callArgs})`
  declared.add(out)
  return `let ${out} = ${nsExpr}(${callArgs})`
}

/**
 * 将单条语句转为可读代码行（用于 TimelinePanel 显示和导出）。
 *
 * 输出格式：`let part0 = cad.op(inputs, { key: value, ... })`
 * - 多输出解构输出 `const { front: out0, back: out1 } = cad.split(input, { ... })`
 * - 成员调用输出 `assem1.add_constraint({ ... })` / `assem1.do_assemble()`
 */
export function statementToLine(stmt: StatementIR): string {
  return formatCodeLine({
    callee: stmt.callee,
    receiver: stmt.receiver,
    inputs: stmt.inputs,
    outputs: stmt.outputs,
    outputKeys: stmt.outputKeys,
    args: stmt.args,
  })
}

// ── 纯数据 → 代码行（宿主代码生成入口，IR 剥离配套） ──

export interface FormatCodeLineInput {
  callee: string
  /** 成员方法调用接收者变量名 */
  receiver?: string
  /** 位置输入变量名 */
  inputs: string[]
  /** 产出变量名 */
  outputs: string[]
  /** 解构键（与 outputs 一一对应） */
  outputKeys?: string[]
  /** 参数对象（纯数据；支持 ParamRef/VarRef/CallRef 形态） */
  args: Record<string, ArgIR>
  /** 调用命名空间（F2：第三方库 `mech.makeHeadstock(...)` → 'mech'；缺省 'cad'） */
  namespace?: string
  /**
   * outputs[0] 是否已在代码中声明：true → 裸重赋值（`part0 = ...`），
   * false/省略 → let 声明；解构/成员调用/无输出时忽略。
   */
  outputDeclared?: boolean
}

/**
 * 从纯数据（非 IR 类型）打印一行 faijs 源代码。
 *
 * 宿主 buildCode / 编辑重排行（editStatement → replaceCodeAt）统一走此入口，
 * 与 statementToLine/scriptToCode 共用同一打印机（单一文本形态真源）。
 */
export function formatCodeLine(input: FormatCodeLineInput): string {
  const stmt: StatementIR = {
    id: '__fmt__' as never,
    callee: input.callee,
    ...(input.receiver !== undefined ? { receiver: input.receiver as PartName } : {}),
    ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
    inputs: input.inputs as PartName[],
    outputs: input.outputs as PartName[],
    ...(input.outputKeys !== undefined ? { outputKeys: input.outputKeys } : {}),
    args: input.args,
  }
  const varNames = new Map<string, string>()
  for (const id of input.inputs) varNames.set(id, id)
  const declared = new Set<string>()
  if (input.outputDeclared && input.outputs[0] !== undefined) declared.add(input.outputs[0])
  return printStatement(stmt, declared, varNames)
}

// ── 脚本 → 扁平代码 ──

/** ImportIR → 源码 import 行（F2 往返打印）。 */
function fmtImport(imp: ImportIR): string {
  switch (imp.kind) {
    case 'namespace':
      return `import * as ${imp.localName} from '${imp.specifier}'`
    case 'default':
      return `import ${imp.localName} from '${imp.specifier}'`
    case 'named':
      return `import { ${(imp.bindings ?? [imp.localName]).join(', ')} } from '${imp.specifier}'`
  }
}

/** FunctionDefIR → 源码函数定义（A1 往返打印；body 保留原文切片，含花括号内换行/缩进，
 *  直接夹在 `{` 与 `}` 之间即可逐位还原原始函数定义）。 */
function fmtFunction(fn: FunctionDefIR): string {
  const params = fn.params.length > 0 ? fn.params.join(', ') : ''
  return `function ${fn.name}(${params}) {${fn.body}}`
}

/**
 * 将整个 ScriptIR 按语句顺序拼接为扁平代码文本。
 *
 * 无 export/async/await/return/参数声明。
 * terminal shapes 自动推导：不被引用的输出即终端（不在代码中标注）。
 * F2：顶层 import 段打印回文件头（往返保真）。
 * A1：顶层函数定义段打印回 import 之后、语句之前（往返保真）。
 */
export function scriptToCode(script: ScriptIR): string {
  const bodyLines: string[] = []
  const varNames = new Map<string, string>()
  /** 已声明过的变量名集合（用于区分 let 首次声明 vs let 重赋值） */
  const declared = new Set<string>()

  // 参数声明：输出为 const name = literal
  for (const p of script.params) {
    bodyLines.push(`const ${p.name} = ${fmtValue(p.value as ArgIR)}`)
    varNames.set(p.name, p.name)
    declared.add(p.name)
  }

  for (const stmt of script.statements) {
    bodyLines.push(printStatement(stmt, declared, varNames))
    // 将 outputs 中的每个 partName 映射到自身，使下游 inputs 能解析
    for (const outId of stmt.outputs) {
      varNames.set(outId, outId)
    }
    if (stmt.outputs.length === 0) {
      varNames.set(stmt.id, primaryOutput(stmt))
    }
  }

  const body = bodyLines.join('\n')
  const imports = (script.imports ?? []).map(fmtImport).join('\n')
  const functions = (script.functions ?? []).map(fmtFunction).join('\n')
  const head = [imports, functions].filter((s) => s.length > 0).join('\n')
  if (head) return body ? `${head}\n${body}` : head
  return body
}
