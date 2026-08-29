/**
 * BrowserFontProvider 测试
 *
 * 测试内容：
 * 1. loadFont('default') 通过 fetch 加载字体
 * 2. loadDefaultFont() 返回 ArrayBuffer
 * 3. 缓存：重复加载不重复 fetch
 * 4. 未注册的 key 抛错
 * 5. listFonts 返回注册的 key 列表
 *
 * Run: npx vitest run src/browser-host/browser-font-provider.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BrowserFontProvider } from './browser-font-provider'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('BrowserFontProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('loadFont("default") fetches from defaultFontUrl', async () => {
    const fontBytes = new ArrayBuffer(100)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fontBytes,
    })

    const provider = new BrowserFontProvider({
      defaultFontUrl: 'http://localhost/fonts/OpenSans-Regular.ttf',
    })

    const result = await provider.loadFont('default')
    expect(result).toBe(fontBytes)
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/fonts/OpenSans-Regular.ttf')
  })

  it('loadDefaultFont returns ArrayBuffer', async () => {
    const fontBytes = new ArrayBuffer(200)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fontBytes,
    })

    const provider = new BrowserFontProvider({
      defaultFontUrl: 'http://localhost/fonts/OpenSans-Regular.ttf',
    })

    const result = await provider.loadDefaultFont()
    expect(result).toBe(fontBytes)
  })

  it('caches fetch results (no duplicate fetch)', async () => {
    const fontBytes = new ArrayBuffer(50)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fontBytes,
    })

    const provider = new BrowserFontProvider({
      defaultFontUrl: 'http://localhost/fonts/font.ttf',
    })

    // First call fetches
    const r1 = await provider.loadFont('default')
    expect(r1).toBe(fontBytes)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second call uses cache
    const r2 = await provider.loadFont('default')
    expect(r2).toBe(fontBytes)
    expect(mockFetch).toHaveBeenCalledTimes(1) // still 1
  })

  it('throws for unregistered font key', async () => {
    const provider = new BrowserFontProvider({
      defaultFontUrl: 'http://localhost/fonts/font.ttf',
    })

    await expect(provider.loadFont('NonExistent')).rejects.toThrow(/not found/)
  })

  it('listFonts returns registered keys', () => {
    const provider = new BrowserFontProvider({
      defaultFontUrl: 'http://localhost/fonts/font.ttf',
      fontUrls: { 'NotoSans': 'http://localhost/fonts/NotoSans.ttf' },
    })

    const fonts = provider.listFonts()
    expect(fonts).toContain('default')
    expect(fonts).toContain('OpenSans')
    expect(fonts).toContain('OpenSans-Regular')
    expect(fonts).toContain('NotoSans')
  })

  it('throws on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    const provider = new BrowserFontProvider({
      defaultFontUrl: 'http://localhost/fonts/missing.ttf',
    })

    await expect(provider.loadFont('default')).rejects.toThrow(/fetch failed/)
  })

  it('throws when no default font URL configured', async () => {
    const provider = new BrowserFontProvider()

    await expect(provider.loadDefaultFont()).rejects.toThrow(/no default font URL/)
  })
})
