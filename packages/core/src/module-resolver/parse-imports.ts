/**
 * parse-imports — 顶层 import 声明定位（span 提取）
 *
 * 通用模块解析能力：acorn 解析模块源码，返回每个静态顶层 import 声明在
 * 源码中的精确 span（specifier 的 start/end 偏移），供调用方做字符串级
 * 重写（不重建 AST，保持行号/注释/格式）。由 `module-resolver/resolver.ts`
 * 与其它需要 import 定位的通道复用。
 *
 * 只处理顶层静态 import 声明（ESM）；动态 `import()` 是运行时行为，不在
 * span 提取范围内。
 */

import { parse } from 'acorn'

/**
 * The exact location of one static import declaration within module source,
 * used to rewrite its specifier without rebuilding the AST.
 */
export interface ImportSpan {
  /** import 声明的原始说明符，如 `./partner`、`@faicad/faijs/sdk` */
  specifier: string
  /** 说明符字符串在源码中的起始偏移（不含引号） */
  start: number
  /** 说明符字符串在源码中的结束偏移（不含引号） */
  end: number
  /** 是否裸说明符（既非相对路径也非绝对 URL） */
  bare: boolean
}

/**
 * Parse module source (plain JS) and return the specifier and location of
 * every static top-level import declaration. Dynamic import() is runtime
 * behavior and is not part of the rewrite scope.
 *
 * The input is expected to be plain JS — the caller is responsible for
 * ensuring the source is de-typed (libraries ship compiled JS at runtime).
 * @param code - the module JavaScript source text.
 * @returns an array of import spans covering each static import declaration.
 */
export function findImports(code: string): ImportSpan[] {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
  const spans: ImportSpan[] = []
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
