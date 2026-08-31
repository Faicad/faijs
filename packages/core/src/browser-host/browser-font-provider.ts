/**
 * BrowserFontProvider — browser 端字体加载（fetch URL）
 *
 * 实现 FontProvider 接口（ports.ts）+ FontLoader 接口（fontRegistry.ts）。
 *
 * 与 node-host 的 NodeFontProvider 对称：
 * - NodeFontProvider: 通过 fs.readFileSync 读取字体文件
 * - BrowserFontProvider: 通过 fetch(url) 加载字体字节
 *
 * 字体 URL 由消费者注入（3d_editor 用 Vite ?url 语法获取字体路径）。
 */

import type { FontProvider } from '../cad-runtime/ports'
import type { FontLoader } from '../brep/text/fontRegistry'

/**
 * Options for constructing a BrowserFontProvider.
 */
export interface BrowserFontProviderOptions {
  /** Default font URL injected by the consumer (via Vite ?url). */
  defaultFontUrl?: string
  /** Additional font registry mapping font key to URL. */
  fontUrls?: Record<string, string>
}

/**
 * BrowserFontProvider loads fonts in the browser by fetching URLs.
 *
 * It implements both the FontProvider contract (ports.ts) and the FontLoader
 * contract (fontRegistry.ts). It is the browser counterpart of the node-host
 * NodeFontProvider: instead of reading font bytes from disk it fetches them over
 * the network. Font URLs are injected by the consumer (the editor supplies font
 * paths via Vite ?url syntax).
 */
export class BrowserFontProvider implements FontProvider, FontLoader {
  private defaultFontUrl: string | undefined
  private fontUrls: Map<string, string>
  /** 缓存的 ArrayBuffer（避免重复 fetch） */
  private cache = new Map<string, ArrayBuffer>()

  constructor(opts?: BrowserFontProviderOptions) {
    this.defaultFontUrl = opts?.defaultFontUrl
    this.fontUrls = new Map(opts?.fontUrls ? Object.entries(opts.fontUrls) : [])

    // 注册默认字体别名
    if (this.defaultFontUrl) {
      this.fontUrls.set('default', this.defaultFontUrl)
      this.fontUrls.set('OpenSans', this.defaultFontUrl)
      this.fontUrls.set('OpenSans-Regular', this.defaultFontUrl)
    }
  }

  /** FontProvider.loadFont: 按 key 加载字体字节 */
  async loadFont(key: string): Promise<ArrayBuffer> {
    const url = this.fontUrls.get(key)
    if (!url) {
      throw new Error(`[BrowserFontProvider] font key "${key}" not found. Available: ${this.listFonts().join(', ')}`)
    }
    return this.fetchUrl(url)
  }

  /** FontLoader.loadDefaultFont: 返回默认字体字节 */
  async loadDefaultFont(): Promise<ArrayBuffer> {
    if (!this.defaultFontUrl) {
      throw new Error('[BrowserFontProvider] no default font URL configured')
    }
    return this.fetchUrl(this.defaultFontUrl)
  }

  /** FontProvider.listFonts: 列出可用字体 key */
  listFonts(): string[] {
    return Array.from(this.fontUrls.keys())
  }

  /** fetch 并缓存 */
  private async fetchUrl(url: string): Promise<ArrayBuffer> {
    const cached = this.cache.get(url)
    if (cached) return cached

    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`[BrowserFontProvider] fetch failed: ${url} (${res.status} ${res.statusText})`)
    }
    const buf = await res.arrayBuffer()
    this.cache.set(url, buf)
    return buf
  }
}
