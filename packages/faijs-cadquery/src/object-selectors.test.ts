/**
 * Object selector class parity — CadQuery 2.8.0 `selectors.py` object
 * selectors (audit §3.3 "C 类 · 对象选择器类", priority P4).
 *
 * Every expectation below is FROZEN from a ONE-SHOT CadQuery 2.8.0 reference
 * capture (`tests/ref-harness/object-selectors-probe.py`, not part of CI — see
 * docs/plans/2026-10-02-cadquery-port-gap-audit.md §5.1). The captured values
 * are hard-coded here; the fixture geometry is rebuilt with the faijs kernel so
 * the selectors recompute the same numbers and the assertions compare.
 *
 * Selections are in-process sub-shape references: no STEP comparison can ever
 * see them, which is exactly why this gap stayed silent. Behaviour that looks
 * like a bug but is upstream's real semantics is marked `GOTCHA:`.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import type { CqShape } from './shape-class'
import { borrowShape, centerOf, shapeTypeOf } from './shape-class'
import {
  AndSelector,
  AreaNthSelector,
  BoxSelector,
  CenterNthSelector,
  InverseSelector,
  LengthNthSelector,
  NearestToShapeSelector,
  RadiusNthSelector,
  SubtractSelector,
  SumSelector,
} from './object-selectors'

beforeAll(async () => {
  await setupNativeKernel()
})

function k(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** Frozen-selection row: (shape type, centre x, y, z) — mirrors the probe's `ident()`. */
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

/** 20×10×2 box with a corner at the origin (matches occt-wasm makeBox). */
function plate(): ShapeHandle {
  return k().makeBox(20, 10, 2)
}

function faces(h: ShapeHandle): CqShape[] {
  return k()
    .getSubShapes(h, 'face')
    .map((f) => borrowShape('face', f))
}

function edges(h: ShapeHandle): CqShape[] {
  return k()
    .getSubShapes(h, 'edge')
    .map((e) => borrowShape('edge', e))
}

/**
 * The plate's 8 corner vertices, built explicitly with `makeVertex`.
 *
 * GOTCHA (kernel, not faijs): `getSubShapes(shape, 'vertex')` is NOT reliable
 * as a test fixture source — it succeeds when this spec runs alone but throws
 * `OcctError: getSubShapes: Cannot read properties of undefined (reading
 * 'OcctKernel')` for every call when the whole package suite runs in parallel
 * (9/43 failures, same message every time; `face`/`edge` extraction in the same
 * process keeps working). The corners of a box are known a priori, so the
 * fixture is constructed directly instead — same geometry, no dependency on
 * that path. (`workplane.ts` uses the same extraction call and is exposed to
 * the same fragility; recorded, not fixed here.)
 */
function plateVertices(): CqShape[] {
  const kk = k()
  const out: CqShape[] = []
  for (const x of [0, 20]) {
    for (const y of [0, 10]) {
      for (const z of [0, 2]) out.push(borrowShape('vertex', kk.makeVertex(x, y, z)))
    }
  }
  return out
}

/** Circle edges of radius 1 / 2 / 3 centred on the X axis at x = 0 / 10 / 20. */
function circles(): CqShape[] {
  const kk = k()
  const z = { x: 0, y: 0, z: 1 }
  return [1, 2, 3].map((r, i) =>
    borrowShape('edge', kk.makeCircleEdge({ x: i * 10, y: 0, z: 0 }, z, r)),
  )
}

/** The 20×10×2 plate with two through-holes (r = 0.5 at (5,5), r = 1.5 at (14,5)). */
function holedPlate(): ShapeHandle {
  const kk = k()
  const p = kk.makeBox(20, 10, 2)
  const cyl1 = kk.translate(kk.makeCylinder(0.5, 4), 5, 5, -1)
  const cyl2 = kk.translate(kk.makeCylinder(1.5, 4), 14, 5, -1)
  return kk.cut(kk.cut(p, cyl1), cyl2)
}

/** The plate's 8 corners as captured by the probe (probe: fixture.plate.vertexCenters). */
const PLATE_VERTICES: readonly Row[] = [
  ['vertex', 0, 0, 0],
  ['vertex', 0, 0, 2],
  ['vertex', 0, 10, 0],
  ['vertex', 0, 10, 2],
  ['vertex', 20, 0, 0],
  ['vertex', 20, 0, 2],
  ['vertex', 20, 10, 0],
  ['vertex', 20, 10, 2],
]

