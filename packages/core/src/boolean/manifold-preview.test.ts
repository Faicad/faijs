/**
 * manifold-preview 测试 — previewMeshIntersect（D 类预览 API）
 *
 * E12.4：宿主不自行加载 manifold 模块；本函数封装单次主线程布尔交集。
 * 任一侧为空或 CSG 失败返回 null；正常求交返回 positions/indices。
 */

import { describe, it, expect } from 'vitest'
import { previewMeshIntersect } from './manifold-preview'
import type { ManifoldMeshData } from './geo-convert'

/** 一个 2x2x2 立方体（8 顶点 12 三角，顶点独立、未焊接——函数内部会焊） */
function cube(cx = 0, cy = 0, cz = 0): ManifoldMeshData {
  const p = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ].map(([x, y, z]) => [x + cx, y + cy, z + cz])
  const positionsArr = new Float32Array(p.flat())
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ])
  return { positions: positionsArr, indices }
}

describe('previewMeshIntersect', () => {
  it('两个重叠立方体求交有几何结果', async () => {
    const a = cube(0, 0, 0)
    const b = cube(0.5, 0, 0) // 在 x 正方向移动 0.5 → 重叠 0.5
    const result = await previewMeshIntersect(a, b)
    expect(result).not.toBeNull()
    expect(result!.positions.length).toBeGreaterThan(0)
    expect(result!.indices.length).toBeGreaterThan(0)
  })

  it('不相交时返回 null', async () => {
    const a = cube(0, 0, 0)
    const b = cube(5, 0, 0) // 远离，无重叠
    const result = await previewMeshIntersect(a, b)
    expect(result).toBeNull()
  })

  it('失败（非法输入）返回 null 而非 throw', async () => {
    const result = await previewMeshIntersect(
      { positions: new Float32Array(0), indices: new Uint32Array(0) },
      cube(0, 0, 0),
    )
    expect(result).toBeNull()
  })
})