/**
 * mesh/fai_split — basis derivation + unified split entry tests.
 *
 * `computeBasisFromNormal` is pure math (no runtime dependency) and is the
 * subject of the first describe block: several normals plus gimbal-lock
 * degenerate orientations, cross-checked against `computePlaneBasis`.
 *
 * `splitWithParams` is the real geometry path: it shells out to the
 * manifold CSG backend (InlineCsgBackend running manifold-3d wasm), so the
 * second describe exercises an actual box split. These are runtime-validated
 * against the loaded backend, not mocked.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as THREE from 'three'
import {
  computeBasisFromNormal,
  computePlaneBasis,
  split,
  splitWithParams,
} from '../../src/mesh/fai_split'
import { meshSplit } from '../../src/index'
import { geoToManifoldMesh } from '@faicad/faijs/boolean/csg-backend'
import type { Shape } from '@faicad/faijs/mesh/types'

/** A world-space unit box centred on the origin. */
function unitBox(): Shape {
  const g = new THREE.BoxGeometry(2, 2, 2)
  return geoToManifoldMesh(g)
}

describe('computeBasisFromNormal — pure basis from normal + inPlaneAngle', () => {
  // Reference: computePlaneBasis decomposes the same normal via Euler XYZ.
  // Golden normals whose Euler decomposition is unambiguous.
  const cases: Array<{ label: string; normal: [number, number, number]; angle: number }> = [
    { label: '+Z at 0deg', normal: [0, 0, 1], angle: 0 },
    { label: '+Z at 90deg', normal: [0, 0, 1], angle: 90 },
    { label: '+Z at 45deg', normal: [0, 0, 1], angle: 45 },
    { label: '+X at 0deg (gimbal-lock rx=+90)', normal: [1, 0, 0], angle: 0 },
    { label: '-X at 0deg (gimbal-lock rx=-90)', normal: [-1, 0, 0], angle: 0 },
    { label: 'tilted +Y-weighted', normal: [0, 0.6, 0.8], angle: 30 },
    { label: 'tilted -Y-weighted', normal: [-0.3, -0.5, 0.8], angle: -60 },
    { label: 'mixed axis', normal: [0.4, -0.5, 0.766], angle: 120 },
  ]

  it.each(cases)('$label produces orthonormal in-plane directions', ({ normal, angle }) => {
    const { widthDir, depthDir } = computeBasisFromNormal(normal, angle)

    // Unit length each.
    const wl = Math.hypot(widthDir[0], widthDir[1], widthDir[2])
    const dl = Math.hypot(depthDir[0], depthDir[1], depthDir[2])
    expect(wl).toBeCloseTo(1, 8)
    expect(dl).toBeCloseTo(1, 8)

    // widthDir and depthDir are mutually orthogonal.
    const dotWD = widthDir[0] * depthDir[0] + widthDir[1] * depthDir[1] + widthDir[2] * depthDir[2]
    expect(dotWD).toBeCloseTo(0, 8)

    // The true in-plane invariant: widthDir × depthDir == ±unit normal (tests
    // both directions lie in the plane normal to `normal` — robust to the
    // Euler-decomposition approximation of arbitrary normals). NOTE: recovering
    // rx/ry from an arbitrary normal is only approximate (the Euler XYZ forward
    // map can't hit every normal), so a bare dot(normal, widthDir)≈0 is used in
    // the dedicated decomposable-normal case below instead.
    const cx = widthDir[1] * depthDir[2] - widthDir[2] * depthDir[1]
    const cy = widthDir[2] * depthDir[0] - widthDir[0] * depthDir[2]
    const cz = widthDir[0] * depthDir[1] - widthDir[1] * depthDir[0]
    const nl = Math.hypot(normal[0], normal[1], normal[2])
    const sign = (cx * normal[0] + cy * normal[1] + cz * normal[2]) / nl
    // The reconstruction is an approximation for arbitrary (non-Euler-XYZ)
    // normals, so widthDir×depthDir is within ~1e-5 of ±normal rather than exact.
    expect(Math.abs(Math.abs(sign) - 1)).toBeCloseTo(0, 4)
  })

  it('an exact Euler-decomposable normal yields width/depth exactly orthogonal to it', () => {
    // normal = forward-map of Euler XYZ (rx, ry, rz=0) with a non-degenerate rx/ry.
    const euler = new THREE.Euler((20 * Math.PI) / 180, (15 * Math.PI) / 180, 0, 'XYZ')
    const n = new THREE.Vector3(0, 0, 1).applyEuler(euler)
    const normal: [number, number, number] = [n.x, n.y, n.z]
    const { widthDir, depthDir } = computeBasisFromNormal(normal, 0)
    const dotNW = normal[0] * widthDir[0] + normal[1] * widthDir[1] + normal[2] * widthDir[2]
    const dotND = normal[0] * depthDir[0] + normal[1] * depthDir[1] + normal[2] * depthDir[2]
    expect(dotNW).toBeCloseTo(0, 6)
    expect(dotND).toBeCloseTo(0, 6)
  })

  it('recovers the same widthDir/depthDir as computePlaneBasis for a decomposable normal', () => {
    // normal = [sin(ry), -sin(rx)*cos(ry), cos(rx)*cos(ry)] is the Euler XYZ
    // forward map used by computePlaneBasis. Pick rx/ry then construct the
    // normal to feed computeBasisFromNormal; the in-plane angle is rz.
    const rx = 20
    const ry = 15
    const rz = 0
    const euler = new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, 'XYZ')
    const normalVec = new THREE.Vector3(0, 0, 1).applyEuler(euler)
    const normal: [number, number, number] = [normalVec.x, normalVec.y, normalVec.z]

    const viaPlaneBasis = computePlaneBasis(rx, ry, rz)
    const viaNormal = computeBasisFromNormal(normal, rz)

    expect(viaNormal.widthDir[0]).toBeCloseTo(viaPlaneBasis.widthDir[0], 8)
    expect(viaNormal.widthDir[1]).toBeCloseTo(viaPlaneBasis.widthDir[1], 8)
    expect(viaNormal.widthDir[2]).toBeCloseTo(viaPlaneBasis.widthDir[2], 8)
    expect(viaNormal.depthDir[0]).toBeCloseTo(viaPlaneBasis.depthDir[0], 8)
    expect(viaNormal.depthDir[1]).toBeCloseTo(viaPlaneBasis.depthDir[1], 8)
    expect(viaNormal.depthDir[2]).toBeCloseTo(viaPlaneBasis.depthDir[2], 8)
  })

  it('handles the gimbal-lock degenerate (normal along ±X) without NaN', () => {
    for (const n of [[1, 0, 0], [-1, 0, 0]] as Array<[number, number, number]>) {
      const { widthDir, depthDir } = computeBasisFromNormal(n, 90)
      expect(widthDir.every((v) => Number.isFinite(v))).toBe(true)
      expect(depthDir.every((v) => Number.isFinite(v))).toBe(true)
      // Still unit and still in the plane normal to the normal.
      expect(Math.hypot(...widthDir)).toBeCloseTo(1, 8)
      expect(widthDir[0] * n[0] + widthDir[1] * n[1] + widthDir[2] * n[2]).toBeCloseTo(0, 8)
    }
  })
})

