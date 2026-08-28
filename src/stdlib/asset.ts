/**
 * stdlib asset — `cad.asset(key, exec)` 库函数（A7 消灭后 asset 走 CallRef）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §5.2
 *
 * 从 adapter 的 assetQuery 迁出为普通 stdlib 函数：
 * 嵌套调用 `cad.asset('cfg')` 编译为 `await cad.asset('cfg', exec)`，返回 UTF-8 字符串。
 */

import type { ExecContext } from '../cad-runtime/exec-context'

/** `cad.asset(key, exec)`：经 exec.assets 解析为 UTF-8 字符串（SVG 等文本资产）。 */
export async function asset(key: string, exec: ExecContext): Promise<string> {
  if (!exec.assets) {
    throw new Error(`[stdlib/asset] asset "${key}" cannot be resolved: exec.assets not available`)
  }
  const result = await exec.assets.resolveByKey(key)
  return new TextDecoder('utf-8').decode(new Uint8Array(result.bytes))
}
