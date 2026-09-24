/**
 * stl-loader — differential test for the hand-written STL parser.
 *
 * The parser replaced three's `STLLoader` (a `three/examples` addon) to keep the
 * addons out of core. The evidence it is a faithful replacement:
 *
 *  1. a hand-built binary STL parses to the expected triangles, including the
 *     degenerate-normal fallback;
 *  2. an ASCII STL parses to the same geometry as its binary twin;
 *  3. a round trip through core's own STL writer (`buildStlBufferFromMesh`)
 *     recovers the source triangle count and bounding box.
 */
import { describe, it, expect } from 'vitest'
import { parseStl } from './stl-loader'
import { geoToManifoldMesh } from '../boolean/geo-convert'
import { buildStlBufferFromMesh } from '../brep/export/stl'
import type { Shape } from './types'

/** Two triangles forming a unit square in the XY plane (non-indexed). */
const SQUARE_POSITIONS = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 1, 0,
  0, 0, 0, 1, 1, 0, 0, 1, 0,
])

function binaryStl(triangles: number[][], normals: number[][]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, triangles.length, true)
  let offset = 84
  triangles.forEach((tri, i) => {
    const n = normals[i] ?? [0, 0, 1]
    view.setFloat32(offset, n[0], true)
    view.setFloat32(offset + 4, n[1], true)
    view.setFloat32(offset + 8, n[2], true)
    offset += 12
    // `tri` is a flat [x0,y0,z0, x1,y1,z1, x2,y2,z2] triple list.
    for (let v = 0; v < tri.length; v += 3) {
      view.setFloat32(offset, tri[v], true)
      view.setFloat32(offset + 4, tri[v + 1], true)
      view.setFloat32(offset + 8, tri[v + 2], true)
      offset += 12
    }
    view.setUint16(offset, 0, true)
    offset += 2
  })
  return buffer
}

const TRIANGLES = [
  [0, 0, 0, 1, 0, 0, 1, 1, 0],
  [0, 0, 0, 1, 1, 0, 0, 1, 0],
]

const ASCII_STL = `solid square
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 1 1 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 1 0
    vertex 0 1 0
  endloop
endfacet
endsolid square
`

describe('mesh/stl-loader', () => {
  it('binary STL: one vertex triple per triangle, stored normal kept', () => {
    const geo = parseStl(binaryStl(TRIANGLES, [[0, 0, 1], [0, 0, 1]]))
    const position = geo.getAttribute('position')
    const normal = geo.getAttribute('normal')
    expect(position.count).toBe(6)
    expect(Array.from(position.array)).toEqual(Array.from(SQUARE_POSITIONS))
    expect(Array.from(normal.array.slice(0, 3))).toEqual([0, 0, 1])
  })

  it('binary STL: a degenerate stored normal falls back to the geometric one', () => {
    const geo = parseStl(binaryStl([TRIANGLES[0]], [[0, 0, 0]]))
    const normal = geo.getAttribute('normal')
    expect(Array.from(normal.array.slice(0, 3))).toEqual([0, 0, 1])
  })

  it('ASCII STL parses to the same geometry as its binary twin', () => {
    const ascii = parseStl(new TextEncoder().encode(ASCII_STL).buffer as ArrayBuffer)
    const binary = parseStl(binaryStl(TRIANGLES, [[0, 0, 1], [0, 0, 1]]))
    expect(Array.from(ascii.getAttribute('position').array))
      .toEqual(Array.from(binary.getAttribute('position').array))
  })

  it('round trip through the STL writer recovers triangles and bounds', () => {
    const source: Shape = {
      positions: SQUARE_POSITIONS,
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    }
    const stl = buildStlBufferFromMesh(source.positions, source.indices)
    const reloaded = geoToManifoldMesh(parseStl(stl))
    expect(reloaded.indices.length / 3).toBe(2)
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < reloaded.positions.length; i += 3) {
      xs.push(reloaded.positions[i])
      ys.push(reloaded.positions[i + 1])
    }
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(1, 6)
    expect(Math.min(...ys)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(1, 6)
  })

  it('empty buffer is rejected loudly', () => {
    expect(() => parseStl(new ArrayBuffer(0))).toThrow(/empty STL buffer/)
  })
})
