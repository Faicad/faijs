/**
 * naming/resolve-edge-vertex-derived.test.ts — M3 边/顶点/生成面 lineage 解析测试
 *
 * 全部纯函数（邻接表由测试直接构造，不 init wasm）：
 * - resolveEdgeTopo：两邻面之交 → 公共边；多公共边 hint 裁决；mesh 无邻接降级
 * - resolveVertexTopo：≥3 面顶点交集 → position 裁决
 * - resolveDerivedFaceTopo：桥接两面 → 法向混合过滤 → 边中点裁决
 */

import { describe, it, expect } from 'vitest'
import { asPartName } from '../../identity'
import type { ResolutionContext, FaceCandidateEntry, EdgeCandidateEntry, VertexCandidateEntry } from './resolve-face'
import { resolveEdgeTopo } from './resolve-edge'
import { resolveVertexTopo } from './resolve-vertex'
import { resolveDerivedFaceTopo } from './resolve-derived'
import type { RoleTable } from './types'

// ── box 六面（ordinal 1..6：+X,-X,+Y,-Y,+Z,-Z）+ 12 边 + 8 顶点 ──

const boxFaces: FaceCandidateEntry[] = [
  { ordinal: 1, hash: 11, row: { surfaceType: 'plane', normal: [1, 0, 0], center: [5, 5, 5] } },
  { ordinal: 2, hash: 12, row: { surfaceType: 'plane', normal: [-1, 0, 0], center: [0, 5, 5] } },
  { ordinal: 3, hash: 13, row: { surfaceType: 'plane', normal: [0, 1, 0], center: [5, 5, 5] } },
  { ordinal: 4, hash: 14, row: { surfaceType: 'plane', normal: [0, -1, 0], center: [5, 0, 5] } },
  { ordinal: 5, hash: 15, row: { surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10] } },
  { ordinal: 6, hash: 16, row: { surfaceType: 'plane', normal: [0, 0, -1], center: [5, 5, 0] } },
]

// box 的 face→edge 邻接（1 起）。立方体 12 条边，按面索引排列：
// 面1(+X): 边 1,2,3,4；面2(-X): 5,6,7,8；面3(+Y): 1,5,9,10；面4(-Y): 2,6,11,12；
// 面5(+Z): 3,7,9,11；面6(-Z): 4,8,10,12
const boxFaceEdge: number[][] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [1, 5, 9, 10],
  [2, 6, 11, 12],
  [3, 7, 9, 11],
  [4, 8, 10, 12],
]

const boxEdges: EdgeCandidateEntry[] = Array.from({ length: 12 }, (_, i) => ({ ordinal: i + 1, hint: { length: 10, midpoint: [5, 5, 5] } }))

const boxTable: RoleTable = new Map([
  [asPartName('box'), new Map([
    ['box:top', [15]],
    ['box:bottom', [16]],
    ['box:front', [14]],
    ['box:back', [13]],
    ['box:right', [11]],
    ['box:left', [12]],
  ])],
])

const ctx: ResolutionContext = {
  kernel: null,
  faces: boxFaces,
  roleTable: boxTable,
  edges: boxEdges,
  faceEdgeAdjacency: boxFaceEdge,
}

// ── resolveEdgeTopo ──

describe('resolveEdgeTopo', () => {
  it('resolves an edge shared by exactly one face pair (exact)', () => {
    // box:top(5) 与 box:front(4) 的公共边：面5 ∩ 面4 = 边 11
    const res = resolveEdgeTopo({
      kind: 'edge',
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:front' }],
      hint: { kind: 'edge', length: 10 },
    }, ctx)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.ordinal).toBe(11)
      expect(res.confidence).toBe('exact')
    }
  })

  it('resolves a cross-origin edge after a boolean merge (from different origins)', () => {
    // 布尔合流：target 的 box:top(5) 与 tool 的 tool:lateral(1) 共享边 3
    const mergedTable: RoleTable = new Map([
      [asPartName('box'), new Map([['box:top', [15]]])],
      [asPartName('tool'), new Map([['tool:lateral', [11]]])],
    ])
    const res = resolveEdgeTopo({
      kind: 'edge',
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('tool'), role: 'tool:lateral' }],
      hint: { kind: 'edge', length: 10 },
    }, { ...ctx, roleTable: mergedTable })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.ordinal).toBe(3)
  })

  it('disambiguates multiple shared edges by hint', () => {
    // 构造：top(5) 与 back(3) 共享两条边 [3, 9]（人为邻接表，模拟圆角后双缝边）
    const multiEdgeCtx: ResolutionContext = {
      ...ctx,
      faceEdgeAdjacency: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [1, 3, 9, 10],  // 面3(back) 人为含边 3、9 → 与 top 共享 {3, 9}
        [2, 6, 11, 12],
        [3, 7, 9, 11],
        [4, 8, 10, 12],
      ],
    }
    // hint 指向边 3（midpoint 靠近 [5,5,10]；边 9 的 midpoint 远离）
    const hintEdges: EdgeCandidateEntry[] = boxEdges.map((e, i) => ({
      ordinal: e.ordinal,
      hint: i === 2 ? { length: 10, midpoint: [5, 5, 10] } : { length: 10, midpoint: [0, 0, 0] },
    }))
    const res = resolveEdgeTopo({
      kind: 'edge',
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:back' }],
      hint: { kind: 'edge', length: 10, midpoint: [5, 5, 10] },
    }, { ...multiEdgeCtx, edges: hintEdges })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.ordinal).toBe(3)
      expect(res.confidence).toBe('geometric-fallback')
    }
  })

  it('falls back to hint-only matching when face→edge adjacency is missing (mesh)', () => {
    // mesh 无邻接：整个边表按 hint 匹配，ordinal 3 的 midpoint 唯一命中
    const meshEdges: EdgeCandidateEntry[] = boxEdges.map((e, i) => ({
      ordinal: e.ordinal,
      hint: i === 2 ? { length: 10, midpoint: [5, 5, 10] } : { length: 10, midpoint: [0, 0, 0] },
    }))
    const res = resolveEdgeTopo({
      kind: 'edge',
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:front' }],
      hint: { kind: 'edge', length: 10, midpoint: [5, 5, 10] },
    }, { ...ctx, edges: meshEdges, faceEdgeAdjacency: undefined })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.confidence).toBe('geometric-fallback')
  })

  it('reports not-found when a role has no current face', () => {
    const res = resolveEdgeTopo({
      kind: 'edge',
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'ghost' }],
      hint: { kind: 'edge', length: 10 },
    }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not-found')
  })
})

