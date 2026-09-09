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
 * CSG/SDF 后端默认使用 Worker 后端（WorkerCsgBackend/WorkerSdfBackend，manifold
 * 计算在独立线程，不阻塞 UI）；无 Web Worker 的环境（如 Node 测试）自动回退到
 * Inline 后端。消费者可注入自定义后端（如第三方实现）。
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

/**
 * Options for creating browser HostPorts.
 */
export interface CreateBrowserPortsOptions {
  /** Default font URL injected by the consumer (via Vite ?url). */
  fontUrl?: string
  /** Additional font registry entries. */
  fontUrls?: BrowserFontProviderOptions['fontUrls']
  /**
   * Whether to use worker backends (moving CSG/SDF computation off the main
   * thread). Defaults to whichever Worker availability warrants: worker when a
   * Web Worker environment exists, otherwise inline. Passing false forces the
   * inline backend; passing true in an environment without Worker throws.
   */
  useWorker?: boolean
  /** Consumer-injectable custom CSG backend. */
  csg?: HostPorts['csg']
  /** Consumer-injectable custom SDF backend. */
  sdf?: HostPorts['sdf']
  /** Consumer-injectable custom asset resolver. */
  assets?: HostPorts['assets']
  /** Consumer-injectable custom event sink. */
  events?: HostPorts['events']
  /** Consumer-injectable library loader (auto-load unregistered libs at execute). */
  libLoader?: HostPorts['libLoader']
  /** Consumer-injectable project loader (multi-file §4.5 relative imports; absent = single-file behavior unchanged). */
  projectLoader?: HostPorts['projectLoader']
}

/**
 * Create browser HostPorts to inject into a CadRuntime.
 *
 * By default this wires up: a WorkerCsgBackend (via csg-worker postMessage,
 * lazily loaded), a WorkerSdfBackend (via sdf-worker postMessage, lazily
 * loaded), a BrowserFontProvider (fetch font URLs), a FetchAssetResolver (fetch
 * URLs) and a BrowserEventSink (window.dispatchEvent). In environments without
 * a Web Worker (Node/tests) it falls back to the inline backends. Consumers may
 * inject custom backends through opts; injecting one prevents the default from
 * loading. It also connects the BrowserFontProvider to the fontRegistry via
 * setFontLoader so brep/text can load fonts through fetch. Consumers may inject
 * a projectLoader (multi-file §4.5) through opts; absent → projectLoader is not
 * installed and single-file behavior is unchanged.
 * @param opts - options controlling font, worker, and backend selection.
 * @returns promise resolving to the assembled HostPorts.
 */
export async function createBrowserPorts(opts?: CreateBrowserPortsOptions): Promise<HostPorts> {
  const fontProvider = new BrowserFontProvider({
    defaultFontUrl: opts?.fontUrl,
    fontUrls: opts?.fontUrls,
  })

  // 连接 BrowserFontProvider 到 fontRegistry
  setFontLoader(fontProvider)

  // CSG/SDF 后端：优先注入，否则按 useWorker 选择 Worker/Inline 后端
  let csg = opts?.csg
  if (!csg) {
    const useWorker = opts?.useWorker ?? typeof Worker !== 'undefined'
    if (useWorker) {
      if (typeof Worker === 'undefined') {
        throw new Error('createBrowserPorts: useWorker=true 但当前环境无 Web Worker')
      }
      const { WorkerCsgBackend } = await import('./worker-csg-backend')
      csg = new WorkerCsgBackend()
    } else {
      const { InlineCsgBackend } = await import('./inline-csg-backend')
      csg = new InlineCsgBackend()
    }
  }

  let sdf = opts?.sdf
  if (!sdf) {
    const useWorker = opts?.useWorker ?? typeof Worker !== 'undefined'
    if (useWorker) {
      if (typeof Worker === 'undefined') {
        throw new Error('createBrowserPorts: useWorker=true 但当前环境无 Web Worker')
      }
      const { WorkerSdfBackend } = await import('./worker-sdf-backend')
      sdf = new WorkerSdfBackend()
    } else {
      const { InlineSdfBackend } = await import('./inline-sdf-backend')
      sdf = new InlineSdfBackend()
    }
  }

  return {
    csg,
    sdf,
    fonts: fontProvider,
    assets: opts?.assets ?? new FetchAssetResolver(),
    events: opts?.events ?? new BrowserEventSink(),
    libLoader: opts?.libLoader,
    projectLoader: opts?.projectLoader,
  }
}
