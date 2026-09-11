/**
 * E1 splineFace op test — builds a B-spline surface face from a point grid
 * (CadQuery `Face.makeSplineSurface` parity, see
 * docs/plans/2026-09-11-cq-compat-gears-extensions-e1-e4.md).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as cq from './index'
import { setupNativeKernel, mkWP, bbox } from './gear-test-harness'

beforeAll(async () => {
  await setupNativeKernel()
}, 120000)

describe('cq-compat E1 splineFace', () => {
  it('throws when rows < 2', async () => {
    const wp = mkWP()
    await expect(cq.splineFace(wp, [[0, 0, 0]], { rows: 1, cols: 1 })).rejects.toThrow(/rows and cols/)
  })

  it('throws when grid length != rows*cols', async () => {
    const wp = mkWP()
    await expect(
      cq.splineFace(wp, [[0, 0, 0], [1, 1, 1]], { rows: 2, cols: 2 }),
    ).rejects.toThrow(/grid length/)
  })

  it('builds a bspline face spanning the grid extents', async () => {
    const rows = 3
    const cols = 3
    const grid: [number, number, number][] = []
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        grid.push([i * 5, j * 5, i * 0.5])
      }
    }
    const wp = mkWP()
    const out = await cq.splineFace(wp, grid, { rows, cols })
    expect(out.shape).toBeDefined()
    const bb = bbox(out.shape!)
    expect(bb.xmin).toBeCloseTo(0, 3)
    expect(bb.xmax).toBeCloseTo(10, 3)
    expect(bb.ymin).toBeCloseTo(0, 3)
    expect(bb.ymax).toBeCloseTo(10, 3)
    expect(bb.zmin).toBeCloseTo(0, 3)
    expect(bb.zmax).toBeCloseTo(1, 3)
  })
})