// ── resolveVertexTopo ──

describe('resolveVertexTopo', () => {
  const boxFaceVertex: number[][] = [
    [1, 2, 3, 4],   // 面1(+X)
    [5, 6, 7, 8],   // 面2(-X)
    [1, 2, 5, 6],   // 面3(+Y)
    [3, 4, 7, 8],   // 面4(-Y)
    [1, 3, 5, 7],   // 面5(+Z)
    [2, 4, 6, 8],   // 面6(-Z)
  ]
  const boxVertices: VertexCandidateEntry[] = Array.from({ length: 8 }, (_, i) => ({
    ordinal: i + 1,
    position: [i % 2 === 0 ? 0 : 10, Math.floor(i / 2) % 2 === 0 ? 0 : 10, i < 4 ? 0 : 10],
  }))

  it('resolves the corner where top/front/right meet (exact)', () => {
    // 面5(top) ∩ 面1(right) ∩ 面4(front) 的公共顶点 = 顶点 3（[10,0,10]）
    const res = resolveVertexTopo({
      kind: 'vertex',
      faces: [
        { origin: asPartName('box'), role: 'box:top' },
        { origin: asPartName('box'), role: 'box:right' },
        { origin: asPartName('box'), role: 'box:front' },
      ],
      hint: { kind: 'vertex', position: [10, 0, 10] },
    }, { ...ctx, vertices: boxVertices, faceVertexAdjacency: boxFaceVertex })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.ordinal).toBe(3)
      expect(res.confidence).toBe('exact')
    }
  })

  it('reports not-found with fewer than 3 faces', () => {
    const res = resolveVertexTopo({
      kind: 'vertex',
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:front' }],
      hint: { kind: 'vertex' },
    }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not-found')
  })
})

// ── resolveDerivedFaceTopo ──

describe('resolveDerivedFaceTopo', () => {
  // 面7 = 生成的过渡面（倒角斜面），法向混合 top(+Z) 与 front(-Y)
  const derivedFaces: FaceCandidateEntry[] = [
    ...boxFaces,
    { ordinal: 7, hash: 17, row: { surfaceType: 'plane', normal: [0, -0.5, 0.5], center: [5, 5, 5] } },
  ]
  // 面7 邻接面5(top) 与面4(front)；其它邻接关系照抄 box
  const faceAdjacency: number[][] = [
    [2, 3, 4, 5],  // 面1(+X)
    [1, 3, 4, 6],  // 面2(-X)
    [1, 2, 5, 6],  // 面3(+Y)
    [1, 2, 5, 7],  // 面4(-Y) 邻接过渡面 7
    [1, 3, 4, 7],  // 面5(+Z) 邻接过渡面 7
    [2, 3, 4, 5],  // 面6(-Z)
    [4, 5],        // 面7 邻接 top 与 front
  ]

  it('resolves the bridged transition face by normal blend (geometric)', () => {
    const res = resolveDerivedFaceTopo({
      kind: 'derived-face',
      op: 'chamfer',
      between: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:front' }],
      hint: { kind: 'derived-face', normalA: [0, 0, 1], normalB: [0, -1, 0], edgeMidpoint: [5, 0, 10] },
    }, { ...ctx, faces: derivedFaces, faceAdjacency })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.ordinal).toBe(7)
      expect(res.confidence).toBe('geometric-fallback')
    }
  })

  it('rejects flanking faces whose normal does not blend (orthogonal to a bridged normal)', () => {
    // 面1(+X) 也邻接 top+front，但法向 [1,0,0] 与 normalB=[0,-1,0] 点积 0 → 拒绝
    const res = resolveDerivedFaceTopo({
      kind: 'derived-face',
      op: 'fillet',
      between: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:front' }],
      hint: { kind: 'derived-face', normalA: [0, 0, 1], normalB: [0, -1, 0], edgeMidpoint: [5, 0, 10] },
    }, { ...ctx, faces: derivedFaces, faceAdjacency })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.ordinal).toBe(7)
  })
})
