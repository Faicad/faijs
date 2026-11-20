/**
 * @vitest-environment node
 *
 * Near-degenerate cone preservation in `revolveVec` (occt-kernel).
 *
 * Root cause (fcstd-port ISO4762 corpus parity, 2026-11-13): modern OCCT's
 * revolve sweep canonicalizes profile slant lines with tiny slope (the
 * Fasteners 0.001 sliver `(4.999,0)->(5,-138)`, slope 7.2e-6 rad) into a
 * lossy/inconsistent cylinder face — FreeCAD 1.1 stock OCCT collapses
 * identically, while the corpus truth (.brp saved by FreeCAD 0.15 / old
 * OCCT) carries the exact cone. `repairDegenerateRevolve` re-derives the
 * exact frustum via wire surgery + `makeCone` + fuse.
 *
 * Exact references:
 *  - minimal trapezoid: frustum(4.999→5, h=138) + cyl(r=5, h=22)
 *    = π·(138/3)·(4.999² + 4.999·5 + 25) + π·25·22 = 12564.2031…
 *  - real ISO4762 M10 screw profile: truth Revolve volume 15328.403620
 *    (probe-validated delta 3.6e-7, test/probe-revolve-s006.ts)
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { initOcctWasm, getKernel } from '../../src/occt-kernel/occtKernel'
import { createOcctPrimitives } from '../../src/occt-kernel/occt-primitives'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle, BrepVec3 } from '../../src/brep/engine/types'

/** L1 adapter under test — carries the repair inside revolveVec. */
let api: BrepEngineApi
/** raw kernel — probe-style face construction; handles are number-compatible. */
let raw: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  api = await createOcctPrimitives()
  raw = getKernel() as unknown as OcctKernel
}, 120000)

const ORIGIN: BrepVec3 = { x: 0, y: 0, z: 0 }
const Z: BrepVec3 = { x: 0, y: 0, z: 1 }
const asH = (h: ShapeHandle): BrepHandle => h as unknown as BrepHandle
/** BrepHandle → ShapeHandle (reverse brand cast for raw kernel calls). */
const asS = (h: BrepHandle): ShapeHandle => h as unknown as ShapeHandle

/** Face from an XZ-plane point list (x=0 plane), closed by line edges. */
const xzFace = (pts: [number, number, number][]): ShapeHandle => {
  const verts = pts.map((p) => raw.makeVertex(p[0], p[1], p[2]))
  const edges: ShapeHandle[] = []
  for (let i = 0; i < verts.length; i++) {
    edges.push(raw.makeEdge(verts[i]!, verts[(i + 1) % verts.length]!))
  }
  return raw.makeFace(raw.makeWire(edges))
}

const surfaceTypeCounts = (solid: ShapeHandle): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const f of raw.getSubShapes(solid, 'face')) {
    const t = raw.surfaceType(f)
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return counts
}

