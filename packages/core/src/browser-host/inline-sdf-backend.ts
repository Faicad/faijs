/**
 * InlineSdfBackend — 主线程直跑 SDF 后端（manifold-3d）
 *
 * 浏览器和 Node 环境均可使用（manifold-3d 在两个环境都可用）。
 *
 * 与 browser 端 WorkerSdfBackend 的区别：
 * - 不使用 Web Worker（Node 环境没有浏览器 Worker API）
 * - 直接在主线程调用 manifold-3d 的 levelSet（经 manifold-loader）
 * - 不支持 progress 回调（CLI 场景不需要）
 */

import type { SdfBackend, MeshData } from '../cad-runtime/ports'
import { runSdfInline } from '../sdf/sdf-core'
import { getManifoldModule } from '../mesh/manifold-loader'

/**
 * InlineSdfBackend is an SDF backend that runs manifold-3d on the main thread.
 *
 * It is usable in both browser and Node environments (manifold-3d works in
 * both). Unlike the WorkerSdfBackend it spawns no Web Worker and instead runs
 * manifold-3d's levelSet directly via the manifold-loader; it does not support
 * progress callbacks, which is fine for CLI scenarios.
 */
export class InlineSdfBackend implements SdfBackend {
  async runSdf(
    code: string,
    params: Record<string, number>,
    bounds: [number, number, number, number, number, number],
    edgeLength: number,
    level: number = 0,
    tolerance: number = -1,
  ): Promise<MeshData> {
    const { Manifold } = await getManifoldModule()
    const result = await runSdfInline(Manifold, code, params, bounds, edgeLength, level, tolerance)
    return { positions: result.positions, indices: result.indices }
  }
}