describe('fixture parity (geometry must match the Python capture)', () => {
  it('plate: bbox [0,20]×[0,10]×[0,2], 6 faces / 12 edges / 8 corners', () => {
    const p = plate()
    const bb = k().getBoundingBox(p)
    expect([bb.xmin, bb.xmax, bb.ymin, bb.ymax, bb.zmin, bb.zmax]).toEqual([0, 20, 0, 10, 0, 2])
    expect(faces(p).length).toBe(6)
    expect(edges(p).length).toBe(12)
    expectIdent(plateVertices(), PLATE_VERTICES)
  })

  it('plate: face areas 20/20/40/40/200/200 and edge lengths 2×4/10×4/20×4', () => {
    const p = plate()
    const kk = k()
    expect(
      faces(p)
        .map((f) => Math.round(kk.getSurfaceArea(f.handle) * 1e7) / 1e7)
        .sort((a, b) => a - b),
    ).toEqual([20, 20, 40, 40, 200, 200])
    expect(
      edges(p)
        .map((e) => Math.round(kk.curveLength(e.handle) * 1e7) / 1e7)
        .sort((a, b) => a - b),
    ).toEqual([2, 2, 2, 2, 10, 10, 10, 10, 20, 20, 20, 20])
  })

  it('circles: radii 1/2/3 and lengths 2π/4π/6π', () => {
    const kk = k()
    const cs = circles()
    expect(cs.map((c) => kk.curveLength(c.handle))).toEqual([
      expect.closeTo(2 * Math.PI, 6),
      expect.closeTo(4 * Math.PI, 6),
      expect.closeTo(6 * Math.PI, 6),
    ])
    expectIdent(cs, [
      ['edge', 0, 0, 0],
      ['edge', 10, 0, 0],
      ['edge', 20, 0, 0],
    ])
  })

  it('holed plate: volume 384.2920367 and 4 circular rim edges (0.5/0.5/1.5/1.5)', () => {
    const h = holedPlate()
    const kk = k()
    expect(kk.getVolume(h)).toBeCloseTo(384.2920367, 6)
    const rims = edges(h).filter((e) => kk.curveType(e.handle) === 'circle')
    expect(rims.length).toBe(4)
    expectIdent(rims, [
      ['edge', 5, 5, 0],
      ['edge', 5, 5, 2],
      ['edge', 14, 5, 0],
      ['edge', 14, 5, 2],
    ])
  })
})

describe('LengthNthSelector parity', () => {
  it('n=0 → the four length-2 edges', () => {
    expectIdent(new LengthNthSelector(0).filter(edges(plate())), [
      ['edge', 0, 0, 1],
      ['edge', 0, 10, 1],
      ['edge', 20, 0, 1],
      ['edge', 20, 10, 1],
    ])
  })

  it('n=1 → the four length-10 edges', () => {
    expectIdent(new LengthNthSelector(1).filter(edges(plate())), [
      ['edge', 0, 5, 0],
      ['edge', 0, 5, 2],
      ['edge', 20, 5, 0],
      ['edge', 20, 5, 2],
    ])
  })

  it('n=-1 and n=0 with directionMax=false → the four length-20 edges', () => {
    const expected: Row[] = [
      ['edge', 10, 0, 0],
      ['edge', 10, 0, 2],
      ['edge', 10, 10, 0],
      ['edge', 10, 10, 2],
    ]
    expectIdent(new LengthNthSelector(-1).filter(edges(plate())), expected)
    expectIdent(new LengthNthSelector(0, false).filter(edges(plate())), expected)
  })

  // GOTCHA: only 3 clusters exist, so n=3 raises — upstream's IndexError.
  it('n=3 raises (only 3 length clusters)', () => {
    expect(() => new LengthNthSelector(3).filter(edges(plate()))).toThrow(
      /Attempted to access index 3 of a list with length 3/,
    )
  })

  // GOTCHA: faces have no Length() — every candidate is dropped, and upstream
  // then indexes an empty cluster list, so it RAISES (it does not return []).
  it('faces raise (no candidate survives the key)', () => {
    expect(() => new LengthNthSelector(0).filter(faces(plate()))).toThrow(/empty list/)
  })

  it('an empty candidate list raises', () => {
    expect(() => new LengthNthSelector(0).filter([])).toThrow(/Can not return the Nth element of an empty list/)
  })
})

