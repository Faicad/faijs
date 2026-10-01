/**
 * resolve-edge.ts — 边 TopoRef 解析（移植 brepjs edgeRefFns，§4.2/§4.3）
 *
 * 边 = 两邻面之交。EdgeTopoRef.faces 是两个 RoleQualifier（带 origin，faijs 扩展：
 * 布尔合流后两面可能来自不同 origin）。
 *
 * 解析 = 两 role 解析到当前面 → 取公共边：
 * - 1 条公共边 → exact
 * - 多条（两邻面沿多边相接，如圆角面）→ hint（length/midpoint）裁决
 * - 无公共边 / role 缺失 → not-found
 *
 * mesh 无 face→edge 邻接（build-mesh-topology.ts:262，§5.3 能力边界）→
 * lineage 不可用，只能给边 hint；此时解析降级为「纯 hint 匹配」并显式标注。
 */

import type { BrepHandle } from '../../brep/engine/types'
import type { EdgeTopoRef, RoleQualifier, TopoResolution } from './types'
import { resolveFaceTopo, type EdgeCandidateEntry, type FaceCandidateEntry, type ResolutionContext } from './resolve-face'

/** Hint 距离比这更近视为不可区分（→ ambiguous）。 */
const HINT_MARGIN = 1e-6

/** 两点的欧氏距离。 */
function distance(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * 解析一个 RoleQualifier 到当前面候选（exact 优先，几何兜底）。
 *
 * @param qualifier - the face role qualifier (origin + role).
 * @param ctx - the resolution context.
 * @returns the face candidates for the role (possibly several after a split).
 */
export function facesForQualifier(
  qualifier: RoleQualifier,
  ctx: ResolutionContext,
): FaceCandidateEntry[] {
  const targetHashes = ctx.roleTable?.get(qualifier.origin)?.get(qualifier.role)
  if (targetHashes !== undefined && targetHashes.length > 0) {
    const survivors = ctx.faces.filter((f) => f.hash !== undefined && targetHashes.includes(f.hash))
    if (survivors.length > 0) return survivors
  }
  // role 缺失/未命中 → 几何兜底（只取最优面，与 resolveFaceTopo 同口径）
  const resolution = resolveFaceTopo(
    { kind: 'face', origin: qualifier.origin, role: qualifier.role, hint: { kind: 'face' } },
    ctx,
  )
  if (resolution.ok) {
    const hit = ctx.faces.find((f) => f.ordinal === resolution.ordinal)
    if (hit) return [hit]
  }
  return []
}

/** 两面的公共边 ordinal（face→edge 邻接交集）。 */
function sharedEdgeOrdinals(faceA: FaceCandidateEntry, faceB: FaceCandidateEntry, ctx: ResolutionContext): number[] {
  const aEdges = new Set(ctx.faceEdgeAdjacency?.[faceA.ordinal - 1] ?? [])
  const bEdges = new Set(ctx.faceEdgeAdjacency?.[faceB.ordinal - 1] ?? [])
  const shared: number[] = []
  for (const e of aEdges) if (bEdges.has(e)) shared.push(e)
  return shared
}

/** 候选边 hint 与 ref hint 的距离分（越小越匹配）。 */
function edgeHintScore(edge: { hint?: { length?: number; midpoint?: readonly number[] } }, refHint: EdgeTopoRef['hint']): number {
  let score = 0
  if (refHint.length !== undefined && edge.hint?.length !== undefined) {
    score += Math.abs(edge.hint.length - refHint.length)
  }
  if (refHint.midpoint !== undefined && edge.hint?.midpoint !== undefined) {
    score += distance(edge.hint.midpoint, refHint.midpoint)
  }
  return score
}

/**
 * 在候选边集合里按**纯几何** hint（length / midpoint）取最优边。
 *
 * 这是「没有 role 层的边身份」的唯一裁决器，两个消费点共用同一份实现：
 * - `resolveEdgeTopo` 的多公共边裁决与 mesh 降级路径；
 * - 网格实体（近似拓扑）的边解析——那里 `EdgeTopoRef.faces` 只是占位限定符
 *   （网格零件没有 role，见 `mesh-primitive.test.ts` 的 Phase 1.8 契约）。
 *
 * 无法区分（最优点与次优点差值 < `HINT_MARGIN`）→ `undefined`，调用方按
 * ambiguous / not-found 如实报错，**绝不**静默拿序号硬取。
 *
 * @param edges - the candidate edges (ordinal + optional handle/hint).
 * @param hint - the edge hint carrying length / midpoint.
 * @returns the best-matching candidate, or undefined when the hint cannot decide.
 */
export function matchEdgeByHint(
  edges: readonly EdgeCandidateEntry[],
  hint: EdgeTopoRef['hint'],
): { ordinal: number; handle?: BrepHandle } | undefined {
  if (hint.length === undefined && hint.midpoint === undefined) return undefined
  let best: { ordinal: number; handle?: BrepHandle } | undefined
  let bestScore = Infinity
  let secondScore = Infinity
  for (const edge of edges) {
    const score = edgeHintScore(edge, hint)
    if (score < bestScore) {
      secondScore = bestScore
      bestScore = score
      best = { ordinal: edge.ordinal, handle: edge.handle }
    } else if (score < secondScore) {
      secondScore = score
    }
  }
  if (best === undefined || secondScore - bestScore < HINT_MARGIN) return undefined
  return best
}

/**
 * 解析边 TopoRef 到当前快照的边序号。
 *
 * @param ref - the edge TopoRef to resolve.
 * @param ctx - the resolution context (needs faceEdgeAdjacency for lineage).
 * @returns the three-state TopoResolution with the edge ordinal.
 */
export function resolveEdgeTopo(
  ref: EdgeTopoRef,
  ctx: ResolutionContext,
): TopoResolution<{ handle?: BrepHandle }> {
  const [qualA, qualB] = ref.faces
  const facesA = facesForQualifier(qualA, ctx)
  const facesB = facesForQualifier(qualB, ctx)
  if (facesA.length === 0 || facesB.length === 0) {
    // 无 role 层的近似拓扑（网格实体）：`faces` 是占位限定符，两个 RoleQualifier
    // 都不可能解析到面——既没有 roleTable（网格零件不冒充 role，Phase 1.8），
    // 限定符本身也不携带几何（类型上只有 origin/role）。边的身份只剩几何一条路：
    // 在整个边表上按 hint 匹配并标注 geometric-fallback。
    //
    // 判据是 `!ctx.faceEdgeAdjacency`：BREP 上下文**总是**带 face→edge 邻接
    // （buildEdgeResolutionContext 现场枚举），故这条分支对 BREP 零影响——
    // BREP 侧解析不到面仍然是 not-found，不会退化成"按长度瞎猜一条边"。
    if (!ctx.faceEdgeAdjacency && ctx.edges && ctx.edges.length > 0) {
      const best = matchEdgeByHint(ctx.edges, ref.hint)
      if (best !== undefined) {
        return { ok: true, entity: { handle: best.handle }, ordinal: best.ordinal, confidence: 'geometric-fallback' }
      }
    }
    return { ok: false, reason: 'not-found' }
  }

  // 收集所有 (a, b) 面对的公共边
  const shared = new Set<number>()
  for (const a of facesA) {
    for (const b of facesB) {
      for (const e of sharedEdgeOrdinals(a, b, ctx)) shared.add(e)
    }
  }

  const unique = [...shared]
  if (unique.length === 1) {
    const [only] = unique
    if (only !== undefined) {
      const edge = ctx.edges?.find((e) => e.ordinal === only)
      return { ok: true, entity: { handle: edge?.handle }, ordinal: only, confidence: 'exact' }
    }
  }

  if (unique.length > 1) {
    // 多公共边 → hint 裁决
    const best = bestEdgeByHint(unique, ref.hint, ctx)
    if (best !== undefined) return { ok: true, entity: { handle: best.handle }, ordinal: best.ordinal, confidence: 'geometric-fallback' }
    return { ok: false, reason: 'ambiguous', candidatesOrdinal: unique }
  }

  // 无公共边：face→edge 邻接缺失（mesh）→ 纯 hint 匹配整个边表；否则 not-found
  if (!ctx.faceEdgeAdjacency && ctx.edges && ctx.edges.length > 0) {
    const best = bestEdgeByHint(ctx.edges.map((e) => e.ordinal), ref.hint, ctx)
    if (best !== undefined) return { ok: true, entity: { handle: best.handle }, ordinal: best.ordinal, confidence: 'geometric-fallback' }
    return { ok: false, reason: 'not-found' }
  }

  return { ok: false, reason: 'not-found' }
}

/** 在候选 ordinal 中按 hint 取最优边；无法区分 → undefined（ambiguous）。 */
function bestEdgeByHint(
  ordinals: readonly number[],
  hint: EdgeTopoRef['hint'],
  ctx: ResolutionContext,
): { ordinal: number; handle?: BrepHandle } | undefined {
  const pool = ordinals
    .map((o) => ctx.edges?.find((e) => e.ordinal === o))
    .filter((e): e is EdgeCandidateEntry => e !== undefined)
  return matchEdgeByHint(pool, hint)
}
