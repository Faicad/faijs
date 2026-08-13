/**
 * browser-host — L3 Browser host 公开 API
 *
 * 与 node-host 对称，实现 HostPorts 接口的浏览器版本。
 *
 * Browser host 负责：
 * - 创建 CadRuntime 实例（注入 browser Ports）
 * - BrowserEventSink（window.dispatchEvent）
 * - BrowserFontProvider（fetch 字体 URL）
 * - FetchAssetResolver（fetch URL 资产）
 *
 * CSG/SDF 后端默认使用 InlineCsgBackend/InlineSdfBackend（manifold-3d 在浏览器也可用），
 * 消费者可注入自定义后端（如 3d_editor 的 Worker 后端）。
 *
 * 注意：InlineCsgBackend/InlineSdfBackend 现在位于 browser-host 目录内，
 * 因为它们不依赖任何 Node.js API（仅使用 manifold-3d，浏览器可用）。
 * 之前放在 node-host 目录下导致 vite external: [/node-host/] 规则错误地将它们
 * 标记为 external，生产构建 404。
 *
 * 设计原则：browser host 的能力和接口与 node host 基本一致。
 * 两者都实现 HostPorts 接口，区别仅在于环境 API（fetch vs fs、window.dispatchEvent vs stderr）。
 */

export { BrowserEventSink } from './browser-event-sink'
export { BrowserFontProvider } from './browser-font-provider'
export type { BrowserFontProviderOptions } from './browser-font-provider'
export { FetchAssetResolver } from './fetch-asset-resolver'
export type { FetchAssetResolverOptions } from './fetch-asset-resolver'

import type { HostPorts } from '../cad-runtime/ports'
import { BrowserEventSink } from './browser-event-sink'
import { BrowserFontProvider } from './browser-font-provider'
import type { BrowserFontProviderOptions } from './browser-font-provider'
import { FetchAssetResolver } from './fetch-asset-resolver'
import { setFontLoader } from '../brep/text/fontRegistry'

export interface CreateBrowserPortsOptions {
  /** 默认字体 URL（消费者通过 Vite ?url 注入） */
  fontUrl?: string
  /** 额外字体注册表 */
  fontUrls?: BrowserFontProviderOptions['fontUrls']
  /** 消费者可注入自定义 CSG 后端（如 Worker 后端） */
  csg?: HostPorts['csg']
  /** 消费者可注入自定义 SDF 后端（如 Worker 后端） */
  sdf?: HostPorts['sdf']
  /** 消费者可注入自定义资产解析器 */
  assets?: HostPorts['assets']
  /** 消费者可注入自定义事件接收器 */
  events?: HostPorts['events']
}

/**
 * 创建 Browser 端 HostPorts（注入 CadRuntime 用）。
 *
 * 默认使用：
 * - csg: InlineCsgBackend（主线程直跑 manifold-3d）— 延迟加载
 * - sdf: InlineSdfBackend（主线程直跑）— 延迟加载
 * - fonts: BrowserFontProvider（fetch 字体 URL）
 * - assets: FetchAssetResolver（fetch URL）
 * - events: BrowserEventSink（window.dispatchEvent）
 *
 * 消费者可通过 opts 注入自定义后端（如 3d_editor 的 Worker 后端）。
 * 当注入自定义后端时，不会加载 InlineCsgBackend/InlineSdfBackend。
 *
 * 同时将 BrowserFontProvider 连接到 fontRegistry（setFontLoader），
 * 使 brep/text 的 ensureDefaultFont() 能通过 fetch 加载字体。
 */
export async function createBrowserPorts(opts?: CreateBrowserPortsOptions): Promise<HostPorts> {
  const fontProvider = new BrowserFontProvider({
    defaultFontUrl: opts?.fontUrl,
    fontUrls: opts?.fontUrls,
  })

  // 连接 BrowserFontProvider 到 fontRegistry
  setFontLoader(fontProvider)

  // CSG/SDF 后端：优先使用注入的后端，否则动态加载 Inline 后端
  let csg = opts?.csg
  if (!csg) {
    const { InlineCsgBackend } = await import('./inline-csg-backend')
    csg = new InlineCsgBackend()
  }

  let sdf = opts?.sdf
  if (!sdf) {
    const { InlineSdfBackend } = await import('./inline-sdf-backend')
    sdf = new InlineSdfBackend()
  }

  return {
    csg,
    sdf,
    fonts: fontProvider,
    assets: opts?.assets ?? new FetchAssetResolver(),
    events: opts?.events ?? new BrowserEventSink(),
  }
}
