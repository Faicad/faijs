import { describe, expect, it } from 'vitest'
import { makeStockMesh } from '../src/stock.js'
import type { CamStockDecl } from '../src/decl.js'

describe('makeStockMesh', () => {
  it('returns null for empty/custom declarations without dimensions', () => {
    expect(makeStockMesh(null)).toBeNull()
    expect(makeStockMesh({ type: 'custom' } as CamStockDecl)).toBeNull()
  })

  it('builds a box mesh with 8 vertices, 36 indices and correct bounds', () => {
    const mesh = makeStockMesh({ type: 'box', size: [60, 40, 20], center: [0, 0, 10] })
    expect(mesh).not.toBeNull()
    expect(mesh!.positions.length / 3).toBe(24)
    expect(mesh!.indices.length).toBe(36)
    expect(mesh!.bounds.min).toEqual([-30, -20, 0])
    expect(mesh!.bounds.max).toEqual([30, 20, 20])
  })

  it('builds a cylinder mesh with side wall + caps', () => {
    const mesh = makeStockMesh({ type: 'cylinder', radius: 10, height: 20, center: [0, 0, 0] })
    expect(mesh).not.toBeNull()
    // 64 radial steps → 130 vertices, 64 * 12 indices
    expect(mesh!.positions.length / 3).toBe(130)
    expect(mesh!.indices.length).toBe(64 * 12)
    expect(mesh!.bounds.max[0]).toBeCloseTo(10, 3)
    expect(mesh!.bounds.max[2]).toBe(10)
    expect(mesh!.bounds.min[2]).toBe(-10)
  })

  it('returns null for zero dimensions', () => {
    expect(makeStockMesh({ type: 'box', size: [0, 10, 10] })).toBeNull()
    expect(makeStockMesh({ type: 'cylinder', radius: 0, height: 10 })).toBeNull()
  })
})
