/**
 * createBrowserPorts 测试
 *
 * 测试内容：
 * 1. 返回完整的 HostPorts（csg, sdf, fonts, assets, events）
 * 2. Node 环境无 Web Worker → 自动回退 InlineCsgBackend / InlineSdfBackend
 * 3. 默认使用 BrowserEventSink
 * 4. 默认使用 BrowserFontProvider + FetchAssetResolver
 * 5. 可注入自定义 csg/sdf/assets/events
 * 6. 连接 fontRegistry（setFontLoader 被调用）
 *
 * Run: npx vitest run src/browser-host/index.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createBrowserPorts } from './index'
import { BrowserEventSink } from './browser-event-sink'
import { BrowserFontProvider } from './browser-font-provider'
import { FetchAssetResolver } from './fetch-asset-resolver'
import { InlineCsgBackend } from './inline-csg-backend'
import { InlineSdfBackend } from './inline-sdf-backend'
import { getFontLoader, clearFonts } from '../brep/text/fontRegistry'
import type { CsgBackend, SdfBackend, AssetResolver, EventSink } from '../cad-runtime/ports'

describe('createBrowserPorts', () => {
  beforeEach(() => {
    clearFonts()
  })

  it('returns HostPorts with all fields populated', async () => {
    const ports = await createBrowserPorts()
    expect(ports.csg).toBeDefined()
    expect(ports.sdf).toBeDefined()
    expect(ports.fonts).toBeDefined()
    expect(ports.assets).toBeDefined()
    expect(ports.events).toBeDefined()
  })

  it('defaults to InlineCsgBackend in environments without Worker (Node)', async () => {
    const ports = await createBrowserPorts()
    expect(ports.csg).toBeInstanceOf(InlineCsgBackend)
  })

  it('defaults to InlineSdfBackend in environments without Worker (Node)', async () => {
    const ports = await createBrowserPorts()
    expect(ports.sdf).toBeInstanceOf(InlineSdfBackend)
  })

  it('useWorker:false forces InlineCsgBackend/InlineSdfBackend', async () => {
    const ports = await createBrowserPorts({ useWorker: false })
    expect(ports.csg).toBeInstanceOf(InlineCsgBackend)
    expect(ports.sdf).toBeInstanceOf(InlineSdfBackend)
  })

  it('useWorker:true without Worker environment throws', async () => {
    await expect(createBrowserPorts({ useWorker: true })).rejects.toThrow(/Web Worker/)
  })

  it('defaults to BrowserEventSink', async () => {
    const ports = await createBrowserPorts()
    expect(ports.events).toBeInstanceOf(BrowserEventSink)
  })

  it('defaults to BrowserFontProvider', async () => {
    const ports = await createBrowserPorts({ fontUrl: 'http://localhost/font.ttf' })
    expect(ports.fonts).toBeInstanceOf(BrowserFontProvider)
  })

  it('defaults to FetchAssetResolver', async () => {
    const ports = await createBrowserPorts()
    expect(ports.assets).toBeInstanceOf(FetchAssetResolver)
  })

  it('allows injecting custom csg backend', async () => {
    const customCsg: CsgBackend = {
      boolean: vi.fn(),
      splitPlane: vi.fn(),
      splitDovetail: vi.fn(),
      splitDowel: vi.fn(),
      splitStraightTenon: vi.fn(),
    }
    const ports = await createBrowserPorts({ csg: customCsg })
    expect(ports.csg).toBe(customCsg)
  })

  it('allows injecting custom sdf backend', async () => {
    const customSdf: SdfBackend = {
      runSdf: vi.fn(),
    }
    const ports = await createBrowserPorts({ sdf: customSdf })
    expect(ports.sdf).toBe(customSdf)
  })

  it('allows injecting custom asset resolver', async () => {
    const customAssets: AssetResolver = {
      resolveByKey: vi.fn(),
      resolveFile: vi.fn(),
      resolveUrl: vi.fn(),
    }
    const ports = await createBrowserPorts({ assets: customAssets })
    expect(ports.assets).toBe(customAssets)
  })

  it('allows injecting custom event sink', async () => {
    const customEvents: EventSink = {
      emit: vi.fn(),
    }
    const ports = await createBrowserPorts({ events: customEvents })
    expect(ports.events).toBe(customEvents)
  })

  it('connects BrowserFontProvider to fontRegistry', async () => {
    const ports = await createBrowserPorts({ fontUrl: 'http://localhost/font.ttf' })
    // fontRegistry's active loader should be the BrowserFontProvider
    const loader = getFontLoader()
    expect(loader).toBe(ports.fonts)
  })
})
