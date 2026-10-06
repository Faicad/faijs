/**
 * mesh/engrave-decoration — SVG branch of `createEngraveDecorationProvider`.
 *
 * Runs under jsdom because the SVG branch goes through `SVGLoader.parse`,
 * which needs a `DOMParser` (browser/DOM API). The text branch is covered in
 * the node-env `engrave-decoration.test.ts`.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createEngraveDecorationProvider } from './engrave-decoration'

const simpleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/>
</svg>`

describe('createEngraveDecorationProvider — SVG branch (jsdom env)', () => {
  it('builds an SVG engrave geometry when svg is provided', async () => {
    const provider = createEngraveDecorationProvider()
    const geo = await provider({
      depth: 3,
      svg: simpleSvg,
      svgSize: 20,
    })
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('honours svgSize and natural dimension parameters', async () => {
    const provider = createEngraveDecorationProvider()
    const geo = await provider({
      depth: 5,
      svg: simpleSvg,
      svgSize: 40,
      svgNaturalWidth: 200,
      svgNaturalHeight: 100,
    })
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
  })
})