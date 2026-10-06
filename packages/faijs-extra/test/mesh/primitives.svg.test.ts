/**
 * mesh/primitives — `svgExtrude` (meshSvgExtrude) coverage.
 *
 * Runs under jsdom because the SVG path goes through `SVGLoader.parse`, which
 * needs a `DOMParser` (a browser/DOM API) — unavailable in the default node
 * env. This is the deliberately-separated DOM-dependent half of the mesh
 * primitives; the pure node half (`text`) lives in `primitives.test.ts`.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { svgExtrude } from '../../src/mesh/primitives'

const simpleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/>
</svg>`

function vertexCount(shape: { positions: Float32Array }): number {
  return shape.positions.length / 3
}

describe('meshSvgExtrude (svgExtrude) — jsdom env', () => {
  it('extrudes a closed square path into a solid shape', () => {
    const s = svgExtrude({ svg: simpleSvg, depth: 5, targetLongSide: 20 })
    expect(s.positions.length).toBeGreaterThan(0)
    expect(s.indices.length).toBeGreaterThan(0)
    expect(vertexCount(s)).toBeGreaterThan(0)
  })

  it('respects targetLongSide when naturalWidth/naturalHeight are provided', () => {
    // Scaling only applies when a natural (logical) size is given; without it
    // the raw SVG coordinates are kept (see extrudeShapes: longSide<=0 → scale=1).
    const small = svgExtrude({ svg: simpleSvg, depth: 5, targetLongSide: 20, naturalWidth: 100, naturalHeight: 100 })
    const big = svgExtrude({ svg: simpleSvg, depth: 5, targetLongSide: 80, naturalWidth: 100, naturalHeight: 100 })
    const xSpan = (p: Float32Array) => {
      let min = Infinity, max = -Infinity
      for (let i = 0; i < p.length; i += 3) { if (p[i] < min) min = p[i]; if (p[i] > max) max = p[i] }
      return max - min
    }
    expect(xSpan(big.positions)).toBeGreaterThan(xSpan(small.positions))
    // scale = targetLongSide/100 → 20→0.2 (src 80 → 16), 80→0.8 (src 80 → 64).
    expect(xSpan(small.positions)).toBeCloseTo(80 * 0.2, 4)
    expect(xSpan(big.positions)).toBeCloseTo(80 * 0.8, 4)
  })

  it('supports naturalWidth/naturalHeight scaling overrides', () => {
    const s = svgExtrude({
      svg: simpleSvg,
      depth: 4,
      targetLongSide: 40,
      naturalWidth: 200,
      naturalHeight: 100,
    })
    expect(s.positions.length).toBeGreaterThan(0)
  })

  it('throws on an SVG with no closed contour', () => {
    // No path at all → any open path is ignored by the loader, so no closed
    // contour shapes are produced.
    const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`
    expect(() => svgExtrude({ svg: emptySvg, depth: 3, targetLongSide: 10 })).toThrow(/closed/i)
  })

  it('extrudes a circle path as well', () => {
    const circleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <circle cx="50" cy="50" r="40"/>
    </svg>`
    const s = svgExtrude({ svg: circleSvg, depth: 6, targetLongSide: 30 })
    expect(s.positions.length).toBeGreaterThan(0)
    expect(s.indices.length).toBeGreaterThan(0)
  })
})