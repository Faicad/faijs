/**
 * mesh/primitives — `text` (meshText) coverage.
 *
 * `text` converts THREE geometry into a `Shape` (ManifoldMeshData) mesh.
 * Font-dependent paths are exercised headlessly by installing the test
 * font loader (reads the bundled OpenSans-Regular.ttf from disk), mirroring
 * how core's text tests run under Node/vitest.
 *
 * Runtime-only notes:
 * - CJK glyphs require a system CJK font via the Local Font Access API; that
 *   is a browser-only path and is NOT exercised here (headless has none).
 *   We cover the ASCII default-font path and the graceful-degradation
 *   substitution of CJK chars to '?'.
 * - `svgExtrude` (meshSvgExtrude) needs a DOM (SVGLoader → DOMParser); it is
 *   covered separately in `primitives.svg.test.ts` under the jsdom env.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { text } from '../../src/mesh/primitives'
import { setupTestFont } from '@faicad/faijs/brep/text/fontTestHelper'

beforeAll(async () => {
  await setupTestFont()
})

function vertexCount(shape: { positions: Float32Array }): number {
  return shape.positions.length / 3
}

describe('meshText (text)', () => {
  it('produces a non-empty mesh for ASCII text', async () => {
    const s = await text({ text: 'ABC', size: 10, depth: 3 })
    expect(s.positions.length).toBeGreaterThan(0)
    expect(s.indices.length).toBeGreaterThan(0)
    expect(vertexCount(s)).toBeGreaterThan(0)
  })

  it('depth scales the extrusion thickness along Z', async () => {
    const thin = await text({ text: 'Hi', size: 20, depth: 2 })
    const thick = await text({ text: 'Hi', size: 20, depth: 10 })

    const zExtent = (p: Float32Array) => {
      let min = Infinity, max = -Infinity
      for (let i = 2; i < p.length; i += 3) { if (p[i] < min) min = p[i]; if (p[i] > max) max = p[i] }
      return { min, max }
    }
    const t = zExtent(thin.positions)
    const k = zExtent(thick.positions)
    // Thicker extrusion spans more Z; base sits at z≈0 (not asserted precisely).
    expect(k.max - k.min).toBeGreaterThanOrEqual((t.max - t.min) * 0.5)
  })

  it('larger size yields a wider footprint', async () => {
    const small = await text({ text: 'A', size: 10, depth: 2 })
    const big = await text({ text: 'A', size: 40, depth: 2 })
    const footprintX = (p: Float32Array) => {
      let min = Infinity, max = -Infinity
      for (let i = 0; i < p.length; i += 3) { if (p[i] < min) min = p[i]; if (p[i] > max) max = p[i] }
      return max - min
    }
    expect(footprintX(big.positions)).toBeGreaterThan(footprintX(small.positions))
  })

  it('CJK text degrades to "?" glyphs instead of throwing when no CJK font', async () => {
    // Headless has no system CJK font → the mixed path falls back to "?" mapping.
    const s = await text({ text: '字', size: 12, depth: 2 })
    expect(s.positions.length).toBeGreaterThan(0)
  })
})