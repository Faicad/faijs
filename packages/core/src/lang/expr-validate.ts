/**
 * expr-validate — 宿主实时表达式反馈层（Timeline 参数表达式编辑，P0-C）
 *
 * 只回答「这段表达式文本在当前脚本里是否合法」，不做参数/变量的精确分类：
 * - 语法：acorn 单表达式解析；
 * - 结构：白名单判定（复用执行侧同一套 isExprWhitelist）；
 * - 引用：表达式里每个 Identifier 必须命中 knownNames（命名空间成员表达式对象如
 *   cfg.OUTX 的 cfg 同样按命中处理），否则 E_REFERENCE。
 *
 * 名字判定与提取侧共用同一份实现（isExprWhitelist / collectExprIdentifiers），
 * knownNames 全量塞进轻量符号表的 paramNames / declared（不区分分类、仅判定存在性）
 * ——这是唯一的语义放宽点，见 plans/2026-09-08-timeline-param-expression-editing.md
 * §3.4.1。提交时以 editArgSource 的真实符号表结果为准。
 */

import { parse as acornParse } from 'acorn'
import { collectExprIdentifiers, isExprWhitelist } from './metadata-extractor'
import type { SymbolTable } from './metadata-extractor'
import { ParseError } from './parse-error'

type ASTNode = any

/**
 * 实时表达式校验的输入：单个表达式文本 + 当前脚本的已知名字白名单。
 * 宿主从 UiMetadata.names 提取 knownNames 后调用 validateExpression。
 */
export interface ExprValidateInput {
  /** 待校验的表达式文本（不含语句上下文，单表达式） */
  text: string
  /** 已知名字白名单（参数名 ∪ 变量名 ∪ 命名空间名）；宿主从 UiMetadata.names 取 */
  knownNames: string[]
}

/** 表达式校验结果：通过，或返回错误码与原因（E_SYNTAX/E_REFERENCE/E_VALUE）。 */
export type ExprValidateResult =
  | { ok: true }
  | { ok: false; code: 'E_SYNTAX' | 'E_REFERENCE' | 'E_VALUE'; message: string; line?: number }

/** 把 knownNames 全量塞进 paramNames/declared 的「仅判定存在性」轻量符号表。 */
function buildNameExistenceTable(knownNames: readonly string[]): SymbolTable {
  return {
    paramNames: new Set(knownNames),
    paramValues: new Map(),
    declared: new Set(knownNames),
    nsBindings: new Map(),
    localFnParams: new Map(),
    defaultNsName: 'cad',
    keep: new Map(),
  }
}

/** acorn 单表达式解析（文本以括号包裹，避免对象字面量被当成块/语句解析）。 */
function parseSingleExpression(text: string): ASTNode {
  const wrapped = `(${text})`
  let program: { body: Array<{ type: string; expression?: ASTNode }> }
  try {
    program = acornParse(wrapped, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      ranges: true,
    }) as unknown as { body: Array<{ type: string; expression?: ASTNode }> }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const line = (e as { loc?: { line?: number } } | undefined)?.loc?.line ?? 1
    throw new ParseError(`SyntaxError: ${message}`, line, 'E_SYNTAX')
  }
  if (program.body.length !== 1 || program.body[0].type !== 'ExpressionStatement' || !program.body[0].expression) {
    throw new ParseError(
      `expected a single expression, got ${program.body.length} statement(s)`,
      1,
      'E_SYNTAX',
    )
  }
  return program.body[0].expression
}

/**
 * 校验单条表达式文本在当前已知名字环境下是否合法（语法 + 白名单 + 引用存在性）。
 * 不抛异常：一切失败路径都折叠进结构化结果，宿主毋需 try/catch。
 * @param input 表达式文本 + 已知名字白名单（见 ExprValidateInput）。
 * @returns 通过（ok）或失败（错误码 / 原因 / 可选行号）。
 */
export function validateExpression(input: ExprValidateInput): ExprValidateResult {
  const text = typeof input?.text === 'string' ? input.text : ''
  const knownNames = Array.isArray(input?.knownNames) ? input.knownNames : []
  if (text.trim() === '') {
    return { ok: false, code: 'E_SYNTAX', message: 'empty expression' }
  }
  let node: ASTNode
  try {
    node = parseSingleExpression(text)
  } catch (e) {
    if (e instanceof ParseError) {
      return { ok: false, code: 'E_SYNTAX', message: e.message, line: e.line }
    }
    throw e
  }
  if (!isExprWhitelist(node)) {
    return {
      ok: false,
      code: 'E_VALUE',
      message: `expression is not in the editable whitelist (${node?.type ?? 'node'})`,
      line: node?.loc?.start?.line ?? 1,
    }
  }
  const table = buildNameExistenceTable(knownNames)
  const params = new Set<string>()
  const refs = new Set<string>()
  try {
    collectExprIdentifiers(node, table, node?.loc?.start?.line ?? 1, params, refs)
  } catch (e) {
    if (e instanceof ParseError) {
      return { ok: false, code: 'E_REFERENCE', message: e.message, line: e.line }
    }
    throw e
  }
  return { ok: true }
}