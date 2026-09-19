/**
 * browser-lib-loader.test.ts — D3-Browser 通用 loader 工厂的防回归测试（§9.4）
 *
 * 全部用例**不触网**：经 `importModule` / `fetchImpl` 注入点观测装载通道与 URL 形态。
 * GOTCHA: `autoLiftFor` 是同步回调，meta 必须**装载前**就绪——`prefetchMeta()` 只
 * 影响其后取值；未预热 + 未传 `meta` 时逐库值恒为 `undefined`（回落推断式），这不是 bug。
 */

import { describe, it, expect, vi } from 'vitest'
import { createBrowserLibLoader, DEFAULT_CDN_BASE } from './browser-lib-loader'
import type { StdlibNamespace } from '../runtime-state'

const ns = (): StdlibNamespace => ({ fn: () => undefined }) as unknown as StdlibNamespace

const CDN = 'https://cdn.example.com/npm/'

describe('createBrowserLibLoader — 装载通路', () => {
  it('方案 b：提供 versions → 拼 CDN 精确 pin 直链（+esm）', async () => {
    const importModule = vi.fn(async () => ns())
    const loader = createBrowserLibLoader({
      cdnBase: CDN,
      versions: { '@faicad/faijs': '0.13.0' },
      importModule,
    })
    await loader.loadLib('@faicad/faijs')
    expect(importModule).toHaveBeenCalledWith(`${CDN}@faicad/faijs@0.13.0/+esm`)
  })

  it('方案 a：无 versions → 裸 specifier（交由页面 importmap 解析）', async () => {
    const importModule = vi.fn(async () => ns())
    const loader = createBrowserLibLoader({ cdnBase: CDN, importModule })
    await loader.loadLib('@faicad/faijs')
    expect(importModule).toHaveBeenCalledWith('@faicad/faijs')
  })

  it('forceImportMap：即使有 versions 也走裸 specifier', async () => {
    const importModule = vi.fn(async () => ns())
    const loader = createBrowserLibLoader({
      cdnBase: CDN,
      versions: { '@faicad/faijs': '0.13.0' },
      forceImportMap: true,
      importModule,
    })
    await loader.loadLib('@faicad/faijs')
    expect(importModule).toHaveBeenCalledWith('@faicad/faijs')
  })

  it('别名归一：短 specifier → npm 全名后才装载（方案 b 拼的是全名）', async () => {
    const importModule = vi.fn(async () => ns())
    const loader = createBrowserLibLoader({
      cdnBase: CDN,
      versions: { '@faicad/gear-lib-demo': '0.13.0' },
      aliases: { 'gear-lib-demo': '@faicad/gear-lib-demo' },
      importModule,
    })
    await loader.loadLib('gear-lib-demo')
    expect(importModule).toHaveBeenCalledWith(`${CDN}@faicad/gear-lib-demo@0.13.0/+esm`)
  })

  it('白名单：按 resoved 包名校验，未列出 → reject（错误信息含原 specifier）', async () => {
    const importModule = vi.fn(async () => ns())
    const loader = createBrowserLibLoader({
      libs: ['@faicad/faijs'],
      aliases: { foo: '@faicad/foo' },
      importModule,
    })
    await expect(loader.loadLib('foo')).rejects.toThrow(
      /package "@faicad\/foo" \(from specifier "foo"\) is not in the browser library whitelist/,
    )
    expect(importModule).not.toHaveBeenCalled()
  })

  it('同一包并发/重复装载只取一次（in-flight 共享缓存）', async () => {
    const importModule = vi.fn(async () => ns())
    const loader = createBrowserLibLoader({ cdnBase: CDN, importModule })
    const [a, b] = await Promise.all([loader.loadLib('@faicad/faijs'), loader.loadLib('@faicad/faijs')])
    await loader.loadLib('@faicad/faijs')
    expect(a).toBe(b)
    expect(importModule).toHaveBeenCalledTimes(1)
  })

  it('装载失败不留毒缓存：第二次调用重试（网络恢复后可装载）', async () => {
    const importModule = vi
      .fn<(u: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(ns())
    const loader = createBrowserLibLoader({ cdnBase: CDN, importModule })
    await expect(loader.loadLib('@faicad/faijs')).rejects.toThrow('offline')
    await expect(loader.loadLib('@faicad/faijs')).resolves.toBeDefined()
    expect(importModule).toHaveBeenCalledTimes(2)
  })

  it('listLibs：返回别名键 ∪ libs ∪ versions 键的 specifier 集合', () => {
    const loader = createBrowserLibLoader({
      aliases: { 'gear-lib-demo': '@faicad/gear-lib-demo' },
      libs: ['@faicad/faijs'],
      versions: { '@faicad/sheetmetal': '0.13.0' },
    })
    expect(new Set(loader.listLibs())).toEqual(
      new Set(['gear-lib-demo', '@faicad/faijs', '@faicad/sheetmetal']),
    )
  })

  it('DEFAULT_CDN_BASE 为 jsDelivr npm 镜像（Q8 定稿）', () => {
    expect(DEFAULT_CDN_BASE).toBe('https://cdn.jsdelivr.net/npm/')
  })

  it('cdnBase 尾随斜杠归一：无斜杠也能拼出合法 URL', async () => {
    const importModule = vi.fn(async () => ns())
    const loader = createBrowserLibLoader({
      cdnBase: 'https://cdn.example.com/npm',
      versions: { '@faicad/faijs': '0.13.0' },
      importModule,
    })
    await loader.loadLib('@faicad/faijs')
    expect(importModule).toHaveBeenCalledWith('https://cdn.example.com/npm/@faicad/faijs@0.13.0/+esm')
  })
})

describe('createBrowserLibLoader — autoLiftFor / prefetchMeta', () => {
  it('autoLiftFor 读 meta（别名与全名两种写法都命中）', () => {
    const loader = createBrowserLibLoader({
      aliases: { 'gear-lib-demo': '@faicad/gear-lib-demo' },
      meta: {
        '@faicad/gear-lib-demo': { autoLift: false },
        '@faicad/sheetmetal': { autoLift: true },
        '@faicad/other': {},
      },
    })
    expect(loader.options?.autoLiftFor?.('gear-lib-demo')).toBe(false)
    expect(loader.options?.autoLiftFor?.('@faicad/sheetmetal')).toBe(true)
    // 未声明 → undefined（回落全局 / runtime 推断式），不是 false
    expect(loader.options?.autoLiftFor?.('@faicad/other')).toBeUndefined()
    expect(loader.options?.autoLiftFor?.('@faicad/unknown')).toBeUndefined()
  })

  it('全局 autoLift 仅在显式给出时写入 options（缺省时不覆盖推断式）', () => {
    expect(createBrowserLibLoader({}).options).not.toHaveProperty('autoLift')
    expect(createBrowserLibLoader({ autoLift: false }).options?.autoLift).toBe(false)
  })

  it('prefetchMeta：抓 package.json 的 faijs.autoLift 填入 meta', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ faijs: { autoLift: false } }),
    })) as unknown as typeof fetch
    const loader = createBrowserLibLoader({
      cdnBase: CDN,
      versions: { '@faicad/cq-compat': '0.13.0' },
      fetchImpl,
    })
    expect(loader.options?.autoLiftFor?.('@faicad/cq-compat')).toBeUndefined()
    await loader.prefetchMeta()
    expect(fetchImpl).toHaveBeenCalledWith(`${CDN}@faicad/cq-compat@0.13.0/package.json`)
    // 预热后可同步取到（runtime 在装载后立即读该值）
    expect(loader.options?.autoLiftFor?.('@faicad/cq-compat')).toBe(false)
  })

  it('prefetchMeta：网络失败 / 非法响应静默跳过，不抛错也不写 meta', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const loader = createBrowserLibLoader({ cdnBase: CDN, libs: ['@faicad/faijs'], fetchImpl })
    await expect(loader.prefetchMeta()).resolves.toBeUndefined()
    expect(loader.options?.autoLiftFor?.('@faicad/faijs')).toBeUndefined()
  })

  it('prefetchMeta：无 fetch 环境（无注入且全局缺失）时为空操作', async () => {
    const loader = createBrowserLibLoader({ cdnBase: CDN, libs: ['@faicad/faijs'], fetchImpl: undefined })
    // 若运行环境自带 fetch，本用例的语义退化为「不抛错」——两种环境都必须 resolve。
    await expect(loader.prefetchMeta()).resolves.toBeUndefined()
  })
})
