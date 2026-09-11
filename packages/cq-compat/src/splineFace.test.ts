/**
 * E1 splineFace op test — builds a B-spline surface face from a point grid
 * (CadQuery `Face.makeSplineApprox` parity, see
 * docs/plans/2026-09-11-cq-compat-gears-extensions-e1-e4.md).
 *
 * Two things are checked here:
 *  1. argument validation + extents;
 *  2. the two strategies behave as documented — on a polynomial (bilinear)
 *     grid both agree, which is the domain where occt's fit and CadQuery's
 *     `makeSplineApprox` coincide. The gear-grid precision (4.2e-11 straight /
 *     5.6e-7 helical) is validated where the gear fixtures live, in
 *     `packages/fai_cq_gears/src/spline-face.test.ts`.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as cq from './index'
import { setupNativeKernel, mkWP, bbox, area } from './gear-test-harness'

beforeAll(async () => {
  await setupNativeKernel()
}, 120000)

/** Row-major flat grid -> `[x,y,z]` tuple array. */
function flat(points: number[][][]): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const row of points) for (const p of row) out.push([p[0], p[1], p[2]])
  return out
}

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

  it('builds a spline face spanning the grid extents (default row-approx-loft)', async () => {
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

  it('both strategies agree on a polynomial (bilinear) grid', async () => {
    // Bilinear surface: exact for both a one-shot fit and a row-wise skin,
    // so this is the domain where the two strategies must coincide.
    const n = 8
    const a = 3
    const points: number[][][] = []
    for (let i = 0; i <= n; i++) {
      const row: number[][] = []
      for (let j = 0; j <= n; j++) row.push([i, j, (a * i * j) / (n * n)])
      points.push(row)
    }
    const grid = flat(points)
    const rows = n + 1
    const cols = n + 1

    const gridOut = await cq.splineFace(mkWP(), grid, { rows, cols, strategy: 'grid' })
    const rowOut = await cq.splineFace(mkWP(), grid, { rows, cols, strategy: 'row-approx-loft' })
    const aGrid = area(gridOut.shape!)
    const aRow = area(rowOut.shape!)
    process.stdout.write(
      `  E1 bilinear 9x9: grid=${aGrid.toFixed(9)} row-loft=${aRow.toFixed(9)} rel=${(Math.abs(aGrid - aRow) / aGrid).toExponential(2)}\n`,
    )
    expect(Math.abs(aGrid - aRow) / aGrid).toBeLessThan(1e-9)
  })

  it('both strategies produce valid faces on a wavy grid', async () => {
    const n = 10
    const points: number[][][] = []
    for (let i = 0; i <= n; i++) {
      const row: number[][] = []
      for (let j = 0; j <= n; j++) {
        const z = 3 * Math.cos((2 * Math.PI * i) / n) * Math.cos((2 * Math.PI * j) / n)
        row.push([i, j, z])
      }
      points.push(row)
    }
    const grid = flat(points)
    const gridOut = await cq.splineFace(mkWP(), grid, { rows: n + 1, cols: n + 1, strategy: 'grid' })
    const rowOut = await cq.splineFace(mkWP(), grid, { rows: n + 1, cols: n + 1 })
    const aGrid = area(gridOut.shape!)
    const aRow = area(rowOut.shape!)
    process.stdout.write(
      `  E1 wavy 11x11:   grid=${aGrid.toFixed(6)} row-loft=${aRow.toFixed(6)} rel=${(Math.abs(aGrid - aRow) / aGrid).toExponential(2)}\n`,
    )
    expect(aGrid).toBeGreaterThan(0)
    expect(aRow).toBeGreaterThan(0)
  })
})
