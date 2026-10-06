/**
 * textureLoader.test.ts — pure loader wiring (textureLoader.ts).
 *
 * The loader itself needs no wasm/GL: it is just a settable function that the
 * browser host injects. These tests exercise the wiring: the default returns
 * null, injecting a loader makes it return that loader's data, and clearing
 * the override restores the null default.
 *
 * Covers: setKnurlTextureLoader, loadKnurlingTexture, disposeKnurlPreviewMaterial.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  setKnurlTextureLoader,
  loadKnurlingTexture,
  disposeKnurlPreviewMaterial,
  type TextureData,
} from '../../../src/mesh/knurl/textureLoader'

const FAKE_TEX: TextureData = {
  data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
  width: 2,
  height: 1,
}

describe('textureLoader', () => {
  afterEach(() => {
    setKnurlTextureLoader(null)
  })

  it('returns null by default (Node has no host-injected loader)', async () => {
    expect(await loadKnurlingTexture()).toBeNull()
  })

  it('returns the injected loader result after setKnurlTextureLoader', async () => {
    setKnurlTextureLoader(async () => FAKE_TEX)
    const out = await loadKnurlingTexture()
    expect(out).toBe(FAKE_TEX)
  })

  it('async loader data/meta is preserved end-to-end', async () => {
    setKnurlTextureLoader(() => Promise.resolve(FAKE_TEX))
    const tex = await loadKnurlingTexture()
    expect(tex).not.toBeNull()
    expect(tex!.width).toBe(2)
    expect(tex!.height).toBe(1)
    expect(tex!.data).toBeInstanceOf(Uint8ClampedArray)
  })

  it('clearing the override restores the null default', async () => {
    setKnurlTextureLoader(async () => FAKE_TEX)
    expect(await loadKnurlingTexture()).not.toBeNull()
    setKnurlTextureLoader(null)
    expect(await loadKnurlingTexture()).toBeNull()
  })

  it('disposeKnurlPreviewMaterial is a no-op and does not throw', () => {
    expect(() => disposeKnurlPreviewMaterial()).not.toThrow()
    expect(disposeKnurlPreviewMaterial()).toBeUndefined()
  })
})