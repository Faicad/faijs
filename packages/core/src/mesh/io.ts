/**
 * mesh IO API — headless 文件加载
 *
 * STL 由 core 自持的 `mesh/stl-loader.ts` 解析（零 three addons）；3MF 由
 * `mesh/threemf-loader.ts` 解析（ZIP 解压 + XML，单位换算到 mm 基准）。
 * 坐标永远以 faijs 基准长度单位（mm）存储 — Shape 不贴 unit 标签（D3）。
 *
 * 单位换算边界（unit-system §5.2）：
 * - STL 无单位元数据 → 由 `opts.unit` 显式声明，缺省 mm，不做启发式猜测。
 * - 3MF `<model unit>` 由解析器读取并换算（micron/mm/cm/inch/foot/meter）。
 */

import * as THREE from 'three'
import { geoToManifoldMesh } from '../boolean/geo-convert'
import { parseStl } from './stl-loader'
import { parseThreemf } from './threemf-loader'
import { mm, type ValueWithUnits } from '../units'
import type { Shape } from './types'

/**
 * Load geometry from raw file bytes (headless variant).
 *
 * @param buffer - the raw file bytes to parse.
 * @param format - format identifier such as 'stl' or '3mf'/'threemf' (defaults to 'stl').
 * @param opts - optional settings; `unit` declares the source unit for
 *   formats without unit metadata (e.g. STL). Defaults to mm.
 * @returns the loaded shape with mm-base coordinates.
 */
export async function importFile(
  buffer: ArrayBuffer,
  format?: string,
  opts?: { unit?: ValueWithUnits },
): Promise<Shape> {
  const fmt = (format ?? 'stl').toLowerCase()

  if (fmt === '3mf' || fmt === 'threemf') {
    const mesh = parseThreemf(buffer)
    return { positions: mesh.positions, indices: mesh.indices }
  }

  if (fmt === 'stl') {
    const scale = (opts?.unit ?? mm).as(mm)
    const geo = parseStl(buffer)
    if (scale !== 1) {
      const attr = geo.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      for (let i = 0; i < arr.length; i++) arr[i] *= scale
    }
    return geoToManifoldMesh(geo)
  }

  // Other known-but-unimplemented formats fall back to STL for backward
  // compatibility, exactly as before; unknown binary throws.
  throw new Error(`[mesh/io] unsupported format: ${fmt}`)
}