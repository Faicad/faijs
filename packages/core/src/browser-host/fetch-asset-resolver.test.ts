/**
 * FetchAssetResolver 测试
 *
 * 测试内容：
 * 1. resolveByKey 通过 keyToUrl 映射获取资产
 * 2. resolveByKey 通过 keyResolver 函数获取资产
 * 3. resolveUrl 直接 fetch URL
 * 4. resolveFile 抛错（browser 不支持）
 * 5. 未注册的 key 抛错
 * 6. fetch 失败抛错
 * 7. 缓存机制
 *
 * Run: npx vitest run src/browser-host/fetch-asset-resolver.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FetchAssetResolver } from './fetch-asset-resolver'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('FetchAssetResolver', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('resolveByKey uses keyToUrl mapping', async () => {
    const bytes = new ArrayBuffer(100)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => bytes,
    })

    const resolver = new FetchAssetResolver({
      keyToUrl: { 'model_box': 'http://localhost/models/box.step' },
    })

    const result = await resolver.resolveByKey('model_box')
    expect(result.bytes).toBe(bytes)
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/models/box.step')
  })

  it('resolveByKey uses keyResolver function', async () => {
    const bytes = new ArrayBuffer(50)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => bytes,
    })

    const resolver = new FetchAssetResolver({
      keyResolver: (key) => `http://localhost/assets/${key}.3mf`,
    })

    const result = await resolver.resolveByKey('logo')
    expect(result.bytes).toBe(bytes)
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/assets/logo.3mf')
  })

  it('keyToUrl takes precedence over keyResolver', async () => {
    const bytes = new ArrayBuffer(30)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => bytes,
    })

    const resolver = new FetchAssetResolver({
      keyToUrl: { 'asset': 'http://localhost/explicit.3mf' },
      keyResolver: (key) => `http://localhost/fallback/${key}.3mf`,
    })

    await resolver.resolveByKey('asset')
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/explicit.3mf')
  })

  it('resolveUrl fetches directly', async () => {
    const bytes = new ArrayBuffer(80)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => bytes,
    })

    const resolver = new FetchAssetResolver()
    const result = await resolver.resolveUrl('http://example.com/model.stl')
    expect(result).toBe(bytes)
  })

  it('resolveFile throws (browser not supported)', async () => {
    const resolver = new FetchAssetResolver()
    await expect(resolver.resolveFile('/path/to/file')).rejects.toThrow(/not available in browser/)
  })

  it('throws for unregistered key', async () => {
    const resolver = new FetchAssetResolver()
    await expect(resolver.resolveByKey('unknown')).rejects.toThrow(/not found/)
  })

  it('throws on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    const resolver = new FetchAssetResolver({
      keyToUrl: { 'broken': 'http://localhost/broken.3mf' },
    })

    await expect(resolver.resolveByKey('broken')).rejects.toThrow(/fetch failed/)
  })

  it('caches fetch results', async () => {
    const bytes = new ArrayBuffer(60)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => bytes,
    })

    const resolver = new FetchAssetResolver({
      keyToUrl: { 'cached': 'http://localhost/cached.3mf' },
    })

    // First call fetches
    const r1 = await resolver.resolveByKey('cached')
    expect(r1.bytes).toBe(bytes)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second call uses cache
    const r2 = await resolver.resolveByKey('cached')
    expect(r2.bytes).toBe(bytes)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
