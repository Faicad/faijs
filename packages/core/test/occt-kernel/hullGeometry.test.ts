/**
 * hullGeometry — 第一方 QuickHull 纯函数测试（2026-09-25 core-decouple Phase 2）
 *
 * 验证点：
 *   1. 盒 8 角点 → 12 个三角面，覆盖全部输入顶点（欧拉公式 F=12 for 8-vertex hull）；
 *   2. 四面体 4 顶点 → 4 个三角面；
 *   3. 点数不足 / 全共面 → 明确抛错。
 *
 * brepjs 源实现行为不变（同源复制）；本测试钉住第一方副本。
 *
 * Run: npx vitest run src/occt-kernel/hullGeometry.test.ts
 */

import { describe, it, expect } from 'vitest'
import { quickHull, type Vec3 } from '../../src/occt-kernel/hullGeometry'

function boxCorners(size: number): Vec3[] {
  const h = size / 2
  const pts: Vec3[] = []
  for (const x of [-h, h]) {
    for (const y of [-h, h]) {
      for (const z of [-h, h]) pts.push({ x, y, z })
    }
  }
  return pts
}

describe('quickHull（第一方复制）', () => {
  it('盒 8 角点 → 12 个三角面，覆盖全部 8 个输入顶点', () => {
    const pts = boxCorners(20)
    const { faces, points } = quickHull(pts, 1e-6)
    // 凸 8 顶点多面体的三角剖分 = 2*(V-2) = 12 面（欧拉）。
    expect(faces).toHaveLength(12)
    expect(points).toHaveLength(8)
    // 每个输入顶点至少出现在一个面里（无孤立点）。
    const used = new Set<number>()
    for (const [a, b, c] of faces) {
      used.add(a)
      used.add(b)
      used.add(c)
    }
    expect(used.size).toBe(8)
    // 无退化面（三点互异）。
    for (const [a, b, c] of faces) {
      expect(new Set([a, b, c]).size).toBe(3)
    }
  })

  it('四面体 4 顶点 → 4 个三角面（QuickHull 初始四面体直接输出）', () => {
    const pts: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 0, z: 10 },
    ]
    const { faces } = quickHull(pts, 1e-6)
    expect(faces).toHaveLength(4)
  })

  it('重复点去重：含重合点的输入仍得到正确面数', () => {
    const pts = [...boxCorners(20), { x: 10, y: 10, z: 10 }, { x: -10, y: -10, z: -10 }]
    const { faces, points } = quickHull(pts, 1e-6)
    expect(points).toHaveLength(8)
    expect(faces).toHaveLength(12)
  })

  it('点数不足 → 明确抛错', () => {
    expect(() => quickHull([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], 1e-6)).toThrow(
      /Fewer than 4 non-coincident points/,
    )
  })

  it('全共面 → 明确抛错', () => {
    const pts: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 5, y: 5, z: 0 },
    ]
    expect(() => quickHull(pts, 1e-6)).toThrow(/All points are coplanar/)
  })
})
