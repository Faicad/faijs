/**
 * mesh IO API — headless 文件加载
 *
 * 替代浏览器版的 io.ts（依赖 fileBlobStore / formatLoaders / model-store）。
 * 仅使用 THREE.js 的 loader（STLLoader）解析文件字节为 Shape。
 */

import { geoToManifoldMesh } from '../boolean/geo-convert'
import type { Shape } from './types'

/**
 * Load geometry from raw file bytes (headless variant). STL is parsed
 * directly; unsupported formats fall back to STL parsing.
 *
 * @param buffer - the raw file bytes to parse.
 * @param format - format identifier such as 'stl' (defaults to 'stl').
 * @returns the loaded shape.
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
