/**
 * geom-hint.ts — 几何 hint 捕获（§3.1）
 *
 * 两路：
 * - `captureFaceHint(kernel, faceHandle)`：BREP 现场面 → FaceHint（assignRoles 用）。
 * - `faceRowToHint(row)`：面行/FaceRow → FaceHint（primitive/mesh 命名槽快照用）。
 *
 * hint 字段与 SelectorRuntime 的 FaceRow（surfaceType/area/center/normal）同源
 * （§2.2），保证 BREP 现场与面行快照两条打分路径口径一致。
 */

import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import type { FaceHint, EdgeHint } from './types'

/**
 * BREP 现场面 → FaceHint。
 *
 * 面积在 occt-wasm 无公开 API（queryBatch 仅测试用），故现场路径不填 area——
 * 打分器对缺失 area 不扣分（scorerArea 双 undefined 跳过）。
 *
 * @param kernel - the OCCT kernel.
 * @param face - the face handle to snapshot.
 * @returns the captured FaceHint.
 */
export function captureFaceHint(kernel: BrepEngineApi, face: BrepHandle): FaceHint {
  const surfaceType = kernel.surfaceType(face)
  const uv = kernel.uvBounds(face)
  const u = (uv.uMin + uv.uMax) / 2
  const v = (uv.vMin + uv.vMax) / 2
  const normal = kernel.surfaceNormal(face, u, v)
  const center = kernel.getSurfaceCenterOfMass(face)
  return {
    kind: 'face',
    surfaceType,
    normal: [normal.x, normal.y, normal.z],
    center: [center.x, center.y, center.z],
  }
}

/**
 * 面行 → FaceHint（mesh/primitive 命名槽快照路径；§3.6 setTopology 注入用）。
 * 面行的 surfaceType/normal/center/area 与 BREP 现场同口径（§1.1 事实）。
 *
 * @param row - a FaceRow (or shape-compatible object) from the selector manifest.
 * @returns the FaceHint derived from the row.
 */
export function faceRowToHint(row: {
  surfaceType?: string
  normal?: readonly number[] | null
  center?: readonly number[] | null
  area?: number
}): FaceHint {
  const hint: FaceHint = { kind: 'face' }
  if (row.surfaceType !== undefined) hint.surfaceType = row.surfaceType
  if (row.normal && row.normal.length === 3) hint.normal = [row.normal[0], row.normal[1], row.normal[2]]
  if (row.center && row.center.length === 3) hint.center = [row.center[0], row.center[1], row.center[2]]
  if (row.area !== undefined && Number.isFinite(row.area)) hint.area = row.area
  return hint
}

/**
 * 边行 → EdgeHint（mesh/primitive 命名槽快照路径；§3.7 edgeNaming 用）。
 * EdgeRow.center 与 EdgeHint.midpoint 同口径（§3.7：边 midpoint 与 EdgeRow.center
 * 同口径，geom-hint.ts 统一采集）。
 *
 * @param row - an EdgeRow (or shape-compatible object) from the selector manifest.
 * @returns the EdgeHint derived from the row.
 */
export function edgeRowToHint(row: {
  length?: number
  center?: readonly number[] | null
}): EdgeHint {
  const hint: EdgeHint = { kind: 'edge' }
  if (row.length !== undefined && Number.isFinite(row.length)) hint.length = row.length
  if (row.center && row.center.length === 3) hint.midpoint = [row.center[0], row.center[1], row.center[2]]
  return hint
}
