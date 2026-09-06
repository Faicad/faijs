/**
 * parse-error — 文本层解析错误的唯一归属（L0 零依赖）
 *
 * 无 IR 双通道方案（2026-09-06）后 parseScript 语义层删除，MetadataExtractor /
 * SyntaxGate 复用同一 ParseError（宿主面 analyzeCode/codeToArgs 抛错契约不变：
 * 含 line 与 code 字段）。本文件是 ParseError 的唯一家，parser.ts 等重导出保持兼容。
 */

/** 解析诊断码（宿主 CadRuntime.check 透传给 CheckError，AI 可据此精确修正）。 */
export type ParseErrorCode =
  /** 语法错误（acorn 闸门） */
  | 'E_SYNTAX'
  /** 控制流语句（if/for/while/do/switch/try/throw/break/continue/labeled/with + 动态 import()） */
  | 'E_CONTROL_FLOW'
  /** 不支持的语句形态（函数/类/export/new/eval 等） */
  | 'E_STATEMENT'
  /** 参数值表达式不合法（无法静态折叠 / 不支持的表达式节点） */
  | 'E_VALUE'
  /** import 声明位置/形态违规（F2） */
  | 'E_IMPORT'
  /** 引用错误（未知变量 / 未声明 receiver） */
  | 'E_REFERENCE'
  /** 本机函数调用 ABI 违规（§3.6：位置实参超位 / args 对象键不在形参表） */
  | 'E_ARG'

/**
 * An error raised while parsing faijs source, carrying the offending line
 * number and a diagnostic code the host can forward for precise feedback.
 */
export class ParseError extends Error {
  /** The 1-based source line at which the parse error occurred. */
  line: number
  /** 诊断码（缺省 E_SYNTAX）。宿主 check() 透传；3d_editor 可据此给 AI 精确反馈。 */
  code: ParseErrorCode

  constructor(message: string, line: number, code: ParseErrorCode = 'E_SYNTAX') {
    super(`[parser] line ${line}: ${message}`)
    this.name = 'ParseError'
    this.line = line
    this.code = code
  }
}
