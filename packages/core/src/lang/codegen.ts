/**
 * codegen — 纯数据 → 文本 打印工具（宿主编辑器/测试用；L0，仅依赖 host-arg）
 *
 * 宿主 buildCode / 编辑重排行（editStatement → replaceCodeAt）统一走此入口。
 * 输入是纯数据（HostArg 面），不依赖任何 IR 类型。
 *
 * 扁平代码格式（无 export/async/await/return/参数声明）：
 * ```js
 * let part0 = cad.box(10, 20, 30)
 * part0 = cad.translate(part0, { offset: [1, 2, 3] })
 * ```
 *
 * 值格式约定（确定性输出）：
 * - vec3 → `[1,2,3]`（紧凑无空格）
 * - 数字 → 整数直出；小数最多保留 6 位有效小数并去尾零
 * - 字符串 → 单引号包裹
 * - HostVarRef → 裸变量名（members 元素）
 * - HostCallRef → `cad.faceNormal(part0)`（嵌套调用）
 * - HostExprRef → `(expr text)`（原文加括号）
 * - 对象字面量 → `{key:value}`（冒号，合法 JS）
 */

import type { HostArg } from './host-arg'
import { isHostVarRef, isHostParamRef, isHostCallRef, isHostExprRef, isHostRef } from './host-arg'

// ── 数值格式化 ──

/**
 * Format a number as text: integers emit as-is; decimals retain at most 6
 * significant fractional digits with trailing zeros stripped.
 * @param n - the number to format.
 * @returns the formatted text representation.
 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(6)
  return s.replace(/\.?0+$/, '')
}

// ── 字符串转义 ──

/** 字符串转义：转义反斜杠、单引号与控制字符（多行 SDF code 等字符串参数用）。
 *  逐一字符映射（避开 regex 控制字符字面量，满足 eslint no-control-regex），
 *  保证 fmtValue ⇄ analyzeCode 往返一致：嵌入 '…' 后仍是合法 JS，可被精确还原。 */
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

/** 参数值 → 文本（递归，HostArg 面） */
function fmtValue(value: HostArg): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return fmtNum(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return `'${escapeStr(value)}'`
  if (isHostVarRef(value)) return value.name
  if (isHostParamRef(value)) return value.name
  if (isHostCallRef(value)) {
    const { callee, args, namespace } = value
    const inner = args.map(fmtValue).join(', ')
    return `${namespace ?? 'cad'}.${callee}(${inner})`
  }
  if (isHostExprRef(value)) return `(${value.text})`
  if (Array.isArray(value)) return `[${value.map(fmtValue).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, HostArg>)
    return `{${entries.map(([k, v]) => `${k}:${fmtValue(v)}`).join(', ')}}`
  }
  return String(value)
}

// ── 纯数据 → 代码行（宿主代码生成入口） ──

/**
 * Pure-data input for printing one faijs source line, decoupled from IR types.
 *
 * `positional` and `args` use `HostArg` (host-friendly types with `kind`-based
 * discrimination).
 */
export interface FormatCodeLineInput {
  callee: string
  /** 成员方法调用接收者变量名 */
  receiver?: string
  /**
   * 位置实参槽（HostArg 形态）：宿主可传字面量、
   * 变量引用（`{kind:'var-ref',name}`）、参数引用（`{kind:'param-ref',name}`）、
   * 嵌套调用（`{kind:'call-ref',callee,args,namespace?}`）、
   * 表达式（`{kind:'expr-ref',text,refs,params}`）或纯 JsonValue，按序打印。
   */
  positional: HostArg[]
  /** 产出变量名 */
  outputs: string[]
  /** 解构键（与 outputs 一一对应） */
  outputKeys?: string[]
  /**
   * （过渡兼容）选项对象：positional 末位不是纯对象时追加为尾随选项对象。
   * 新代码应把选项对象直接放进 positional。
   */
  args?: Record<string, HostArg>
  /** 调用命名空间（F2：第三方库 `mech.makeHeadstock(...)` → 'mech'；缺省 'cad'） */
  namespace?: string
  /**
   * outputs[0] 是否已在代码中声明：true → 裸重赋值（`part0 = ...`），
   * false/省略 → let 声明；解构/成员调用/无输出时忽略。
   */
  outputDeclared?: boolean
}

/** 检测 HostArg 是否为纯数据对象（非引用形态）。 */
function isPlainObjArg(arg: HostArg): boolean {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && !isHostRef(arg)
}

/**
 * 从纯数据（非 IR 类型）打印一行 faijs 源代码。
 *
 * 宿主 buildCode / 编辑重排行（editStatement → replaceCodeAt）统一走此入口。
 * @param input - the pure-data line description.
 * @returns the printed single-line code text.
 */
export function formatCodeLine(input: FormatCodeLineInput): string {
  const positional = input.positional
  const argsInput: Record<string, HostArg> = input.args ?? {}

  // 位置实参按序打印
  const positionalParts = positional.map((arg) => {
    if (isPlainObjArg(arg)) {
      const entries = Object.entries(arg as Record<string, HostArg>)
      return `{ ${entries.map(([k, v]) => `${k}:${fmtValue(v)}`).join(', ')} }`
    }
    return fmtValue(arg)
  })

  // args 槽（过渡兼容：positional 末位非纯对象时追加为独立选项槽）
  const argsParts = Object.entries(argsInput).map(([k, v]) => `${k}:${fmtValue(v)}`)
  const lastIsPlainObject = positional.length > 0 && isPlainObjArg(positional[positional.length - 1])

  let callArgs: string
  if (positionalParts.length > 0) {
    callArgs = positionalParts.join(', ')
    if (!lastIsPlainObject && argsParts.length > 0) {
      callArgs = [...positionalParts, `{ ${argsParts.join(', ')} }`].join(', ')
    }
  } else if (input.receiver) {
    callArgs = argsParts.length > 0 ? `{ ${argsParts.join(', ')} }` : ''
  } else {
    callArgs = argsParts.length > 0 ? `{ ${argsParts.join(', ')} }` : '{}'
  }

  // F2：命名空间前缀（缺省 cad）；本机函数调用 callee 无命名空间前缀
  const nsExpr = input.namespace === undefined ? `cad.${input.callee}` : `${input.namespace}.${input.callee}`

  // 1) 解构：outputKeys + outputs 一一对应
  if (input.outputKeys && input.outputKeys.length > 0) {
    const destructure = input.outputKeys.map((k, i) => `${k}: ${input.outputs[i]}`).join(', ')
    return `const { ${destructure} } = ${nsExpr}(${callArgs})`
  }

  // 2) 成员调用
  if (input.receiver) {
    return `${input.receiver}.${input.callee}(${callArgs})`
  }

  // 3) 无赋值调用
  if (input.outputs.length === 0) {
    return `${nsExpr}(${callArgs})`
  }

  // 4) 赋值：outputDeclared → 裸重赋值；否则 let 声明
  const out = input.outputs[0]
  if (input.outputDeclared) return `${out} = ${nsExpr}(${callArgs})`
  return `let ${out} = ${nsExpr}(${callArgs})`
}
