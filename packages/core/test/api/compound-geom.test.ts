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
import { configureBackends, CONTRACT_VERSION, BrepUnsupportedError, type Backends } from '../../src/runtime-state'
import { compound } from '../../src/api/compound-geom'
import { compound as structCompound, fromBrep, solid, hasBrep, brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'

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
    config: { mode },
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

// ── dropSubsumed（FreeCAD truth drop_cumulative_part_design 镜像） ──

describe('compound: dropSubsumed (brep path)', () => {
  /** fake kernel：每个句柄一个 solid；体积/包围盒走查表。 */
  function fakeKernelWith(inv: Record<number, { vol: number; bb: [number, number, number, number, number, number] }>) {
    return {
      makeCompound: (hs: BrepHandle[]) => hs as unknown as BrepHandle,
      meshShape: () => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }),
      getSubShapes: (h: BrepHandle) => [h],
      getVolume: (h: BrepHandle) => inv[h as unknown as number].vol,
      getBoundingBox: (h: BrepHandle) => {
        const b = inv[h as unknown as number].bb
        return { xmin: b[0], ymin: b[1], zmin: b[2], xmax: b[3], ymax: b[4], zmax: b[5] }
      },
    }
  }

  function memberOf(h: number): Shape {
    return fromBrep(cubeMesh(1), { solid: h as unknown as BrepHandle })
  }

  it('later eligible member with >= volume and containing bbox subsumes earlier ones (Dir_F pattern)', () => {
    // Pad(41.9) → Pocket(40.34) → Pad001(42.69, bbox contains both)：
    // Pad 与 Pocket 都被 Pad001 吞并删除，只剩 Pad001。
    const k = fakeKernelWith({
      1: { vol: 41.9, bb: [-8.65, -1.25, -3, 8.65, 1.25, 1] },
      2: { vol: 40.34, bb: [-8.65, -1.25, -3, 8.65, 1.25, 1] },
      3: { vol: 42.69, bb: [-8.65, -1.25, -3, 8.65, 1.25, 1] },
    })
    configureBackends(makeBackends('auto', k))
    const out = compound({ members: [memberOf(1), memberOf(2), memberOf(3)], dropSubsumed: [0, 1, 2] })
    const handles = (brepOf(out) as unknown as BrepHandle[]) as unknown as number[]
    expect(handles).toEqual([3])
  })

  it('volume-decreasing later member never subsumes (SAE pockets pattern)', () => {
    // Pad001(83872) 之后一连串减材料 Pocket（体积递减）：谁也吞不掉谁，全部保留。
    const k = fakeKernelWith({
      1: { vol: 83872, bb: [-86, -75, -84, 86, 77, 0] },
      2: { vol: 67760, bb: [-86, -75, -84, 86, 77, 0] },
      3: { vol: 65756, bb: [-86, -75, -84, 86, 77, 0] },
    })
    configureBackends(makeBackends('auto', k))
    const out = compound({ members: [memberOf(1), memberOf(2), memberOf(3)], dropSubsumed: [0, 1, 2] })
    const handles = (brepOf(out) as unknown as BrepHandle[]) as unknown as number[]
    expect(handles).toEqual([1, 2, 3])
  })

  it('non-eligible members are neither dropped nor subsume (is_pd mirror)', () => {
    // 成员 0（不在列表）体积更小但被 1 包含：不删；成员 2（不在列表）体积更大：
    // 即便包含成员 1 也不参与吞并。
    const k = fakeKernelWith({
      1: { vol: 10, bb: [0, 0, 0, 1, 1, 1] },
      2: { vol: 20, bb: [0, 0, 0, 1, 1, 1] },
      3: { vol: 30, bb: [0, 0, 0, 1, 1, 1] },
    })
    configureBackends(makeBackends('auto', k))
    const out = compound({ members: [memberOf(1), memberOf(2), memberOf(3)], dropSubsumed: [1] })
    const handles = (brepOf(out) as unknown as BrepHandle[]) as unknown as number[]
    expect(handles).toEqual([1, 2, 3])
  })

  it('bbox poking out of the later member keeps the earlier one', () => {
    // 体积条件满足但包围盒越界：不吞并。
    const k = fakeKernelWith({
      1: { vol: 10, bb: [-5, 0, 0, 1, 1, 1] },
      2: { vol: 20, bb: [0, 0, 0, 1, 1, 1] },
    })
    configureBackends(makeBackends('auto', k))
    const out = compound({ members: [memberOf(1), memberOf(2)], dropSubsumed: [0, 1] })
    const handles = (brepOf(out) as unknown as BrepHandle[]) as unknown as number[]
    expect(handles).toEqual([1, 2])
  })

  it('fewer than two eligible members → unchanged (nothing can subsume)', () => {
    const k = fakeKernelWith({
      1: { vol: 10, bb: [0, 0, 0, 1, 1, 1] },
      2: { vol: 20, bb: [0, 0, 0, 1, 1, 1] },
    })
    configureBackends(makeBackends('auto', k))
    const out = compound({ members: [memberOf(1), memberOf(2)], dropSubsumed: [0] })
    const handles = (brepOf(out) as unknown as BrepHandle[]) as unknown as number[]
    expect(handles).toEqual([1, 2])
  })

  it('out-of-range indices are ignored, no throw', () => {
    const k = fakeKernelWith({
      1: { vol: 10, bb: [0, 0, 0, 1, 1, 1] },
      2: { vol: 20, bb: [0, 0, 0, 1, 1, 1] },
    })
    configureBackends(makeBackends('auto', k))
    const out = compound({ members: [memberOf(1), memberOf(2)], dropSubsumed: [-1, 2, 1.5] })
    const handles = (brepOf(out) as unknown as BrepHandle[]) as unknown as number[]
    expect(handles).toEqual([1, 2])
  })

  it('mesh path with dropSubsumed → BrepUnsupportedError (no silent ignore)', () => {
    configureBackends(makeBackends('mesh'))
    const a = solid(cubeMesh(2))
    const b = solid(cubeMesh(2))
    expect(() => compound({ members: [a, b], dropSubsumed: [0, 1] })).toThrow(BrepUnsupportedError)
  })
})
