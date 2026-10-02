/**
 * E2 helix op test — creates a helical wire on the workplane
 * (CadQuery `Workplane().makeHelix` parity, see
 * docs/plans/2026-09-11-cq-compat-gears-extensions-e1-e4.md).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as cq from './index'
import { setupNativeKernel, mkWP, bbox } from './gear-test-harness'

beforeAll(async () => {
  await setupNativeKernel()
}, 120000)

describe('cq-compat E2 helix', () => {
  it('builds a right-handed helix with correct height and radius', async () => {
    const wp = mkWP()
    const out = await cq.helix(wp, 2, 10, 5)
    expect(out.shape).toBeDefined()
    const bb = bbox(out.shape!)
    // Extrusion axis = wp.normal = [0,0,1] → height along Z.
    expect(bb.zmax - bb.zmin).toBeCloseTo(10, 3)
    // radius 5 → xy bbox span ~ 2*radius = 10.
    expect(bb.xmax - bb.xmin).toBeCloseTo(10, 1)
    expect(bb.ymax - bb.ymin).toBeCloseTo(10, 1)
  })

  it('builds a left-handed helix when leftHanded is set', async () => {
    const wp = mkWP()
    const out = await cq.helix(wp, 2, 10, 5, { leftHanded: true })
    expect(out.shape).toBeDefined()
    const bb = bbox(out.shape!)
    expect(bb.zmax - bb.zmin).toBeCloseTo(10, 3)
    expect(bb.xmax - bb.xmin).toBeCloseTo(10, 1)
    expect(bb.ymax - bb.ymin).toBeCloseTo(10, 1)
  })
})
