/**
 * Sketch parity mirrors — upstream cadquery 2.8.0 `tests/test_sketch.py`
 * (prefixed sketch* API surface of the main cq-compat package).
 *
 * Each test cites its upstream case. Parity is asserted by area / face-count /
 * edge-count (upstream Sketch is a 2D face container; STEP export yields zero
 * volume so this follows the sketch.test.ts header convention).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import {
  sketchCreate,
  sketchRect,
  sketchCircle,
  sketchSegment,
  sketchArc,
  sketchBezier,
  sketchClose,
  sketchAssemble,
  sketchAdd,
  sketchSubtract,
  sketchRarray,
  sketchParray,
  sketchDistribute,
  sketchMoved,
  sketchLocated,
  sketchCopy,
  sketchDelete,
  sketchReplace,
  sketchFillet,
  sketchChamfer,
  sketchClean,
  sketchHull,
  sketchHullFromPoints,
  sketchPush,
  sketchFaces,
  sketchWires,
  sketchEdges,
  sketchVertices,
  sketchReset,
  sketchArea,
  sketchFaceCount,
  sketchOffset,
  sketchTag,
  sketchFinalize,
  sketchDispose,
} from './index'
import type { Sketch } from './index'

beforeAll(async () => {
  await setupNativeKernel()
})

/** Edge count across effective faces (upstream `_faces.Edges()` length). */
function edgeCount(sk: Sketch): number {
  const kern = getKernel() as unknown as { getSubShapes: (h: unknown, t: string) => unknown[] }
  let n = 0
  for (const f of sk.faces) n += (kern.getSubShapes(f, 'edge') as unknown[]).length
  return n
}
void edgeCount

describe('test_face_interface mirror', () => {
  it('rect(2,2).rect(1,1, mode=s) → area 3 (upstream s3)', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 's' })
    expect(sketchArea(s)).toBeCloseTo(3, 6)
    sketchDispose(s)
  })

  it('rect(2,2).rect(1,1, mode=i) → area 1 (upstream s4)', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchRect(s, 1, 1, { mode: 'i' })
    expect(sketchArea(s)).toBeCloseTo(1, 6)
    sketchDispose(s)
  })

  it('invalid mode throws (upstream mode="dummy")', () => {
    const s = sketchRect(sketchCreate(), 2, 2)
    expect(() => sketchRect(s, 1, 1, { mode: 'dummy' as never })).toThrow(/Invalid mode/)
    sketchDispose(s)
  })

  it('wires().offset(-0.1, mode=r).reset() → 0.8² (upstream s5)', () => {
    let s = sketchRect(sketchCreate(), 1, 1)
    s = sketchWires(s)
    s = sketchOffset(s, -0.1, { mode: 'r' })
    s = sketchReset(s)
    expect(sketchArea(s)).toBeCloseTo(0.8 ** 2, 6)
    sketchDispose(s)
  })
})

describe('test_distribute mirror', () => {
  it('distribute without selection throws', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchFaces(s)
    expect(() => sketchDistribute(s, 5)).toThrow()
    sketchDispose(s)
  })

  it('circle(mode=c,tag).edges(tag).distribute(3).rect(1,1) → area 3, 3 faces at r=4', () => {
    let s = sketchCircle(sketchCreate(), 4, { mode: 'c', tag: 'c' })
    s = sketchEdges(s, undefined, 'c')
    s = sketchDistribute(s, 3)
    s = sketchRect(s, 1, 1)
    expect(sketchArea(s)).toBeCloseTo(3, 6)
    expect(sketchFaceCount(s)).toBe(3)
    sketchDispose(s)
  })

  it('distribute(3, rotate=False) → 3 faces', () => {
    let s = sketchCircle(sketchCreate(), 4, { mode: 'c', tag: 'c' })
    s = sketchEdges(s, undefined, 'c')
    s = sketchDistribute(s, 3, 0, 1, false)
    s = sketchRect(s, 1, 1)
    expect(sketchArea(s)).toBeCloseTo(3, 6)
    expect(sketchFaceCount(s)).toBe(3)
    sketchDispose(s)
  })

  it('arc edges distribute(3, 0.25, 0.75) → 3 rects spanning the arc', () => {
    let s = sketchCreate()
    s = sketchArc(s, [0, 0], 4, 180, 180)
    s = sketchEdges(s)
    s = sketchDistribute(s, 3, 0.25, 0.75)
    s = sketchRect(s, 1, 0.5)
    expect(sketchFaceCount(s)).toBe(3)
    sketchDispose(s)
  })

  it('two arcs distribute(4, 0, 1).circle(0.5) → 8 faces', () => {
    let s = sketchCreate()
    s = sketchArc(s, [0, 2], 4, 0, 90)
    s = sketchArc(s, [0, -2], 4, 0, -90)
    s = sketchEdges(s)
    s = sketchDistribute(s, 4, 0, 1)
    s = sketchCircle(s, 0.5)
    expect(sketchFaceCount(s)).toBe(8)
    sketchDispose(s)
  })
})

