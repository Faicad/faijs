/**
 * E3 `sketchOnFace` on-surface composition tests using a recording kernel, so
 * the UV→surface mapping is asserted on the exact sampled points handed to the
 * kernel without requiring occt-wasm. The `cad.sketchOnFace` op wrapper (F1) is
 * covered by api-level e2e tests.
 *
 * The recording kernel models an infinite flat +Z surface at `z = face`, so the
 * `pointOnSurface(face,u,v)` result is `(u, v, face)` and `uvBounds` reports a
 * known box — letting us assert the exact mapped points the bridge asks for.
 *
 * Run: npx vitest run src/geometry2d/bridge/on-surface.test.ts
 */
import { describe, it, expect } from 'vitest'
import { makeLine2d, makeCircle2d } from '../../../src/geometry2d/curve2d'
import { Blueprint } from '../../../src/geometry2d/blueprint'
import {
  curves2dBounds,
  makeUvMap,
  buildEdgeOnSurface,
  assembleWireOnFace,
  type SurfaceEdgesKernel,
  type FaceScaleMode,
} from '../../../src/geometry2d/bridge/on-surface'

type SurfacePoint = { x: number; y: number; z: number }

/** Recording flat +Z surface at `z=faceZ`; records evaluated points/splines/lines. */
function recordingKernel(faceZ = 0) {
  const points: SurfacePoint[] = []
  const splines: SurfacePoint[][] = []
  const lines: SurfacePoint[] = []
  const bounds = { uMin: 0, uMax: 10, vMin: 0, vMax: 5 }
  const kernel = {
    pointOnSurface(_face: unknown, u: number, v: number): SurfacePoint {
      const p = { x: u, y: v, z: faceZ }
      points.push(p)
      return p
    },
    uvBounds(_face: unknown) {
      return bounds
    },
    interpolatePoints(pts: SurfacePoint[], degree: number) {
      splines.push(pts)
      void degree
      return { kind: 'spline' as const }
    },
    makeLineEdge(a: SurfacePoint, b: SurfacePoint) {
      lines.push(a, b)
      return { kind: 'line' as const }
    },
    makeWire(_edges: unknown[]) {
      return { kind: 'wire' as const }
    },
  }
  return {
    k: kernel as unknown as Pick<
      SurfaceEdgesKernel,
      'pointOnSurface' | 'uvBounds' | 'interpolatePoints' | 'makeLineEdge' | 'makeWire'
    >,
    get points() {
      return points
    },
    get splines() {
      return splines
    },
    get lines() {
      return lines
    },
    get bounds() {
      return bounds
    },
  }
}

describe('curves2dBounds (E3 box)', () => {
  it('a diagonal line samples a tight box', () => {
    const b = curves2dBounds([makeLine2d(0, 0, 4, 4)])
    expect(b.x0).toBeCloseTo(0, 9)
    expect(b.x1).toBeCloseTo(4, 9)
    expect(b.y0).toBeCloseTo(0, 9)
    expect(b.y1).toBeCloseTo(4, 9)
  })

  it('empty curve set yields the origin rect', () => {
    expect(curves2dBounds([])).toEqual({ x0: 0, x1: 0, y0: 0, y1: 0 })
  })
})

describe('makeUvMap (E3 scale modes)', () => {
  const rect = { x0: 0, x1: 4, y0: 0, y1: 4 }
  const bounds = { uMin: 2, uMax: 10, vMin: 1, vMax: 5 }

  it('original is the identity', () => {
    const m = makeUvMap('original', rect, bounds)
    expect(m(3, 7)).toEqual([3, 7])
  })

  it('bounds/native scale the contour box onto the UV bounds, aspect-preserving', () => {
    const m = makeUvMap('bounds', rect, bounds)
    // rect 0..4 in x -> uv 2..10 (scale 2); 0..4 in y -> uv 1..5 (scale 1).
    expect(m(0, 0)).toEqual([2, 1])
    expect(m(4, 4)).toEqual([10, 5])
    expect(m(2, 2)).toEqual([6, 3])
    const n = makeUvMap('native', rect, bounds)
    expect(n(4, 0)).toEqual([10, 1])
  })
})

describe('buildEdgeOnSurface (E3 sample→surface→interpolate)', () => {
  it('a curve collapsing to ≤2 distinct surface points -> makeLineEdge', () => {
    const r = recordingKernel(7)
    const face = { kind: 'face' as const } as unknown as never
    // Every 2D point maps to the single surface coordinate (u=0,v=5) -> 1 distinct point.
    const uv = () => [0, 5] as [number, number]
    const edge = buildEdgeOnSurface(r.k, face, uv, makeLine2d(0, 1, 4, 1), 8)
    expect(edge).toEqual({ kind: 'line' })
    // makeLineEdge(endpoint, endpoint) records both args on the single distinct point.
    expect(r.lines).toEqual([
      { x: 0, y: 5, z: 7 },
      { x: 0, y: 5, z: 7 },
    ])
  })

  it('a curve with many sampled points yields an interpolated spline of mapped surface points', () => {
    const r = recordingKernel(7)
    const face = { kind: 'face' } as unknown as never
    // u = 2x keeps the full circle distinct; every point lies on z=7.
    const uv = (x: number, _y: number) => [x * 2, 0] as [number, number]
    const edge = buildEdgeOnSurface(r.k, face, uv, makeCircle2d(2, 1, 1, true), 6)
    expect(edge).toEqual({ kind: 'spline' })
    expect(r.splines).toHaveLength(1)
    expect(r.splines[0]).toHaveLength(7) // samples+1
    for (const p of r.splines[0]!) {
      expect(p.z).toBe(7) // every mapped point lies on the surface plane z=7
    }
  })
})

describe('assembleWireOnFace (E3 contour→wire)', () => {
  it('assembles a closed square wire on the flat surface (every on-surface point lies on the face plane)', () => {
    const r = recordingKernel(0)
    const face = { kind: 'face' } as unknown as never
    const bp = new Blueprint([
      makeLine2d(0, 0, 4, 0),
      makeLine2d(4, 0, 4, 4),
      makeLine2d(4, 4, 0, 4),
      makeLine2d(0, 4, 0, 0),
    ])
    const mode: FaceScaleMode = 'original'
    const { wire, uv } = assembleWireOnFace(r.k, face, mode, bp, 4)
    expect(wire).toEqual({ kind: 'wire' })
    // original mode: uv identity -> 2D coords read straight as (u,v).
    expect(uv(1, 2)).toEqual([1, 2])
    // 4 edges, each interpolated into a spline of 5 sampled points on the plane z=0.
    expect(r.splines).toHaveLength(4)
    for (const pts of r.splines) {
      expect(pts.every((p) => Math.abs(p.z - 0) < 1e-9)).toBe(true)
    }
  })
})