describe('AreaNthSelector parity', () => {
  it('n=0 → the two 20-area end faces', () => {
    expectIdent(new AreaNthSelector(0).filter(faces(plate())), [
      ['face', 0, 5, 1],
      ['face', 20, 5, 1],
    ])
  })

  it('n=1 → the two 40-area side faces', () => {
    expectIdent(new AreaNthSelector(1).filter(faces(plate())), [
      ['face', 10, 0, 1],
      ['face', 10, 10, 1],
    ])
  })

  it('n=2 and n=-1 → the two 200-area top/bottom faces', () => {
    const expected: Row[] = [
      ['face', 10, 5, 0],
      ['face', 10, 5, 2],
    ]
    expectIdent(new AreaNthSelector(2).filter(faces(plate())), expected)
    expectIdent(new AreaNthSelector(-1).filter(faces(plate())), expected)
  })

  // GOTCHA: edges are not faces/shells/solids and are not closed planar wires,
  // so every candidate is dropped → raises (same path as LengthNth on faces).
  it('edges raise (an open edge has no area)', () => {
    expect(() => new AreaNthSelector(0).filter(edges(plate()))).toThrow(/empty list/)
  })
})

describe('CenterNthSelector parity', () => {
  it('faces along +X: n=0 → the -X face, n=-1 → the +X face', () => {
    const fs = faces(plate())
    expectIdent(new CenterNthSelector({ x: 1, y: 0, z: 0 }, 0).filter(fs), [['face', 0, 5, 1]])
    expectIdent(new CenterNthSelector({ x: 1, y: 0, z: 0 }, -1).filter(fs), [['face', 20, 5, 1]])
  })

  it('faces along +X: n=1 → the four faces at x-centre 10', () => {
    expectIdent(new CenterNthSelector({ x: 1, y: 0, z: 0 }, 1).filter(faces(plate())), [
      ['face', 10, 0, 1],
      ['face', 10, 5, 0],
      ['face', 10, 5, 2],
      ['face', 10, 10, 1],
    ])
  })

  it('directionMax=false reverses the cluster order', () => {
    expectIdent(new CenterNthSelector({ x: 1, y: 0, z: 0 }, 0, false).filter(faces(plate())), [
      ['face', 20, 5, 1],
    ])
  })

  it('faces along +Z: n=0 → the bottom face, n=-1 → the top face', () => {
    const fs = faces(plate())
    expectIdent(new CenterNthSelector({ x: 0, y: 0, z: 1 }, 0).filter(fs), [['face', 10, 5, 0]])
    expectIdent(new CenterNthSelector({ x: 0, y: 0, z: 1 }, -1).filter(fs), [['face', 10, 5, 2]])
  })

  it('the direction is NOT normalised (2·X keeps the same clusters)', () => {
    expectIdent(new CenterNthSelector({ x: 2, y: 0, z: 0 }, 1).filter(faces(plate())), [
      ['face', 10, 0, 1],
      ['face', 10, 5, 0],
      ['face', 10, 5, 2],
      ['face', 10, 10, 1],
    ])
  })

  it('vertices along (1,1,0): n=0 → x=y=0, n=-1 → x=20,y=10', () => {
    const vs = plateVertices()
    expectIdent(new CenterNthSelector({ x: 1, y: 1, z: 0 }, 0).filter(vs), [
      ['vertex', 0, 0, 0],
      ['vertex', 0, 0, 2],
    ])
    expectIdent(new CenterNthSelector({ x: 1, y: 1, z: 0 }, -1).filter(vs), [
      ['vertex', 20, 10, 0],
      ['vertex', 20, 10, 2],
    ])
  })
})

