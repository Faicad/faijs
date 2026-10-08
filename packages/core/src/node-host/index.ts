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

/** Options for creating Node host ports. */
export interface CreateNodePortsOptions {
  /** Asset directory (used by FsAssetResolver). */
  assetsDir?: string
  /** Manifest file path. */
  manifestPath?: string
  /** Extra fonts directory. */
  fontsDir?: string
  /** Default font path (falls back to the project single source of truth when omitted). */
  defaultFontPath?: string
  /**
   * Look up font *family names* in the OS font directories (default `true`).
   *
   * This is what makes `text(font: 'Arial')` behave like CadQuery, whose
   * `Font_FontMgr` resolves names against the installed fonts. Set `false` for a
   * hermetic host: name lookups then miss and fall back to the default font.
   */
  systemFonts?: boolean
}

/**
 * Create Node-side HostPorts (for injecting into CadRuntime).
 *
 * Assembles all inline backends into HostPorts:
 * - csg: InlineCsgBackend (runs manifold-3d directly on the main thread)
 * - sdf: InlineSdfBackend (runs directly on the main thread)
 * - fonts: NodeFontProvider (fs font loading)
 * - assets: FsAssetResolver (fs asset resolution)
 * - events: CliEventSink (writes to stderr + collects)
 * - hostEnv: 'node' (script-face export commands are open on this host)
 *
 * Also connects the NodeFontProvider to fontRegistry (setFontLoader), so that
 * brep/text's ensureDefaultFont() can load fonts via the filesystem.
 *
 * @param opts - options controlling the ports (assets/fonts directories, default font path)
 * @returns the assembled HostPorts
 */
export function createNodePorts(opts?: CreateNodePortsOptions): HostPorts {
  const fontProvider = new NodeFontProvider({
    defaultFontPath: opts?.defaultFontPath,
    fontsDir: opts?.fontsDir,
    systemFonts: opts?.systemFonts,
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
    // 宿主环境声明：Node.js 进程 → 脚本面导出命令（cad.exportStl / cad.exportBrep）
    // 在此开放；落盘发生在用户自己的机器上。见 cad-runtime/ports.ts#HostEnv。
    hostEnv: 'node',
  }
}
