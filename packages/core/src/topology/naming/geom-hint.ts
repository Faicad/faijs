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
import type { FaceHint, EdgeHint, AxisHint } from './types'

/** 归一化向量（axis 采集内部用；零向量返回 null，调用方放弃采集）。 */
function normalizedAxis(v: [number, number, number]): [number, number, number] | null {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < 1e-12 || !Number.isFinite(len)) return null
  return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * BREP 现场圆柱面 → 轴 hint（P0 装配前置）。
 *
 * 算法与 occt-kernel/topologyExt.ts getSurfaceParams 的 cylinder 分支同源：
 * direction = normalize(S(u,v+1) − S(u,v))（V 向即轴向）；origin = P − R·外法向
 *（surfaceNormal 含朝向，reversed 面先取反修正）。
 *
 * @param kernel - the OCCT kernel.
 * @param face - the cylindrical face handle.
 * @returns the axis hint, or undefined when the axis cannot be derived.
 */
function captureCylinderFaceAxis(kernel: BrepEngineApi, face: BrepHandle): AxisHint | undefined {
  try {
    const uv = kernel.uvBounds(face)
    const p0 = kernel.pointOnSurface(face, uv.uMin, uv.vMin)
    const p1 = kernel.pointOnSurface(face, uv.uMin, uv.vMin + 1)
    const direction = normalizedAxis([p1.x - p0.x, p1.y - p0.y, p1.z - p0.z])
    const cyl = kernel.getFaceCylinderData(face)
    if (!direction || !cyl) return undefined
    let sn = kernel.surfaceNormal(face, uv.uMin, uv.vMin)
    if (kernel.shapeOrientation(face) === 'reversed') {
      sn = { x: -sn.x, y: -sn.y, z: -sn.z }
    }
    const origin: [number, number, number] = [
      p0.x - cyl.radius * sn.x,
      p0.y - cyl.radius * sn.y,
      p0.z - cyl.radius * sn.z,
    ]
    return { origin, direction }
  } catch {
    return undefined
  }
}

/**
 * BREP 现场圆边 → 轴 hint（origin = 圆心，direction = 所在平面法向；P0 装配前置）。
 *
 * 用曲线上三个不同参数的采样点做外接圆圆心（三点定圆，精确、无弧长近似），
 * 法向取 (p1−p0)×(p2−p0) 归一化。只用 curvePointAtParam/curveParameters 等既有
 * 公开内核 API（与 getCurveParams 的 circle 分支同一能力面），不新增内核方法。
 *
 * @param kernel - the OCCT kernel.
 * @param edge - the circular edge handle.
 * @returns the axis hint, or undefined when sampling fails.
 */