describe('BoxSelector parity', () => {
  it('centre mode on vertices: the corner order is irrelevant (XOR test)', () => {
    const vs = plateVertices()
    const expected: Row[] = [['vertex', 0, 0, 0]]
    expectIdent(new BoxSelector({ x: 0, y: 0, z: 0 }, { x: 10, y: 5, z: 1 }).filter(vs), expected)
    expectIdent(new BoxSelector({ x: 10, y: 5, z: 1 }, { x: 0, y: 0, z: 0 }).filter(vs), expected)
  })

  it('centre mode: a box that spans two z levels keeps both', () => {
    expectIdent(new BoxSelector({ x: -1, y: -1, z: -1 }, { x: 10, y: 5, z: 3 }).filter(plateVertices()), [
      ['vertex', 0, 0, 0],
      ['vertex', 0, 0, 2],
    ])
  })

  it('centre mode: a box around everything keeps all 8 vertices', () => {
    const got = new BoxSelector({ x: -1, y: -1, z: -1 }, { x: 21, y: 11, z: 3 }).filter(plateVertices())
    expect(got.length).toBe(8)
  })

  it('centre mode on faces: the -X face is inside (0,0,0)-(10,10,2), the +X one is not', () => {
    expectIdent(new BoxSelector({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 2 }).filter(faces(plate())), [
      ['face', 0, 5, 1],
    ])
  })

  // GOTCHA: boundingbox mode needs BOTH bbox corners strictly inside, so an
  // EXACT-fit box around the plate selects nothing at all.
  it('boundingbox mode: an exact-fit box selects nothing', () => {
    expect(new BoxSelector({ x: 0, y: 0, z: 0 }, { x: 20, y: 10, z: 2 }, true).filter(faces(plate()))).toEqual([])
  })

  it('boundingbox mode: a padded box around the plate selects all 6 faces', () => {
    const got = new BoxSelector(
      { x: -1e-3, y: -1e-3, z: -1e-3 },
      { x: 20 + 1e-3, y: 10 + 1e-3, z: 2 + 1e-3 },
      true,
    ).filter(faces(plate()))
    expect(got.length).toBe(6)
  })

  it('boundingbox mode: a half-width box keeps only the -X face', () => {
    expectIdent(
      new BoxSelector({ x: -1e-3, y: -1e-3, z: -1e-3 }, { x: 10 + 1e-3, y: 10 + 1e-3, z: 2 + 1e-3 }, true).filter(
        faces(plate()),
      ),
      [['face', 0, 5, 1]],
    )
  })

  it('boundingbox mode on a degenerate (vertex) bbox behaves like centre mode', () => {
    expectIdent(new BoxSelector({ x: 0, y: 0, z: 0 }, { x: 10, y: 5, z: 1 }, true).filter(plateVertices()), [
      ['vertex', 0, 0, 0],
    ])
  })
})

describe('RadiusNthSelector parity', () => {
  it('n=0/1/-1 → radius 1 / 2 / 3', () => {
    const cs = circles()
    expectIdent(new RadiusNthSelector(0).filter(cs), [['edge', 0, 0, 0]])
    expectIdent(new RadiusNthSelector(1).filter(cs), [['edge', 10, 0, 0]])
    expectIdent(new RadiusNthSelector(-1).filter(cs), [['edge', 20, 0, 0]])
  })

  it('directionMax=false → the largest radius first', () => {
    expectIdent(new RadiusNthSelector(0, false).filter(circles()), [['edge', 20, 0, 0]])
  })

  // GOTCHA: a straight edge has no circle radius — it is DROPPED, not failed.
  it('a straight edge is dropped (not an error) when others survive', () => {
    const kk = k()
    const line = borrowShape('edge', kk.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }))
    expectIdent(new RadiusNthSelector(-1).filter([...circles(), line]), [['edge', 20, 0, 0]])
  })

  it('only a straight edge → every candidate dropped → raises', () => {
    const kk = k()
    const line = borrowShape('edge', kk.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }))
    expect(() => new RadiusNthSelector(0).filter([line])).toThrow(/empty list/)
  })

  it('faces raise (a face has no circle radius)', () => {
    expect(() => new RadiusNthSelector(0).filter(faces(plate()))).toThrow(/empty list/)
  })

  it('realistic usage: the rim edges of two through-holes (0.5 and 1.5)', () => {
    const rims = edges(holedPlate()).filter((e) => k().curveType(e.handle) === 'circle')
    expectIdent(new RadiusNthSelector(0).filter(rims), [
      ['edge', 5, 5, 0],
      ['edge', 5, 5, 2],
    ])
    expectIdent(new RadiusNthSelector(-1).filter(rims), [
      ['edge', 14, 5, 0],
      ['edge', 14, 5, 2],
    ])
  })
})

