/**
 * mesh IO API — headless 文件加载
 *
 * 替代浏览器版的 io.ts（依赖 fileBlobStore / formatLoaders / model-store）。
 * 仅使用 THREE.js 的 loader（STLLoader）解析文件字节为 Shape。
 */

import { geoToManifoldMesh } from '../boolean/geo-convert'
import type { Shape } from './types'

/**
 * 从文件字节加载几何（headless 版本）
 *
 * @param buffer 文件字节
 * @param format 格式标识（stl 等）
 */
export async function importFile(
  buffer: ArrayBuffer,
  format?: string,
): Promise<Shape> {
  const fmt = (format ?? 'stl').toLowerCase()

  if (fmt === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geo = new STLLoader().parse(buffer)
    return geoToManifoldMesh(geo)
  }

  // For other formats, try STL as fallback
  try {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geo = new STLLoader().parse(buffer)
    return geoToManifoldMesh(geo)
  } catch {
    throw new Error(`[mesh/io] unsupported format: ${fmt}`)
  }
}
