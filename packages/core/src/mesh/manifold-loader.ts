/**
 * manifold-loader — 环境级单例加载 manifold-3d 核心模块
 *
 * F5 设计意图说明：
 * manifoldPromise 是环境级单例，不是实例级。
 * 在整个浏览器页面/Node 进程中，manifold-3d WASM 只应初始化一次。
 * 多个 CadRuntime 实例共享同一个 manifold 模块是正确的行为。
 *
 * 浏览器与 Node 共用（node-host 的 Inline 后端与浏览器 Worker 后端都走这里）。
 * 加载逻辑复刻 manifold-3d lib/wasm.js 的 instantiateManifold：
 * `Module({ locateFile })` + `module.setup()`，两步缺一不可。
 *
 * 必须用根裸导入 `import('manifold-3d')`：Node 的 package.json main、
 * exports 的 "." 与 importmap 的精确键都解析到同一个 manifold.js。
 * 若写成子路径导入，build 产物需要 importmap 提供对应的精确键，
 * 否则以 "Failed to resolve module specifier" 崩掉。
 */

import type { ManifoldToplevel } from 'manifold-3d/manifold'

let wasmUrl: string | undefined
let manifoldPromise: Promise<ManifoldToplevel> | null = null

/**
 * Specify the URL from which manifold.wasm is loaded.
 * Must be called before the first getManifoldModule() (module-level cache,
 * matching the official setWasmUrl semantics).
 *
 * @param url - the wasm file URL.
 */
export function setManifoldWasmUrl(url: string): void {
  wasmUrl = url
}

/**
 * Read the currently configured wasm URL (used by the Worker backend during
 * the initialization handshake).
 *
 * @returns the configured wasm URL, or undefined when none was set.
 */
export function getManifoldWasmUrl(): string | undefined {
  return wasmUrl
}

/**
 * Get (and cache) the Manifold WASM module instance, loaded once per
 * environment.
 *
 * @returns a promise resolving to the initialized Manifold module.
 */
export async function getManifoldModule(): Promise<ManifoldToplevel> {
  if (!manifoldPromise) {
    manifoldPromise = import('manifold-3d').then(async (m) => {
      const url = wasmUrl
      const mod = await m.default(url ? { locateFile: () => url } : undefined)
      mod.setup()
      return mod
    })
  }
  return manifoldPromise
}
