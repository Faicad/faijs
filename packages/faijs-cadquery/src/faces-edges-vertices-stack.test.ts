/**
 * P3-3 freeze — `faces`/`edges`/`vertices` are EAGER multi-object pushes.
 *
 * CadQuery `Workplane._selectObjects` (`cq.py:753`) resolves the requested
 * sub-shapes of EVERY stack object, pools them, and runs the SELECTOR over the
 * POOLED set (`cq.py:236` `_filter` over the union — global min/max selectors
 * like `<XY` / `>Z` must see every candidate, not per-object). faijs reproduces
 * that by `makeCompound`-ing the stack into one owner and resolving the single
 * `{kind, sel}` step against it (`selectOnStack` in workplane.ts).
 *
 * Every expected COUNT below is locked to a one-shot CadQuery 2.8.0 capture
 * (`tests/ref-harness/p3-3-*.py`, run with cadquery-env python). Counts are
 * topologically position-independent, so a default (origin-centred) `box` is fine.
 *
 * 内核：setupNativeKernel() binds the vendored brepjs kernel (same selector path).
 */
import { describe, it, beforeAll, expect } from 'vitest'
import type { OcctKernel } from 'occt-wasm'
import * as cq from './index'
import { fromHandle, brepOf } from '@faicad/faijs/sdk'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import { shapeTypeOf, areaOf } from './shape-class'
import type { Shape } from '@faicad/faijs/mesh/types'

let cube: Awaited<ReturnType<typeof cq.box>>

beforeAll(async () => {
  await setupNativeKernel()
  cube = await cq.box(await cq.Workplane('XY'), 1, 1, 1)
})

function k(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** A genuine TWO-object stack: two unit solids, the second translated (5,0,0)
 * so no face is kernel-identical and survives `isSame` dedup — exactly the
 * `w = Workplane.box().add(Workplane.box().translate((5,0,0)))` of the probe.
 *
 * Built from kernel primitives rather than `cad.translate`, because `cad.*`
 * ops return a `Result` wrapper (not a bare `Shape`), which `add` would drop. */
function twoSolids(): ReturnType<typeof cq.add> {
  const kk = k()
  const a = fromHandle(kk.makeBox(1, 1, 1)) as Shape
  const b = fromHandle(kk.translate(kk.makeBox(1, 1, 1), 5, 0, 0)) as Shape
  return cq.add(cq.add(cq.Workplane('XY'), a), b)
}

describe('faces() eager push — single cube', () => {
  it('faces() → 6 faces', () => {
    expect(cq.size(cq.faces(cube, ''))).toBe(6)
  })
  it('faces(">Z") → 1 face (the top), stack head is a Face of area 1', () => {
    const wp = cq.faces(cube, '>Z')
    expect(cq.size(wp)).toBe(1)
    expect(shapeTypeOf(brepOf(wp.objects[0]!) as never)).toBe('face')
    expect(areaOf(brepOf(wp.objects[0]!) as never)).toBeCloseTo(1, 6)
  })
  it('faces("+Z") → 1 (probe: cube.faces("+Z").size() == 1)', () => {
    expect(cq.size(cq.faces(cube, '+Z'))).toBe(1)
  })
  it('no match → empty stack (size 0), not the pushed solid', () => {
    // GOTCHA: a face's own face-set is ITSELF, so re-filtering must use the
    // face NORMAL. The top face normal is +Z → `|Z` (parallel to Z) still
    // matches it (== 1, NOT 0); only a non-parallel axis is empty.
    // Probe (`p3-3-nomatch-probe.py`): faces('>Z').faces('|Z') == 1,
    //                                    faces('>Z').faces('|X') == 0.
    expect(cq.size(cq.faces(cq.faces(cube, '>Z'), '|Z'))).toBe(1)
    expect(cq.size(cq.faces(cq.faces(cube, '>Z'), '|X'))).toBe(0)
  })
})

describe('progressive narrowing — the stack model', () => {
  it('GOTCHA (P3-3 core): faces("+Z").vertices("<XY") == 1, NOT 4', () => {
    // The selector runs over the POOLED face vertices, so `<XY` (min x+y) picks
    // the single corner. Probe: cube.faces("+Z").vertices("<XY").size() == 1.
    // (The plan §8.2 draft value "4" was a pre-probe guess — the capture is 1.)
    expect(cq.size(cq.vertices(cq.faces(cube, '+Z'), '<XY'))).toBe(1)
  })
  it('faces("+Z").vertices() (empty sel) → 4 (all 4 corners of the face)', () => {
    expect(cq.size(cq.vertices(cq.faces(cube, '+Z'), ''))).toBe(4)
  })
  it('faces(">Z").edges() → 4 (the top face outline; |Z filter gives 0)', () => {
    expect(cq.size(cq.edges(cq.faces(cube, '>Z'), ''))).toBe(4)
    expect(cq.size(cq.edges(cq.faces(cube, '>Z'), '|Z'))).toBe(0)
  })
  it('edges("|Z") → 4 vertical edges; edges("|Z").vertices() → 8', () => {
    expect(cq.size(cq.edges(cube, '|Z'))).toBe(4)
    expect(cq.size(cq.vertices(cq.edges(cube, '|Z'), ''))).toBe(8)
  })
  it('vertices() → 8 (probe: cube.vertices().size() == 8)', () => {
    expect(cq.size(cq.vertices(cube, ''))).toBe(8)
  })
})

describe('multi-object stack — pooled filter is GLOBAL, not per-object', () => {
  it('two solids: stack 2, faces() → 12, faces(">Z") → 2', () => {
    const t = twoSolids()
    expect(cq.size(t)).toBe(2)
    expect(cq.size(cq.faces(t, ''))).toBe(12)
    expect(cq.size(cq.faces(t, '>Z'))).toBe(2)
  })
  it('GOTCHA: two solids faces(">Z").vertices("<XY") == 1, NOT 2', () => {
    // `faces(">Z")` pushes 2 top faces (2 objects); `vertices("<XY")` pools BOTH
    // faces' vertices (8) and filters globally → the unique min(x+y) corner = 1.
    // A naive per-object filter would wrongly return 2. Probe == 1.
    const t = twoSolids()
    expect(cq.size(cq.vertices(cq.faces(t, '>Z'), '<XY'))).toBe(1)
  })
  it('two solids: edges("|Z") → 8, vertices() → 16', () => {
    const t = twoSolids()
    expect(cq.size(cq.edges(t, '|Z'))).toBe(8)
    expect(cq.size(cq.vertices(t, ''))).toBe(16)
  })
  it('two solids: faces(">Z").edges() → 8, .edges("|X") → 4', () => {
    const t = twoSolids()
    expect(cq.size(cq.edges(cq.faces(t, '>Z'), ''))).toBe(8)
    expect(cq.size(cq.edges(cq.faces(t, '>Z'), '|X'))).toBe(4)
  })
})

describe('empty stack', () => {
  it('vertices() on an empty workplane → 0 (probe: empty.vertices().size() == 0)', async () => {
    expect(cq.size(cq.vertices(await cq.Workplane('XY'), ''))).toBe(0)
  })
})
