/**
 * @vitest-environment node
 *
 * E2 `sketchOnPlane` plane-lift composition tests using a recording kernel, so
 * the lift math is asserted on the exact 3D points handed to the kernel without
 * requiring occt-wasm. The real `cad.sketchOnPlane` op wrapper (F1) is covered
 * by the api-level tests.
 *
 * Run: npx vitest run src/geometry2d/bridge/lift-on-plane.test.ts
 */

import { describe, it, expect } from 'vitest'
import type { Vec3 } from '../../../src/geometry2d/bridge/plane'
import { makePlane, namedPlane, liftPointToPlane, worldToPlane } from '../../../src/geometry2d/bridge/plane'
import { liftCurve2dToPlane, type PlaneWireKernel } from '../../../src/geometry2d/bridge/lift-on-plane'
import { makeLine2d, makeArc2dThreePoints, makeCircle2d } from '../../../src/geometry2d/curve2d'

/** Recording kernel: captures the on-plane points passed to each edge primitive. */
function recordingKernel() {
  const lines: Vec3[] = []
  const arcs: Vec3[] = []
  const circles: { center: Vec3; normal: Vec3; radius: number }[] = []
  const kernel = {
    makeLineEdge(a: Vec3, b: Vec3) {
      lines.push(a, b)
      return { kind: 'line' as const }
    },
    makeArcEdge(a: Vec3, m: Vec3, b: Vec3) {
      arcs.push(a, m, b)
      return { kind: 'arc' as const }
    },
    makeCircleEdge(center: Vec3, normal: Vec3, radius: number) {
      circles.push({ center, normal, radius })
      return { kind: 'circle' as const }
    },
    makeBezierEdge(_pts: Vec3[]) {
      return { kind: 'bezier' as const }
    },
    makeWire(_edges: unknown[]) {
      return { kind: 'wire' as const }
    },
  }
  return {
    /** Typed facade: the string-record mock satisfies the bridge's }Bid contract. */
    k: kernel as unknown as PlaneWireKernel,
    get lines() {
      return lines
    },
    get arcs() {
      return arcs
    },
    get circles() {
      return circles
    },
  }
}

describe('plane frame (E2 basis)', () => {
  it('XY frame maps (1,2) -> (1,2,0)', () => {
    const p = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    expect(liftPointToPlane(p, 1, 2)).toEqual({ x: 1, y: 2, z: 0 })
  })

  it("XZ plane places 2D y into world Z (namedPlane 'XZ': normal -Y)", () => {
    const p = namedPlane('XZ', { x: 0, y: 0, z: 0 })
    // xDir=(1,0,0), zDir=(0,-1,0) -> yDir = zDir x xDir = (0,0,1)
    expect(liftPointToPlane(p, 3, 4)).toEqual({ x: 3, y: 0, z: 4 })
  })

  it('custom oblique plane lifts a unit point to be on-plane (normal-dot=0)', () => {
    const a = 1 / Math.sqrt(2)
    const p = makePlane({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { x: a, y: -a, z: 0 })
    const v = liftPointToPlane(p, 1, 0)
    expect(v.x + v.y + v.z).toBeCloseTo(0, 9)
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6)
  })
})

