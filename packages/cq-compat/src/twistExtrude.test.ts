/**
 * E4 twistExtrude op test — extrudes a profile while twisting it about the
 * extrusion axis (CadQuery `Workplane().twistExtrude` parity, see
 * docs/plans/2026-09-11-cq-compat-gears-extensions-e1-e4.md).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { fromHandle } from '@faicad/faijs-core/sdk'
import { brepOf } from '@faicad/faijs-core/shape'
import type { ShapeHandle } from 'occt-wasm'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as cq from './index'
import { setupNativeKernel, kernel, mkWP, bbox } from './gear-test-harness'

beforeAll(async () => {
  await setupNativeKernel()
}, 120000)

function volume(shape: Shape): number {
  return kernel().queryBatch([brepOf(shape) as unknown as ShapeHandle])[0].volume
}

describe('cq-compat E4 twistExtrude', () => {
  it('throws when no profile is set', async () => {
    const wp = mkWP()
    await expect(cq.twistExtrude(wp, 90, 10)).rejects.toThrow(/profile required/)
  })

  it('twists a rectangular profile into a solid of the given height', async () => {
    // makeRectangle returns a face directly (no makeWire/makeFace needed);
    // center it at the origin so the twist axis passes through its middle.
    const rect = kernel().makeRectangle(4, 4)
    const face = fromHandle(kernel().translate(rect, -2, -2, 0))
    const wp = mkWP({ shape: face })
    const out = await cq.twistExtrude(wp, 90, 10, { steps: 16 })
    expect(out.shape).toBeDefined()
    const bb = bbox(out.shape!)
    // Extrusion axis = wp.normal = [0,0,1] → height along Z.
    expect(bb.zmax - bb.zmin).toBeCloseTo(10, 1)
    expect(volume(out.shape!)).toBeGreaterThan(0)
  })
})
