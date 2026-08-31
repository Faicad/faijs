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

/**
 * Raw RGBA pixel data plus the pixel dimensions of a loaded texture.
 */
export interface TextureData {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 纹理加载器覆盖函数（由浏览器 host 注入） */
let _textureLoaderOverride: (() => Promise<TextureData | null>) | null = null

/**
 * Set the knurling texture loader (injected by the browser host at startup).
 *
 * @param loader - the loader to use, or null to clear the override.
 */
export function setKnurlTextureLoader(loader: (() => Promise<TextureData | null>) | null): void {
  _textureLoaderOverride = loader
}

/**
 * Load the knurling texture. Uses the injected host loader when present;
 * otherwise returns null (the texture is supplied through the port).
 *
 * @returns the texture data, or null when no loader is available.
 */
export async function loadKnurlingTexture(): Promise<TextureData | null> {
  if (_textureLoaderOverride) {
    return _textureLoaderOverride()
  }
  // In the faijs engine the texture is provided through the TextureSampler
  // port; this function only serves as a fallback when no override is set.
  return null
}

/** Dispose the knurl preview material; a no-op in the headless engine. */
export function disposeKnurlPreviewMaterial(): void {
  // no-op in headless
}

/** Bounds type shared with the knurl preview path (a THREE.Box3). */
export type KnurlPreviewBounds = THREE.Box3
