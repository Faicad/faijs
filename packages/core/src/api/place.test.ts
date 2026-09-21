/**
 * place — 平台刚性放置 op 测试（H11 / 方案 §4.3）
 *
 * 覆盖：
 * - mesh 路径：四元数→矩阵（Hamilton）旋转 + 平移，逐顶点验证
 * - mesh 路径：结构 compound 子节点展平后整体变换
 * - brep 路径（fake kernel，无需 WASM）：transform + solidToShape + fromBrep
 *   登记句柄；面演化恒等传播
 * - 非实体放行（C6）：brep 路径对无 roleTable 的输入不报错（恒等演化）
 *
 * 四元数→矩阵的 brep/mesh 一致性标定（R-CK）见 place-calibration.test.ts（需 WASM）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../runtime-state'
import { place } from './place'
import { fromBrep, solid, hasBrep, brepOf } from '../shape'
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

const Q_Z90: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2]

// ── mesh 路径：旋转 + 平移 ──

describe('place: mesh path transform', () => {
  beforeEach(() => configureBackends(makeBackends('mesh')))

  it('identity rotation + translation shifts every vertex by t', async () => {
    const out = await place(solid(cubeMesh(2)), { rotation: [0, 0, 0, 1], position: [5, 0, 0] })
    // vertex 0 = (-1,-1,-1) → (4,-1,-1)
    expect(out.positions[0]).toBeCloseTo(4)
    expect(out.positions[1]).toBeCloseTo(-1)
    expect(out.positions[2]).toBeCloseTo(-1)
    // 顶点数不变（同形）
    expect(out.positions.length).toBe(8 * 3)
  })

  it('90° about Z rotates (x,y)→(-y,x), z unchanged (Hamilton convention)', async () => {
    // 顶点 6 = (1,1,1) → (-1,1,1)
    const out = await place(solid(cubeMesh(2)), { rotation: Q_Z90, position: [0, 0, 0] })
    expect(out.positions[18]).toBeCloseTo(-1)
    expect(out.positions[19]).toBeCloseTo(1)
    expect(out.positions[20]).toBeCloseTo(1)
    // 顶点 0 = (-1,-1,-1) → (1,-1,-1)
    expect(out.positions[0]).toBeCloseTo(1)
    expect(out.positions[1]).toBeCloseTo(-1)
    expect(out.positions[2]).toBeCloseTo(-1)
  })

  it('flattens structural compound children before transforming', async () => {
    const inner = { kind: 'compound', children: [solid(cubeMesh(2)), solid(cubeMesh(2))] } as unknown as Shape
    const out = await place(inner, { rotation: [0, 0, 0, 1], position: [3, 0, 0] })
    // 2 个 cube 被展平，顶点数 = 2*8
    expect(out.positions.length).toBe(2 * 8 * 3)
    // 第一个 cube 顶点 0 = (-1,-1,-1) → (2,-1,-1)
    expect(out.positions[0]).toBeCloseTo(2)
  })
})

// ── brep 路径（fake kernel） ──

describe('place: brep path (fake kernel)', () => {
  it('on-chain input → brep transform + solidToShape + fromBrep (handle registered)', async () => {
    const fakeKernel = {
      transform: (s: unknown) => (s as number) + 5000,
      meshShape: () => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }),
      subShapeHashes: () => [],
    }
    configureBackends(makeBackends('auto', fakeKernel))
    const input = fromBrep(cubeMesh(5), { solid: 42 as unknown as BrepHandle })
    const out = await place(input, { rotation: [0, 0, 0, 1], position: [5, 0, 0] })
    expect(hasBrep(out)).toBe(true)
    expect(brepOf(out)).toBe(5042) // transform(42) = 5042
    expect(out.positions.length).toBe(9)
  })

  it('C6: no roleTable on input → identity evolution, no error (non-solid safe)', async () => {
    const fakeKernel = {
      transform: (s: unknown) => (s as number) + 1,
      meshShape: () => ({ positions: [0, 0, 0], indices: [] }),
      subShapeHashes: () => [],
    }
    configureBackends(makeBackends('auto', fakeKernel))
    // 非实体（wire）句柄同样走通：place 只做刚体变换，不要求实体
    const wire = fromBrep(cubeMesh(1), { solid: ('wire' as unknown) as BrepHandle })
    await expect(place(wire, { position: [1, 2, 3] })).resolves.toBeTruthy()
  })
})
