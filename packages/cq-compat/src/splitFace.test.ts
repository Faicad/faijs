/**
 * E3 splitFace op test — splits the workplane's shape by a plane and keeps one
 * side (CadQuery `face.split(plane)` / `split(keepTop)` parity, see
 * docs/plans/2026-09-11-cq-compat-gears-extensions-e1-e4.md).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { fromHandle } from '@faicad/faijs-core/sdk'
import * as cq from './index'
import { setupNativeKernel, kernel, mkWP, bbox } from './gear-test-harness'

beforeAll(async () => {
  await setupNativeKernel()
}, 120000)

describe('cq-compat E3 splitFace', () => {
  it('keeps the top fragment when keep=top', async () => {
    const solid = fromHandle(kernel().makeBox(10, 10, 10))
    const wp = mkWP({ shape: solid })
    const out = await cq.splitFace(wp, { origin: [0, 0, 5], normal: [0, 0, 1] }, 'top')
    expect(out.shape).toBeDefined()
    const bb = bbox(out.shape!)
    expect(bb.zmin).toBeCloseTo(5, 3)
    expect(bb.zmax).toBeCloseTo(10, 3)
  })

  it('keeps the bottom fragment when keep=bottom', async () => {
    const solid = fromHandle(kernel().makeBox(10, 10, 10))
    const wp = mkWP({ shape: solid })
    const out = await cq.splitFace(wp, { origin: [0, 0, 5], normal: [0, 0, 1] }, 'bottom')
    expect(out.shape).toBeDefined()
    const bb = bbox(out.shape!)
    expect(bb.zmin).toBeCloseTo(0, 3)
    expect(bb.zmax).toBeCloseTo(5, 3)
  })
})
