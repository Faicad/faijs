/**
 * textureLoader — 滚花纹理加载器
 *
 * 浏览器环境：由 host 通过 setKnurlTextureLoader() 注入纹理加载器。
 * Node 环境：返回 null（由 TextureSampler port 提供纹理）。
 *
 * F5 设计意图说明：
 * _textureLoaderOverride 是环境级单例，不是实例级。
 * 在整个浏览器页面中，滚花纹理只应加载一次。
 * 多个 CadRuntime 实例共享同一个纹理加载器是正确的行为。
 */

import * as THREE from 'three'

export interface TextureData {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 纹理加载器覆盖函数（由浏览器 host 注入） */
let _textureLoaderOverride: (() => Promise<TextureData | null>) | null = null

/**
 * 设置纹理加载器（由浏览器 host 在启动时注入）。
 * 3d_editor 通过 Vite ?url + fetch + canvas 加载 knurling.jpg。
 */
export function setKnurlTextureLoader(loader: (() => Promise<TextureData | null>) | null): void {
  _textureLoaderOverride = loader
}

/**
 * 加载滚花纹理。
 * 如果 host 注入了纹理加载器，使用注入的加载器。
 * 否则返回 null（由 port 提供纹理）。
 */
export async function loadKnurlingTexture(): Promise<TextureData | null> {
  if (_textureLoaderOverride) {
    return _textureLoaderOverride()
  }
  // 在 faijs 引擎中，纹理通过 TextureSampler port 提供。
  // 此函数仅在未注入 port 时作为回退。
  return null
}

export function disposeKnurlPreviewMaterial(): void {
  // no-op in headless
}

export type KnurlPreviewBounds = THREE.Box3
