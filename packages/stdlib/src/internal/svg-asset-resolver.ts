/**
 * stdlib internal svg-asset-resolver — SVG 资产解析辅助函数
 *
 * 从 src/ops/svg-asset-resolver.ts 迁入（Phase 2.5 删除 src/ops/）。
 *
 * AssetRef 类型已退役（§4.2：`cad.asset(...)` 走 CallRefIR，运行时解析为字符串）；
 * 此处保留对 `{$asset: key}` 结构（旧 IR / 宿主手写语句）的运行时兼容。
 */

import type { HostPorts } from '@faicad/faijs-core/cad-runtime/ports'

/** 将 ArrayBuffer 解码为 UTF-8 字符串 */
function decodeUtf8(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
}

/** 结构判断：旧 AssetRef 形态 `{$asset: key}`（运行时兼容，不依赖已退役类型） */
function isLegacyAssetRef(v: unknown): v is { $asset: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && '$asset' in v
}

/**
 * 解析 args.svg 字段为 SVG 文本字符串。
 *
 * - 普通字符串：直接返回（兼容直接传入 SVG 文本）
 * - 旧 AssetRef 结构（{ $asset: key }）：按 key 解析（运行时兼容）
 *
 * @throws 如果 key 无法解析
 */
export async function resolveSvgArg(
  svg: unknown,
  ports?: Pick<HostPorts, 'assets'>,
): Promise<string> {
  // 普通字符串：直接返回（兼容旧格式或直接传入 SVG 文本）
  if (typeof svg === 'string') return svg

  // 旧 AssetRef 结构：按 key 解析
  if (isLegacyAssetRef(svg)) {
    const key = svg.$asset

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
