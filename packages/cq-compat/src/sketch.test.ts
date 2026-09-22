/**
 * Sketch geometry-container parity tests — mirrors upstream cadquery 2.8.0
 * `tests/test_sketch.py` for the non-planegcs surface: construction modes,
 * selectors, tags, offsets and the sketch→extrude outlet.
 *
 * Reference: upstream test_modes / test_val / test_vals / test_face_interface
 * (upstream Sketch is a 2D face container; STEP export yields zero volume so
 * these are asserted as area/face-count parity rather than STEP comparison).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import { brepOf } from '@faicad/faijs/shape'
import {
  sketchCreate,
  sketchRect,
  sketchCircle,
  sketchEllipse,
  sketchPolygon,
  sketchRegularPolygon,
  sketchSlot,
  sketchTrapezoid,
  sketchOffset,
  sketchFaces,
  sketchWires,
  sketchEdges,
  sketchVertices,
  sketchReset,
  sketchVals,
  sketchSelect,
  sketchArea,
  sketchFaceCount,
  sketchExtrude,
  sketchDispose,
} from './index'

beforeAll(async () => {
  await setupNativeKernel()
})

describe('test_modes parity', () => {
  it('additive mode: rect(2,2).rect(1,1) keeps both faces fused, area 4', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 'a' })
    expect(sketchArea(s)).toBeCloseTo(4, 6)
    expect(sketchFaceCount(s)).toBe(2)
    sketchDispose(s)
  })

  it('subtraction mode: area 4-1 = 3, one face', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 's' })
    expect(sketchArea(s)).toBeCloseTo(3, 6)
    expect(sketchFaceCount(s)).toBe(1)
    sketchDispose(s)
  })

  it('intersection mode: area 1', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 'i' })
    expect(sketchArea(s)).toBeCloseTo(1, 6)
    expect(sketchFaceCount(s)).toBe(1)
    sketchDispose(s)
  })

  it('construction mode requires a tag', () => {
    expect(() => sketchRect(sketchCreate(), 2, 2, { mode: 'c' })).toThrow(/tag/i)
    expect(() => sketchRect(sketchCreate(), 2, 2, { mode: 'dummy' as never })).toThrow(/invalid mode/i)
  })

  it('construction mode stores the new geometry under the tag', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 'c', tag: 't' })
    expect(sketchArea(s)).toBeCloseTo(4, 6)
    expect(sketchFaceCount(s)).toBe(1)
    const tagged = s.tags.get('t')
    expect(tagged).toBeTruthy()
    expect((getKernel() as any).getSurfaceArea(tagged![0])).toBeCloseTo(1, 6)
    sketchDispose(s)
  })

  it('replace mode via offset: rect(1,1).wires().offset(-0.1, mode="r").reset()', () => {
    let s = sketchRect(sketchCreate(), 1, 1)
    s = sketchWires(s)
    s = sketchOffset(s, -0.1, { mode: 'r' })
    s = sketchReset(s)
    expect(sketchArea(s)).toBeCloseTo(0.8 * 0.8, 6)
    sketchDispose(s)
  })
})

describe('geometry declarations parity', () => {
  it('circle area', () => {
    const s = sketchCircle(sketchCreate(), 2)
    expect(sketchArea(s)).toBeCloseTo(Math.PI * 4, 4)
    sketchDispose(s)
  })

  it('ellipse area (a=3, b=2) = pi*a*b', () => {
    const s = sketchEllipse(sketchCreate(), 3, 2)
    expect(sketchArea(s)).toBeCloseTo(Math.PI * 6, 4)
    sketchDispose(s)
  })

  it('regularPolygon hexagon area = 6 * (sqrt(3)/4) * r^2', () => {
    const s = sketchRegularPolygon(sketchCreate(), 2, 6)
    expect(sketchArea(s)).toBeCloseTo((3 * Math.sqrt(3)) / 2 * 4, 4)
    sketchDispose(s)
  })

  it('slot(w=4,h=2): rectangle 4x2 + two semicircle caps radius 1', () => {
    const s = sketchSlot(sketchCreate(), 4, 2)
    expect(sketchArea(s)).toBeCloseTo(4 * 2 + Math.PI * 1, 4)
    sketchDispose(s)
  })

  it('trapezoid: rect 4x2 minus two right triangles', () => {
    const s = sketchTrapezoid(sketchCreate(), 4, 2, 45)
    // top width = 4 - 2*(2/tan45) = 0 -> triangle of area 4
    expect(sketchArea(s)).toBeCloseTo(4, 4)
    sketchDispose(s)
  })

  it('polygon triangle area', () => {
    const s = sketchPolygon(sketchCreate(), [
      [0, 0],
      [2, 0],
      [0, 2],
    ])
    expect(sketchArea(s)).toBeCloseTo(2, 6)
    sketchDispose(s)
  })
})

describe('selector parity', () => {
  it('faces() selects all faces; val/vals return them', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 'a' })
    const sel = sketchFaces(s)
    expect(sel.selected.length).toBe(2)
    const v = sketchVals(s)
    expect(v.length).toBe(2)
    // topological face areas of the fused pair sum to the union area (4)
    const kk = getKernel() as any
    expect(kk.getSurfaceArea(v[0]) + kk.getSurfaceArea(v[1])).toBeCloseTo(4, 6)
    sketchDispose(s)
  })

  it('wires()/edges()/vertices() expose sub-shapes', () => {
    const s = sketchRect(sketchCreate(), 2, 2)
    const ws = sketchWires(s)
    expect(ws.selected.length).toBe(1)
    const es = sketchEdges(s)
    expect(es.selected.length).toBe(4)
    const vs = sketchVertices(s)
    expect(vs.selected.length).toBe(4)
    sketchDispose(s)
  })

  it('tag/select round-trip stores construction geometry', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 'c', tag: 'hole' })
    const sel = sketchSelect(s, 'hole')
    expect(sel.selected.length).toBe(1)
    expect((getKernel() as any).getSurfaceArea(sel.selected[0])).toBeCloseTo(1, 6)
    sketchDispose(s)
  })
})

describe('sketch → extrude outlet (Phase 2 action 3, brep side)', () => {
  it('extrudes the effective faces into a fused solid', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 's' })
    const solid = sketchExtrude(s, 2)
    const k = getKernel() as any
    const handle = brepOf(solid as never)
    expect(k.getVolume(handle)).toBeCloseTo(6, 6)
    expect((k.getSubShapes(handle, 'solid') as unknown[]).length).toBe(1)
    k.release(handle)
    sketchDispose(s)
  })

  it('slot extrude: (4*2 + pi) * 3', () => {
    const s = sketchSlot(sketchCreate(), 4, 2)
    const solid = sketchExtrude(s, 3)
    const k = getKernel() as any
    const handle = brepOf(solid as never)
    expect(k.getVolume(handle)).toBeCloseTo((4 * 2 + Math.PI) * 3, 4)
    k.release(handle)
    sketchDispose(s)
  })
})
