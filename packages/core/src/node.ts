/**
 * Node.js 入口 — 仅在 Node.js 环境中使用
 *
 * 这个文件单独导出 node-host 相关的模块，避免主入口 index.ts
 * 静态 import node-host 模块（在浏览器环境中会导致 404）。
 *
 * 消费者在 Node.js 环境中应从 @faicad/faijs/node 导入：
 *   import { createNodePorts } from '@faicad/faijs/node'
 */

export { createNodePorts } from './node-host'
export { setManifoldWasmUrl, getManifoldWasmUrl, getManifoldModule } from './mesh/manifold-loader'
export { InlineCsgBackend } from './browser-host/inline-csg-backend'
export { InlineSdfBackend } from './browser-host/inline-sdf-backend'
export { NodeFontProvider } from './node-host/node-font-provider'
export { FsAssetResolver } from './node-host/fs-asset-resolver'
export { CliEventSink } from './node-host/cli-event-sink'
export { cliCheck, cliRun, cliMain, parseArgs } from './node-host/cli'
export type { CliCheckResult, CliRunResult, CliRunOptions } from './node-host/cli'
