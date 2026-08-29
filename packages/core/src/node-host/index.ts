/**
 * node-host — L3 Node host 公开 API
 *
 *
 * Node host 负责：
 * - 创建 CadRuntime 实例（注入 node Ports：InlineCsgBackend / InlineSdfBackend / ...）
 * - 连接 NodeFontProvider 到 fontRegistry
 * - CLI 入口
 */

export { InlineCsgBackend } from '../browser-host/inline-csg-backend'
export { InlineSdfBackend } from '../browser-host/inline-sdf-backend'
export { NodeFontProvider } from './node-font-provider'
export type { NodeFontProviderOptions } from './node-font-provider'
export { FsAssetResolver } from './fs-asset-resolver'
export type { FsAssetResolverOptions } from './fs-asset-resolver'
export { CliEventSink } from './cli-event-sink'

import type { HostPorts } from '../cad-runtime/ports'
import { InlineCsgBackend } from '../browser-host/inline-csg-backend'
import { InlineSdfBackend } from '../browser-host/inline-sdf-backend'
import { NodeFontProvider } from './node-font-provider'
import { FsAssetResolver } from './fs-asset-resolver'
import { CliEventSink } from './cli-event-sink'
import { setFontLoader } from '../brep/text/fontRegistry'

export interface CreateNodePortsOptions {
  /** 资产目录（供 FsAssetResolver 使用） */
  assetsDir?: string
  /** manifest 文件路径 */
  manifestPath?: string
  /** 额外字体目录 */
  fontsDir?: string
  /** 默认字体路径（不传则用项目唯一真源） */
  defaultFontPath?: string
}

/**
 * 创建 Node 端 HostPorts（注入 CadRuntime 用）。
 *
 * 组装全部 inline 后端为 HostPorts：
 * - csg: InlineCsgBackend（主线程直跑 manifold-3d）
 * - sdf: InlineSdfBackend（主线程直跑）
 * - fonts: NodeFontProvider（fs 字体加载）
 * - assets: FsAssetResolver（fs 资产解析）
 * - events: CliEventSink（写入 stderr + 收集）
 *
 * 同时将 NodeFontProvider 连接到 fontRegistry（setFontLoader），
 * 使 brep/text 的 ensureDefaultFont() 能通过 fs 加载字体。
 */
export function createNodePorts(opts?: CreateNodePortsOptions): HostPorts {
  const fontProvider = new NodeFontProvider({
    defaultFontPath: opts?.defaultFontPath,
    fontsDir: opts?.fontsDir,
  })

  // 连接 NodeFontProvider 到 fontRegistry
  setFontLoader(fontProvider)

  const assets = new FsAssetResolver({
    assetsDir: opts?.assetsDir,
    manifestPath: opts?.manifestPath,
  })

  return {
    csg: new InlineCsgBackend(),
    sdf: new InlineSdfBackend(),
    fonts: fontProvider,
    assets,
    events: new CliEventSink(),
  }
}