describe('curves as edges on plane (E2)', () => {
  it('line on a translated XY plane: endpoints reflect the origin', () => {
    const r = recordingKernel()
    const plane = makePlane({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const line = makeLine2d(0, 0, 2, 0)
    const edges = liftCurve2dToPlane(r.k, plane, line)
    expect(edges).toHaveLength(1)
    expect(r.lines.slice(0, 2)).toEqual([
      { x: 1, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ])
  })

  it('full circle on XY: one makeCircleEdge with center/normal/radius (F6 — was two arc halves)', () => {
    const r = recordingKernel()
    const plane = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const circle = makeCircle2d(5, 0, 1, true)
    const edges = liftCurve2dToPlane(r.k, plane, circle)
    expect(edges).toHaveLength(1)
    expect(r.circles).toEqual([{ center: { x: 5, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 1 }])
  })

  it('full circle sense=false flips the normal (CW winding)', () => {
    const r = recordingKernel()
    const plane = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const circle = makeCircle2d(0, 0, 2, false)
    liftCurve2dToPlane(r.k, plane, circle)
    const n = r.circles[0]!.normal
    expect(n.z).toBe(-1)
    expect(n.x).toBeCloseTo(0, 12)
    expect(n.y).toBeCloseTo(0, 12)
    expect(r.circles[0]!.radius).toBe(2)
  })

  it('trimmed arc lifts to an on-plane arc edge (z=0 on XY)', () => {
    const r = recordingKernel()
    const plane = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const arc = makeArc2dThreePoints(1, 0, 0.7071, 0.7071, 0, 1)
    const edges = liftCurve2dToPlane(r.k, plane, arc)
    expect(edges).toHaveLength(1)
    expect(r.arcs).toHaveLength(3)
    expect(r.arcs.map((v) => v.z)).toEqual([0, 0, 0])
  })

  // P2 (2026-09-28, ArchDetail class): a fully-trimmed sketch can carry a
  // ZERO-LENGTH line. makeLineEdge(start, start) is rejected by the OCCT
  // kernel and killed the whole sketchOnPlane call — the lift now skips it.
  it('GOTCHA: zero-length line lifts to NO edge (makeLineEdge(p,p) would abort the kernel)', () => {
    const r = recordingKernel()
    const plane = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const line = makeLine2d(5, 5, 5, 5) // degenerate: start == end
    const edges = liftCurve2dToPlane(r.k, plane, line)
    expect(edges).toEqual([])
    expect(r.lines).toHaveLength(0)
  })
})
describe('worldToPlane — 3D → 2D projection (F2)', () => {
  // worldToPlane is the inverse of liftPointToPlane: orthogonal projection onto
  // the plane's 2D coords. The normal component is dropped, so an off-plane point
  // projects to the foot of the perpendicular (sketch-point-on-face semantics).

  it('XY plane: (3,4,0) -> {u:3, v:4}', () => {
    const p = namedPlane('XY')
    expect(worldToPlane(p, { x: 3, y: 4, z: 0 })).toEqual({ u: 3, v: 4 })
  })

  it('XZ plane: (3,0,4) -> {u:3, v:4} (2D y maps to world Z)', () => {
    const p = namedPlane('XZ')
    expect(worldToPlane(p, { x: 3, y: 0, z: 4 })).toEqual({ u: 3, v: 4 })
  })

  it('translated origin: subtracts the plane origin before projecting', () => {
    const p = makePlane({ x: 10, y: 20, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    expect(worldToPlane(p, { x: 13, y: 24, z: 0 })).toEqual({ u: 3, v: 4 })
  })

  it('roundtrips losslessly: worldToPlane(liftPointToPlane(u,v)) === {u,v}', () => {
    const p = makePlane({ x: 1, y: 2, z: 3 }, { x: 1, y: 1, z: 1 }, { x: 1, y: -1, z: 0 })
    const lifted = liftPointToPlane(p, 7, -5)
    const back = worldToPlane(p, lifted)
    expect(back.u).toBeCloseTo(7, 10)
    expect(back.v).toBeCloseTo(-5, 10)
  })

  it('off-plane point drops the normal component (orthogonal projection)', () => {
    const p = namedPlane('XY') // normal (0,0,1)
    // (3,4,9) is 9 units off the XY plane; projection must ignore z
    expect(worldToPlane(p, { x: 3, y: 4, z: 9 })).toEqual({ u: 3, v: 4 })
  })

  it('accepts the array form [x,y,z] (script literal shape)', () => {
    const p = namedPlane('XY')
    expect(worldToPlane(p, [3, 4, 0])).toEqual({ u: 3, v: 4 })
  })
})