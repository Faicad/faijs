import type { SelectorRuntime } from './types'

/** Sentinel face id meaning "no face" for a triangle. */
export const TOPOLOGY_FACE_ID_NONE = 0xffffffff

interface FaceRunColumns {
  stride: number
  occurrenceRow: number
  primitiveIndex: number
  triangleStart: number
  triangleCount: number
  faceRow: number
}

/**
 * Resolve the column indexes used to read face-run rows from a proxy.
 *
 * @param runtime - the selector runtime whose proxy defines the run columns.
 * @returns the resolved column positions and row stride.
 */
export function faceRunColumnIndexes(runtime: SelectorRuntime): FaceRunColumns {
  const columns =
    Array.isArray(runtime.proxy.faceRunColumns) && runtime.proxy.faceRunColumns.length > 0
      ? runtime.proxy.faceRunColumns
      : ['occurrenceRow', 'primitiveIndex', 'triangleStart', 'triangleCount', 'faceRow']

  return {
    stride: columns.length,
    occurrenceRow: Math.max(0, columns.indexOf('occurrenceRow')),
    primitiveIndex: Math.max(0, columns.indexOf('primitiveIndex')),
    triangleStart: Math.max(0, columns.indexOf('triangleStart')),
    triangleCount: Math.max(0, columns.indexOf('triangleCount')),
    faceRow: Math.max(0, columns.indexOf('faceRow')),
  }
}

/** Identifies a single part/mesh for which face ids are computed. */
export interface PartMeshInfo {
  occurrenceId: string
  primitiveIndex: number
  triangleCount: number
}

/**
 * Build a per-triangle faceId array for one part/mesh (from SelectorRuntime).
 * Each entry is either a face table row index or TOPOLOGY_FACE_ID_NONE.
 *
 * @param part - identifies the part/mesh whose triangles to label.
 * @param runtime - the selector runtime providing the face-run data.
 * @returns the per-triangle faceId array, or null when no faces match.
 */
export function buildFaceIdsForPart(
  part: PartMeshInfo,
  runtime: SelectorRuntime,
): Uint32Array | null {
  const runs = runtime.proxy.faceRuns
  const triangleCount = Math.max(0, Math.floor(Number(part.triangleCount || 0)))

  if (!(runs instanceof Uint32Array) || runs.length === 0 || triangleCount <= 0) {
    return null
  }

  const occurrenceId = String(part.occurrenceId || '').trim()
  if (!occurrenceId) {
    return null
  }

  const primitiveIndex = Math.max(0, Math.floor(Number(part.primitiveIndex || 0)))
  const cols = faceRunColumnIndexes(runtime)
  const faceIds = new Uint32Array(triangleCount)
  faceIds.fill(TOPOLOGY_FACE_ID_NONE)

  let matched = false

  for (let offset = 0; offset + cols.stride <= runs.length; offset += cols.stride) {
    const runOccurrenceRow = Number(runs[offset + cols.occurrenceRow])
    const triangleStart = Number(runs[offset + cols.triangleStart])
    const runTriangleCount = Number(runs[offset + cols.triangleCount])
    const faceRow = Number(runs[offset + cols.faceRow])

    // 先按 occurrence / primitiveIndex 过滤出**属于本 part** 的行：其它 part 的行
    // 的 triangleStart 是它们自己的 mesh 坐标，用本 part 的 triangleCount 去校验会误报。
    const runOccurrenceId = runtime.occurrenceIdByRowIndex.get(runOccurrenceRow)
    if (
      runOccurrenceId !== occurrenceId ||
      Number(runs[offset + cols.primitiveIndex]) !== primitiveIndex
    ) {
      continue
    }

    // 非法行（缺三角化的面等）：triangleCount = 0 的行不参与（面结构未三角化，非破坏）。
    if (
      !Number.isInteger(triangleStart) ||
      !Number.isInteger(runTriangleCount) ||
      !Number.isInteger(faceRow) ||
      triangleStart < 0 ||
      runTriangleCount <= 0 ||
      faceRow < 0
    ) {
      continue
    }

    // I6 破坏即报错：本 part 的面行区间必须落在显示 mesh 的三角形数之内。
    // 这里**禁止静默 clamp**（旧实现 `Math.min(..., triangleCount)` 会把"面行区间
    // 越界 = 拓扑面表与显示 mesh 不同源"这一严重不一致伪装成正常结果）。
    if (triangleStart + runTriangleCount > triangleCount) {
      throw new Error(
        `E_TOPO_FACE_MESH_MISMATCH: face run row ${faceRow} covers triangles ` +
        `[${triangleStart}, ${triangleStart + runTriangleCount}) but part ${occurrenceId} ` +
        `(primitiveIndex ${primitiveIndex}) has only ${triangleCount} triangles — ` +
        `topology face table is not aligned with the display mesh`,
      )
    }

    faceIds.fill(faceRow, triangleStart, triangleStart + runTriangleCount)
    matched = true
  }

  return matched ? faceIds : null
}
