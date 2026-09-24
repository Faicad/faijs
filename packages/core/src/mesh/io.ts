/**
 * mesh IO API — headless 文件加载
 *
 * 替代浏览器版的 io.ts（依赖 fileBlobStore / formatLoaders / model-store）。
 * STL 由 core 自持的 `mesh/stl-loader.ts` 解析（零 three addons——`three/examples`
 * 不在 three 的版本兼容承诺内，且会把不可控模块带进每个消费方，含小程序 worker）。
 */

import { geoToManifoldMesh } from '../boolean/geo-convert'
import { parseStl } from './stl-loader'
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
    return geoToManifoldMesh(parseStl(buffer))
  }

  // For other formats, try STL as fallback
  try {
    return geoToManifoldMesh(parseStl(buffer))
  } catch {
    throw new Error(`[mesh/io] unsupported format: ${fmt}`)
  }
}
