/**
 * Kind-selector parity — CadQuery 2.8.0 `Workplane.wires()/shells()/solids()/
 * compounds()` + `Shape.Wires()/Shells()/Solids()/Compounds()` and the string
 * selector running over those kinds (audit §3.5 "E 类 · 派生沉默缺口", first
 * two rows).
 *
 * Every expectation is FROZEN from a ONE-SHOT CadQuery 2.8.0 reference capture
 * (`tests/ref-harness/kind-selectors-probe.py`, not part of CI — see
 * docs/plans/2026-10-02-cadquery-port-gap-audit.md §5.1). Fixtures are rebuilt
 * with the faijs kernel so the selectors recompute the same numbers.
 *
 * These results are in-process sub-shape references / counts: none of them ever
 * reach an exported STEP, which is why this whole family stayed silent.
 * Behaviour that looks like a bug but is upstream's real semantics carries a
 * `GOTCHA:` note.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import type { CqShape } from './shape-class'
import {
  borrowShape,
  centerOf,
  lengthOf,
  makeCompound,
  shapeTypeOf,
  shells,
  solids,
  compounds,
  facesOf,
  wiresOf,
  StringSyntaxSelector,
  wrapShape,
  disposeShape,
} from './shape-class'

beforeAll(async () => {
  await setupNativeKernel()
})

function k(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** Frozen-selection row: (shape type, centre x, y, z) — mirrors the probe's `kinds()`. */
type Row = readonly [string, number, number, number]

function ident(items: CqShape[]): Row[] {
  return items
    .map((i): Row => {
      const c = centerOf(i)
      return [shapeTypeOf(i), c.x, c.y, c.z]
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || a[1] - b[1] || a[2] - b[2] || a[3] - b[3])
}

/** Compare a selection against the frozen capture (centres to 1e-6). */
function expectIdent(items: CqShape[], expected: readonly Row[]): void {
  const got = ident(items)
  expect(got.length).toBe(expected.length)
  for (let idx = 0; idx < expected.length; idx += 1) {
    expect(got[idx][0]).toBe(expected[idx][0])
    expect(got[idx][1]).toBeCloseTo(expected[idx][1], 6)
    expect(got[idx][2]).toBeCloseTo(expected[idx][2], 6)
    expect(got[idx][3]).toBeCloseTo(expected[idx][3], 6)
  }
}

// ---------------------------------------------------------------------------
// Fixtures — rebuilt with the faijs kernel to match the Python capture exactly
// ---------------------------------------------------------------------------

/** 20×10×2 solid box with a corner at the origin (matches occt-wasm makeBox). */
function plate(): ShapeHandle {
  return k().makeBox(20, 10, 2)
}

/** The plate pierced by two through-holes: r=0.5 at (5,5) and r=1.5 at (14,5). */
function holedPlate(): ShapeHandle {
  const kk = k()
  const p = kk.makeBox(20, 10, 2)
  const c1 = kk.translate(kk.makeCylinder(0.5, 4), 5, 5, -1)
  const c2 = kk.translate(kk.makeCylinder(1.5, 4), 14, 5, -1)
  return kk.cut(kk.cut(p, c1), c2)
}

/** The +Z-most face of a shape (the probe selects it by `Center().z`). */
function topFace(h: ShapeHandle): CqShape {
  const fs = facesOf(h)
  const zMax = Math.max(...fs.map((f) => centerOf(f).z))
  const picked = fs.filter((f) => Math.abs(centerOf(f).z - zMax) < 1e-9)
  expect(picked.length).toBe(1)
  return picked[0]!
}

/** Two disjoint unit cubes at x∈[0,1] and x∈[5,6] joined into one compound. */
function twoBoxes(): CqShape {
  const kk = k()
  return makeCompound([
    wrapShape('solid', kk.makeBox(1, 1, 1) as never),
    wrapShape('solid', kk.translate(kk.makeBox(1, 1, 1), 5, 0, 0) as never),
  ])
}

/** Closed polygon wire from a point list (first point repeated last). */
function polygonWire(pts: ReadonlyArray<readonly [number, number]>): ShapeHandle {
  const kk = k()
  const edges: ShapeHandle[] = []
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]!
    const b = pts[i + 1]!
    edges.push(kk.makeLineEdge({ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }))
  }
  const w = kk.makeWire(edges)
  for (const e of edges) kk.release(e)
  return w
}

// Both of these are L-shaped, equal length (40) and share their bbox SIZE —
// they differ in where the legs sit, so their `Center()` and their bbox centre
// ORDER differently (see the `>X`/`<X` cases below). This pair is what separates
// a faithful `Center()` port from a bbox-centre shortcut.
const P_PTS = [
  [10, 0],
  [0, 0],
  [0, 2],
  [8, 2],
  [8, 10],
  [10, 10],
  [10, 0],
] as const

const Q_PTS = [
  [0.9, 0],
  [10.9, 0],
  [10.9, 2],
  [2.9, 2],
  [2.9, 10],
  [0.9, 10],
  [0.9, 0],
] as const

