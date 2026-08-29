/**
 * stdlib asset — `cad.asset(key)` 库函数（A7 消灭后 asset 走 CallRefIR）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §5.2
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * 嵌套调用 `cad.asset('cfg')` 返回 UTF-8 字符串（SVG 等文本资产）。
 */
/** `cad.asset(key)`：经宿主资产解析器解析为 UTF-8 字符串（SVG 等文本资产）。 */
export declare function asset(key: string): Promise<string>;
//# sourceMappingURL=asset.d.ts.map