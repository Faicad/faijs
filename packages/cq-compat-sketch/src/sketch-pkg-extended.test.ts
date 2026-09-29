/**
 * Package-surface tests for the P0-2 Sketch completion: edge declarations
 * (segment/arc/bezier/spline + close/assemble), arrays (rarray/parray/
 * distribute), modifiers (fillet/chamfer/hull/clean) and the constraint
 * segment validation (constrain error paths).
 *
 * Mirrors upstream cadquery 2.8.0 tests/test_sketch.py assertions by area /
 * face-count / edge-count parity (see sketch.test.ts header note).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from '../../cq-compat/src/gear-test-harness'
import {
  sketch,
  rect,
  circle,
  segment,
  arc,
  bezier,
  close,
  assemble,
  add,
  subtract,
  rarray,
  parray,
  distribute,
  moved,
  located,
  copy,
  delete as sketchDelete,
  replace,
  fillet,
  chamfer,
  clean,
  hull,
  hullFromPoints,
  constrain,
  finalize,
  push,
  faces,
  vertices,
  offset,
  reset,
  edges,
  wires,
  area,
  faceCount,
  dispose,
} from './index'
import type { Sketch } from './index'

beforeAll(async () => {
  await setupNativeKernel()
})

/** Edge count across all effective faces (upstream `_faces.Edges()` length). */
function edgeCount(sk: Sketch): number {
  const k = getKernel() as never as Parameters<typeof Object>[0] & {
    getSubShapes: (h: unknown, t: string) => unknown[]
  }
  let n = 0
  for (const f of sk.faces) n += (k.getSubShapes(f, 'edge') as unknown[]).length
  return n
}

describe('edge interface (upstream test_edge_interface)', () => {
  it('segment×3 + close + assemble → one face, area 1', () => {
    let s = sketch()
    s = segment(s, [0, 0], [1, 0])
    s = segment(s, [1, 1])
    s = segment(s, 1, 180)
    s = close(s)
    s = assemble(s)
    expect(faceCount(s)).toBe(1)
    expect(area(s)).toBeCloseTo(1, 6)
    dispose(s)
  })

  it('three-point arc + close + assemble → area π/2', () => {
    let s = sketch()
    s = arc(s, [0, 0], [1, 1], [0, 2])
    s = close(s)
    s = assemble(s)
    expect(faceCount(s)).toBe(1)
    expect(area(s)).toBeCloseTo(Math.PI / 2, 4)
    dispose(s)
  })

  it('two arcs forming a circle → area π', () => {
    let s = sketch()
    s = arc(s, [0, 0], [1, 1], [0, 2])
    s = arc(s, [-1, 1], [0, 0])
    s = assemble(s)
    expect(faceCount(s)).toBe(1)
    expect(area(s)).toBeCloseTo(Math.PI, 4)
    dispose(s)
  })

  it('center/radius/angle arc vertices', () => {
    let s = sketch()
    s = arc(s, [0, 0], 1, 0, 90)
    s = vertices(s)
    expect(s.selected.length).toBe(2)
    dispose(s)
  })

  it('assemble of non-closed edges throws (upstream ValueError)', () => {
    let s = sketch()
    s = segment(s, [0, 0], [1, 0])
    s = segment(s, [2, 0], [3, 0])
    expect(() => assemble(s)).toThrow()
    dispose(s)
  })
})

describe('bezier (upstream test_bezier)', () => {
  it('bezier-enclosed face area 5.35', () => {
    let s = sketch()
    s = segment(s, [0, 0], [0, 0.5])
    s = bezier(s, [[0, 0.5], [-1, 2], [1, 0.5], [5, 0]])
    s = bezier(s, [[5, 0], [1, -0.5], [-1, -2], [0, -0.5]])
    s = close(s)
    s = assemble(s)
    expect(area(s)).toBeCloseTo(5.35, 2)
    dispose(s)
  })
})

