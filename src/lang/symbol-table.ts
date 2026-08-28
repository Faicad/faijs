/**
 * symbol-table — 标准库符号表类型与消费入口（L0 零依赖）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.6
 * 实施文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §3.5
 *
 * 符号表是"标准库符号表"（正常语言编译器认识 prelude 的同款机制），
 * 机器生成、均匀查询、无 per-函数代码路径。
 * 未知第三方函数不在表中时，语言的一切机制仍然工作（有确定默认行为）。
 *
 * 生成文件：src/lang/symbol-table.json（由 scripts/gen-symbol-table.ts 生成，禁手改）。
 * 消费方：命名服务（§4.7 derivePartName）、活跃性分析（§4.8 consumes）、check() 诊断（§4.9）。
 */

import symbolTable from './symbol-table.json'

export interface FunctionSymbol {
  /** 位置形参中 ReadonlyShape 的下标 */
  readonlyPositions?: number[]
  /** options 对象中 readonly 的属性名（members 等） */
  readonlyPaths?: string[]
}

/** 标准库符号表：callee → readonly 标注。均匀数据，无 per-函数代码。 */
export type SymbolTable = Record<string, FunctionSymbol>

/** 生成的符号表（禁手改，由 scripts/gen-symbol-table.ts 生成） */
export const SYMBOL_TABLE: SymbolTable = symbolTable as SymbolTable

/** 未知函数（不在表中）→ undefined，消费方按默认语义处理 */
export function getFunctionSymbol(callee: string): FunctionSymbol | undefined {
  return SYMBOL_TABLE[callee]
}
