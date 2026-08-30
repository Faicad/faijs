/**
 * sdf-runner — SDF 执行入口（headless 版本）
 *
 * 替代浏览器版的 sdf-runner.ts（使用 Worker）。
 * 直接使用 InlineSdfBackend 在主线程执行 SDF。
 *
 * F2 修复：不静态 import browser-host/inline-sdf-backend（L1 不依赖 L3）。
 * 改为延迟动态 import，仅在未注入后端时按需加载。
 */

import type { SdfBackend } from '../cad-runtime/ports'

/** Mesh data produced by an SDF run: interleaved positions and triangle indices. */
export interface SdfMeshData {
  positions: Float32Array
  indices: Uint32Array
}

let _backend: SdfBackend | null = null

/**
 * 浏览器 host 注入 SDF 后端（WorkerSdfBackend）。
 *
 * @param backend - the SDF backend to use.
 */
export function setSdfBackend(backend: SdfBackend): void {
  _backend = backend
}

/**
 * 获取当前 SDF 后端。
 * F2 修复：延迟动态 import InlineSdfBackend，避免 L1 静态依赖 L3。
 */
async function getBackend(): Promise<SdfBackend> {
  if (_backend) return _backend
  // 延迟加载——仅在实际需要时才拉入 L3 代码
  const { InlineSdfBackend } = await import('../browser-host/inline-sdf-backend')
  _backend = new InlineSdfBackend()
  return _backend
}

/**
 * 执行 SDF 生成。
 * @param code    用户编写的 JS 代码（含 sdf 函数）
 * @param params  参数值表
 * @param bounds  包围盒 6 元组 [xmin,ymin,zmin,xmax,ymax,zmax]
 * @param edgeLength 八叉树单元边长（越小越精细）
 * @param level   等值面值（默认 0）
 * @param tolerance 网格化容差（<0 用 manifold 默认）
 * @returns mesh data produced by the SDF extraction.
 */
export async function runSdf(
  code: string,
  params: Record<string, number>,
  bounds: [number, number, number, number, number, number],
  edgeLength: number,
  level: number = 0,
  tolerance: number = -1,
): Promise<SdfMeshData> {
  const backend = await getBackend()
  return backend.runSdf(code, params, bounds, edgeLength, level, tolerance)
}
