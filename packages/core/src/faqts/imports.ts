/**
 * faits — import 声明解析与说明符重写（Phase D, pipeline 第 2–3 步）
 *
 * 说明：faits 复用 Phase B 的导入通道 ①② —— 即"只负责把它所依赖的
 * 裸说明符改写到宿主能解析的绝对 URL（file:/blob:/http(s):），其余
 * 保持原样"。与 faijs 的 ModuleResolver（Phase E V5.2, plan §4.1）不
 * 同，此处 **不实现** 模块仓库解析，只做确定性的语法级重写：
 *
 * - 相对说明符（`./x`、`../x`）→ 可选按 base URL 绝对化，否则保留
 * - `@faicad/faijs` 及其子路径（含 `/sdk`）→ **零替换**，由宿主 importmap 解析
 * - 其它裸说明符 → 走宿主提供的 rewrite 表（复用 B 通道 ①② 的产物）
 *
 * acorn 仅用于定位每个 import 声明在源码中的精确 span；替换用字符串
 * 手术完成，不重建整份 AST，避免丢注释/格式（保持行号定位）。
 */

import { parse } from 'acorn'

export interface FaqtsImportSpan {
  /** import 声明的原始说明符，如 `./partner`、`@faqad/faqjs/sdk` */
  specifier: string
  /** 说明符字符串在源码中的起始偏移（不含引号） */
  start: number
  /** 说明符字符串在源码中的结束偏移（不含引号） */
  end: number
  /** 是否裸说明符（既非相对路径也非绝对 URL） */
  bare: boolean
}

export type FaqtsRewriteFn = (specifier: string, ctx: { bare: boolean }) => string | undefined

/** 宿主 importmap 应已覆盖的说明符前缀，重写时默认跳过。 */
const RESERVED_BARE_PREFIXES = ['@faicad/faijs', '@faicad/faq', '@faicad/faq/sdk', '@fc/fq/' ]

/**
 * 解析模块源码（必须是已去类型的 JS），返回全部静态 import 的说明符/位置。
 *
 * 只处理顶层 import 声明（ESM 静态导入）；动态 import() 属于运行时行为，
 * 不在重写范围内——若 faits 需要动态导入，宿主 importmap 自行兜底。
 */
export function findImports(code: string): FaqtsImportSpan[] {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
  const spans: FaqtsImportSpan[] = []
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    const src = node.source as { value: string; start?: number; end?: number }
    if (!src || src.start === undefined || src.end === undefined) continue
    const spec = src.value
    const bare = !spec.startsWith('.') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)
    // acorn 的 source.start/end 覆盖含引号的字符串字面量 → 收缩到不含引号的内容
    spans.push({ specifier: spec, start: src.start + 1, end: src.end - 1, bare })
  }
  return spans
}

function isReserved(specifier: string): boolean {
  return RESERVED_BARE_PREFIXES.some((p) => specifier === p || specifier.startsWith(p + '/'))
}

/**
 * 重写模块代码中的 import 说明符：按 span（start/end）对源码做替换。
 *
 * 规则（按优先级）：
 * 1. 保留前缀（`@faicad/faij` 家族）→ 不改（宿主 importmap 解析）
 * 2. rewrite 钩子返回非 `undefined` → 用之
 * 3. 相对说明符且给了 baseURL → 绝对化
 * 4. 其余 → 原样保留
 *
 * 用一次 `code` 全串替换（从后往前保证 span 位置不漂移）。
 */
export function rewriteImports(
  code: string,
  options: {
    rewrite?: FaqtsRewriteFn
    baseURL?: string | URL
  } = {},
): string {
  const spans = findImports(code)
  let out = code
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]
    let repl: string | undefined
    if (options.rewrite) {
      // 宿主重写钩子优先（可覆盖保留前缀，用于测试/自定义宿主将
      // `@faicad/faq` 指向同一个模块实例，保证 Shape 身份一致）
      repl = options.rewrite(span.specifier, { bare: span.bare })
    }
    if (repl === undefined && isReserved(span.specifier)) {
      // 保留前缀：零替换，交给宿主 importmap（B 通道 ① 语义）
      repl = undefined
    }
    if (repl === undefined && span.bare === false && options.baseURL) {
      repl = new URL(span.specifier, options.baseURL).href
    }
    if (repl === undefined || repl === span.specifier) continue
    // 替换除引号外的字符串内容
    out = out.slice(0, span.start) + repl + out.slice(span.end)
  }
  return out
}