/**
 * source-edit — 参数槽源码精确替换（P0-D）
 *
 * 纯函数：不触碰任何运行时状态。用 newText 精确替换 code 中 (stmtId, path) 槽位的
 * 源码区间，返回新全文。结果 ok 时保证「编辑后的新代码至少可被 module 级 acorn 解析」；
 * 执行侧 update 仍会做完整校验（语义、安全、引用）。
 *
 * path 是**不透明标识符**：必须等于 meta.argSources 中某条记录的 path（全等匹配、
 * 不解析结构）。宿主只能从 ArgSource 读取后原样回传，不得自行构造。
 *
 * 偏移断言：`code.slice(start,end) === src.text` 不符 → E_RANGE_STALE（宿主应刷新
 * 重新提取后重试一次，仍失败则关闭面板并报错，禁止静默写回旧值）。
 */

import { parse as acornParse } from 'acorn'
import { extractMetadata } from './metadata-extractor'
import type { ExtractMetadataOptions, UiMetadata } from './metadata-extractor'
import { validateExpression } from './expr-validate'
import { ParseError } from './parse-error'
import type { StmtId } from '../identity'

/**
 * 本地最小 Result（与 vendored brepjs/core/result 判别的结构一致，纯结构化等价）。
 * lang 层禁止反向 import vendored（分层守卫 R5/L1 D8）——`ok/err/Result` 入库 API
 * 面是唯一官方出口；这里用同构本地实现，宿主按结构使用无感。
 */
export type LocalResult<T, E = never> = { ok: true; value: T } | { ok: false; error: E }
function okRes<T>(value: T): LocalResult<T, never> {
  return { ok: true, value }
}

/**
 * 参数槽源码精确替换失败的错误分类：
 * 槽位缺失（E_SLOT_NOT_FOUND）、偏移过期（E_RANGE_STALE）、原脚本不可提取（E_PARSE）、
 * 新文本/替换后全文语法错（E_SYNTAX）、引用未声明名（E_REFERENCE）、不在白名单（E_VALUE）。
 */
export type EditSourceError =
  /** stmtId+path 在 meta.argSources 中无匹配 */
  | { kind: 'E_SLOT_NOT_FOUND'; message: string }
  /** code.slice(start,end) !== src.text（偏移已失效） */
  | { kind: 'E_RANGE_STALE'; message: string }
  /** 原脚本本身无法提取（坏表达式/语法错 → 整体不可编辑） */
  | { kind: 'E_PARSE'; message: string; line?: number }
  /** 新文本或替换后全文语法失败 */
  | { kind: 'E_SYNTAX'; message: string; line?: number }
  /** 新文本引用了未声明名字 */
  | { kind: 'E_REFERENCE'; message: string; line?: number }
  /** 新文本不在表达式白名单 */
  | { kind: 'E_VALUE'; message: string; line?: number }

/** 新文本校验（复用 validateExpression：同一份白名单/引用判定实现，不复制）。 */
function validateNewExpression(
  newText: string,
  knownNames: string[],
): Extract<EditSourceError, { kind: 'E_SYNTAX' | 'E_REFERENCE' | 'E_VALUE' }> | null {
  const res = validateExpression({ text: newText, knownNames })
  if (res.ok) return null
  return {
    kind: res.code,
    message: res.message,
    ...(res.line !== undefined ? { line: res.line } : {}),
  } as Extract<EditSourceError, { kind: 'E_SYNTAX' | 'E_REFERENCE' | 'E_VALUE' }>
}

/**
 * 用 newText 精确替换 code 中由 (stmtId, path) 标识的槽位源码，返回新全文。
 * path 必须取自 meta.argSources 的原始值（不透明标识符，宿主不得自行构造）。
 * 成功时（ok=true）保证新代码至少可被 module 级 acorn 解析。
 * @param code 当前完整脚本源码。
 * @param stmtId 槽位所属语句 id（必须与 meta.argSources 中记录一致）。
 * @param path 槽位路径（自 ArgSource 原样回传，禁止自行构造）。
 * @param newText 替换后的表达式文本（只替换该槽位区间）。
 * @param options 透传给 extractMetadata 的提取选项（如 ns/heuristic）。
 * @returns 成功 → { ok: true, value: 新全文 }；失败 → { ok: false, error: EditSourceError }。
 */
export function editArgSource(
  code: string,
  stmtId: StmtId,
  path: string,
  newText: string,
  options?: ExtractMetadataOptions,
): LocalResult<string, EditSourceError> {
  // 1. 提取元数据（抛 ParseError 时转 E_PARSE——对已存在的坏脚本给「整体不可编辑」信号）
  let meta: UiMetadata
  try {
    meta = extractMetadata(code, options)
  } catch (e) {
    if (e instanceof ParseError) {
      return { ok: false, error: { kind: 'E_PARSE', message: e.message, line: e.line } }
    }
    throw e
  }

  // 2–3. 查找 stmtId+path 全等匹配（同名同路径理论上唯一；多条取数组顺序第一条）
  const src = meta.argSources.find((s) => s.stmtId === stmtId && s.path === path)
  if (!src) {
    return {
      ok: false,
      error: {
        kind: 'E_SLOT_NOT_FOUND',
        message: `no arg source for stmtId="${stmtId}" path="${path}"`,
      },
    }
  }

  // 4. 偏移断言（code 被篡改/已编辑过 → E_RANGE_STALE）
  if (code.slice(src.start, src.end) !== src.text) {
    return {
      ok: false,
      error: {
        kind: 'E_RANGE_STALE',
        message: `arg source range stale for stmtId="${stmtId}" path="${path}"; re-extract metadata and retry`,
      },
    }
  }

  // 5. 新文本校验（语法 → 白名单 → 未知名）
  const invalid = validateNewExpression(newText, meta.names)
  if (invalid) return { ok: false, error: invalid }

  // 6. splice：纯字符串拼接，不做格式化/规范化（JS UTF-16 下标与 acorn 一致）
  const newCode = code.slice(0, src.start) + newText + code.slice(src.end)

  // 7. 全量回验（不跑安全扫描）
  try {
    acornParse(newCode, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: { kind: 'E_SYNTAX', message: `edited script failed to re-parse: ${message}` },
    }
  }

  // 8
  return okRes(newCode)
}