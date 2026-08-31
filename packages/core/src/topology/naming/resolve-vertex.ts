/**
 * resolve-vertex.ts — 顶点 TopoRef 解析（移植 brepjs vertexRefFns，§4.4）
 *
 * 顶点 = ≥3 邻面之交。VertexTopoRef.faces 是 RoleQualifier[]（faijs 扩展带 origin）。
 *
 * 解析 = 各 role 解析到当前面 → 面顶点交集（face→vertex 邻接）→ 公共顶点：
 * - 1 个 → exact
 * - 多个 → position hint 裁决
 * - 无 / role 缺失 → not-found
 *
 * 顶点类型在 M3 一并移植但**不接 UI、不进 manifest**（选择器无 vertex 表），
 * 仅为倒角/定位类 op 的内部参数预留（§4.4）。
 */

import type { BrepHandle } from '../../brep/engine/types'
import type { TopoResolution, VertexTopoRef } from './types'
import type { FaceCandidateEntry, ResolutionContext, VertexCandidateEntry } from './resolve-face'
import { facesForQualifier } from './resolve-edge'

/** 一个角至少需要这么多面才能钉住唯一顶点。 */
const MIN_VERTEX_FACES = 3
/** Hint 距离比这更近视为不可区分（→ ambiguous）。 */
const HINT_MARGIN = 1e-6

/** 顶点序号 → 顶点候选。 */
function vertexOf(ctx: ResolutionContext, ordinal: number): VertexCandidateEntry | undefined {
  return ctx.vertices?.find((v) => v.ordinal === ordinal)
}

/**
 * 解析顶点 TopoRef 到当前快照的顶点序号。
 *
 * @param ref - the vertex TopoRef to resolve.
 * @param ctx - the resolution context (needs faceVertexAdjacency for lineage).
 * @returns the three-state TopoResolution with the vertex ordinal.
 */
export function resolveVertexTopo(
  ref: VertexTopoRef,
  ctx: ResolutionContext,
): TopoResolution<{ handle?: BrepHandle }> {
  if (ref.faces.length < MIN_VERTEX_FACES) {
    return { ok: false, reason: 'not-found' }
  }

  // 各 role 的面集合
  const faceSets: FaceCandidateEntry[][] = []
  for (const qualifier of ref.faces) {
    const faces = facesForQualifier(qualifier, ctx)
    if (faces.length === 0) return { ok: false, reason: 'not-found' }
    faceSets.push(faces)
  }

  // 面顶点交集（face→vertex 邻接）
  let common: Set<number> | undefined
  for (const faces of faceSets) {
    const verts = new Set<number>()
    for (const f of faces) {
      for (const v of ctx.faceVertexAdjacency?.[f.ordinal - 1] ?? []) verts.add(v)
    }
    common = common === undefined ? verts : intersect(common, verts)
    if (common.size === 0) return { ok: false, reason: 'not-found' }
  }
  if (common === undefined || common.size === 0) {
    return { ok: false, reason: 'not-found' }
  }

  const unique = [...common]
  if (unique.length === 1) {
    const [only] = unique
    if (only !== undefined) {
      const v = vertexOf(ctx, only)
      return { ok: true, entity: { handle: v?.handle }, ordinal: only, confidence: 'exact' }
    }
  }

  if (unique.length > 1) {
    const best = nearestVertex(unique, ref.hint.position, ctx)
    if (best !== undefined) {
      return { ok: true, entity: { handle: best.handle }, ordinal: best.ordinal, confidence: 'geometric-fallback' }
    }
    return { ok: false, reason: 'ambiguous', candidatesOrdinal: unique }
  }

  return { ok: false, reason: 'not-found' }
}

/** 集合交集。 */
function intersect(a: Set<number>, b: Set<number>): Set<number> {
  const out = new Set<number>()
  for (const h of a) if (b.has(h)) out.add(h)
  return out
}

/** 距 hint 位置最近的候选顶点；并列/无信号 → undefined（ambiguous）。 */
function nearestVertex(
  ordinals: readonly number[],
  position: readonly number[] | undefined,
  ctx: ResolutionContext,
): VertexCandidateEntry | undefined {
  if (position === undefined) return undefined
  let best: VertexCandidateEntry | undefined
  let bestDist = Infinity
  let secondDist = Infinity
  for (const ord of ordinals) {
    const v = vertexOf(ctx, ord)
    const p = v?.position
    if (p === undefined) continue
    const d = distance(p, position)
    if (d < bestDist) {
      secondDist = bestDist
      bestDist = d
      best = v
    } else if (d < secondDist) {
      secondDist = d
    }
  }
  if (best === undefined || secondDist - bestDist < HINT_MARGIN) return undefined
  return best
}

/** 两点的欧氏距离。 */
function distance(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
