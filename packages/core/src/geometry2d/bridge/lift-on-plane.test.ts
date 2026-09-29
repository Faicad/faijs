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
import type { Vec3 } from './plane'
import { makePlane, namedPlane, liftPointToPlane } from './plane'
import { liftCurve2dToPlane, type PlaneWireKernel } from './lift-on-plane'
import { makeLine2d, makeArc2dThreePoints, makeCircle2d } from '../curve2d'

/** Recording kernel: captures the on-plane points passed to each edge primitive. */
function recordingKernel() {
  const lines: Vec3[] = []
  const arcs: Vec3[] = []
  const kernel = {
    makeLineEdge(a: Vec3, b: Vec3) {
      lines.push(a, b)
      return { kind: 'line' as const }
    },
    makeArcEdge(a: Vec3, m: Vec3, b: Vec3) {
      arcs.push(a, m, b)
      return { kind: 'arc' as const }
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

  it('full circle on XY: two makeArcEdge halves with finite on-plane points', () => {
    const r = recordingKernel()
    const plane = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const circle = makeCircle2d(5, 0, 1, true)
    const edges = liftCurve2dToPlane(r.k, plane, circle)
    expect(edges).toHaveLength(2)
    expect(r.arcs).toHaveLength(6)
    expect(r.arcs.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))).toBe(true)
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