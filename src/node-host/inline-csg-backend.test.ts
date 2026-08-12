/**
 * @vitest-environment node
 *
 * InlineCsgBackend 测试 (P3-1)
 *
 * 测试内容：
 * 1. boolean union: 两个不重叠立方体 → triangle count 相加
 * 2. boolean subtract: 两个重叠立方体 → 结果非空
 * 3. splitPlane: 立方体水平分割 → 两个非空 mesh
 * 4. InlineCsgBackend 结果与 csg.test.ts inline 模式一致
 *
 * Run: npx vitest run src/node-host/inline-csg-backend.test.ts
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { InlineCsgBackend } from './inline-csg-backend'
import { geoToManifoldMesh } from '../boolean/csg-backend'
import type { MeshData } from '../cad-runtime/ports'

// ── helpers ──

function box(cx: number, cy: number, cz: number, hw: number, hh: number, hd: number): MeshData {
  const g = new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2)
  g.translate(cx, cy, cz)
  const m = geoToManifoldMesh(g)
  return { positions: m.positions, indices: m.indices }
}

function tris(d: MeshData): number { return d.indices.length / 3 }

function bbox(d: MeshData) {
  let mx = Infinity, my = Infinity, mz = Infinity, Mx = -Infinity, My = -Infinity, Mz = -Infinity
  for (let i = 0; i < d.positions.length; i += 3) {
    const x = d.positions[i], y = d.positions[i + 1], z = d.positions[i + 2]
    if (x < mx) mx = x; if (x > Mx) Mx = x
    if (y < my) my = y; if (y > My) My = y
    if (z < mz) mz = z; if (z > Mz) Mz = z
  }
  return { min: [mx, my, mz], max: [Mx, My, Mz], size: [Mx - mx, My - my, Mz - mz] }
}

// ── tests ──

describe('InlineCsgBackend: boolean operations', () => {
  const backend = new InlineCsgBackend()

  it('union: two non-overlapping boxes → triangle count = sum (24)', async () => {
    const a = box(0, 0, 0, 1, 1, 1)    // [-1,-1,-1]→[1,1,1]
    const b = box(3, 0, 0, 1, 1, 1)    // [2,-1,-1]→[4,1,1]
    const result = await backend.boolean('union', [a, b])
    expect(tris(result)).toBe(24)
  })

  it('subtract: two overlapping boxes → non-empty result', async () => {
    const a = box(0, 0, 0, 1, 1, 1)   // [-1,-1,-1]→[1,1,1]
    const b = box(0.5, 0, 0, 1, 1, 1) // [-0.5,-1,-1]→[1.5,1,1]
    const result = await backend.boolean('subtract', [a, b])
    expect(tris(result)).toBeGreaterThan(0)
    const bb = bbox(result)
    expect(bb.size[0]).toBeCloseTo(0.5, 1) // left half: [-1,-0.5]
  })

  it('intersect: two overlapping boxes → non-empty result', async () => {
    const a = box(0, 0, 0, 1, 1, 1)
    const b = box(0.5, 0, 0, 1, 1, 1)
    const result = await backend.boolean('intersect', [a, b])
    expect(tris(result)).toBeGreaterThan(0)
    const bb = bbox(result)
    // intersection: [-0.5,-1,-1]→[1,1,1] → size [1.5, 2, 2]
    expect(bb.size[0]).toBeCloseTo(1.5, 1)
  })
})

describe('InlineCsgBackend: splitPlane', () => {
  const backend = new InlineCsgBackend()

  it('Z=0 plane splits centered box → two non-empty meshes', async () => {
    const mesh = box(0, 0, 0, 1, 1, 1) // [-1,-1,-1]→[1,1,1]
    const result = await backend.splitPlane(mesh, { normal: [0, 0, 1], offset: 0 })
    expect(tris(result.front)).toBeGreaterThan(0)
    expect(tris(result.back)).toBeGreaterThan(0)
    // Symmetric split → equal triangle counts
    expect(tris(result.front)).toBe(tris(result.back))
  })

  it('plane above model → front empty, back non-empty', async () => {
    const mesh = box(0, 0, 0, 1, 1, 1) // [-1,-1,-1]→[1,1,1]
    const result = await backend.splitPlane(mesh, { normal: [0, 0, 1], offset: 10 })
    expect(tris(result.front)).toBe(0)
    expect(tris(result.back)).toBeGreaterThan(0)
  })

  it('X=0 plane splits centered box → two non-empty meshes', async () => {
    const mesh = box(0, 0, 0, 1, 1, 1)
    const result = await backend.splitPlane(mesh, { normal: [1, 0, 0], offset: 0 })
    expect(tris(result.front)).toBeGreaterThan(0)
    expect(tris(result.back)).toBeGreaterThan(0)
    expect(tris(result.front)).toBe(tris(result.back))
  })
})

describe('InlineCsgBackend: output types', () => {
  it('produces Float32Array positions and Uint32Array indices', async () => {
    const backend = new InlineCsgBackend()
    const a = box(0, 0, 0, 1, 1, 1)
    const result = await backend.boolean('union', [a, box(3, 0, 0, 1, 1, 1)])
    expect(result.positions).toBeInstanceOf(Float32Array)
    expect(result.indices).toBeInstanceOf(Uint32Array)
  })
})
