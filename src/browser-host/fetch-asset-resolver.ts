/**
 * FetchAssetResolver — browser 端资产解析（fetch URL）
 *
 * 实现 AssetResolver 接口（ports.ts）。
 *
 * 与 node-host 的 FsAssetResolver 对称：
 * - FsAssetResolver: 通过 fs 读取本地文件 + manifest 映射
 * - FetchAssetResolver: 通过 fetch URL 获取资产字节
 *
 * browser 环境不支持 resolveFile（无文件系统），调用时抛错。
 * resolveUrl 和 resolveByKey 通过 fetch 获取。
 */

import type { AssetResolver } from '../cad-runtime/ports'

export interface FetchAssetResolverOptions {
  /** key → URL 映射（类似 manifest） */
  keyToUrl?: Record<string, string>
  /** 自定义 key → URL 解析函数 */
  keyResolver?: (key: string) => string | undefined
}

export class FetchAssetResolver implements AssetResolver {
  private keyToUrl: Map<string, string>
  private keyResolver: ((key: string) => string | undefined) | undefined
  /** 缓存的 ArrayBuffer */
  private cache = new Map<string, ArrayBuffer>()

  constructor(opts?: FetchAssetResolverOptions) {
    this.keyToUrl = new Map(opts?.keyToUrl ? Object.entries(opts.keyToUrl) : [])
    this.keyResolver = opts?.keyResolver
  }

  async resolveByKey(key: string): Promise<{ bytes: ArrayBuffer; format?: string }> {
    let url: string | undefined

    // 先查 keyToUrl 映射
    url = this.keyToUrl.get(key)

    // 再用自定义解析函数
    if (!url && this.keyResolver) {
      url = this.keyResolver(key)
    }

    if (!url) {
      throw new Error(`[FetchAssetResolver] asset key "${key}" not found`)
    }

    const bytes = await this.fetchUrl(url)
    return { bytes, format: undefined }
  }

  async resolveFile(path: string): Promise<ArrayBuffer> {
    throw new Error('[FetchAssetResolver] resolveFile is not available in browser environment. Use resolveUrl or resolveByKey instead.')
  }

  async resolveUrl(url: string): Promise<ArrayBuffer> {
    return this.fetchUrl(url)
  }

  /** fetch 并缓存 */
  private async fetchUrl(url: string): Promise<ArrayBuffer> {
    const cached = this.cache.get(url)
    if (cached) return cached

    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`[FetchAssetResolver] fetch failed: ${url} (${res.status} ${res.statusText})`)
    }
    const buf = await res.arrayBuffer()
    this.cache.set(url, buf)
    return buf
  }
}
