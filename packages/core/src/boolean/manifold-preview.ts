/**
 * manifold-preview — 主线程 CSG 预览辅助（D 类）
 *
 * E12.4：宿主不得自行调 getManifoldModule / manifold-3d API。
 * 交互预览所需的单次主线程布尔运算封装在此，由 faijs 内部加载
 * manifold 单例并管理内存，宿主只传 mesh 数据往返。
 *
 * 仅用于预览/辅助计算，绝不用于提交几何（提交走脚本语句执行）。
 */

import { getManifoldModule } from '../mesh/manifold-loader'
import { meshToManifold, manifoldToMeshData } from './csg-core'

/** Interchange mesh representation for preview operations: positions with triangle indices. */
export interface ManifoldMeshData {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * 主线程求两个 mesh 的布尔交集（预览用）。
 *
 * 与 computeDovetailSplit 等执行路径不同，这里只做一次三元操作并返回
 * mesh 数据；任一侧为空或 CSG 失败时返回 null（宿主回退到简单预览）。
 * 内部负责 Manifold/Mesh 的 delete（WASM 内存安全）。
 * @param a - the first input mesh data.
 * @param b - the second input mesh data.
 * @returns the intersecting mesh data, or null when either input is empty or the CSG operation fails.
 */
export async function previewMeshIntersect(
  a: ManifoldMeshData,
  b: ManifoldMeshData,
): Promise<ManifoldMeshData | null> {
  try {
    const { Manifold, Mesh } = await getManifoldModule()
    const am = meshToManifold(Manifold, Mesh, a)
    const bm = meshToManifold(Manifold, Mesh, b)
    try {
      if (am.isEmpty() || bm.isEmpty()) return null
      const result = am.intersect(bm)
      if (result.isEmpty()) {
        result.delete()
        return null
      }
      const data = manifoldToMeshData(result)
      result.delete()
      return data
    } finally {
      am.delete()
      bm.delete()
    }
  } catch {
    return null
  }
}