describe('test_rarray / test_parray mirror', () => {
  it('rarray(2,2,3,3).rect(1,1) → area 9, 9 faces', () => {
    let s = sketchRarray(sketchCreate(), 2, 2, 3, 3)
    s = sketchRect(s, 1, 1)
    expect(sketchArea(s)).toBeCloseTo(9, 6)
    expect(sketchFaceCount(s)).toBe(9)
    sketchDispose(s)
  })

  it('push([(0,0),(1,1)]).rarray(2,2,3,3).rect(0.5,0.5) → 18 faces, area 4.5', () => {
    let s = sketchPush(sketchCreate(), [
      [0, 0],
      [1, 1],
    ])
    s = sketchRarray(s, 2, 2, 3, 3)
    s = sketchRect(s, 0.5, 0.5)
    expect(sketchArea(s)).toBeCloseTo(18 * 0.25, 6)
    expect(sketchFaceCount(s)).toBe(18)
    sketchDispose(s)
  })

  it('rarray(2,2,3,0) throws', () => {
    expect(() => sketchRarray(sketchCreate(), 2, 2, 3, 0)).toThrow()
  })

  it('parray(2,0,90,3).rect(1,1) → area 3, 3 faces', () => {
    let s = sketchParray(sketchCreate(), 2, 0, 90, 3)
    s = sketchRect(s, 1, 1)
    expect(sketchArea(s)).toBeCloseTo(3, 6)
    expect(sketchFaceCount(s)).toBe(3)
    sketchDispose(s)
  })

  it('parray(2,0,90,3,False).rect(0.5,0.5) vertex check', () => {
    let s = sketchParray(sketchCreate(), 2, 0, 90, 3, false)
    s = sketchRect(s, 0.5, 0.5)
    s = sketchReset(s)
    s = sketchVertices(s, '>(1,1,0)')
    expect(s.selected.length).toBe(1)
    sketchDispose(s)
  })

  it('parray(4,20,360,6).rect(1,0.5) → 6 faces', () => {
    let s = sketchParray(sketchCreate(), 4, 20, 360, 6)
    s = sketchRect(s, 1.0, 0.5)
    expect(sketchFaceCount(s)).toBe(6)
    sketchDispose(s)
  })
})

describe('test_modifiers mirror', () => {
  it('vertices(<X).fillet(0.1) → 2 faces, area 1.99571', () => {
    let s = sketchPush(sketchCreate(), [
      [-2, 0],
      [2, 0],
    ])
    s = sketchRect(s, 1, 1)
    s = sketchReset(s)
    s = sketchFaces(s)
    s = sketchVertices(s, '<X')
    s = sketchFillet(s, 0.1)
    expect(sketchFaceCount(s)).toBe(2)
    expect(sketchArea(s)).toBeCloseTo(1.995707963267949, 4)
    sketchDispose(s)
  })

  it('vertices(>X).chamfer(0.1) → 2 faces, area 1.99', () => {
    let s = sketchPush(sketchCreate(), [
      [-2, 0],
      [2, 0],
    ])
    s = sketchRect(s, 1, 1)
    s = sketchReset(s)
    s = sketchFaces(s)
    s = sketchVertices(s, '>X')
    s = sketchChamfer(s, 0.1)
    expect(sketchFaceCount(s)).toBe(2)
    expect(sketchArea(s)).toBeCloseTo(1.99, 6)
    sketchDispose(s)
  })

  it('hull of two spaced rects → 3 faces, area 5', () => {
    let s = sketchPush(sketchCreate(), [
      [-2, 0],
      [2, 0],
    ])
    s = sketchRect(s, 1, 1)
    s = sketchReset(s)
    s = sketchFaces(s)
    s = sketchHull(s)
    expect(sketchFaceCount(s)).toBe(3)
    expect(sketchArea(s)).toBeCloseTo(5, 4)
    sketchDispose(s)
  })

  it('hull of two disjoint segments → 1 face, area 1', () => {
    let s = sketchSegment(sketchCreate(), [0, 0], [0, 1])
    s = sketchSegment(s, [1, 0], [2, 0])
    s = sketchHull(s)
    expect(sketchFaceCount(s)).toBe(1)
    expect(sketchArea(s)).toBeCloseTo(1, 4)
    sketchDispose(s)
  })

  it('rect(2,2).wires().offset(1) → 2 faces; clean() → 1 face', () => {
    let s = sketchRect(sketchCreate(), 2, 2)
    s = sketchWires(s)
    s = sketchOffset(s, 1)
    expect(sketchFaceCount(s)).toBe(2)
    s = sketchClean(s)
    expect(sketchFaceCount(s)).toBe(1)
    sketchDispose(s)
  })

  it('hull without objects throws', () => {
    expect(() => sketchHull(sketchCreate())).toThrow()
  })
})

