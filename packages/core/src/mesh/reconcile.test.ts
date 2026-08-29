/**
 * reconcile 单测 — P0-1c 四步归约的独立断言
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §6.1.5 P0-1c
 *
 * 四步各有独立用例：
 *   1. weldVertices — 共享边重复顶点合并
 *   2. removeDegenerate — 零面积三角形剔除
 *   3. unifyOrientation — 相邻三角形缠绕方向统一
 *   4. assertManifold — 开放边/非流形边显式报错
 */

import { describe, it, expect } from 'vitest'
import {
  weldVertices,
  removeDegenerate,
  unifyOrientation,
  assertManifold,
  reconcileMesh,
} from './reconcile'

// 合法四面体（4 顶点 / 4 面，每条边 2 个三角形共享）
function tetrahedron(): { positions: Float32Array; indices: Uint32Array } {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]),
    indices: new Uint32Array([
      0, 2, 1,
      0, 1, 3,
      0, 3, 2,
      1, 2, 3,
    ]),
  }
}

/** 四面体三角汤：每个面独立 3 个顶点（共享边顶点重复） */
function tetrahedronSoup(): { positions: Float32Array; indices: Uint32Array } {
  const pos: number[] = []
  const idx: number[] = []
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ]
  for (const f of faces) {
    for (const vi of f) {
      pos.push(
        tetrahedron().positions[vi * 3],
        tetrahedron().positions[vi * 3 + 1],
        tetrahedron().positions[vi * 3 + 2],
      )
      idx.push(pos.length / 3 - 1)
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

describe('reconcile step 1: weldVertices', () => {
  it('merges coincident vertices and rebuilds indices', () => {
    const soup = tetrahedronSoup()
    expect(soup.positions.length / 3).toBe(12)
    const { positions, indices } = weldVertices(soup.positions, soup.indices)
    // 12 → 4 个独立顶点
    expect(positions.length / 3).toBe(4)
    expect(indices.length).toBe(12)
    // 索引全部落在 [0,4) 内
    for (const i of indices) {
      expect(i).toBeLessThan(4)
    }
  })

  it('is a no-op on an already-welded mesh (vertex count preserved)', () => {
    const { positions, indices } = tetrahedron()
    const result = weldVertices(positions, indices)
    expect(result.positions.length).toBe(positions.length)
    expect(result.indices.length).toBe(indices.length)
  })
})

describe('reconcile step 2: removeDegenerate', () => {
  it('drops zero-area triangles', () => {
    // 3 个顶点共线 → 面积 0
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      2, 0, 0,
      0, 1, 0,
    ])
    const indices = new Uint32Array([0, 1, 2, 0, 1, 3])
    const result = removeDegenerate(positions, indices)
    expect(result.indices.length / 3).toBe(1)
    expect(result.positions.length / 3).toBe(3) // 只剩三角形 0,1,3 的顶点
  })

  it('keeps a valid mesh untouched', () => {
    const t = tetrahedron()
    const result = removeDegenerate(t.positions, t.indices)
    expect(result.indices.length).toBe(t.indices.length)
  })
})

describe('reconcile step 3: unifyOrientation', () => {
  it('flips a neighbor whose shared edge runs the same direction', () => {
    // 四面体中翻转一个面 (0,1,3) → (0,3,1)：
    // 与 tri0 (0,2,1) 共享边 (0,1) 时，两者都从 1→0 遍历（同方向）→ 不一致
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ])
    const indices = new Uint32Array([
      0, 2, 1,
      0, 3, 1,  // 翻转后的 tri1
      0, 3, 2,
      1, 2, 3,
    ])
    const result = unifyOrientation(positions, indices)

    // tri1 应被翻回 (0, 1, 3)，其余不变
    expect([...result.indices]).toEqual([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])

    // 翻转后整个网格应为合法 2-manifold（断言不抛）
    expect(() => assertManifold(result.positions, result.indices)).not.toThrow()
  })

  it('leaves already-consistent winding untouched', () => {
    const t = tetrahedron()
    const result = unifyOrientation(t.positions, t.indices)
    expect([...result.indices]).toEqual([...t.indices])
  })
})

describe('reconcile step 4: assertManifold', () => {
  it('passes on a closed 2-manifold', () => {
    expect(() => assertManifold(tetrahedron().positions, tetrahedron().indices)).not.toThrow()
  })

  it('throws on an open boundary edge', () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ])
    const indices = new Uint32Array([0, 1, 2]) // 单三角形：每条边只被 1 个三角形共享
    expect(() => assertManifold(positions, indices)).toThrow(/not 2-manifold/)
  })

  it('throws on a non-manifold edge (3 triangles sharing)', () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
      1, 1, 0,
    ])
    // 边 (0,2) 被三个三角形共享
    const indices = new Uint32Array([
      0, 2, 1,
      0, 3, 2,
      0, 2, 4,
    ])
    expect(() => assertManifold(positions, indices)).toThrow(/not 2-manifold/)
  })
})

describe('reconcileMesh (full pipeline)', () => {
  it('turns a triangle soup into a manifold mesh', () => {
    const soup = tetrahedronSoup()
    const { positions, indices } = reconcileMesh(soup.positions, soup.indices)
    // 12 顶点三角汤 → 4 顶点 / 4 面的闭合流形
    expect(positions.length / 3).toBe(4)
    expect(indices.length / 3).toBe(4)
    // 最终断言已内置于管线，能走到这里即通过
  })

  it('passes a valid manifold with identical geometry (bbox preserved)', () => {
    const t = tetrahedron()
    const result = reconcileMesh(t.positions, t.indices)
    // 顶点数量与三角形数量不变（weld 按首见顺序重建顶点数组，顺序可能变化，但拓扑与几何不变）
    expect(result.positions.length).toBe(t.positions.length)
    expect(result.indices.length).toBe(t.indices.length)
    expect(() => assertManifold(result.positions, result.indices)).not.toThrow()

    const bbox = (p: Float32Array): [number, number, number] => {
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[i + k])
          max[k] = Math.max(max[k], p[i + k])
        }
      }
      return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    }
    expect(bbox(result.positions)).toEqual(bbox(t.positions))
  })

  it('throws on a non-manifold input (no silent fallback)', () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ])
    const indices = new Uint32Array([0, 1, 2])
    expect(() => reconcileMesh(positions, indices)).toThrow(/not 2-manifold/)
  })

  it('returns empty mesh untouched', () => {
    const result = reconcileMesh(new Float32Array(0), new Uint32Array(0))
    expect(result.positions.length).toBe(0)
    expect(result.indices.length).toBe(0)
  })
})