function captureCircleEdgeAxis(kernel: BrepEngineApi, edge: BrepHandle): AxisHint | undefined {
  try {
    const { first, last } = kernel.curveParameters(edge)
    if (!Number.isFinite(first) || !Number.isFinite(last)) return undefined
    const d = (last - first) / 3
    const pa = kernel.curvePointAtParam(edge, first)
    const pb = kernel.curvePointAtParam(edge, first + d)
    const pc = kernel.curvePointAtParam(edge, first + 2 * d)
    const e1: [number, number, number] = [pb.x - pa.x, pb.y - pa.y, pb.z - pa.z]
    const e2: [number, number, number] = [pc.x - pa.x, pc.y - pa.y, pc.z - pa.z]
    // 三点外接圆：解 o = a + α·e1 + β·e2，满足 |o−a| = |o−b| = |o−c|
    const e11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2]
    const e22 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2]
    const e12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]
    const denom = e11 * e22 - e12 * e12
    if (Math.abs(denom) < 1e-18) return undefined
    const alpha = (e11 * e22 - e22 * e12) / (2 * denom)
    const beta = (e22 * e11 - e11 * e12) / (2 * denom)
    const origin: [number, number, number] = [
      pa.x + alpha * e1[0] + beta * e2[0],
      pa.y + alpha * e1[1] + beta * e2[1],
      pa.z + alpha * e1[2] + beta * e2[2],
    ]
    const direction = normalizedAxis([
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ])
    if (!direction) return undefined
    return { origin, direction }
  } catch {
    return undefined
  }
}

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
  // P0 装配前置：圆柱面采集轴 hint（其余面类型缺省——平面用 center+normal 即可）
  const axis = surfaceType === 'cylinder' ? captureCylinderFaceAxis(kernel, face) : undefined
  return {
    kind: 'face',
    surfaceType,
    normal: [normal.x, normal.y, normal.z],
    center: [center.x, center.y, center.z],
    ...(axis ? { axis } : {}),
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
  axis?: { origin?: readonly number[] | null; direction?: readonly number[] | null } | null
}): FaceHint {
  const hint: FaceHint = {
    kind: 'face',
    ...(row.surfaceType !== undefined ? { surfaceType: row.surfaceType } : {}),
    ...(row.normal && row.normal.length === 3 ? { normal: [row.normal[0], row.normal[1], row.normal[2]] as [number, number, number] } : {}),
    ...(row.center && row.center.length === 3 ? { center: [row.center[0], row.center[1], row.center[2]] as [number, number, number] } : {}),
    ...(row.area !== undefined && Number.isFinite(row.area) ? { area: row.area } : {}),
    ...(row.axis?.origin && row.axis.origin.length === 3 && row.axis.direction && row.axis.direction.length === 3
      ? {
          axis: {
            origin: [row.axis.origin[0], row.axis.origin[1], row.axis.origin[2]] as [number, number, number],
            direction: [row.axis.direction[0], row.axis.direction[1], row.axis.direction[2]] as [number, number, number],
          },
        }
      : {}),
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
  axis?: { origin?: readonly number[] | null; direction?: readonly number[] | null } | null
}): EdgeHint {
  const hint: EdgeHint = {
    kind: 'edge',
    ...(row.length !== undefined && Number.isFinite(row.length) ? { length: row.length } : {}),
    ...(row.center && row.center.length === 3 ? { midpoint: [row.center[0], row.center[1], row.center[2]] as [number, number, number] } : {}),
    ...(row.axis?.origin && row.axis.origin.length === 3 && row.axis.direction && row.axis.direction.length === 3
      ? {
          axis: {
            origin: [row.axis.origin[0], row.axis.origin[1], row.axis.origin[2]] as [number, number, number],
            direction: [row.axis.direction[0], row.axis.direction[1], row.axis.direction[2]] as [number, number, number],
          },
        }
      : {}),
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
/**
 * BREP 现场边 → 轴 hint（装配约束的边实体来源；P0 前置）。
 *
 * 直边：origin = 曲线起点，direction = 起点切向；
 * 圆边：origin = 圆心（三点定圆），direction = 所在平面法向；
 * 其它曲线类型 → undefined（不静默造轴）。
 *
 * @param kernel - the OCCT kernel.
 * @param edge - the edge handle.
 * @returns the axis hint, or undefined for unsupported curves / sampling failure.
 */
export function captureEdgeAxis(kernel: BrepEngineApi, edge: BrepHandle): AxisHint | undefined {
  try {
    const curveType = kernel.curveType(edge)
    if (curveType === 'line') {
      const { first } = kernel.curveParameters(edge)
      const origin = kernel.curvePointAtParam(edge, first)
      const tangent = kernel.curveTangent(edge, first)
      const direction = normalizedAxis([tangent.x, tangent.y, tangent.z])
      if (Number.isFinite(origin.x) && Number.isFinite(origin.y) && Number.isFinite(origin.z) && direction) {
        return { origin: [origin.x, origin.y, origin.z], direction }
      }
    } else if (curveType === 'circle') {
      return captureCircleEdgeAxis(kernel, edge)
    }
  } catch {
    // 曲线类型读取失败 → 无 axis hint（调用方按缺省处理，不静默造轴）
  }
  return undefined
}

/**
 * 采集棱边 hint（长度 / 中点 / 轴）。
 *
 * P0 装配前置：直边（起点 + 切向）与圆边（圆心 + 所在平面法向）产出 axis hint；
 * 退化或非线/圆曲线不产出 axis（调用方按缺省处理，不静默造轴）。
 *
 * @param kernel - the BREP engine API.
 * @param edge - the edge handle.
 * @returns the captured edge hint.
 */
export function captureEdgeHint(kernel: BrepEngineApi, edge: BrepHandle): EdgeHint {
  const length = kernel.curveLength(edge)
  const hint: { kind: 'edge'; length?: number; midpoint?: [number, number, number]; axis?: AxisHint } = { kind: 'edge' }
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
  // P0 装配前置：直边（起点+切向）/ 圆边（圆心+法向）采集轴 hint
  const axis = captureEdgeAxis(kernel, edge)
  if (axis) hint.axis = axis
  return hint
}
