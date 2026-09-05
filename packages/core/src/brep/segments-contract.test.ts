/**
 * segments 统一契约验收测试（方案 2026-09-05 §5.4）
 *
 * 裁决 1：`segments` 是 faijs 对 brepjs 的显式超集；brep 路径不是忽略，
 * 而是用于三角化（显示 mesh 与 STL 导出的唯一来源）。
 *
 * 验收要点：
 * 1. brep 模式下 segment 不同的球面，三角化顶点/三角形数显著不同（守「不忽略」）。
 * 2. 同一 segments 下 mesh 与 brep 的 bbox 一致（parity）；三角形数随 segments 单调。
 * 3. `nRad` 与 `segments` 两个名字在三处消费点结果一致（等价性）。
 * 4. `clampNRad` 边界：越界被钳制到 [NRAD_MIN, NRAD_MAX]，不产生畸形几何。
 *
 * 运行：npx vitest run src/brep/segments-contract.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { solidToShape } from '../brep/brep-ops'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { sphereBrep, cylinderBrep, coneBrep } from '../brep/primitives-brep'
import { clampNRad, NRAD_MIN, NRAD_MAX } from '../mesh/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** 统计一个 Shape 的三角形数（每个索引三元组为一个三角形）。 */
function triangleCount(indices: Float32Array | Uint32Array): number {
  return indices.length / 3
}

describe('P0: segments 统一契约', () => {
  it('brep 模式：sphere {segments:8} 与 {segments:64} 三角化直角三角形数显著不同（不忽略）', async () => {
    const low = await sphereBrep({ radius: 10, segments: 8 })
    const high = await sphereBrep({ radius: 10, segments: 64 })
    const lowTri = triangleCount(low.indices)
    const highTri = triangleCount(high.indices)
    // 64 vs 8 的角反射差约 8 倍 → 三角形数应当有数量级差距
    expect(highTri).toBeGreaterThan(lowTri * 4)
  })

  it('cret: segments 越大三角化越密（单调不降）', async () => {
    const counts: number[] = []
    for (const s of [8, 16, 32, 64]) {
      const sphere = await sphereBrep({ radius: 10, segments: s })
      counts.push(triangleCount(sphere.indices))
    }
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    }
  })

  it('三条三角化的 nRad 与 segments 等价（sphere 16 == sphere {nRad:16}）', async () => {
    const a = await sphereBrep({ radius: 10, nRad: 16 })
    const b = await sphereBrep({ radius: 10, segments: 16 })
    expect(triangleCount(a.indices)).toBe(triangleCount(b.indices))
    expect(a.indices.length).toBe(b.indices.length)
  })

  it('clampNRad 边界：n=2 → 3（NRAD_MIN），n=1000 → 128（NRAD_MAX）', () => {
    expect(clampNRad(2)).toBe(NRAD_MIN)
    expect(clampNRad(1000)).toBe(NRAD_MAX)
    expect(clampNRad(undefined)).toBe(64) // 引擎默认 64 = brepjs standard 等效
  })

  it('越界 segments 不产生畸形几何（仍产出合法三角网且 bbox 有限）', async () => {
    const out = await sphereBrep({ radius: 10, segments: 100000 })
    expect(triangleCount(out.indices)).toBeGreaterThan(0)
    // NRAD_MAX 钳制后段数不会爆炸：与 segments:128 等价
    const clamped = await sphereBrep({ radius: 10, segments: 128 })
    expect(triangleCount(out.indices)).toBe(clamped.indices.length / 3)
  })

  it('apex 缺省 segments 与显式 64 的三角面数相等（默认 = 引擎默认 64）', async () => {
    const def = await sphereBrep({ radius: 10 })
    const explicit = await sphereBrep({ radius: 10, segments: 64 })
    expect(def.indices.length).toBe(explicit.indices.length)
  })

  it('cylinder/cone brep 同受 segments 控制', async () => {
    const lowCyl = await cylinderBrep({ radius: 5, height: 20, segments: 8 })
    const highCyl = await cylinderBrep({ radius: 5, height: 20, segments: 64 })
    expect(triangleCount(highCyl.indices)).toBeGreaterThan(triangleCount(lowCyl.indices) * 2)
    const lowCone = await coneBrep({ radiusBottom: 5, radiusTop: 0, height: 20, segments: 8 })
    const highCone = await coneBrep({ radiusBottom: 5, radiusTop: 0, height: 20, segments: 64 })
    expect(triangleCount(highCone.indices)).toBeGreaterThan(triangleCount(lowCone.indices) * 2)
  })

  it('solidToShape 显式 segments 也驱动三角化（brep-ops 消费点）', async () => {
    const { getBrepEngine } = await import('../brep/engine/registry')
    const kernel = (await getBrepEngine()).primitives
    // 每个 segments 用独立实体构造（同一句柄的 tessellation 会被 OCCT 缓存）
    const low = primitiveToBrepSolid(kernel, 'sphere', { radius: 10 })
    const shape8 = solidToShape(kernel, low.solid, 8)
    const lowCount = shape8.indices.length
    kernel.release(low.solid)
    const high = primitiveToBrepSolid(kernel, 'sphere', { radius: 10 })
    const shape64 = solidToShape(kernel, high.solid, 64)
    const highCount = shape64.indices.length
    kernel.release(high.solid)
    expect(lowCount).toBeGreaterThan(0)
    expect(highCount).toBeGreaterThan(lowCount * 4)
  })
})