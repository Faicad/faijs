/**
 * manifold-loader — 单例加载 manifold-3d 核心模块（manifold.js，非 manifoldCAD）
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
 * 指定 manifold.wasm 的加载地址。
 * 必须在首次 getManifoldModule() 之前调用（模块级缓存，与官方 setWasmUrl 语义一致）。
 */
export function setManifoldWasmUrl(url: string): void {
  wasmUrl = url
}

/** 读取当前配置的 wasm 地址（Worker 后端初始化握手用） */
export function getManifoldWasmUrl(): string | undefined {
  return wasmUrl
}

/** 获取（并缓存）Manifold WASM 模块实例 */
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
