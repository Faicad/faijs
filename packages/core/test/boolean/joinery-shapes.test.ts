import { describe, it, expect } from 'vitest'
import { buildWedgeGeometry, buildDowelGeometry, buildStraightTenonGeometry } from '../../src/boolean/joinery-shapes'

describe('buildWedgeGeometry', () => {
  it('produces 8 vertices and 12 triangles with correct output shape', () => {
    const r = buildWedgeGeometry([0, 0, 0], [0, 0, 1], [1, 0, 0], 10, 20, 60, 30)
    expect(r.positions).toHaveLength(8 * 3)
    expect(r.indices).toHaveLength(36)
  })

  it('bottom vertices sit depth below the cutting plane along -normal', () => {
    const r = buildWedgeGeometry([0, 0, 0], [0, 0, 1], [1, 0, 0], 5, 10, 30, 20)
    // GOTCHA: verts 0..3 are the front face bottoms, 4..7 the back face bottoms;
    // the "top" verts (at the plane) are 2,3,6,7. Just assert the overall z-extent.
    let minZ = 1e9
    let maxZ = -1e9
    for (let i = 0; i < r.positions.length; i += 3) {
      minZ = Math.min(minZ, r.positions[i + 2])
      maxZ = Math.max(maxZ, r.positions[i + 2])
    }
    expect(minZ).toBeCloseTo(-5)
    expect(maxZ).toBeCloseTo(0)
  })
})

describe('buildDowelGeometry', () => {
  it('produces a cylinder mesh with the requested segment count', () => {
    const r = buildDowelGeometry([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], 10, 20, 32)
    // segments*2 + 2 center-cap vertices
    expect(r.positions).toHaveLength((32 * 2 + 2) * 3)
    expect(r.indices.length % 3).toBe(0)
  })

  it('lays the circles in the widthDir/depthDir plane', () => {
    const r = buildDowelGeometry([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], 10, 20, 16)
    // top circle verts are on the cutting plane (normal=[0,0,1] → z=0)
    for (let i = 0; i < 16; i++) {
      expect(r.positions[i * 3 + 2]).toBeCloseTo(0)
    }
    // radius 5
    const x = r.positions[0], y = r.positions[1]
    expect(Math.hypot(x, y)).toBeCloseTo(5)
  })
})

describe('buildStraightTenonGeometry', () => {
  it('produces a box tenon mesh with positions and indices', () => {
    const r = buildStraightTenonGeometry([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], 10, 20)
    expect(r.positions.length % 3).toBe(0)
    expect(r.indices.length % 3).toBe(0)
    expect(r.indices.length).toBeGreaterThan(0)
  })

  it('mesh is watertight-looking: every index is within the position count', () => {
    const r = buildStraightTenonGeometry([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], 10, 20)
    const vertCount = r.positions.length / 3
    for (const idx of r.indices) {
      expect(idx).toBeLessThan(vertCount)
    }
  })
})