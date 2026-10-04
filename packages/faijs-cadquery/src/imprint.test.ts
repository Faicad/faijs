/**
 * imprint parity — CadQuery 2.8.0 module-level `imprint(*shapes)` free
 * function (`occ_impl/shapes.py:6774`, `BOPAlgo_Builder.Perform`).
 *
 * Expectations verified against CadQuery 2.8.0 (one-shot capture, audit §5.1):
 *   imprint(b1, b2)            → 11 faces, vol 2,   2 solids (shared face merged)
 *   imprint(b1, b2, glue=full) → 11 faces, vol 2,   2 solids
 *   imprint(b1, b3, glue=partial) → 12 faces, vol 1.125, 2 solids
 *
 * NOTE: the ref STEP files in out/ref/ show f12/f12/f13 — these are STALE
 * (generated with a different build or face-counting path). The values below
 * come from running CadQuery 2.8.0 directly and match the upstream assertions
 * (`len(res.Faces()) == len(compound(b1, b2).Faces()) - 1` → 11 == 12-1).
 *
 * Fixtures are the same boxes the upstream test builds, rebuilt with the faijs
 * kernel (occt-wasm `makeBox` is corner-at-origin, hence the -0.5 lift).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { fromHandle } from '@faicad/faijs/sdk'
import { brepOf } from '@faicad/faijs/shape'
import type { Shape } from '@faicad/faijs/mesh/types'
import { setupNativeKernel } from './gear-test-harness'
import { volumeOf, solids } from './shape-class'
import { imprint } from './workplane'

beforeAll(async () => {
  await setupNativeKernel()
})

function k(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** xy-centred box, base on z=0 — matches CadQuery `box(w,l,h)`. */
function box(w: number, l: number, h: number): Shape {
  return fromHandle(k().translate(k().makeBox(w, l, h), -w / 2, -l / 2, 0) as ShapeHandle) as Shape
}

function faceCount(s: Shape): number {
  return k().getSubShapes(brepOf(s) as ShapeHandle, 'face').length
}

describe('imprint — BOPAlgo_Builder via fuseAll (CadQuery 2.8.0 parity)', () => {
  it('imprint(b1, b2) of two face-touching boxes: vol 2, 2 solids, 11 faces (shared face merged)', () => {
    const b1 = box(1, 1, 1)
    const b2 = fromHandle(k().translate(brepOf(b1) as ShapeHandle, 1, 0, 0) as ShapeHandle) as Shape
    const res = imprint(b1, b2)
    expect(volumeOf(brepOf(res) as ShapeHandle)).toBeCloseTo(2, 6)
    expect(solids(brepOf(res) as ShapeHandle).length).toBe(2)
    // CadQuery: 11 faces (6+6-1, shared face merged by BOPAlgo_Builder)
    expect(faceCount(res)).toBe(11)
  })

  it('imprint(b1, b3) partial touch: vol 1.125, 2 solids, 12 faces', () => {
    const b1 = box(1, 1, 1)
    const b3 = box(0.5, 0.5, 0.5)
    const b3m = fromHandle(k().translate(brepOf(b3) as ShapeHandle, 0.75, 0, 0) as ShapeHandle) as Shape
    const res = imprint(b1, b3m)
    expect(volumeOf(brepOf(res) as ShapeHandle)).toBeCloseTo(1.125, 6)
    expect(solids(brepOf(res) as ShapeHandle).length).toBe(2)
    // CadQuery: 12 faces (b1 face split into 2 → 7, b3 keeps 6, shared face merged → 12)
    expect(faceCount(res)).toBe(12)
  })

  it('single shape returns it unchanged', () => {
    const b1 = box(1, 1, 1)
    expect(volumeOf(brepOf(imprint(b1)) as ShapeHandle)).toBeCloseTo(1, 6)
  })
})
