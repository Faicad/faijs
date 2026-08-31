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
  const hint: FaceHint = {
    kind: 'face',
    ...(row.surfaceType !== undefined ? { surfaceType: row.surfaceType } : {}),
    ...(row.normal && row.normal.length === 3 ? { normal: [row.normal[0], row.normal[1], row.normal[2]] as [number, number, number] } : {}),
    ...(row.center && row.center.length === 3 ? { center: [row.center[0], row.center[1], row.center[2]] as [number, number, number] } : {}),
    ...(row.area !== undefined && Number.isFinite(row.area) ? { area: row.area } : {}),
  }
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
  const hint: EdgeHint = {
    kind: 'edge',
    ...(row.length !== undefined && Number.isFinite(row.length) ? { length: row.length } : {}),
    ...(row.center && row.center.length === 3 ? { midpoint: [row.center[0], row.center[1], row.center[2]] as [number, number, number] } : {}),
  }
  return hint
}

/**
 * BREP 现场边 → EdgeHint。
 *
 * hint 是「并列裁决者」而非身份本身（§1.2），只在两邻面多公共边时用于打分。
 * length 用 `kernel.curveLength(edge)`；midpoint 取曲线参数中点的点坐标
 * （与 face 的 curvePointAtParam 同口径；屏蔽封闭/退化边的采样退化）。
 *
 * @param kernel - the OCCT kernel.
 * @param edge - the edge handle to snapshot.
 * @returns the captured EdgeHint.
 */
export function captureEdgeHint(kernel: BrepEngineApi, edge: BrepHandle): EdgeHint {
  const length = kernel.curveLength(edge)
  const hint: { kind: 'edge'; length?: number; midpoint?: [number, number, number] } = { kind: 'edge' }
  if (Number.isFinite(length) && length > 0) hint.length = length
  try {
    const { first, last } = kernel.curveParameters(edge)
    if (Number.isFinite(first) && Number.isFinite(last)) {
      const mid = kernel.curvePointAtParam(edge, (first + last) / 2)
      if (Number.isFinite(mid.x) && Number.isFinite(mid.y) && Number.isFinite(mid.z)) {
        hint.midpoint = [mid.x, mid.y, mid.z]
      }
    }
  } catch {
    // 退化边（如长度 0）读曲线参数失败 → 只留 length，不发散
  }
  return hint
}
