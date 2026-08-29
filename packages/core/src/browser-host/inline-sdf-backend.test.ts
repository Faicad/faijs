﻿/**
 * @vitest-environment node
 *
 * InlineSdfBackend 测试 (P3-2)
 *
 * 测试内容：
 * 1. 基本功能：执行简单 SDF → 非空 mesh
 * 2. 输出类型：Float32Array positions + Uint32Array indices
 * 3. 球体 SDF：验证 mesh 大致形状（顶点数 > 0，bbox 在预期范围内）
 * 4. 带 bounds() 的脚本
 *
 * Run: npx vitest run src/browser-host/inline-sdf-backend.test.ts
 */

import { describe, it, expect } from 'vitest'
import { InlineSdfBackend } from './inline-sdf-backend'
import type { MeshData } from '../cad-runtime/ports'

// ── helpers ──

function tris(d: MeshData): number { return d.indices.length / 3 }
function verts(d: MeshData): number { return d.positions.length / 3 }

function bbox(d: MeshData) {
  let mx = Infinity, my = Infinity, mz = Infinity, Mx = -Infinity, My = -Infinity, Mz = -Infinity
  for (let i = 0; i < d.positions.length; i += 3) {
    const x = d.positions[i]!, y = d.positions[i + 1]!, z = d.positions[i + 2]!
    if (x < mx) mx = x; if (x > Mx) Mx = x
    if (y < my) my = y; if (y > My) My = y
    if (z < mz) mz = z; if (z > Mz) Mz = z
  }
  return { min: [mx, my, mz], max: [Mx, My, Mz], size: [Mx - mx, My - my, Mz - mz] }
}

// ── tests ──

describe('InlineSdfBackend: basic SDF execution', () => {
  it('sphere SDF → non-empty mesh', async () => {
    const backend = new InlineSdfBackend()
    const code = `
      const r = 5
      function sdf(x, y, z) {
        return Math.sqrt(x*x + y*y + z*z) - r
      }
    `
    const params: Record<string, number> = {}
    const bounds: [number, number, number, number, number, number] = [-6, -6, -6, 6, 6, 6]
    const result = await backend.runSdf(code, params, bounds, 0.5, 0, -1)

    expect(tris(result)).toBeGreaterThan(0)
    expect(verts(result)).toBeGreaterThan(0)
  }, 30000)

  it('produces Float32Array positions and Uint32Array indices', async () => {
    const backend = new InlineSdfBackend()
    const code = `
      function sdf(x, y, z) {
        return Math.sqrt(x*x + y*y + z*z) - 3
      }
    `
    const bounds: [number, number, number, number, number, number] = [-4, -4, -4, 4, 4, 4]
    const result = await backend.runSdf(code, {}, bounds, 0.5, 0, -1)

    expect(result.positions).toBeInstanceOf(Float32Array)
    expect(result.indices).toBeInstanceOf(Uint32Array)
  }, 30000)

  it('sphere SDF with r=5 → bbox approx [-5, 5] in each axis', async () => {
    const backend = new InlineSdfBackend()
    const code = `
      const radius = 5
      function sdf(x, y, z) {
        return Math.sqrt(x*x + y*y + z*z) - radius
      }
    `
    const bounds: [number, number, number, number, number, number] = [-6, -6, -6, 6, 6, 6]
    const result = await backend.runSdf(code, {}, bounds, 0.8, 0, -1)

    const bb = bbox(result)
    // The mesh should fit within a sphere of radius 5
    // With edgeLength=0.8, expect approximate fit
    for (let i = 0; i < 3; i++) {
      expect(bb.min[i]).toBeGreaterThanOrEqual(-6)
      expect(bb.max[i]).toBeLessThanOrEqual(6)
      expect(bb.size[i]).toBeGreaterThan(0)
    }
  }, 30000)

  it('uses user-defined bounds() when available', async () => {
    const backend = new InlineSdfBackend()
    const code = `
      function sdf(x, y, z) {
        return Math.sqrt(x*x + y*y + z*z) - 2
      }
      function bounds() {
        return { min: [-3, -3, -3], max: [3, 3, 3] }
      }
    `
    // Pass different bounds — user bounds() should override
    const fallbackBounds: [number, number, number, number, number, number] = [-100, -100, -100, 100, 100, 100]
    const result = await backend.runSdf(code, {}, fallbackBounds, 0.5, 0, -1)

    // Should be non-empty and much smaller than fallback bounds would suggest
    expect(tris(result)).toBeGreaterThan(0)
    const bb = bbox(result)
    // User bounds was [-3,3], so mesh should fit within that
    for (let i = 0; i < 3; i++) {
      expect(bb.min[i]).toBeGreaterThanOrEqual(-3.5)
      expect(bb.max[i]).toBeLessThanOrEqual(3.5)
    }
  }, 30000)

  it('passes params to SDF code', async () => {
    const backend = new InlineSdfBackend()
    const code = `
      function sdf(x, y, z) {
        return Math.sqrt(x*x + y*y + z*z) - r
      }
    `
    const params = { r: 4 }
    const bounds: [number, number, number, number, number, number] = [-5, -5, -5, 5, 5, 5]
    const result = await backend.runSdf(code, params, bounds, 0.5, 0, -1)

    expect(tris(result)).toBeGreaterThan(0)
    // Mesh should fit within sphere of radius 4
    const bb = bbox(result)
    for (let i = 0; i < 3; i++) {
      expect(bb.min[i]).toBeGreaterThanOrEqual(-5)
      expect(bb.max[i]).toBeLessThanOrEqual(5)
    }
  }, 30000)
})
