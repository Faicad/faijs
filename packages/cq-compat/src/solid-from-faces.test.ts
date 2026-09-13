/**
 * solidFromFaces — cq-compat extension E5 tests.
 *
 * Sew a closed set of box faces into a solid; verify solid-ness, positive
 * volume and exact box metrics. Mirrors the usage pattern gears need
 * (tooth-face patches + caps → sewn solid).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { solidFromFaces, val } from './index'
import { setupNativeKernel, mkWP, kernel } from './gear-test-harness'
import { fromHandle } from '@faicad/faijs-core/sdk'
import { brepOf } from '@faicad/faijs-core/shape'
import type { Workplane } from './workplane'

/** Raw kernel handle of a Workplane's `.shape` (kernel methods need the raw id). */
function rawOf(wp: Workplane): unknown {
  return brepOf(wp.shape as never)
}

beforeAll(async () => {
  await setupNativeKernel()
}, 120000)

/** Six planar faces of a box, built from wire loops on the raw kernel. */
function boxFaces(half: number): Workplane[] {
  const k = kernel() as unknown as {
    makeLineEdge: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => unknown
    makeWire: (edges: unknown[]) => unknown
    makeFace: (wire: unknown) => unknown
  }
  const corners: Array<[number, number, number]> = [
    [-half, -half, -half], [half, -half, -half], [half, half, -half], [-half, half, -half],
    [-half, -half, half], [half, -half, half], [half, half, half], [-half, half, half],
  ]
  const v = (i: number) => ({ x: corners[i][0], y: corners[i][1], z: corners[i][2] })
  // 6 quad loops: bottom(0-1-2-3), top(4-5-6-7), and 4 sides
  const loops = [
    [0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0],
  ]
  return loops.map((loop) => {
    const edges = loop.map((i, j) => k.makeLineEdge(v(i), v(loop[(j + 1) % 4])))
    const face = k.makeFace(k.makeWire(edges))
    // Minimal Workplane-like carrier: only `.shape` is consumed by
    // solidFromFaces; `fromHandle` returns a Shape registered in the runtime
    // slots, which is what `brepOf` looks up.
    return { shape: fromHandle(face) } as unknown as Workplane
  })
}

describe('solidFromFaces (E5)', () => {
  it('sews six box faces into a positive-volume solid with exact metrics', async () => {
    const half = 5
    const result = await solidFromFaces(mkWP(), boxFaces(half))
    const solid = rawOf(result)
    expect(solid).toBeDefined()

    const k = kernel() as unknown as {
      isSolid: (s: unknown) => boolean
      getVolume: (s: unknown) => number
      getBoundingBox: (s: unknown) => { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }
    }
    expect(k.isSolid(solid)).toBe(true)
    expect(k.getVolume(solid)).toBeCloseTo((2 * half) ** 3, 3)
    const bb = k.getBoundingBox(solid)
    expect(bb.xmax - bb.xmin).toBeCloseTo(2 * half, 6)
    expect(bb.ymax - bb.ymin).toBeCloseTo(2 * half, 6)
    expect(bb.zmax - bb.zmin).toBeCloseTo(2 * half, 6)
  })

  it('rejects an empty faces list', async () => {
    await expect(solidFromFaces(mkWP(), [])).rejects.toThrow(/non-empty/)
  })

  it('rejects a face carrier without .shape', async () => {
    await expect(solidFromFaces(mkWP(), [{} as unknown as Workplane])).rejects.toThrow(/\.shape is required/)
  })
})
