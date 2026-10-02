/**
 * 2D sketch string-selector parity — the E-class derived silent gap
 * (docs/plans/2026-10-02-cadquery-port-gap-audit.md §3.5).
 *
 * Truth is a ONE-SHOT CadQuery 2.8.0 capture
 * (`tests/ref-harness/sketch-selectors-probe.py`, not wired into CI) frozen here
 * per audit §5.1. Every expected value below was printed by that probe.
 *
 * Upstream `Sketch._select` dispatches to the SAME
 * `cadquery.selectors.StringSyntaxSelector` the 3D Workplane selectors use, so
 * the sketch side has to obey the same two rules the 3D side was already fixed
 * to obey:
 *   ① the ordering key is `Center()` (type-dispatched mass centre), NOT the bbox
 *      centre — for a triangle face / circular arc the two order differently and
 *      `>X` picks a DIFFERENT element;
 *   ② extremes are clustered at 1e-4 from the cluster's first key, not "within
 *      an epsilon of the single best value".
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import type { ShapeHandle } from 'occt-wasm'
import { setupNativeKernel } from './gear-test-harness'
import { centerOf } from './shape-class'
import {
  sketch as sketchCreate,
  polygon,
  rect,
  push,
  reset,
  arc,
  segment,
  faces as selFaces,
  wires as selWires,
  edges as selEdges,
  vertices as selVertices,
  dispose,
} from './sketch'

beforeAll(async () => {
  await setupNativeKernel()
})

/** `Face@(4.50000,8.00000)` — matches the probe's printable identity. */
function identOf(h: ShapeHandle): string {
  const t = getKernel().getShapeType(h)
  const c = centerOf(h)
  const name = t.charAt(0).toUpperCase() + t.slice(1)
  return `${name}@(${c.x.toFixed(5)},${c.y.toFixed(5)})`
}

function ident(hs: ShapeHandle[]): string[] {
  return hs.map(identOf)
}

/** Order-sensitive comparison (single-term results are cluster-ordered). */
function expectIdent(hs: ShapeHandle[], expected: string[]): void {
  expect(ident(hs)).toEqual(expected)
}

/** Order-insensitive comparison (upstream `not` is a Python set difference). */
function expectSet(hs: ShapeHandle[], expected: string[]): void {
  expect([...ident(hs)].sort()).toEqual([...expected].sort())
}

/**
 * F1 — triangle at [(0,0),(10,0),(0,4)] + a 9x4 rect pushed to (4.5,8).
 * Their `Center()` x-order (3.333 < 4.5) is the OPPOSITE of their bbox-centre
 * x-order (5.0 > 4.5), so every `>X` / `<X` below is a discriminating case.
 */
function f1() {
  let s = sketchCreate()
  s = polygon(s, [
    [0, 0],
    [10, 0],
    [0, 4],
  ])
  s = push(s, [{ x: 4.5, y: 8 }])
  s = rect(s, 9, 4)
  // upstream `push()` leaves Locations in `_selection`, so a `reset()` is
  // mandatory before selecting — otherwise the selection resolves to nothing.
  return reset(s)
}

/** F2 — quarter arc (r=10, 0..90°) + the straight segment (6,0)-(6,9). */
function f2() {
  let s = sketchCreate()
  s = arc(s, [0, 0], 10, 0, 90)
  s = segment(s, [6, 0], [6, 9])
  return s
}

/** F3 — two 4x4 squares separated in Y, x-centres differing by `dx`. */
function f3(dx: number) {
  let s = sketchCreate()
  s = rect(s, 4, 4)
  s = push(s, [{ x: dx, y: 10 }])
  s = rect(s, 4, 4)
  return reset(s)
}

