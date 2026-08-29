/**
 * stdlib asset — `cad.asset(key)` 库函数（A7 消灭后 asset 走 CallRefIR）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §5.2
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * 嵌套调用 `cad.asset('cfg')` 返回 UTF-8 字符串（SVG 等文本资产）。
 */

import { getBackends } from '../runtime-state'

/** `cad.asset(key)`：经宿主资产解析器解析为 UTF-8 字符串（SVG 等文本资产）。 */
export async function asset(key: string): Promise<string> {
  const assets = getBackends().assets as { resolveByKey(key: string): Promise<{ bytes: ArrayBuffer }> } | undefined
  if (!assets) {
    throw new Error(`[stdlib/asset] asset "${key}" cannot be resolved: assets not available`)
  }
  const result = await assets.resolveByKey(key)
  return new TextDecoder('utf-8').decode(new Uint8Array(result.bytes))
}
