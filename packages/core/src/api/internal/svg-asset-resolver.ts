/**
 * api internal svg-asset-resolver — SVG 资产解析辅助函数
 *
 * 从 src/ops/svg-asset-resolver.ts 迁入（Phase 2.5 删除 src/ops/）。
 *
 * AssetRef 类型已退役（§4.2：`cad.asset(...)` 走 CallRefIR，运行时解析为字符串）；
 * 此处保留对 `{$asset: key}` 结构（旧 IR / 宿主手写语句）的运行时兼容。
 */

import type { HostPorts } from '../../cad-runtime/ports'

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
 * @throws if the SVG key cannot be resolved.
 * @param svg - the svg argument: a plain SVG string or a legacy `{ $asset: key }` reference.
 * @param ports - the host asset ports used to resolve a legacy asset reference.
 * @returns the resolved SVG text string.
 */
export async function resolveSvgArg(
  svg: unknown,
  ports?: Pick<HostPorts, 'assets'>,
): Promise<string> {
  return resolveAssetTextArg(svg, ports, 'SVG')
}

/**
 * 「文本或资产引用」参数的通解（SVG / DXF 共用）。
 *
 * 为什么把 svg 那套抽出来而不是复制一份：语义完全一样（字符串直用、`{$asset}` 走
 * ports 解析、UTF-8 解码），唯一差别是错误文案里的资源名。复制一份的下场是
 * "SVG 支持 ports.assets 而 DXF 忘了"这类只有端侧才暴露的分叉。
 *
 * @param arg 参数值：文本字符串或 `{ $asset: key }`
 * @param ports 宿主资产端口
 * @param label 资源名（只进错误文案：'SVG' / 'DXF'）
 * @returns 解析后的资源文本（字符串直通或资产 UTF-8 解码结果）
 */
export async function resolveAssetTextArg(
  arg: unknown,
  ports: Pick<HostPorts, 'assets'> | undefined,
  label: string,
): Promise<string> {
  // 普通字符串：直接返回（兼容旧格式或直接传入文件文本）
  if (typeof arg === 'string') return arg

  // 旧 AssetRef 结构：按 key 解析
  if (isLegacyAssetRef(arg)) {
    const key = arg.$asset

    // 优先使用 ports.assets（headless 环境支持）
    if (ports?.assets) {
      const result = await ports.assets.resolveByKey(key)
      return decodeUtf8(result.bytes)
    }

    // ports.assets is required for headless engine
    throw new Error(`[resolveAssetTextArg] ${label} asset "${key}" cannot be resolved: ports.assets not available`)
  }

  throw new Error(`[resolveAssetTextArg] ${label}: expected string or AssetRef, got ${typeof arg}`)
}