describe('arrays (upstream test_rarray / test_parray / test_distribute)', () => {
  it('rarray 3×3 of 1×1 rects → area 9', () => {
    let s = sketch()
    s = rarray(s, 2, 2, 3, 3)
    s = rect(s, 1, 1)
    expect(area(s)).toBeCloseTo(9, 6)
    expect(faceCount(s)).toBe(9)
    dispose(s)
  })

  it('rarray over pushed loci → 18 faces, area 4.5', () => {
    let s = sketch()
    s = push(s, [[0, 0], [1, 1]])
    s = rarray(s, 2, 2, 3, 3)
    s = rect(s, 0.5, 0.5)
    expect(area(s)).toBeCloseTo(18 * 0.25, 6)
    expect(faceCount(s)).toBe(18)
    dispose(s)
  })

  it('parray 3 elements on r=2 arc → area 3', () => {
    let s = sketch()
    s = parray(s, 2, 0, 90, 3)
    s = rect(s, 1, 1)
    expect(area(s)).toBeCloseTo(3, 6)
    expect(faceCount(s)).toBe(3)
    dispose(s)
  })

  it('parray with n=0 throws', () => {
    expect(() => parray(sketch(), 2, 0, 90, 0)).toThrow(/At least 1 element/)
  })

  it('rarray with ny=0 throws', () => {
    expect(() => rarray(sketch(), 2, 2, 3, 0)).toThrow(/At least 1 element/)
  })

  it('distribute along construction circle edges → 3 rects at r=4', () => {
    let s = sketch()
    s = circle(s, 4, { mode: 'c', tag: 'c' })
    s = reset(s)
    s = edges(s, undefined, 'c')
    s = distribute(s, 3)
    s = rect(s, 1, 1)
    expect(area(s)).toBeCloseTo(3, 6)
    expect(faceCount(s)).toBe(3)
    dispose(s)
  })

  it('distribute without selection throws', () => {
    expect(() => distribute(sketch(), 5)).toThrow(/Nothing selected/)
  })
})

describe('modifiers (upstream test_modifiers / test_misc)', () => {
  it('fillet at two vertices → 2 faces, 10 edges', () => {
    let s = sketch()
    s = push(s, [[-2, 0], [2, 0]])
    s = rect(s, 1, 1)
    s = reset(s)
    s = faces(s)
    s = vertices(s, '<X')
    s = fillet(s, 0.1)
    expect(faceCount(s)).toBe(2)
    expect(area(s)).toBeCloseTo(1.995707963267949, 4)
    dispose(s)
  })

  it('chamfer at two vertices → 2 faces, 10 edges', () => {
    let s = sketch()
    s = push(s, [[-2, 0], [2, 0]])
    s = rect(s, 1, 1)
    s = reset(s)
    s = faces(s)
    s = vertices(s, '<X')
    s = chamfer(s, 0.1)
    expect(faceCount(s)).toBe(2)
    expect(area(s)).toBeCloseTo(1.99, 6)
    dispose(s)
  })

  it('hull of three rects → 3 faces, area 5', () => {
    let s = sketch()
    s = push(s, [[-2, 0], [2, 0]])
    s = rect(s, 1, 1)
    s = reset(s)
    s = faces(s)
    s = hull(s)
    expect(faceCount(s)).toBe(3)
    expect(area(s)).toBeCloseTo(5, 4)
    dispose(s)
  })

  it('hull of two segments → area 1', () => {
    let s = sketch()
    s = segment(s, [0, 0], [0, 1])
    s = segment(s, [1, 0], [2, 0])
    s = hull(s)
    expect(faceCount(s)).toBe(1)
    expect(area(s)).toBeCloseTo(1, 4)
    dispose(s)
  })

  it('hullFromPoints on rect corners', () => {
    const s = hullFromPoints(sketch(), [[0, 0], [2, 0], [2, 2], [0, 2], [1, 0.5]])
    expect(area(s)).toBeCloseTo(4, 6)
    dispose(s)
  })

  it('hull without objects throws', () => {
    expect(() => hull(sketch())).toThrow(/No objects available/)
  })

  it('clean unifies offset internals → 1 face, 8 edges', () => {
    let s = rect(sketch(), 2, 2)
    s = reset(s)
    s = wires(s)
    s = offset(s, 1)
    expect(faceCount(s)).toBe(2)
    s = clean(s)
    expect(faceCount(s)).toBe(1)
    expect(edgeCount(s)).toBe(8)
    dispose(s)
  })
})


