/**
 * 第一方模块（2026-09-25 core-decouple Phase 1）：`wasmIndex` 复制自 brepjs
 * `src/utils/vec3.ts`（同源复制，仅提取 errors.ts 依赖的最小符号）。
 */

/** Safe typed array index access（brepjs 原语义：`arr[i] as T`）。
 *
 * @param arr - The array to index into.
 * @param i - The index to access.
 * @returns The element at index `i`.
 */
export function wasmIndex<T>(arr: ArrayLike<T>, i: number): T {
  return arr[i] as T;
}
