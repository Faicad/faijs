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

import type { ArgIR, StatementIR, ScriptIR, ParamRefIR, VarRefIR, CallRefIR } from './types'
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

/** 字符串转义：单引号、反斜杠与控制字符。
 *  必须保证 fmtValue ⇄ analyzeCode 往返一致：多行字符串参数（SDF code 等）
 *  嵌入 '…' 后仍须是合法 JS，且可被 parser 精确还原（\n → \\n，\r → \\r 等）。 */
function escapeStr(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\x08/g, '\\b') // 退格；注意 /\b/ 在外是单词边界，必须用 \x08
    .replace(/\f/g, '\\f')
    .replace(/\x0B/g, '\\v') // 垂直制表；\v 在正则是单词内不匹配，用 \x0B 防歧义
}

/** ParamRefIR → 裸标识符 `name`（文本形式中无 $ 前缀，合法 JS） */
function fmtParamRef(ref: ParamRefIR): string {
  return ref.$param
}

/** VarRefIR → 裸变量名（已声明变量，如 group/assembly 的 members 元素） */
function fmtVarRef(ref: VarRefIR, varNames?: Map<string, string>): string {
  return varNames?.get(ref.$ref) ?? ref.$ref
}

/** CallRefIR → `cad.<callee>(<args>)`（嵌套调用，如 cad.faceCenter(part0)） */
function fmtCallRef(ref: CallRefIR, varNames?: Map<string, string>): string {
  const { callee, args } = ref.$call
  const inner = args.map((a) => fmtValue(a, varNames)).join(', ')
  return `cad.${callee}(${inner})`
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

  // 1) 解构：outputKeys + outputs 一一对应
  if (stmt.outputKeys && stmt.outputKeys.length > 0) {
    const destructure = stmt.outputKeys.map((k, i) => `${k}: ${stmt.outputs[i]}`).join(', ')
    return `const { ${destructure} } = cad.${stmt.callee}(${callArgs})`
  }

  // 2) 成员调用
  if (stmt.receiver) {
    return `${stmt.receiver}.${stmt.callee}(${argsParts.length > 0 ? `{ ${argsParts.join(', ')} }` : ''})`
  }

  // 3) 无赋值调用
  if (stmt.outputs.length === 0) {
    return `cad.${stmt.callee}(${callArgs})`
  }

  // 4) 赋值：outputs[0] 已声明 → 裸重赋值；未声明 → let 声明
  const out = stmt.outputs[0]
  if (declared.has(out)) return `${out} = cad.${stmt.callee}(${callArgs})`
  declared.add(out)
  return `let ${out} = cad.${stmt.callee}(${callArgs})`
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

/**
 * 将整个 ScriptIR 按语句顺序拼接为扁平代码文本。
 *
 * 无 export/async/await/return/参数声明。
 * terminal shapes 自动推导：不被引用的输出即终端（不在代码中标注）。
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

  return bodyLines.join('\n')
}
