/**
 * P4 acceptance — vertex selectors + per-level narrowing (plan D2/D3).
 *
 * "Probes" the cross-kind narrowing chain on a unit centred cube through the
 * faijs selector engine (the same `resolveSelection`/`resolveVertexSelection`
 * that `Workplane.vertices()/faces()/edges()` + `eachpoint` route through).
 *
 * These are pure-behavior assertions that do NOT depend on a CadQuery ref
 * environment; expected values are locked to cadquery 2.8.0 on `box(1,1,1)`
 * (probe ground truth `sel_probe_out.txt`).
 *
 * 内核：setupNativeKernel() 绑定 vendored brepjs 内核（同 selectors 引擎路径）。
 */
import { describe, it, beforeAll, expect } from 'vitest'
import * as cq from './index'
import { setupNativeKernel, kernel, brepOf, bbox } from './gear-test-harness'
import {
  resolveVertexSelection,
  resolveSelection,
  type SelStep,
} from '@faicad/faijs/api/cadquery-selectors'

/** Vertex.Center() = the vertex itself (cadquery shapes.py:1973). */
function vpos(h: unknown): [number, number, number] {
  const p = kernel().vertexPosition(h as never) as { x: number; y: number; z: number }
  return [p.x, p.y, p.z]
}

function sortPts(pts: Array<[number, number, number]>): Array<[number, number, number]> {
  return [...pts].sort((a, b) => (a.join(',') < b.join(',') ? -1 : a.join(',') > b.join(',') ? 1 : 0))
}

let cube: ReturnType<typeof cq.val>

// The engine's `resolveSelection` takes the raw kernel handle (numeric id),
// not a faijs `Shape`; `brepOf` extracts it (same handle space the engine's
// `getKernel()` singletons use). `as never` sidesteps the branded ShapeHandle.
function cubeH(): never {
  return brepOf(cube as never) as never
}

beforeAll(async () => {
  await setupNativeKernel()
  // box(1,1,1) centred at origin, +Z up — same fixture as the probe.
  const wp = await cq.box(await cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, true] })
  cube = await cq.val(wp)
})

function vertsFor(sel: string): Array<[number, number, number]> {
  return resolveVertexSelection(cube as never, sel).map(vpos)
}

describe('vertex selectors (BaseDirSelector drops vertices; Nth / Center run on the point itself)', () => {
  it('>Z selects the 4 top vertices (z = +0.5)', () => {
    // DirectionMinMaxSelector((0,0,1), max) → 4 vertices at z=+0.5.
    expect(sortPts(vertsFor('>Z'))).toEqual([
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
    ])
  })
  it('X / +Z / |Z / #Z all yield 0 (BaseDirSelector drops non-face/edge)', () => {
    // selectors.py:176-184 — skip everything that isn't a PLANE face or LINE edge.
    for (const sel of ['X', '+Z', '|Z', '#Z']) {
      expect(vertsFor(sel)).toEqual([])
    }
  })
  it('>Z[1] throws (DirectionNthSelector parallel-prefilter empties the set)', () => {
    // GOTCHA: `>A[k]` is DirectionNthSelector = parallel pre-filter then
    // _NthSelector.filter. The pre-filter drops every vertex → ValueError,
    // NOT 4 vertices.
    expect(() => resolveVertexSelection(cube as never, '>Z[1]')).toThrow()
  })
  it('>>Z selects the top 4 (CenterNthSelector(-1, max) has no pre-filter)', () => {
    expect(sortPts(vertsFor('>>Z'))).toEqual([
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
    ])
  })
})

describe('per-level narrowing (plan D3: next step sees only the previous result)', () => {
  it('.faces("+Z").vertices("<XY") → the single (-0.5,-0.5,0.5) corner', () => {
    // plan §5.5.3 C5: x+y smallest among the +Z face's 4 corners.
    // Corners: (±0.5,±0.5,0.5); min x+y = -0.5-0.5 = -1 → (-0.5,-0.5,0.5).
    const chain: SelStep[] = [
      { kind: 'face', sel: '+Z' },
      { kind: 'vertex', sel: '<XY' },
    ]
    const hits = resolveSelection(cubeH(), chain).handles.map(vpos)
    expect(hits).toEqual([[-0.5, -0.5, 0.5]])
  })
  it('whole-cube ".vertices(\\"<XY\\")" is NOT the narrowed single corner', () => {
    // Whole-cube "<XY": x+y ties across both z-columns → differs from the
    // narrowed top-face single corner. Confirms the chain candidate-set
    // actually narrowed.
    const wholeHits = resolveSelection(cubeH(), [{ kind: 'vertex', sel: '<XY' }]).handles.map(vpos)
    expect(wholeHits).not.toEqual([[-0.5, -0.5, 0.5]])
  })
  it('.faces("|Z").vertices() has 8 vertices (dedup, not 12)', () => {
    // C2/C4: faces("|Z") (top+bottom) → union has 8 corners, deduped once each.
    const chain: SelStep[] = [
      { kind: 'face', sel: '|Z' },
      { kind: 'vertex', sel: '' },
    ]
    const sel = resolveSelection(cubeH(), chain)
    expect(sel.handles.length).toBe(8)
  })
})

describe('eachpoint consumes the narrowing chain through the Workplane (plan D3)', () => {
  it('axes the selChain is carried and extended step-by-step', async () => {
    let wp = await cq.box(await cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, true] })
    wp = await cq.faces(wp, '|Z')
    expect(wp.selChain).toEqual([{ kind: 'face', sel: '|Z' }])
    wp = await cq.vertices(wp, '<XY')
    expect(wp.selChain).toEqual([
      { kind: 'face', sel: '|Z' },
      { kind: 'vertex', sel: '<XY' },
    ])
  })
  it('.faces("|Z").each(…)) places a part at BOTH planar faces (not the silent shape centre)', async () => {
    // plan §2.1 flag: legacy resolveFaceSelector returned the shape centre for
    // `|Z`; the chain resolves it to the two planar faces → cube 1×1×1 plus two
    // 0.1³ bumps at z=±0.5 → bbox ×1×1×1.1.
    const base = await cq.box(await cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, true] })
    const bump = await cq.box(await cq.Workplane('XY'), 0.1, 0.1, 0.1, { centered: [true, true, true] })
    const faceWp = await cq.faces(base, '|Z')
    const out = await cq.eachpoint(faceWp, bump)
    const b = bbox(out.shape as never)
    expect(b.zmax - b.zmin).toBeCloseTo(1.1, 5)
    expect(b.xmax - b.xmin).toBeCloseTo(1, 5)
  })
})