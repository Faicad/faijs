/**
 * resolve-derived.ts — 生成面（倒角/圆角过渡面）TopoRef 解析
 * （移植 brepjs derivedFaceRefFns，§4.5）
 *
 * 生成面没有稳定 hash（操作前不存在，fillet/chamfer 演化为空），
 * 以「桥接的两面」lineage 命名：解析 = 重找被桥接的两面 → 取同时邻接
 * 两者的面 → 法向混合过滤（过渡面法向同时正比于两条被桥接法向，
 * 正交的侧面被拒绝）→ 边中点裁决并列。
 */

import type { BrepHandle } from '../../brep/engine/types'
import type { DerivedFaceTopoRef, TopoResolution } from './types'
import type { FaceCandidateEntry, ResolutionContext } from './resolve-face'
import { facesForQualifier } from './resolve-edge'

/** 面法向与捕获法向几乎一致才视为「重导出被桥接面」。 */
const NORMAL_MATCH = 0.99
/** 过渡面法向须对两条被桥接法向都有正分量。 */
const BLEND_THRESHOLD = 0.1
/** 并列距离容差。 */
const HINT_MARGIN = 1e-6

/** 法向点积。 */
function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** 面候选的法向（row 快照；无则 undefined）。 */
function normalOf(face: FaceCandidateEntry): readonly number[] | undefined {
  return face.row?.normal
}

/**
 * 解析生成面 TopoRef 到当前快照的面序号。
 *
 * @param ref - the derived-face TopoRef to resolve.
 * @param ctx - the resolution context (needs faceAdjacency for lineage).
 * @returns the three-state TopoResolution with the face ordinal.
 */
export function resolveDerivedFaceTopo(
  ref: DerivedFaceTopoRef,
  ctx: ResolutionContext,
): TopoResolution<{ handle?: BrepHandle }> {
  const [qualA, qualB] = ref.between
  let facesA = facesForQualifier(qualA, ctx)
  if (facesA.length === 0) facesA = facesByNormal(ctx, ref.hint.normalA)
  let facesB = facesForQualifier(qualB, ctx)
  if (facesB.length === 0) facesB = facesByNormal(ctx, ref.hint.normalB)
  if (facesA.length === 0 || facesB.length === 0) {
    return { ok: false, reason: 'not-found' }
  }

  // 同时邻接 A 面与 B 面的面（排除 A/B 自身）
  const blended = betweenFaces(ctx, facesA, facesB).filter((f) => {
    const n = normalOf(f)
    if (!n) return false
    return dot(n, ref.hint.normalA) > BLEND_THRESHOLD && dot(n, ref.hint.normalB) > BLEND_THRESHOLD
  })

  if (blended.length === 1) {
    const [only] = blended
    if (only !== undefined) {
      return { ok: true, entity: { handle: only.handle }, ordinal: only.ordinal, confidence: 'geometric-fallback' }
    }
  }

  if (blended.length > 1) {
    const best = ref.hint.edgeMidpoint && nearestByMidpoint(blended, ref.hint.edgeMidpoint)
    if (best !== undefined) {
      return { ok: true, entity: { handle: best.handle }, ordinal: best.ordinal, confidence: 'geometric-fallback' }
    }
    return { ok: false, reason: 'ambiguous', candidatesOrdinal: blended.map((f) => f.ordinal) }
  }

  return { ok: false, reason: 'not-found' }
}

/** 法向与目标法向几乎一致的面（重导出被桥接面）。 */
function facesByNormal(ctx: ResolutionContext, normal: readonly number[]): FaceCandidateEntry[] {
  return ctx.faces.filter((f) => {
    const n = normalOf(f)
    return n !== undefined && dot(n, normal) > NORMAL_MATCH
  })
}

/** 同时邻接 A、B 面集合的面（排除 A/B 自身，face→face 邻接交集）。 */
function betweenFaces(
  ctx: ResolutionContext,
  aFaces: readonly FaceCandidateEntry[],
  bFaces: readonly FaceCandidateEntry[],
): FaceCandidateEntry[] {
  const exclude = new Set<number>([...aFaces, ...bFaces].map((f) => f.ordinal))
  const adjacentToA = new Set<number>()
  for (const a of aFaces) {
    for (const n of ctx.faceAdjacency?.[a.ordinal - 1] ?? []) adjacentToA.add(n)
  }
  const betweenOrdinals = new Set<number>()
  for (const b of bFaces) {
    for (const n of ctx.faceAdjacency?.[b.ordinal - 1] ?? []) {
      if (!exclude.has(n) && adjacentToA.has(n)) betweenOrdinals.add(n)
    }
  }
  if (betweenOrdinals.size === 0) return []
  const byOrdinal = new Map(ctx.faces.map((f) => [f.ordinal, f]))
  const result: FaceCandidateEntry[] = []
  for (const ord of betweenOrdinals) {
    const f = byOrdinal.get(ord)
    if (f) result.push(f)
  }
  return result
}

/** 距边中点最近的面；并列 → undefined（ambiguous）。 */
function nearestByMidpoint(faces: readonly FaceCandidateEntry[], point: readonly number[]): FaceCandidateEntry | undefined {
  let best: FaceCandidateEntry | undefined
  let bestDist = Infinity
  let secondDist = Infinity
  for (const f of faces) {
    const c = f.row?.center
    if (c === undefined) continue
    const d = distance(c, point)
    if (d < bestDist) {
      secondDist = bestDist
      bestDist = d
      best = f
    } else if (d < secondDist) {
      secondDist = d
    }
  }
  if (best === undefined || secondDist - bestDist < HINT_MARGIN) return undefined
  return best
}

/** 两点欧氏距离。 */
function distance(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
