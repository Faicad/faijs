/**
 * resolve-face.ts — 面 TopoRef 解析（移植 brepjs shapeRefFns.resolveRef，§2.5）
 *
 * 解析策略：
 * 1. 精确：roleTable[origin][role] 的 hash 命中当前面
 *    - 恰好 1 → exact；0 → deleted；多个（1→多分裂）→ 只在这几个候选间用 hint 打分
 * 2. 几何兜底（role 缺失 / 分裂打分未命中）：在当前全部面上按 hint 打分
 *    - BREP：kernel 现场几何；mesh/primitive：命名槽面 hint 快照
 * 3. 最优分 > MIN_SCORE 且与次优差 ≥ AMBIGUITY_THRESHOLD → geometric-fallback；
 *    否则 ambiguous（并列）/ not-found（无超阈值候选）
 *
 * 任何一步定不了案就返回三态（调用方抛 TopoRefError），绝不静默拿序号硬取。
 */

import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import type { FaceHint, FaceTopoRef, RoleTable, TopoResolution } from './types'
import { scoreCandidate, MIN_SCORE, AMBIGUITY_THRESHOLD } from './score'

/** 单个面候选：枚举序号 + 会话内 hash +（BREP 句柄 或 面行快照）。 */
export interface FaceCandidateEntry {
  /** 面枚举序号（1 起，TopExp::MapShapes 序；与 FaceRow.id 的 `o1.fN` 同序）。 */
  ordinal: number
  /** 会话内 hash（BREP：subShapeHashes；exact 匹配用）。 */
  hash?: number
  /** BREP 现场句柄（存在 → 打分走 kernel 现场几何）。 */
  handle?: BrepHandle
  /** mesh/primitive 面行快照（存在 → 打分走 scoreCandidate row 路径）。 */
  row?: Readonly<{
    surfaceType?: string
    normal?: readonly number[]
    center?: readonly number[]
    area?: number
  }>
}

/** 面解析上下文：候选表 + role 表 + kernel（BREP 现场打分用，可为 null）。 */
export interface ResolutionContext {
  /** OCCT 内核（mesh/primitive 路径为 null——打分走 row 快照）。 */
  readonly kernel: BrepEngineApi | null
  /** 当前快照的全部面候选（按枚举序，ordinal 1 起）。 */
  readonly faces: readonly FaceCandidateEntry[]
  /** 该 part 的 RoleTable（BREP 链上的 part 有；mesh/primitive 无 → 只走几何兜底）。 */
  readonly roleTable?: RoleTable
}

/** 打分候选 → 候选条目（handle 优先、row 兜底，与 score.ts FaceCandidate 同构）。 */
function toScoringCandidate(c: FaceCandidateEntry): { handle?: BrepHandle; row?: FaceCandidateEntry['row'] } {
  return c.handle !== undefined ? { handle: c.handle } : { row: c.row }
}

/** 一组候选对 hint 打分：best / secondBest / scored。 */
function scoreCandidates(
  hint: FaceHint,
  candidates: readonly FaceCandidateEntry[],
  ctx: ResolutionContext,
): { scored: Array<{ candidate: FaceCandidateEntry; score: number }>; best?: FaceCandidateEntry; bestScore: number; secondBestScore: number } {
  let bestScore = -Infinity
  let secondBestScore = -Infinity
  let best: FaceCandidateEntry | undefined
  const scored: Array<{ candidate: FaceCandidateEntry; score: number }> = []
  for (const c of candidates) {
    const score = scoreCandidate(ctx.kernel, hint, toScoringCandidate(c))
    if (score > MIN_SCORE) scored.push({ candidate: c, score })
    if (score > bestScore) {
      secondBestScore = bestScore
      bestScore = score
      best = c
    } else if (score > secondBestScore) {
      secondBestScore = score
    }
  }
  return { scored, best, bestScore, secondBestScore }
}

/** 打分结果 → 三态（match / ambiguous / none）。 */
function outcomeOf(
  hint: FaceHint,
  candidates: readonly FaceCandidateEntry[],
  ctx: ResolutionContext,
): { kind: 'match'; candidate: FaceCandidateEntry } | { kind: 'ambiguous'; candidates: FaceCandidateEntry[] } | { kind: 'none' } {
  const { scored, best, bestScore, secondBestScore } = scoreCandidates(hint, candidates, ctx)
  if (best !== undefined && bestScore > MIN_SCORE) {
    if (bestScore - secondBestScore < AMBIGUITY_THRESHOLD && scored.length > 1) {
      const competitive = scored
        .filter((e) => e.score >= bestScore - AMBIGUITY_THRESHOLD)
        .map((e) => e.candidate)
      return { kind: 'ambiguous', candidates: competitive }
    }
    return { kind: 'match', candidate: best }
  }
  return { kind: 'none' }
}

/**
 * 解析面 TopoRef 到当前快照的序号/句柄。
 *
 * @param ref - the face TopoRef to resolve.
 * @param ctx - the resolution context (candidates + role table + kernel).
 * @returns the three-state TopoResolution.
 */
export function resolveFaceTopo(
  ref: FaceTopoRef,
  ctx: ResolutionContext,
): TopoResolution<{ handle?: BrepHandle }> {
  // 1. 精确：role 的追踪 hash 在候选面中命中
  const targetHashes = ctx.roleTable?.get(ref.origin)?.get(ref.role)
  if (targetHashes !== undefined && targetHashes.length > 0) {
    const survivors = ctx.faces.filter((f) => f.hash !== undefined && targetHashes.includes(f.hash))
    if (survivors.length === 1) {
      const [only] = survivors
      if (only) {
        return { ok: true, entity: { handle: only.handle }, ordinal: only.ordinal, confidence: 'exact' }
      }
    } else if (survivors.length === 0) {
      return { ok: false, reason: 'deleted' }
    } else {
      // 1→多分裂：只在后继内裁决，不与全形状竞争
      const split = outcomeOf(ref.hint, survivors, ctx)
      if (split.kind === 'match') {
        return {
          ok: true,
          entity: { handle: split.candidate.handle },
          ordinal: split.candidate.ordinal,
          confidence: 'geometric-fallback',
        }
      }
      if (split.kind === 'ambiguous') {
        return { ok: false, reason: 'ambiguous', candidatesOrdinal: split.candidates.map((c) => c.ordinal) }
      }
      // 'none' → 落到全形状几何兜底
    }
  }

  // 2. 几何兜底：全形状打分
  const all = outcomeOf(ref.hint, ctx.faces, ctx)
  if (all.kind === 'match') {
    return {
      ok: true,
      entity: { handle: all.candidate.handle },
      ordinal: all.candidate.ordinal,
      confidence: 'geometric-fallback',
    }
  }
  if (all.kind === 'ambiguous') {
    return { ok: false, reason: 'ambiguous', candidatesOrdinal: all.candidates.map((c) => c.ordinal) }
  }
  return { ok: false, reason: 'not-found' }
}
