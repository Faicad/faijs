/**
 * textureLoader — 滚花纹理加载器
 *
 * 浏览器环境：从 @/assets/textures/knurling.jpg 加载纹理。
 * Node 环境：返回 null（由 TextureSampler port 提供纹理）。
 */

import * as THREE from 'three'

export interface TextureData {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * 加载滚花纹理。
 * Node 环境：返回 null（由 port 提供纹理）。
 * 浏览器环境：由浏览器 host 覆盖此函数。
 */
export async function loadKnurlingTexture(): Promise<TextureData | null> {
  // 在 faijs 引擎中，纹理通过 TextureSampler port 提供。
  // 此函数仅在未注入 port 时作为回退。
  return null
}

export function disposeKnurlPreviewMaterial(): void {
  // no-op in headless
}

export type KnurlPreviewBounds = THREE.Box3