describe('kind extraction: Shape.Wires/Shells/Solids/Compounds', () => {
  it('solid plate: 6 wires / 1 shell / 1 solid / 0 compounds / 6 faces', () => {
    const p = plate()
    expect(wiresOf(p).length).toBe(6)
    expect(shells(p).length).toBe(1)
    expect(solids(p).length).toBe(1)
    expect(compounds(p).length).toBe(0)
    expect(facesOf(p).length).toBe(6)
  })

  it('solid plate: every face contributes its own boundary wire', () => {
    expectIdent(wiresOf(plate()), [
      ['wire', 0, 5, 1],
      ['wire', 10, 0, 1],
      ['wire', 10, 5, 0],
      ['wire', 10, 5, 2],
      ['wire', 10, 10, 1],
      ['wire', 20, 5, 1],
    ])
  })

  it('GOTCHA: a FACE carries no shells / solids / compounds — only wires', () => {
    // upstream `_collectProperty` reads the requested property off every stack
    // object: a Face has Wires(), but Shells()/Solids()/Compounds() are all
    // empty, so `Workplane.faces('>Z').solids()` is an EMPTY selection, not the
    // owning solid.
    const f = topFace(plate())
    expect(wiresOf(f).length).toBe(1)
    expect(shells(f).length).toBe(0)
    expect(solids(f).length).toBe(0)
    expect(compounds(f).length).toBe(0)
  })

  it('holed plate: the pierced top face has 3 wires (outer + one per hole)', () => {
    const f = topFace(holedPlate())
    const ws = wiresOf(f)
    expect(ws.length).toBe(3)
    expectIdent(ws, [
      ['wire', 5, 5, 2],
      ['wire', 10, 5, 2],
      ['wire', 14, 5, 2],
    ])
    // lengths: outer rectangle perimeter 60, then the two hole circumferences
    const lens = ws.map((w) => Math.round(lengthOf(w) * 1e6) / 1e6).sort((a, b) => a - b)
    expect(lens).toEqual([expect.closeTo(Math.PI, 6), expect.closeTo(3 * Math.PI, 6), expect.closeTo(60, 6)])
  })

  it('holed plate as a whole: 12 wires (the pierced faces gained a wire each)', () => {
    expect(wiresOf(holedPlate()).length).toBe(12)
  })

  it('compound of two cubes: 2 solids / 2 shells / 12 wires / 12 faces', () => {
    const comp = twoBoxes()
    expect(solids(comp).length).toBe(2)
    expect(shells(comp).length).toBe(2)
    expect(wiresOf(comp).length).toBe(12)
    expect(facesOf(comp).length).toBe(12)
    disposeShape(comp)
  })

  it('GOTCHA: Compounds() of a compound INCLUDES the compound itself', () => {
    // upstream uses a TopExp walk, which yields the top shape when it matches
    // the requested type — so `Workplane.compounds()` on a compound returns 1
    // (the whole thing), while the same call on a solid returns 0.
    const comp = twoBoxes()
    expectIdent(compounds(comp), [['compound', 3, 0.5, 0.5]])
    disposeShape(comp)
  })
})

describe('string selector over wires / shells / solids', () => {
  it('>X over the compound wires picks the x = 6 face wire', () => {
    const sel = new StringSyntaxSelector('>X').filter(wiresOf(twoBoxes()))
    expectIdent(sel, [['wire', 6, 0.5, 0.5]])
  })

  it('>X / <X over the compound solids pick the far / near cube', () => {
    const ss = solids(twoBoxes())
    expectIdent(new StringSyntaxSelector('>X').filter(ss), [['solid', 5.5, 0.5, 0.5]])
    expectIdent(new StringSyntaxSelector('<X').filter(ss), [['solid', 0.5, 0.5, 0.5]])
  })

  it('>X over the holed top-face wires picks the hole at x = 14', () => {
    const sel = new StringSyntaxSelector('>X').filter(wiresOf(topFace(holedPlate())))
    expectIdent(sel, [['wire', 14, 5, 2]])
  })
})

describe('string selector runs on Center(), NOT on the bbox centre', () => {
  it('fixture parity: P and Q are equal-length L wires whose orders disagree', () => {
    const kk = k()
    const P = polygonWire(P_PTS)
    const Q = polygonWire(Q_PTS)
    // lengths identical (both 40) — only the leg placement differs
    expect(lengthOf(P)).toBeCloseTo(40, 6)
    expect(lengthOf(Q)).toBeCloseTo(40, 6)
    // Center() is the LINEAR centre of mass: P leans +X, Q leans −X …
    expectIdent([borrowShape('wire', P), borrowShape('wire', Q)], [
      ['wire', 4.3, 3.4, 0],
      ['wire', 6.6, 3.4, 0],
    ])
    // … while the bbox centres order the OTHER way round (P 5.0 < Q 5.9).
    const bbCentre = (h: ShapeHandle): number => {
      const bb = kk.getBoundingBox(h)
      return (bb.xmin + bb.xmax) / 2
    }
    expect(bbCentre(P)).toBeCloseTo(5, 6)
    expect(bbCentre(Q)).toBeCloseTo(5.9, 6)
    expect(centerOf(P).x).toBeGreaterThan(centerOf(Q).x)
    kk.release(P)
    kk.release(Q)
  })

  it('>X picks P (Center 6.6) even though Q has the larger bbox centre (5.9)', () => {
    const items = [borrowShape('wire', polygonWire(P_PTS)), borrowShape('wire', polygonWire(Q_PTS))]
    expectIdent(new StringSyntaxSelector('>X').filter(items), [['wire', 6.6, 3.4, 0]])
    expectIdent(new StringSyntaxSelector('<X').filter(items), [['wire', 4.3, 3.4, 0]])
  })
})