describe('NearestToShapeSelector parity', () => {
  it('the nearer of two solids wins regardless of input order', () => {
    const kk = k()
    const ref = kk.makeBox(1, 1, 1)
    const near = borrowShape('solid', kk.translate(kk.makeBox(1, 1, 1), 5, 0, 0))
    const far = borrowShape('solid', kk.translate(kk.makeBox(1, 1, 1), 12, 0, 0))
    const expected: Row[] = [['solid', 5.5, 0.5, 0.5]]
    expectIdent(new NearestToShapeSelector(ref).filter([far, near]), expected)
    expectIdent(new NearestToShapeSelector(ref).filter([near, far]), expected)
  })

  it('distances are the true minimum (4 and 11), not centre-to-centre', () => {
    const kk = k()
    const ref = kk.makeBox(1, 1, 1)
    const near = kk.translate(kk.makeBox(1, 1, 1), 5, 0, 0)
    const far = kk.translate(kk.makeBox(1, 1, 1), 12, 0, 0)
    expect(kk.distanceBetween(ref, near)).toBeCloseTo(4, 6)
    expect(kk.distanceBetween(ref, far)).toBeCloseTo(11, 6)
  })

  it('vertices: the closest one wins', () => {
    const kk = k()
    const ref = borrowShape('vertex', kk.makeVertex(0, 0, 0))
    const items = [7, 2, 5].map((x) => borrowShape('vertex', kk.makeVertex(x, 0, 0)))
    expectIdent(new NearestToShapeSelector(ref).filter(items), [['vertex', 2, 0, 0]])
  })

  it('faces: the -X face is nearest to (-10, 5, 1)', () => {
    const kk = k()
    const ref = borrowShape('vertex', kk.makeVertex(-10, 5, 1))
    expectIdent(new NearestToShapeSelector(ref).filter(faces(plate())), [['face', 0, 5, 1]])
  })

  it('an empty candidate list raises', () => {
    const ref = borrowShape('solid', k().makeBox(1, 1, 1))
    expect(() => new NearestToShapeSelector(ref).filter([])).toThrow(/empty list/)
  })
})

describe('binary selector parity (And / Sum / Subtract / Inverse)', () => {
  const all = () => plateVertices()
  const lowBox = () => new BoxSelector({ x: 0, y: 0, z: 0 }, { x: 10, y: 5, z: 1 })
  const highBox = () => new BoxSelector({ x: 15, y: 6, z: 1.5 }, { x: 21, y: 11, z: 3 })
  const everything = () => new BoxSelector({ x: -1, y: -1, z: -1 }, { x: 21, y: 11, z: 3 })

  it('Sum: the union of two disjoint boxes', () => {
    expectIdent(new SumSelector(lowBox(), highBox()).filter(all()), [
      ['vertex', 0, 0, 0],
      ['vertex', 20, 10, 2],
    ])
  })

  it('And: the intersection of a wide box with a narrow one', () => {
    expectIdent(new AndSelector(everything(), lowBox()).filter(all()), [['vertex', 0, 0, 0]])
  })

  it('Subtract: everything except the narrow box', () => {
    expectIdent(new SubtractSelector(everything(), lowBox()).filter(all()), [
      ['vertex', 0, 0, 2],
      ['vertex', 0, 10, 0],
      ['vertex', 0, 10, 2],
      ['vertex', 20, 0, 0],
      ['vertex', 20, 0, 2],
      ['vertex', 20, 10, 0],
      ['vertex', 20, 10, 2],
    ])
  })

  it('Inverse: everything except the bottom face', () => {
    const bottom = new CenterNthSelector({ x: 0, y: 0, z: 1 }, 0)
    const expected: Row[] = [
      ['face', 0, 5, 1],
      ['face', 10, 0, 1],
      ['face', 10, 5, 2],
      ['face', 10, 10, 1],
      ['face', 20, 5, 1],
    ]
    expectIdent(new InverseSelector(bottom).filter(faces(plate())), expected)
    expectIdent(new SubtractSelector(everything(), bottom).filter(faces(plate())), expected)
  })
})
