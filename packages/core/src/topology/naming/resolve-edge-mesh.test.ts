/**
 * resolve-edge — 无 role 层的边解析（网格实体的近似拓扑）
 *
 * 网格零件没有 role（Phase 1.8：primitive/mesh 行 origin/role 显式为 null），
 * `EdgeTopoRef.faces` 里的两个 RoleQualifier 因此只是**占位**——不可能解析到面，
 * 限定符类型上也不携带几何。边的身份只剩几何一条路：在整个边表上按
 * length/midpoint 匹配。
 *
 * 本文件钉住这条降级的**边界**，因为它是唯一一处"解析不到面时不再直接 not-found"
 * 的放宽，必须证明放宽只对 mesh 上下文生效：
 * - mesh 上下文（无 face→edge 邻接）→ 纯几何匹配，命中即 geometric-fallback；
 * - BREP 上下文（**总有** face→edge 邻接）→ 解析不到面仍然 not-found，
 *   绝不退化成"按长度猜一条边"（猜错就倒错棱）。
 */
import { describe, it, expect } from 'vitest'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import type { EdgeTopoRef } from './types'
import { resolveEdgeTopo } from './resolve-edge'
import type { EdgeCandidateEntry, ResolutionContext } from './resolve-face'

/** 只提供面打分所需最小面的假内核（不得调用到未提供的成员，否则测试会响）。 */
function faceKernel(): BrepEngineApi {
  return {
    surfaceType: () => 'plane',
    surfaceNormal: () => ({ x: 0, y: 0, z: 1 }),
    surfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
    uvBounds: () => ({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 }),
  } as unknown as BrepEngineApi
}

/** 占位限定符的边引用（origin/role 不参与解析，只有 hint 参与）。 */
const meshEdgeRef = (hint: EdgeTopoRef['hint']): EdgeTopoRef => ({
  kind: 'edge',
  faces: [{ origin: 'mesh' as never, role: '' }, { origin: 'mesh' as never, role: '' }],
  hint,
})

const edge = (ordinal: number, length: number, midpoint: number[]): EdgeCandidateEntry => ({
  ordinal,
  handle: ordinal as unknown as BrepHandle,
  hint: { length, midpoint },
})

/** mesh 上下文：句柄 + 边表，**没有** faceEdgeAdjacency（无 role 层的如实形态）。 */
function meshCtx(edges: EdgeCandidateEntry[]): ResolutionContext {
  return {
    kernel: faceKernel(),
    faces: [{ ordinal: 1, handle: 1 as unknown as BrepHandle }],
    edges,
  }
}

describe('resolveEdgeTopo：无 role 层的近似拓扑按几何解析', () => {
  const edges = [
    edge(1, 10, [5, 0, 0]),
    edge(2, 10, [0, 5, 0]),
    edge(3, 30, [0, 0, 15]),
  ]

  it('占位限定符 + 唯一 hint → 命中一条边（geometric-fallback）', () => {
    const r = resolveEdgeTopo(meshEdgeRef({ kind: 'edge', length: 30, midpoint: [0, 0, 15] }), meshCtx(edges))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ordinal).toBe(3)
      expect(r.confidence).toBe('geometric-fallback')
    }
  })

  it('同样长的两条边靠 midpoint 区分', () => {
    const r = resolveEdgeTopo(meshEdgeRef({ kind: 'edge', length: 10, midpoint: [0, 5, 0] }), meshCtx(edges))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ordinal).toBe(2)
  })

  it('hint 区分不出（并列）→ 如实 ambiguous / not-found，不硬取序号', () => {
    const r = resolveEdgeTopo(meshEdgeRef({ kind: 'edge', length: 10 }), meshCtx(edges))
    expect(r.ok).toBe(false)
  })

  it('hint 为空 → not-found（没有几何可依据）', () => {
    const r = resolveEdgeTopo(meshEdgeRef({ kind: 'edge' }), meshCtx(edges))
    expect(r.ok).toBe(false)
  })

  it('GOTCHA：带 face→edge 邻接的上下文（BREP 形态）不享受该降级 → not-found', () => {
    // 这是本降级的边界。BREP 上下文有邻接表，"面解析不到"是**真错误**（role 过期 /
    // 面被删），必须报出来；若在这里按长度猜一条边，用户会得到一条倒错的棱而毫无提示。
    const brepCtx: ResolutionContext = {
      kernel: faceKernel(),
      faces: [{ ordinal: 1, handle: 1 as unknown as BrepHandle }],
      edges,
      faceEdgeAdjacency: [[]],
      edgeFaceAdjacency: [[]],
    }
    const r = resolveEdgeTopo(meshEdgeRef({ kind: 'edge', length: 30, midpoint: [0, 0, 15] }), brepCtx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-found')
  })
})
