﻿/**
 * SVG 资产解析辅助函数
 *
 * P4-2/P4-3：SVG 内容改为资产引用 { $asset: key }。
 * ops 层执行时需将 AssetRef 解析为 SVG 文本字符串。
 *
 * 解析优先级：
 * 1. ports.assets（headless 环境支持）→ bytes → UTF-8 decode
 * 2. SvgAssetStore（browser 回退）→ 直接字符串
 */

import type { AssetRef } from '../../faijs/types'
import { isAssetRef } from '../../faijs/types'
import type { HostPorts } from '../../cad-runtime/ports'

/**
 * 将 ArrayBuffer 解码为 UTF-8 字符串
 */
function decodeUtf8(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
}

/**
 * 解析 args.svg 字段为 SVG 文本字符串。
 *
 * - 如果是 AssetRef（{ $asset: key }）：按 key 解析
 * - 如果是普通字符串：直接返回（兼容）
 *
 * @throws 如果 key 无法解析
 */
export async function resolveSvgArg(
  svg: unknown,
  ports?: HostPorts,
): Promise<string> {
  // 普通字符串：直接返回（兼容旧格式或直接传入 SVG 文本）
  if (typeof svg === 'string') return svg

  // AssetRef：按 key 解析
  if (isAssetRef(svg as never)) {
    const ref = svg as AssetRef
    const key = ref.$asset

    // 优先使用 ports.assets（headless 环境支持）
    if (ports?.assets) {
      const result = await ports.assets.resolveByKey(key)
      return decodeUtf8(result.bytes)
    }

    // ports.assets is required for headless engine
    throw new Error(`[resolveSvgArg] SVG asset "${key}" cannot be resolved: ports.assets not available`)
  }

  throw new Error(`[resolveSvgArg] expected string or AssetRef, got ${typeof svg}`)
}
