/**
 * code-to-args — 单语句行 args 提取（编辑回填配套）
 *
 * 设计文档：3d_editor docs/plans/2026-08-28-ir-strip-source-code-generation-plan.md §4.6
 *
 * 宿主编辑回填（FeatureEditor.backfill / editStatement）需要从代码行
 * 反提参数对象。此能力由 faijs 标配提供（与 parse 语义一致），
 * 宿主不得用 acorn 自行解析（B3 修正）。
 *
 * F1（表达式折叠）：args 含计算表达式（binary/template/conditional/spread）时，
 * 与 parser 折叠语义一致地**求值后返回字面值**，不抛错。
 * 单行提取缺失参数真实值 → 前置声明用哨兵字面量 `let <id> = 0`（参数形态），
 * 使表达式可静态折叠；宿主用 StatementSummary.hasComputedArgs 判定只读降级，
 * 不得把折叠值写回源码（会丢失原表达式）。
 */

import type { JsonValue } from './types'
import { parseScript } from './parser'

/**
 * 单行提取的前置声明规则（确定性静态规则，非 try/catch 兜底）：
 * parser 的作用域检查（inputs / 重赋值 LHS / 成员方法 receiver / args 中的
 * 裸标识符参数引用）要求变量已声明，而单行提取天然缺失声明上下文。
 * 规则：提取行内全部标识符（剥掉字符串字面量后），为每个非 `cad`/关键字
 * 标识符前置一行 `let <id> = 0`（哨兵参数）。parser 对该形态只做语法
 * 检查、不查符号表；多余声明对 varToId 仅是"可查到"，不影响目标行的
 * args 解析结果。F1 起用哨兵参数（而非 `cad.assembly({})` 语句）——
 * 参数值已知 → 表达式可静态折叠，满足"参数为表达式时返回折叠字面值"。
 */
const IDENT_RE = /[A-Za-z_$][\w$]*/g
const STRING_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g
const NON_DECL = new Set([
  'cad', 'const', 'let', 'true', 'false', 'null', 'undefined',
  'await', 'return', 'new', 'typeof', 'var', 'function',
])

function extractIdentifiers(line: string, namespaces?: Set<string>): string[] {
  const withoutStrings = line.replace(STRING_RE, "''")
  const declared = declaredByLine(withoutStrings)
  const ids = new Set<string>()
  for (const m of withoutStrings.matchAll(IDENT_RE)) {
    const id = m[0]
    if (NON_DECL.has(id) || declared.has(id) || namespaces?.has(id)) continue
    ids.add(id)
  }
  return [...ids]
}

/**
 * 行内自身声明的标识符（前置声明必须跳过，否则 acorn 重声明报错）：
 * - `const/let x = ...` 的 x
 * - `const { k1: v1, k2 } = ...` 的绑定名 v1/k2（键名 k1 不是声明，仍需前置声明——无害）
 */
function declaredByLine(line: string): Set<string> {
  const ids = new Set<string>()
  let m = /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)
  if (m) ids.add(m[1])
  m = /^\s*const\s*\{([^}]*)\}\s*=/.exec(line)
  if (m) {
    for (const prop of m[1].split(',')) {
      const bound = (prop.split(':')[1] ?? prop).trim()
      const id = /^([A-Za-z_$][\w$]*)/.exec(bound)
      if (id) ids.add(id[1])
    }
  }
  return ids
}

/**
 * 解析单条语句行，提取其 args 对象（序列化形态，无 IR 变体语义）。
 *
 * 支持的行形态（与 parser 接受的语句一致）：
 * - `const part0 = cad.box({ size: 20 })`
 * - `part0 = cad.drill(part0, { diameter: 5 })`（裸重赋值）
 * - `const { front: a, back: b } = cad.split(part0, { normal: [0,0,1] })`（解构）
 * - `asm0.add_constraint({ ... })`（成员方法调用）
 * - args 中的裸标识符参数引用（`cad.box({ size: height })`）
 * - args 中的计算表达式（`cad.box({ size: base + 20 })`）→ 折叠为字面值返回
 *
 * 无 args 的语句（如 `asm0.do_assemble()`）返回 `{}`。
 *
 * @param codeLine 单条语句源码行
 * @param opts.namespaces 该脚本顶层 import 的绑定名（F2：`mech.makeHeadstock(...)`
 *   中 `mech` 不得被前置声明为变量）。L0 不感知注册表，由宿主从脚本 imports 提供。
 * @throws ParseError — 行文本不是合法语句时抛出（含行号）
 */
export function codeToArgs(codeLine: string, opts?: { namespaces?: string[] }): Record<string, JsonValue> {
  const namespaces = new Set(opts?.namespaces ?? [])
  const decls = extractIdentifiers(codeLine, namespaces)
    .map((id) => `let ${id} = 0`)
    .join('\n')
  const code = decls ? `${decls}\n${codeLine}` : codeLine
  const { script } = parseScript(code)
  const last = script.statements[script.statements.length - 1]
  if (!last) return {}
  // Args on the wire are JSON-shaped data (ParamRef/VarRef/CallRef are plain
  // objects like { $param } / { $ref } / { $call }); the host contract face is
  // JsonValue — IR types never leak to the host (IR strip red line).
  return last.args as unknown as Record<string, JsonValue>
}