describe('sketch selector · fixture geometry (anchors the frozen truth)', () => {
  it('F1: 2 faces / 2 wires / 7 edges / 7 vertices', () => {
    const s = f1()
    expect(selFaces(s).selected.length).toBe(2)
    expect(selWires(s).selected.length).toBe(2)
    expect(selEdges(s).selected.length).toBe(7)
    expect(selVertices(s).selected.length).toBe(7)
    dispose(s)
  })

  it('F1: face / wire centres match the CadQuery capture', () => {
    const s = f1()
    expectSet(selFaces(s).selected, ['Face@(3.33333,1.33333)', 'Face@(4.50000,8.00000)'])
    expectSet(selWires(s).selected, ['Wire@(4.19258,1.19258)', 'Wire@(4.50000,8.00000)'])
    dispose(s)
  })

  it('F1: bbox centres order the opposite way — the trap this guards', () => {
    const s = f1()
    const k = getKernel()
    const bboxX = selFaces(s).selected.map((h) => {
      const bb = k.getBoundingBox(h)
      return (bb.xmin + bb.xmax) / 2
    })
    // bbox: triangle 5.0 > rect 4.5   —   Center(): triangle 3.333 < rect 4.5
    expect(Math.max(...bboxX)).toBeCloseTo(5.0, 6)
    expect(Math.min(...bboxX)).toBeCloseTo(4.5, 6)
    dispose(s)
  })

  it('F2: 2 edges, arc centre (6.366198,6.366198) vs segment centre (6,4.5)', () => {
    const s = f2()
    const es = selEdges(s).selected
    expect(es.length).toBe(2)
    expectSet(es, ['Edge@(6.36620,6.36620)', 'Edge@(6.00000,4.50000)'])
    dispose(s)
  })
})

describe('sketch selector · >X / <X / >Y / <Y run on Center(), not the bbox centre', () => {
  it('F1 faces: Center() x-order wins (rect 4.5 over triangle 3.333)', () => {
    const s = f1()
    expectIdent(selFaces(s, '>X').selected, ['Face@(4.50000,8.00000)'])
    expectIdent(selFaces(s, '<X').selected, ['Face@(3.33333,1.33333)'])
    expectIdent(selFaces(s, '>Y').selected, ['Face@(4.50000,8.00000)'])
    expectIdent(selFaces(s, '<Y').selected, ['Face@(3.33333,1.33333)'])
    dispose(s)
  })

  it('F1 wires: the wire COM of the triangle is 4.192582, not the bbox 5.0', () => {
    const s = f1()
    expectIdent(selWires(s, '>X').selected, ['Wire@(4.50000,8.00000)'])
    expectIdent(selWires(s, '<X').selected, ['Wire@(4.19258,1.19258)'])
    expectIdent(selWires(s, '>Y').selected, ['Wire@(4.50000,8.00000)'])
    expectIdent(selWires(s, '<Y').selected, ['Wire@(4.19258,1.19258)'])
    dispose(s)
  })

  it('F1 edges: ties cluster — "<X" returns both x=0 edges', () => {
    const s = f1()
    expectIdent(selEdges(s, '>X').selected, ['Edge@(9.00000,8.00000)'])
    expectIdent(selEdges(s, '<X').selected, ['Edge@(0.00000,2.00000)', 'Edge@(0.00000,8.00000)'])
    expectIdent(selEdges(s, '>Y').selected, ['Edge@(4.50000,10.00000)'])
    expectIdent(selEdges(s, '<Y').selected, ['Edge@(5.00000,0.00000)'])
    dispose(s)
  })

  it('F1 vertices: a vertex Centre() is its own point; "<X" clusters 4 of them', () => {
    const s = f1()
    expectIdent(selVertices(s, '>X').selected, ['Vertex@(10.00000,0.00000)'])
    expectIdent(selVertices(s, '<X').selected, [
      'Vertex@(0.00000,0.00000)',
      'Vertex@(0.00000,4.00000)',
      'Vertex@(0.00000,6.00000)',
      'Vertex@(0.00000,10.00000)',
    ])
    // GOTCHA: inside a tied cluster the order is the INPUT order (the sort is
    // stable), and the sub-shape traverser's order is an OCC iteration detail —
    // CadQuery yields (0,10) before (9,10) here, faijs the other way round.
    // The MEMBERSHIP is what is pinned, not the intra-cluster order.
    expectSet(selVertices(s, '>Y').selected, ['Vertex@(0.00000,10.00000)', 'Vertex@(9.00000,10.00000)'])
    expectSet(selVertices(s, '<Y').selected, ['Vertex@(0.00000,0.00000)', 'Vertex@(10.00000,0.00000)'])
    dispose(s)
  })

  it('F2 edges: the arc wins ">X" on Center() (6.366) but would lose on bbox (5.0)', () => {
    const s = f2()
    expectIdent(selEdges(s, '>X').selected, ['Edge@(6.36620,6.36620)'])
    expectIdent(selEdges(s, '<X').selected, ['Edge@(6.00000,4.50000)'])
    expectIdent(selEdges(s, '>Y').selected, ['Edge@(6.36620,6.36620)'])
    expectIdent(selEdges(s, '<Y').selected, ['Edge@(6.00000,4.50000)'])
    dispose(s)
  })
})