describe('revolveVec near-degenerate cone preservation', () => {
  it('minimal trapezoid: sliver slant revolves to the exact frustum (probe-validated)', () => {
    // profile: (4.999,0) -> (5,-138) [degenerate slant] -> (5,-160) -> (0,-160) -> (0,0)
    const face = xzFace([
      [0, 4.999, 0],
      [0, 5, -138],
      [0, 5, -160],
      [0, 0, -160],
      [0, 0, 0],
    ])
    const solid = api.revolveVec(asH(face), ORIGIN, Z, 360)
    const exact = Math.PI * (138 / 3) * (4.999 * 4.999 + 4.999 * 5 + 25) + Math.PI * 25 * 22
    // GOTCHA: without the repair OCCT collapses the sliver to a cylinder
    // (volume 12562.4000385…, off by ~1.8) — the tolerance below only holds
    // with the exact frustum in the result.
    expect(raw.getVolume(asS(solid))).toBeCloseTo(exact, 6)
    const counts = surfaceTypeCounts(asS(solid))
    expect(counts.get('cone')).toBe(1)
    expect(counts.get('cylinder')).toBe(1)
  })

  it('real ISO4762 M10 profile (arc + sliver): matches saved corpus truth 15328.403620', () => {
    // global coords: sketch local (x, y) -> global (0, x, y); revolve around Z
    const v = (y: number, z: number): ShapeHandle => raw.makeVertex(0, y, z)
    const pSlantTop = v(4.999, 0) // degenerate slant start
    const pFar = v(5, -138) // slant end (max radius station)
    const arcStart = v(8, 9.97229)
    const arcMid = v(7.97229 + 0.02771 * Math.SQRT1_2, 9.97229 + 0.02771 * Math.SQRT1_2)
    const arcEnd = v(7.97229, 10)

    const wire = raw.makeWire([
      raw.makeEdge(pSlantTop, pFar), // the 0.001 sliver
      raw.makeEdge(pFar, v(5, -168.5)), // shank
      raw.makeEdge(v(5, -168.5), v(3.5, -170)), // chamfer (healthy cone)
      raw.makeEdge(v(3.5, -170), v(0, -170)), // tip
      raw.makeEdge(v(0, -170), v(0, 10)), // axis
      raw.makeEdge(v(0, 10), arcEnd), // head top
      raw.makeArcEdge(raw.vertexPosition(arcStart), raw.vertexPosition(arcMid), raw.vertexPosition(arcEnd)), // head fillet arc
      raw.makeEdge(arcStart, v(8, 0)), // head side
      raw.makeEdge(v(8, 0), pSlantTop), // head bottom
    ])
    const face = raw.makeFace(wire)

    const solid = api.revolveVec(asH(face), ORIGIN, Z, 360)
    // truth: volume of the Revolve solid saved in the corpus .fcstd (brp)
    expect(raw.getVolume(asS(solid))).toBeCloseTo(15328.40362, 5)
    // truth face set: cone×2 (sliver frustum + chamfer), cyl×2, torus×1 (fillet)
    const counts = surfaceTypeCounts(asS(solid))
    expect(counts.get('cone')).toBe(2)
    expect(counts.get('torus')).toBe(1)
    expect(counts.get('cylinder')).toBe(2)
  })

  it('healthy cone (slope above SLOPE_TOL) takes the plain sweep and stays exact', () => {
    // (5,0) -> (6,10): slope 0.1 rad ≫ 1e-3 — the repair must not engage.
    const face = xzFace([
      [0, 5, 0],
      [0, 6, 10],
      [0, 5, 10],
    ])
    const solid = api.revolveVec(asH(face), ORIGIN, Z, 360)
    // Pappus: A = 5, x̄ = 16/3 → V = 2π·5·16/3 = 160π/3
    expect(raw.getVolume(asS(solid))).toBeCloseTo((160 * Math.PI) / 3, 6)
  })

  it('partial angle (<360°) is never repaired: exact plain-sweep passthrough', () => {
    const face = xzFace([
      [0, 4.999, 0],
      [0, 5, -138],
      [0, 5, -160],
      [0, 0, -160],
      [0, 0, 0],
    ])
    // 180°: gate rejects (full-revolution only) → identical to the raw sweep.
    const half = api.revolveVec(asH(face), ORIGIN, Z, 180)
    const plain = raw.revolve(face, { point: ORIGIN, direction: Z }, Math.PI)
    expect(raw.getVolume(asS(half))).toBeCloseTo(raw.getVolume(plain), 9)
    // sanity: a half revolve of the full profile is roughly half the solid
    expect(raw.getVolume(asS(half))).toBeGreaterThan(6000)
  })

  it('solver-noise cylinder lines (|Δr| below MIN_DR) never trigger the repair', () => {
    // Regression (fcstd-port s034/s037, ISO4762 M5x12/M5x80): the planegcs
    // solve leaves ~3e-11 radial noise on tangent-constrained head-side
    // lines. With MIN_DR at 1e-12 those noise cylinder lines were classified
    // as degenerate slivers and the repair crashed in makeCone ("cone with
    // two identic radii" — wasm refuses |Δr| < 1e-7). MIN_DR = 1e-7 keeps
    // them on the plain sweep path.
    const face = xzFace([
      [0, 2.499, 0],
      [0, 2.5, -0.2], // slant slope 0.005 ≫ SLOPE_TOL — healthy, no repair
      [0, 2.5 - 3e-11, -11.2], // noise cylinder line (the s034 head side)
      [0, 0, -11.2],
      [0, 0, 0],
    ])
    const solid = api.revolveVec(asH(face), ORIGIN, Z, 360)
    // exact value: cone(2.499→2.5, h=0.2) + cyl(2.5, h=11) — the 3e-11 noise
    // is far below BREP precision and cannot move the volume.
    const exact =
      Math.PI * (0.2 / 3) * (2.499 * 2.499 + 2.499 * 2.5 + 2.5 * 2.5) + Math.PI * 2.5 * 2.5 * 11
    expect(raw.getVolume(asS(solid))).toBeCloseTo(exact, 3)
  })
})