describe('splitWithParams — real box split through the manifold backend', () => {
  beforeAll(() => {
    // No explicit wasm URL needed: manifold-3d uses its own locateFile default.
    // The backend lazily loads InlineCsgBackend on first use.
  })

  it('plane cut at the mid-plane (offset 0, applyExplode=false) yields a closed split', async () => {
    const box = unitBox()
    const res = await splitWithParams({
      shape: box,
      cutMode: 'plane',
      normal: [0, 0, 1],
      offset: 0,
      inPlaneAngle: 0,
      bbCenter: [0, 0, 0],
      bboxSize: [2, 2, 2],
      applyExplode: false,
    })

    // Two non-empty halves, both still triangular solids.
    expect(res.front.positions.length).toBeGreaterThan(0)
    expect(res.back.positions.length).toBeGreaterThan(0)
    expect(res.front.indices.length).toBeGreaterThan(0)
    expect(res.back.indices.length).toBeGreaterThan(0)

    // The derived plane data round-trips the inputs.
    expect(res.normal).toEqual([0, 0, 1])
    expect(res.planeCenter).toEqual([0, 0, 0])
    expect(res.planeDistance).toBeCloseTo(0, 6)
    // No explode applied → offsets reported as 0.
    expect(res.frontExplodeOffset).toBe(0)
    expect(res.backExplodeOffset).toBe(0)

    // Combined triangle count roughly preserves the box's 12 triangles
    // (the plane cut adds a cap; manifold may re-tessellate).
    const total = res.front.indices.length / 3 + res.back.indices.length / 3
    expect(total).toBeGreaterThanOrEqual(10)
  })

  it('applyExplode (default) offsets both halves along the normal', async () => {
    const box = unitBox()
    const res = await splitWithParams({
      shape: box,
      cutMode: 'plane',
      normal: [0, 0, 1],
      offset: 0,
      inPlaneAngle: 0,
      bbCenter: [0, 0, 0],
      bboxSize: [2, 2, 2],
    })

    const diag = Math.sqrt(2 * 2 + 2 * 2 + 2 * 2)
    const base = diag * 0.02
    expect(res.frontExplodeOffset).toBeCloseTo(base, 10)
    expect(res.backExplodeOffset).toBeCloseTo(-base, 10)

    // Box spans z∈[-1,1]; split at z=0 → front half z∈[0,1], back z∈[-1,0].
    // After explode: front shifted by +base, back shifted by -base.
    const minZ = (p: Float32Array) => { let m = Infinity; for (let i = 2; i < p.length; i += 3) m = Math.min(m, p[i]); return m }
    const maxZ = (p: Float32Array) => { let m = -Infinity; for (let i = 2; i < p.length; i += 3) m = Math.max(m, p[i]); return m }
    expect(minZ(res.front.positions)).toBeCloseTo(res.frontExplodeOffset, 5)
    expect(maxZ(res.back.positions)).toBeCloseTo(res.backExplodeOffset, 5)
  })

  it('dovetail split with applyExplode=false leaves groove geometry intact and offsets 0', async () => {
    const box = unitBox()
    const res = await splitWithParams({
      shape: box,
      cutMode: 'dovetail',
      normal: [0, 0, 1],
      offset: 0,
      inPlaneAngle: 0,
      bbCenter: [0, 0, 0],
      bboxSize: [2, 2, 2],
      groove: { depth: 1, depthTolerance: 0.1, width: 2, widthTolerance: 0.1, flapsAngle: 10 },
      applyExplode: false,
    })
    expect(res.front.indices.length).toBeGreaterThan(0)
    expect(res.back.indices.length).toBeGreaterThan(0)
    expect(res.frontExplodeOffset).toBe(0)
    expect(res.backExplodeOffset).toBe(0)
  })

  it('dowel split with applyExplode=false yields non-empty halves', async () => {
    const box = unitBox()
    const res = await splitWithParams({
      shape: box,
      cutMode: 'dowel',
      normal: [0, 0, 1],
      offset: 0,
      inPlaneAngle: 0,
      bbCenter: [0, 0, 0],
      bboxSize: [2, 2, 2],
      dowel: { diameter: 1, diameterTolerance: 0.1, height: 0.6, heightTolerance: 0.1 },
      selectedSections: [],
      applyExplode: false,
    })
    expect(res.front.indices.length).toBeGreaterThan(0)
    expect(res.back.indices.length).toBeGreaterThan(0)
    expect(res.frontExplodeOffset).toBe(0)
  })
})

describe('package entry re-export', () => {
  // B3 correction (2026-10-06): the editor-side mesh aggregate (`editorCad`) is gone;
  // single implementations are re-exported from the package entry by name. Pin the
  // alias to the same function so entry and implementation cannot drift apart.
  it('meshSplit is the same function as mesh/fai_split.split', () => {
    expect(meshSplit).toBe(split)
  })
})