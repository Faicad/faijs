/**
 * symbol-table — 标准库符号表类型与消费入口（L0 零依赖）
 *
 * 设计文档：docs/plans/2026-08-28-keep-syntax-design.md §P1
 * （历史：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.6）
 *
 * 符号表是"标准库符号表"（正常语言编译器认识 prelude 的同款机制），
 * 机器生成、均匀查询。keep-syntax P1 之后它只承载一个职责：
 * check() 符号检查判定 callee 是否存在（"函数不存在"诊断）。
 * 保留语义（readonlyPositions/readonlyPaths）已删除——保留由 keep 声明
 * （调用点 keep / 函数体 exec.keep）显式表达，不再靠类型标注提取（R7）。
 * 未知第三方函数不在表中时，check() 报"函数不存在"，其它机制不受影响。
 *
 * 生成文件：src/lang/symbol-table.generated.ts（由 scripts/gen-symbol-table.ts 生成，禁手改）。
 */

import symbolTable from './symbol-table.generated'

/** 符号表条目（keep-syntax P1 后为空对象占位，仅承载键存在性）。 */
export type FunctionSymbol = Record<string, never>

/** 标准库符号表：callee → 条目。均匀数据，无 per-函数代码。 */
export type SymbolTable = Record<string, FunctionSymbol>

/** 生成的符号表（禁手改，由 scripts/gen-symbol-table.ts 生成） */
export const SYMBOL_TABLE: SymbolTable = symbolTable as SymbolTable

/** 未知函数（不在表中）→ undefined，check() 据此报"函数不存在" */
export function getFunctionSymbol(callee: string): FunctionSymbol | undefined {
  return SYMBOL_TABLE[callee]
}