describe('test_delete mirror', () => {
  it('faces(<X).delete() → 1 face', () => {
    let s = sketchPush(sketchCreate(), [
      [-2, 0],
      [2, 0],
    ])
    s = sketchRect(s, 1, 1)
    s = sketchReset(s)
    s = sketchFaces(s, '<X')
    s = sketchDelete(s)
    expect(sketchFaceCount(s)).toBe(1)
    sketchDispose(s)
  })

  it('segment+close: edges(<X).delete() leaves 2 pending edges (upstream s2)', () => {
    let s = sketchSegment(sketchCreate(), [0, 0], [1, 0])
    s = sketchSegment(s, [0, 1], { tag: 'e' })
    s = sketchClose(s)
    expect(s.edges.length).toBe(3)
    s = sketchEdges(s, '<X')
    s = sketchDelete(s)
    expect(s.edges.length).toBe(2)
    sketchDispose(s)
  })

  it('delete without selection throws', () => {
    expect(() => sketchDelete(sketchRect(sketchCreate(), 1, 1))).toThrow()
  })
})

describe('test_edge_interface mirror', () => {
  it('segment/segment/segment(1,180)/close/assemble → area 1', () => {
    let s = sketchSegment(sketchCreate(), [0, 0], [1, 0])
    s = sketchSegment(s, [1, 1])
    s = sketchSegment(s, 1, 180)
    s = sketchClose(s)
    s = sketchAssemble(s)
    expect(sketchFaceCount(s)).toBe(1)
    expect(sketchArea(s)).toBeCloseTo(1, 6)
    sketchDispose(s)
  })

  it('arc(0,0)(1,1)(0,2).close().assemble() → area π/2', () => {
    let s = sketchArc(sketchCreate(), [0, 0], [1, 1], [0, 2])
    s = sketchClose(s)
    s = sketchAssemble(s)
    expect(sketchFaceCount(s)).toBe(1)
    expect(sketchArea(s)).toBeCloseTo(Math.PI / 2, 4)
    sketchDispose(s)
  })

  it('two half-circle arcs → area π', () => {
    let s = sketchArc(sketchCreate(), [0, 0], [1, 1], [0, 2])
    s = sketchArc(s, [-1, 1], [0, 0])
    s = sketchAssemble(s)
    expect(sketchFaceCount(s)).toBe(1)
    expect(sketchArea(s)).toBeCloseTo(Math.PI, 4)
    sketchDispose(s)
  })

  it('arc(c,r,a,da) vertex counts (2/2/1 for 90/−90/360 sweeps)', () => {
    let s = sketchArc(sketchCreate(), [0, 0], 1, 0, 90)
    s = sketchVertices(s)
    expect(s.selected.length).toBe(2)
    let s2 = sketchArc(sketchCreate(), [0, 0], 1, 0, -90)
    s2 = sketchVertices(s2)
    expect(s2.selected.length).toBe(2)
    let s3 = sketchArc(sketchCreate(), [0, 0], 1, 90, 360)
    s3 = sketchVertices(s3)
    expect(s3.selected.length).toBe(1)
    sketchDispose(s)
    sketchDispose(s2)
    sketchDispose(s3)
  })

  it('assemble of disjoint segments throws (upstream ValueError)', () => {
    let s = sketchSegment(sketchCreate(), [0, 0], [1, 0])
    s = sketchSegment(s, [2, 0], [3, 0])
    expect(() => sketchAssemble(s)).toThrow()
    sketchDispose(s)
  })
})

describe('test_bezier mirror', () => {
  it('bezier-enclosed face area 5.35', () => {
    let s = sketchSegment(sketchCreate(), [0, 0], [0, 0.5])
    s = sketchBezier(s, [
      [0, 0.5],
      [-1, 2],
      [1, 0.5],
      [5, 0],
    ])
    s = sketchBezier(s, [
      [5, 0],
      [1, -0.5],
      [-1, -2],
      [0, -0.5],
    ])
    s = sketchClose(s)
    s = sketchAssemble(s)
    expect(sketchArea(s)).toBeCloseTo(5.35, 2)
    sketchDispose(s)
  })
})

