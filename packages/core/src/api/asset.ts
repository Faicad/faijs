/**
 * stdlib asset — `cad.asset(key)` 库函数（A7 消灭后 asset 走 CallRefIR）
 *
 *
 * 嵌套调用 `cad.asset('cfg')` 返回 UTF-8 字符串（SVG 等文本资产）。
 */

import { getBackends } from '../runtime-state'

/**
 * 查询资产 key 内容为 UTF-8 字符串（SVG 等文本资产）。嵌套调用，供 text/svg 类 op 作资产引用。
 * @group 查询
 * @inputs 0
 * @async true
 * @qual ok
 * @name asset
 * @returns Promise<string> 资产内容字符串（UTF-8 解码）。`cad.asset('cfg')` 返回 SVG 等文本资产，可作 svgExtrude/engrave 的 svg 参数。
 * @param key - 资产 key。type:string required:true
 * @example
 * const svg = await cad.asset('logo_cfg')
 */
export async function asset(key: string): Promise<string> {
  const assets = getBackends().assets as { resolveByKey(key: string): Promise<{ bytes: ArrayBuffer }> } | undefined
  if (!assets) {
    throw new Error(`[stdlib/asset] asset "${key}" cannot be resolved: assets not available`)
  }
  const result = await assets.resolveByKey(key)
  return new TextDecoder('utf-8').decode(new Uint8Array(result.bytes))
}
