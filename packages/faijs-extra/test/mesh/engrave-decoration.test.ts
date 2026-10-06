/**
 * mesh/engrave-decoration — `createEngraveDecorationProvider` coverage.
 *
 * The provider builds a `THREE.BufferGeometry` for `cad.engrave` from either
 * text (opentype default font) or an SVG path. The text branch is exercised
 * headlessly via the test font loader.
 *
 * Runtime-only note:
 * - The SVG branch needs a DOM (SVGLoader → DOMParser); it is covered under
 *   jsdom in `engrave-decoration.svg.test.ts`.
 * - The CJK system-font branch (Local Font Access API) is browser-only and not
 *   exercised headlessly.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngraveDecorationProvider } from '../../src/mesh/engrave-decoration'
import { setupTestFont } from '@faicad/faijs/brep/text/fontTestHelper'

beforeAll(async () => {
  await setupTestFont()
})

describe('createEngraveDecorationProvider', () => {
  it('returns a callable provider (async geometry builder)', () => {
    const provider = createEngraveDecorationProvider()
    expect(typeof provider).toBe('function')
  })

  it('renders an ASCII text geometry with default textSize=10', async () => {
    const provider = createEngraveDecorationProvider()
    const geo = await provider({
      depth: 2,
      text: 'HELLO',
    })
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('honours textSize and depth parameters', async () => {
    const provider = createEngraveDecorationProvider()
    const geo = await provider({
      depth: 8,
      text: 'WIDE',
      textSize: 30,
    })
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
    // Larger text → wider geometry extent.
    let minX = Infinity, maxX = -Infinity
    const pos: Float32Array = geo.getAttribute('position').array as Float32Array
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < minX) minX = pos[i]
      if (pos[i] > maxX) maxX = pos[i]
    }
    expect(maxX - minX).toBeGreaterThan(10)
  })

  it('throws when neither text nor svg is provided', async () => {
    const provider = createEngraveDecorationProvider()
    await expect(
      provider({ depth: 2 }),
    ).rejects.toThrow(/text or svg/)
  })
})