describe('sketch selector · cluster tolerance 1e-4 (GOTCHA)', () => {
  it('centres 5e-5 apart fall in ONE cluster: ">X" and "<X" both return both', () => {
    const s = f3(0.00005)
    expectSet(selFaces(s, '>X').selected, ['Face@(0.00000,0.00000)', 'Face@(0.00005,10.00000)'])
    expectSet(selFaces(s, '<X').selected, ['Face@(0.00000,0.00000)', 'Face@(0.00005,10.00000)'])
    dispose(s)
  })

  it('centres 2e-4 apart split into two clusters', () => {
    const s = f3(0.0002)
    expectIdent(selFaces(s, '>X').selected, ['Face@(0.00020,10.00000)'])
    expectIdent(selFaces(s, '<X').selected, ['Face@(0.00000,0.00000)'])
    dispose(s)
  })

  it('exactly tied centres cluster as well', () => {
    const s = f3(0)
    expectSet(selFaces(s, '>X').selected, ['Face@(0.00000,0.00000)', 'Face@(0.00000,10.00000)'])
    dispose(s)
  })
})

describe('sketch selector · boolean composition', () => {
  it('"and" is a real INTERSECTION over the full list (not a chained no-op)', () => {
    const s = f1()
    expectIdent(selFaces(s, '>X and >Y').selected, ['Face@(4.50000,8.00000)'])
    // GOTCHA: upstream AndSelector intersects; the naive "apply each term to the
    // previous result" reading (or a single-element extreme, which always
    // matches) would return the >X face here instead of nothing.
    expectIdent(selFaces(s, '>X and <Y').selected, [])
    expectIdent(selVertices(s, '>X and >Y').selected, [])
    dispose(s)
  })

  it('"or" concatenates per-term results in grammar order', () => {
    const s = f1()
    expectIdent(selFaces(s, '>X or <X').selected, ['Face@(4.50000,8.00000)', 'Face@(3.33333,1.33333)'])
    expectSet(selVertices(s, '>X or >Y').selected, [
      'Vertex@(10.00000,0.00000)',
      'Vertex@(0.00000,10.00000)',
      'Vertex@(9.00000,10.00000)',
    ])
    dispose(s)
  })

  it('"not" is the complement over the full list', () => {
    const s = f1()
    expectIdent(selFaces(s, 'not >X').selected, ['Face@(3.33333,1.33333)'])
    expectSet(selVertices(s, 'not >Y').selected, [
      'Vertex@(0.00000,0.00000)',
      'Vertex@(9.00000,6.00000)',
      'Vertex@(0.00000,4.00000)',
      'Vertex@(0.00000,6.00000)',
      'Vertex@(10.00000,0.00000)',
    ])
    dispose(s)
  })
})

describe('sketch selector · edge cases (GOTCHA)', () => {
  it('an empty candidate list RAISES instead of returning an empty selection', () => {
    const s = sketchCreate()
    expect(() => selFaces(s, '>X')).toThrow(/Nth element of an empty list/)
    dispose(s)
  })

  it('a single element is its own extreme', () => {
    const s = rect(sketchCreate(), 2, 2)
    expectIdent(selFaces(s, '>X').selected, ['Face@(0.00000,0.00000)'])
    dispose(s)
  })

  it('"XY" is the un-normalised (1,1) direction — picks the min-x+min-y corner', () => {
    const s = rect(sketchCreate(), 2, 2)
    expectIdent(selVertices(s, '<XY').selected, ['Vertex@(-1.00000,-1.00000)'])
    dispose(s)
  })
})