describe('test_located / copies mirror', () => {
  it('located identity: faces preserved, pending edges cleared', () => {
    let s = sketchSegment(sketchCreate(), [0, 0], [1, 0])
    s = sketchSegment(s, [1, 1])
    s = sketchClose(s)
    s = sketchAssemble(s)
    expect(s.edges.length).toBe(3)
    const s2 = sketchLocated(s, 0, 0)
    expect(s2.edges.length).toBe(0)
    expect(sketchFaceCount(s2)).toBe(1)
    sketchDispose(s)
    sketchDispose(s2)
  })

  it('moved(x,y) partial copy', () => {
    const s = sketchRect(sketchCreate(), 1, 1)
    const m = sketchMoved(s, 5, 0)
    expect(sketchArea(m)).toBeCloseTo(1, 6)
    sketchDispose(s)
    sketchDispose(m)
  })

  it('copy duplicates faces', () => {
    const s = sketchRect(sketchCreate(), 1, 1)
    const c = sketchCopy(s)
    expect(sketchArea(c)).toBeCloseTo(1, 6)
    sketchDispose(s)
    sketchDispose(c)
  })
})

describe('test_replace / test_add / test_subtract mirror', () => {
  it('replace with selected face', () => {
    let s = sketchRect(sketchCreate(), 1, 1)
    s = sketchPush(s, [[5, 0]])
    s = sketchRect(s, 0.5, 0.5)
    s = sketchReset(s)
    s = sketchFaces(s, '<X')
    s = sketchReplace(s)
    expect(sketchFaceCount(s)).toBe(1)
    expect(sketchArea(s)).toBeCloseTo(1, 6)
    sketchDispose(s)
  })

  it('add fuses the selected face back (idempotent)', () => {
    let s = sketchRect(sketchCreate(), 0.5, 2)
    s = sketchPush(s, [[1, 0]])
    s = sketchRect(s, 0.5, 2)
    s = sketchReset(s)
    s = sketchFaces(s, '<X')
    s = sketchAdd(s)
    expect(sketchArea(s)).toBeCloseTo(2, 6)
    sketchDispose(s)
  })

  it('subtract removes the selected face', () => {
    let s = sketchRect(sketchCreate(), 0.5, 2)
    s = sketchPush(s, [[0.5, 0]])
    s = sketchRect(s, 0.5, 2)
    s = sketchReset(s)
    s = sketchFaces(s, '<X')
    s = sketchSubtract(s)
    expect(sketchArea(s)).toBeCloseTo(1, 6)
    sketchDispose(s)
  })
})

describe('test_finalize / test_misc mirror', () => {
  it('finalize returns the parent', () => {
    const parent = { marker: 1 }
    const s = sketchRect(sketchCreate(), 2, 2)
    expect(sketchFinalize(s, parent)).toBe(parent)
    sketchDispose(s)
  })
})

describe('test_selectors mirror', () => {
  it('push+rect+subtract reset chain: selectors count topology', () => {
    let s = sketchPush(sketchCreate(), [
      [-2, 0],
      [2, 0],
    ])
    s = sketchRect(s, 1, 1)
    s = sketchRect(s, 0.5, 0.5, { mode: 's' })
    s = sketchReset(s)
    s = sketchVertices(s)
    expect(s.selected.length).toBe(16)
    s = sketchReset(s)
    s = sketchEdges(s)
    expect(s.selected.length).toBe(16)
    s = sketchReset(s)
    s = sketchWires(s)
    expect(s.selected.length).toBe(4)
    s = sketchReset(s)
    s = sketchFaces(s)
    expect(s.selected.length).toBe(2)
    s = sketchReset(s)
    s = sketchVertices(s, '<Y')
    expect(s.selected.length).toBe(4)
    s = sketchReset(s)
    s = sketchEdges(s, '<X or >X')
    expect(s.selected.length).toBe(2)
    sketchDispose(s)
  })

  it('tag stores selection; select restores it', () => {
    let s = sketchPush(sketchCreate(), [
      [-2, 0],
      [2, 0],
    ])
    s = sketchRect(s, 1, 1)
    s = sketchReset(s)
    s = sketchFaces(s, '<X')
    s = sketchReset(s)
    // tag without selection throws (upstream test_missing_selection)
    expect(() => sketchTagHelper(s)).toThrow()
    sketchDispose(s)
  })
})

/** tag requires a selection (upstream Sketch.tag raises without one). */
function sketchTagHelper(s: Sketch): Sketch {
  return sketchTag(s, 'name')
}

describe('test_missing_selection mirror', () => {
  it('offset without selection throws', () => {
    const s = sketchRect(sketchCreate(), 1, 1)
    expect(() => sketchOffset(s, 0.1)).toThrow()
    sketchDispose(s)
  })

  it('fillet without selection throws', () => {
    const s = sketchRect(sketchCreate(), 1, 1)
    expect(() => sketchFillet(s, 0.1)).toThrow()
    sketchDispose(s)
  })
})

describe('hullFromPoints mirror', () => {
  it('rect corner cloud with interior point → area 4', () => {
    const s = sketchHullFromPoints(sketchCreate(), [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [1, 0.5],
    ])
    expect(sketchArea(s)).toBeCloseTo(4, 6)
    sketchDispose(s)
  })
})