describe('copies (upstream test_located / copy semantics)', () => {
  it('moved translates faces, original untouched', () => {
    const s = rect(sketch(), 1, 1)
    const m = moved(s, 5, 0)
    expect(area(m)).toBeCloseTo(1, 6)
    expect(area(s)).toBeCloseTo(1, 6)
    dispose(s)
    dispose(m)
  })

  it('located places faces at the locus', () => {
    const s = rect(sketch(), 1, 1)
    const l = located(s, 3, 4)
    expect(area(l)).toBeCloseTo(1, 6)
    expect(l.locs[0]).toMatchObject({ x: 3, y: 4 })
    dispose(s)
    dispose(l)
  })

  it('copy duplicates faces', () => {
    const s = rect(sketch(), 1, 1)
    const c = copy(s)
    expect(area(c)).toBeCloseTo(1, 6)
    dispose(s)
    dispose(c)
  })
})

describe('edits (upstream test_delete / test_replace / add/subtract)', () => {
  it('delete selected face removes it', () => {
    let s = rect(sketch(), 1, 1)
    s = push(s, [[5, 0]])
    s = rect(s, 1, 4)
    expect(faceCount(s)).toBe(2)
    s = reset(s)
    s = faces(s, '<X')
    s = sketchDelete(s)
    expect(faceCount(s)).toBe(1)
    dispose(s)
  })

  it('delete without selection throws', () => {
    expect(() => sketchDelete(rect(sketch(), 1, 1))).toThrow(/Selection is needed/)
  })

  it('replace swaps faces with the selection', () => {
    let s = rect(sketch(), 1, 1)
    s = push(s, [[5, 0]])
    s = rect(s, 0.5, 0.5)
    s = reset(s)
    s = faces(s, '<X')
    s = replace(s)
    expect(faceCount(s)).toBe(1)
    expect(area(s)).toBeCloseTo(1, 6)
    dispose(s)
  })

  it('add fuses selected faces into the sketch', () => {
    let s = rect(sketch(), 0.5, 2)
    s = push(s, [[1, 0]])
    s = rect(s, 0.5, 2)
    s = reset(s)
    s = faces(s, '<X')
    s = add(s)
    expect(area(s)).toBeCloseTo(2, 6)
    dispose(s)
  })

  it('subtract cuts selected faces from the sketch', () => {
    let s = rect(sketch(), 0.5, 2)
    s = push(s, [[0.5, 0]])
    s = rect(s, 0.5, 2)
    s = reset(s)
    s = faces(s, '<X')
    s = subtract(s)
    expect(area(s)).toBeCloseTo(1, 6)
    dispose(s)
  })
})

describe('constraint segment validation (upstream test_constraint_validation)', () => {
  it('constrain with unknown tag throws', () => {
    let s = sketch()
    s = segment(s, [1, 1], [2, 1], { tag: 's' })
    expect(() => constrain(s, { tags: ['s', 'Dummy'], kind: 'Coincident' })).toThrow(/Tag not found/)
    dispose(s)
  })

  it('constrain with unknown kind throws', () => {
    let s = sketch()
    s = segment(s, [1, 1], [2, 1], { tag: 's' })
    expect(() => constrain(s, { tags: ['s'], kind: 'Dummy' })).toThrow(/Unknown constraint/)
    dispose(s)
  })

  it('finalize returns the parent', () => {
    const parent = { marker: true }
    const s = rect(sketch(), 2, 2)
    expect(finalize(s, parent)).toBe(parent)
    dispose(s)
  })
})
