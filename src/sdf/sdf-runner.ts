/**
 * sdf-runner — SDF 执行入口（headless 版本）
 *
 * 替代浏览器版的 sdf-runner.ts（使用 Worker）。
 * 直接使用 InlineSdfBackend 在主线程执行 SDF。
 */

import { InlineSdfBackend } from '../browser-host/inline-sdf-backend'

export interface SdfMeshData {
  positions: Float32Array
  indices: Uint32Array
}

let _backend: InlineSdfBackend | null = null

function getBackend(): InlineSdfBackend {
  if (!_backend) {
    _backend = new InlineSdfBackend()
  }
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
 */
export async function runSdf(
  code: string,
  params: Record<string, number>,
  bounds: [number, number, number, number, number, number],
  edgeLength: number,
  level: number = 0,
  tolerance: number = -1,
): Promise<SdfMeshData> {
  const backend = getBackend()
  return backend.runSdf(code, params, bounds, edgeLength, level, tolerance)
}
