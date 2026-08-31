/**
 * score.ts — 面候选打分器（移植 brepjs src/topology/shapeRef/scoring.ts）
 *
 * 两套实现，口径一致、结果可比（§3.5）：
 * - `defaultFaceScorer`：BREP 现场几何（kernel 计算 surfaceType/normal/center/area）
 * - `scoreFaceRow`：mesh/primitive 面行快照（FaceRow 或命名槽 FaceHint）
 *
 * 阈值常量化并写明 mm 单位假设——faijs 契约就是 mm，可直接沿用 brepjs 阈值。
 */

import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import type { FaceHint } from './types'

/** 打分函数：分越高越匹配；-Infinity 直接拒绝。 */
export type FaceScorer = (hint: FaceHint, candidate: FaceCandidate) => number

/** 打分候选：BREP 现场句柄 或 mesh/primitive 面行快照，二选一。 */
export interface FaceCandidate {
  /** BREP 现场面句柄（走 kernel 现场几何）。 */
  readonly handle?: BrepHandle
  /** 面行快照（mesh/primitive；与 handle 二选一）。 */
  readonly row?: Readonly<{
    surfaceType?: string
    normal?: readonly number[]
    center?: readonly number[]
    area?: number
  }>
}

/** 曲面类型不符直接拒绝（硬门）。 */
const TYPE_MISMATCH = -Infinity
/** 法向点积下限（拒绝阈值）。 */
const NORMAL_DOT_MIN = 0.707
/** 质心距²上限（mm²；拒绝阈值）。 */
const CENTROID_DIST_SQ_MAX = 100
/** 面积 |log 比| 超此值扣分。 */
const AREA_LOG_RATIO_MAX = 1.0
/** 几何兜底接受的最小分。 */
export const MIN_SCORE = 0.5
/** 并列模糊带：两候选分差小于此值视为并列（→ ambiguous）。 */
export const AMBIGUITY_THRESHOLD = 0.1

/** 从候选读取几何量的统一入口（handle 优先，row 兜底）。 */
function candidateGeometry(
  kernel: BrepEngineApi | null,
  candidate: FaceCandidate,
): { surfaceType?: string; normal?: readonly number[]; center?: readonly number[]; area?: number } {
  if (candidate.handle !== undefined && kernel) {
    const center = kernel.getSurfaceCenterOfMass(candidate.handle)
    const uv = kernel.uvBounds(candidate.handle)
    const u = (uv.uMin + uv.uMax) / 2
    const v = (uv.vMin + uv.vMax) / 2
    const normal = kernel.surfaceNormal(candidate.handle, u, v)
    return {
      surfaceType: kernel.surfaceType(candidate.handle),
      normal: [normal.x, normal.y, normal.z],
      center: [center.x, center.y, center.z],
      area: faceAreaOf(kernel, candidate.handle),
    }
  }
  return candidate.row ?? {}
}

/** 面面积：BREP 现场无直接 API，用包围盒近似不可靠——退化为 undefined（不打分）。 */
function faceAreaOf(_kernel: BrepEngineApi, _face: BrepHandle): number | undefined {
  // occt-wasm 无公开 face area API（queryBatch 仅测试用、返回 {area} 但生产路径零调用）。
  // hint 携带的 area 仍参与面积比扣分（见 scorerArea），此处返回 undefined 表示「现场未知」。
  return undefined
}

/** 面积比扣分（hint.area 已知且 >0 时）。 */
function scorerArea(hint: FaceHint, area: number | undefined): number {
  if (hint.area === undefined || hint.area <= 0) return 0
  if (area === undefined || area <= 0) return 0
  const logRatio = Math.abs(Math.log(hint.area / area))
  return logRatio > AREA_LOG_RATIO_MAX ? -logRatio : 0
}

/**
 * 打分一条候选（共用于 BREP 现场与面行快照两路）。
 *
 * @param kernel - OCCT 内核（candidate.handle 路径需要；row 路径可传 null）。
 * @param hint - 被解析 TopoRef 携带的面 hint。
 * @param candidate - 候选（句柄或面行）。
 * @returns 综合分；-Infinity 表示硬性不匹配。
 */
export function scoreCandidate(
  kernel: BrepEngineApi | null,
  hint: FaceHint,
  candidate: FaceCandidate,
): number {
  let score = 0
  const g = candidateGeometry(kernel, candidate)

  // 曲面类型硬门
  if (hint.surfaceType !== undefined) {
    if (g.surfaceType === hint.surfaceType) {
      score += 1.0
    } else {
      return TYPE_MISMATCH
    }
  }

  // 法向点积
  if (hint.normal !== undefined && g.normal !== undefined) {
    const dot =
      hint.normal[0] * g.normal[0] +
      hint.normal[1] * g.normal[1] +
      hint.normal[2] * g.normal[2]
    if (dot < NORMAL_DOT_MIN) return TYPE_MISMATCH
    score += dot
  }

  // 质心距²惩罚
  if (hint.center !== undefined && g.center !== undefined) {
    const dx = hint.center[0] - g.center[0]
    const dy = hint.center[1] - g.center[1]
    const dz = hint.center[2] - g.center[2]
    const distSq = dx * dx + dy * dy + dz * dz
    if (distSq > CENTROID_DIST_SQ_MAX) return TYPE_MISMATCH
    score -= distSq / 100
  }

  // 面积比扣分
  score += scorerArea(hint, g.area)

  return score
}

/**
 * BREP 现场打分器（§3.5 defaultFaceScorer 移植）：候选是活句柄，几何现场算。
 * 保持与 scoreFaceRow 同一套权重，保证两路结果可比。
 */
/**
 * Build a scorer that computes geometry live from a BREP kernel handle.
 *
 * @param kernel - the OCCT kernel used to evaluate candidate face geometry.
 * @returns a FaceScorer scoring live face handles against a FaceHint.
 */
export function defaultFaceScorer(kernel: BrepEngineApi): FaceScorer {
  return (hint, candidate) => scoreCandidate(kernel, hint, candidate)
}

/**
 * 面行/命名槽快照打分器（§3.5 scoreFaceRow）：候选是 FaceRow/hint 快照，
 * 用于 mesh/primitive（无 kernel 现场几何）。
 *
 * @param hint - the FaceHint carried by the TopoRef being resolved.
 * @param row - the candidate face-row snapshot (surfaceType/normal/center/area).
 * @returns the combined score; -Infinity rejects the candidate outright.
 */
export function scoreFaceRow(hint: FaceHint, row: FaceCandidate['row']): number {
  return scoreCandidate(null, hint, { row })
}
