/**
 * InlineSdfBackend — Node 端 SDF 后端实现（主线程直跑）
 *
 * 设计文档：docs/faijs-engine-refactor-design.md §5.1
 *
 * 与 browser 端 WorkerSdfBackend 的区别：
 * - 不使用 Web Worker
 * - 直接在主线程调用 manifold-3d 的 levelSet
 * - 不支持 progress 回调（CLI 场景不需要）
 */

import type { SdfBackend, MeshData } from '../cad-runtime/ports'
import { runSdfInline } from '../sdf/sdf-core'

type ManifoldMod = typeof import('manifold-3d/manifoldCAD')

let manifoldPromise: Promise<ManifoldMod> | null = null

async function getManifold(): Promise<ManifoldMod> {
  if (!manifoldPromise) {
    manifoldPromise = import('manifold-3d/manifoldCAD')
  }
  return manifoldPromise
}

export class InlineSdfBackend implements SdfBackend {
  async runSdf(
    code: string,
    params: Record<string, number>,
    bounds: [number, number, number, number, number, number],
    edgeLength: number,
    level: number = 0,
    tolerance: number = -1,
  ): Promise<MeshData> {
    const { Manifold } = await getManifold()
    const result = await runSdfInline(Manifold, code, params, bounds, edgeLength, level, tolerance)
    return { positions: result.positions, indices: result.indices }
  }
}
