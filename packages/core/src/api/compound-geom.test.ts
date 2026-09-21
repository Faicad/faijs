/**
 * compound-geom — 平台几何复合体 op 测试（H11 / 方案 §4.2）
 *
 * 覆盖：
 * - mesh 路径：成员 mesh 合并（顶点/索引拼接 + 索引偏移正确）
 * - mesh 路径：结构 compound 子节点展平（不重复计数、不漏算）
 * - brep 路径（fake kernel，无需 WASM）：makeCompound 收句柄 → solidToShape 三角化
 *   → fromBrep 登记句柄；成员全在链上才走 brep 路径
 * - 非实体放行（C6）：brep 路径收任意 BrepHandle（含非实体）不报错
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { configureBackends, CONTRACT_VERSION, BrepUnsupportedError, type Backends } from '../runtime-state'
import { compound } from './compound-geom'
import { compound as structCompound, fromBrep, solid, hasBrep, brepOf } from '../shape'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'

// ── helpers ──

function cubeMesh(size: number): Shape {
  const s = size / 2
  const positions = new Float32Array([
    -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ])
  return { positions, indices }
}

function makeBackends(mode: 'auto' | 'brep' | 'mesh', kernelBrep?: unknown): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode, brepCapabilities: undefined },
    kernel: { brep: kernelBrep ?? null, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
}

const VERTS = 8
const TRIS = 12

// ── mesh 路径：合并 ──

describe('compound: mesh path merge', () => {
  beforeEach(() => configureBackends(makeBackends('mesh')))

  it('merges two member meshes: positions/indices concatenated, index offset correct', () => {
    const a = solid(cubeMesh(2))
    const b = solid(cubeMesh(4))
    const out = compound({ members: [a, b] })
    expect(out.positions.length).toBe(2 * VERTS * 3)
    expect(out.indices.length).toBe(2 * TRIS * 3)
    // 第二个 cube 的索引整体偏移了第一个 cube 的顶点数
    const base = VERTS
    expect(out.indices[TRIS * 3 + 0]).toBe(base + 0)
    expect(out.indices[TRIS * 3 + 1]).toBe(base + 1)
  })

  it('flattens structural compound children (single member that is a struct compound)', () => {
    const inner = structCompound([solid(cubeMesh(2)), solid(cubeMesh(3))])
    const out = compound({ members: [inner] })
    // 展平后两个子 mesh 都进入结果，不把 compound 当整体
    expect(out.positions.length).toBe(2 * VERTS * 3)
    expect(out.indices.length).toBe(2 * TRIS * 3)
  })

  it('mixes plain mesh members and struct-compound members', () => {
    const inner = structCompound([solid(cubeMesh(2)), solid(cubeMesh(2))])
    const out = compound({ members: [solid(cubeMesh(2)), inner] })
    // 1 个独立 + (2 个内层) = 3 个 cube
    expect(out.positions.length).toBe(3 * VERTS * 3)
    expect(out.indices.length).toBe(3 * TRIS * 3)
  })

  it('empty members → empty mesh (no throw)', () => {
    const out = compound({ members: [] })
    expect(out.positions.length).toBe(0)
    expect(out.indices.length).toBe(0)
  })

  it('does NOT register a BREP handle on the mesh-path output', () => {
    const out = compound({ members: [solid(cubeMesh(2))] })
    expect(hasBrep(out)).toBe(false)
  })
})

// ── brep 路径（fake kernel） ──

describe('compound: brep path (fake kernel)', () => {
  it('all members on-chain → makeCompound + solidToShape + fromBrep (handle registered)', () => {
    const fakeKernel = {
      makeCompound: (_handles: BrepHandle[]) => 909 as unknown as BrepHandle,
      meshShape: () => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }),
    }
    configureBackends(makeBackends('auto', fakeKernel))

    const a = fromBrep(cubeMesh(2), { solid: 11 as unknown as BrepHandle })
    const b = fromBrep(cubeMesh(2), { solid: 22 as unknown as BrepHandle })
    const out = compound({ members: [a, b] })

    expect(hasBrep(out)).toBe(true)
    expect(brepOf(out)).toBe(909)
    expect(out.positions.length).toBe(9)
  })

  it('C6: accepts non-solid handles (brep path does not require a solid)', () => {
    // 非实体句柄（如 wire/face/shell）只是 unknown，compound 不区分
    const fakeKernel = {
      makeCompound: (_handles: BrepHandle[]) => 707 as unknown as BrepHandle,
      meshShape: () => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }),
    }
    configureBackends(makeBackends('auto', fakeKernel))
    const wire = fromBrep(cubeMesh(1), { solid: ('wire-handle' as unknown) as BrepHandle })
    const out = compound({ members: [wire] })
    expect(brepOf(out)).toBe(707)
  })

  it('brep mode with an off-chain member → BrepUnsupportedError (no silent mesh fallback)', () => {
    const fakeKernel = {
      makeCompound: (_handles: BrepHandle[]) => 1 as unknown as BrepHandle,
      meshShape: () => ({ positions: [], indices: [] }),
    }
    configureBackends(makeBackends('brep', fakeKernel))
    const a = fromBrep(cubeMesh(2), { solid: 11 as unknown as BrepHandle })
    const off = solid(cubeMesh(2)) // 不在 BREP 链上
    expect(() => compound({ members: [a, off] })).toThrow(BrepUnsupportedError)
  })
})
