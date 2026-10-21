import { describe, it, expect, beforeAll } from 'vitest'
import { meshToAsciiStl, reconstructSolidFromMesh } from '../../src/occt-kernel/meshReconstruct'
import { initOcctWasm, getOcctKernel, type ShapeHandle } from '../../src/occt-kernel/occtKernel'

describe('meshToAsciiStl', () => {
  it('emits one facet block per triangle with normalized cross-product normal', () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ])
    const indices = new Uint32Array([0, 1, 2])
    const stl = meshToAsciiStl(positions, indices)
    expect(stl.startsWith('solid mesh_reconstruct')).toBe(true)
    expect(stl.endsWith('endsolid mesh_reconstruct')).toBe(true)
    // XY-plane triangle → CCW normal is +Z
    // (b-a) x (c-a) = (1,0,0) x (0,1,0) = (0,0,1)
    expect(stl).toContain('facet normal 0 0 1')
    expect(stl).toContain('vertex 0 0 0')
    expect(stl).toContain('vertex 1 0 0')
    expect(stl).toContain('vertex 0 1 0')
    expect(stl).toContain('endfacet')
  })

  it('throws when there is no mesh data', () => {
    expect(() => meshToAsciiStl(new Float32Array(), new Uint32Array())).toThrow(
      /no mesh data/,
    )
  })

  it('emits one facet per triangle across multiple triangles', () => {
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 0, 1, 0, 0, 0, 1,
    ])
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5])
    const stl = meshToAsciiStl(positions, indices)
    const facetCount = (stl.match(/facet normal/g) ?? []).length
    expect(facetCount).toBe(2)
  })
})

/**
 * Two axis-aligned unit cubes that do NOT touch (offset 10 on X).
 *
 * This mirrors the real-world shape that broke the old pipeline:
 * `example016.stl` (derived from LetterBlock.scad) contains two disjoint
 * blocks. It is closed and manifold, but `sewAndSolidify()` returns a
 * *compound of shells* — which is not usable as a boolean tool.
 */
function twoDisjointCubes(): { positions: Float32Array; indices: Uint32Array } {
  const cube = (ox: number) => {
    const v: number[] = []
    for (let c = 0; c < 8; c++) {
      v.push(ox + ((c >> 0) & 1), (c >> 1) & 1, (c >> 2) & 1)
    }
    // 12 triangles, outward-facing for a CCW convention on each face
    const tri = [
      0, 2, 1, 1, 2, 3, // z=0
      4, 5, 6, 5, 7, 6, // z=1
      0, 1, 4, 1, 5, 4, // y=0
      2, 6, 3, 3, 6, 7, // y=1
      0, 4, 2, 2, 4, 6, // x=0
      1, 3, 5, 3, 7, 5, // x=1
    ]
    return { v, tri }
  }
  const a = cube(0)
  const b = cube(10)
  const positions = new Float32Array([...a.v, ...b.v])
  const indices = new Uint32Array([
    ...a.tri,
    ...b.tri.map((i) => i + 8),
  ])
  return { positions, indices }
}

describe('reconstructSolidFromMesh — multi-shell meshes', () => {
  let kernel: ReturnType<typeof getOcctKernel>

  beforeAll(async () => {
    await initOcctWasm()
    kernel = getOcctKernel()
  }, 120_000)

  it('GOTCHA(multi-shell): two disjoint closed blocks reconstruct to two solids', () => {
    const { positions, indices } = twoDisjointCubes()
    // L1 契约面（BrepHandle）与 occt 原生 handle（ShapeHandle）运行时同构，
    // 与下方 `kernel as never` 同样的跨品牌转换。
    const shape = reconstructSolidFromMesh(kernel as never, positions, indices) as unknown as ShapeHandle

    // The old pipeline threw "open or non-manifold" here. Solids must exist —
    // shells alone cannot be used as a boolean tool.
    const solids = kernel.getSubShapes(shape, 'solid')
    expect(solids.length).toBe(2)
    for (const s of solids) {
      expect(kernel.isValid(s)).toBe(true)
    }
    expect(kernel.queryBatch([shape])[0].volume).toBeCloseTo(2, 6)
  })

  it('a single closed block reconstructs to one valid solid', () => {
    const cube = (ox: number) => {
      const v: number[] = []
      for (let c = 0; c < 8; c++) v.push(ox + ((c >> 0) & 1), (c >> 1) & 1, (c >> 2) & 1)
      return { v, tri: [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5] }
    }
    const a = cube(0)
    const shape = reconstructSolidFromMesh(
      kernel as never,
      new Float32Array(a.v),
      new Uint32Array(a.tri),
    ) as unknown as ShapeHandle
    expect(kernel.isSolid(shape)).toBe(true)
    expect(kernel.isValid(shape)).toBe(true)
    expect(kernel.queryBatch([shape])[0].volume).toBeCloseTo(1, 6)
  })
})