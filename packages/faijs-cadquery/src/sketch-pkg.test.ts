/**
 * Package-surface smoke tests: `@faicad/faijs-cadquery/sketch (merged 2026-10-02, ex standalone package)` re-exports the
 * sketch container with unprefixed CadQuery grammar names and the extrude
 * outlet works end to end.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { brepOf } from '@faicad/faijs/shape'
import { setupNativeKernel } from './gear-test-harness'
import { sketch, rect, circle, slot, faces, wires, offset, reset, area, faceCount, extrude, dispose } from './sketch-pkg'

beforeAll(async () => {
  await setupNativeKernel()
})

describe('cq-compat-sketch package surface', () => {
  it('unprefixed CadQuery grammar names work end to end', () => {
    let s = sketch()
    s = rect(s, 2, 2)
    s = rect(s, 1, 1, { mode: 's' })
    expect(area(s)).toBeCloseTo(3, 6)
    expect(faceCount(s)).toBe(1)
    const solid = extrude(s, 2)
    const k = getKernel() as any
    expect(k.getVolume(brepOf(solid as never))).toBeCloseTo(6, 6)
    k.release(solid)
    dispose(s)
  })

  it('circle + slot + offset chain', () => {
    let s = circle(sketch(), 1)
    expect(area(s)).toBeCloseTo(Math.PI, 4)
    s = slot(sketch(), 4, 2)
    expect(area(s)).toBeCloseTo(4 * 2 + Math.PI, 4)
    s = rect(sketch(), 1, 1)
    s = wires(s)
    s = offset(s, -0.1, { mode: 'r' })
    s = reset(s)
    expect(area(s)).toBeCloseTo(0.64, 6)
    dispose(s)
  })

  it('faces selector flattens fused topological faces', () => {
    let s = rect(sketch(), 2, 2)
    s = rect(s, 1, 1)
    const sel = faces(s)
    expect(sel.selected.length).toBe(2)
    dispose(s)
  })
})
