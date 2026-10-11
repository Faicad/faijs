/**
 * geo-convert — 纯数据转换函数（从 csg.ts 提取）
 *
 * { positions, indices } ↔ ManifoldMeshData 转换（焊接 + 法线派生）。
 * 不依赖 Worker / postMessage，可在 Node 和浏览器环境通用。
 */

import { weldMesh } from '../mesh/meshdata/weld'
import { deriveNormals } from './deriveNormals'
import type { Shape } from '../mesh/types'

// ── 类型（与 csg.ts 保持一致）──

/** The set of supported boolean operations. */
export type BooleanOperation = 'union' | 'subtract' | 'intersect'

/** Interchange mesh representation: interleaved positions with triangle indices. */
export interface ManifoldMeshData {
  positions: Float32Array
  indices: Uint32Array
}

/** Design parameters for a dovetail groove (depth, tolerances, width, flaps angle). */
export interface DovetailGrooveParams {
  depth: number
  depthTolerance: number
  width: number
  widthTolerance: number
  flapsAngle: number
}

/** Design parameters for a dowel split (diameter, tolerances, height). */
export interface DowelSplitParams {
  diameter: number
  diameterTolerance: number
  height: number
  heightTolerance: number
}

/** Design parameters for a straight-tenon split (side length, tolerances, height). */
export interface StraightTenonSplitParams {
  sideLength: number
  sideLengthTolerance: number
  height: number
  heightTolerance: number
}

// ── { positions, indices } → ManifoldMeshData（焊接重复顶点）──

/**
 * Convert raw position+index data into ManifoldMeshData, welding duplicate vertices.
 * @param data - the source mesh data with positions and indices.
 * @returns the converted mesh data with welded, unique vertices.
 */
export function geoToManifoldMesh(
  data: { positions: ArrayLike<number>; indices: ArrayLike<number> },
): ManifoldMeshData {
  return weldMesh(data.positions, data.indices)
}

// ── ManifoldMeshData → Shape（含法线派生）──

/**
 * Convert ManifoldMeshData into a Shape, optionally computing creased normals.
 * @param data - the source mesh data.
 * @param options - optional settings; computeNormals defaults to true and derives creased normals.
 * @returns the resulting Shape (empty when there are no positions or indices).
 */
export function manifoldMeshToGeo(
  data: ManifoldMeshData,
  options?: { computeNormals?: boolean },
): Shape {
  if (data.positions.length === 0 || data.indices.length === 0) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) }
  }
  const shape: Shape = {
    positions: new Float32Array(data.positions),
    indices: new Uint32Array(data.indices),
  }
  if (options?.computeNormals !== false) {
    return deriveNormals(shape)
  }
  return shape
}
