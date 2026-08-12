﻿import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ManifoldMeshData } from '../boolean/csg-backend'

// computeSplit 走 Worker + Manifold wasm，单测里替换成可断言的桩
const computeSplitMock = vi.fn()
vi.mock('../boolean/csg-backend', () => ({
  computeSplit: (...args: unknown[]) => computeSplitMock(...args),
}))

const {
  computeExtrudeOffsets,
  makeWorldPlane,
  offsetMesh,
  scaleMeshAlongNormal,
  buildExtrudeParts,
  SLICE_THICKNESS,
} = await import('../boolean/extrude-helpers')

const Z: [number, number, number] = [0, 0, 1]

/** 位于 z = h 平面上的单位正方形（2 个三角形）。 */
function squareAt(h: number): ManifoldMeshData {
  return {
    positions: new Float32Array([0, 0, h, 1, 0, h, 1, 1, h, 0, 1, h]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  }
}

function zsOf(mesh: ManifoldMeshData): number[] {
  const out: number[] = []
  for (let i = 2; i < mesh.positions.length; i += 3) out.push(mesh.positions[i])
  return out
}

describe('computeExtrudeOffsets', () => {
  it('centered 上下各推 L/2', () => {
    expect(computeExtrudeOffsets('centered', 10)).toEqual({ front: 5, back: -5 })
  })

  it('forward 只推上半，backward 只拉下半', () => {
    expect(computeExtrudeOffsets('forward', 10)).toEqual({ front: 10, back: 0 })
    expect(computeExtrudeOffsets('backward', 10)).toEqual({ front: 0, back: -10 })
  })

  it('不变量：front - back 恒等于 L', () => {
    for (const mode of ['centered', 'forward', 'backward'] as const) {
      for (const L of [0, 1, 7.5, 100]) {
        const { front, back } = computeExtrudeOffsets(mode, L)
        expect(front - back).toBeCloseTo(L, 10)
      }
    }
  })
})

describe('makeWorldPlane', () => {
  it('constant = -originOffset，且法线归一化', () => {
    const { plane, normalVec } = makeWorldPlane([0, 0, 2], 3)
    expect(normalVec.length()).toBeCloseTo(1, 10)
    expect(plane.constant).toBeCloseTo(-3, 10)
  })

  it('法线正侧距离为正（THREE 裁剪保留该侧）', () => {
    const { plane } = makeWorldPlane(Z, 3)
    expect(plane.distanceToPoint({ x: 0, y: 0, z: 5 } as never)).toBeCloseTo(2, 10)
    expect(plane.distanceToPoint({ x: 0, y: 0, z: 1 } as never)).toBeCloseTo(-2, 10)
  })
})

describe('offsetMesh', () => {
  it('distance=0 原样返回（不拷贝）', () => {
    const m = squareAt(0)
    expect(offsetMesh(m, Z, 0)).toBe(m)
  })

  it('整体平移且共享索引', () => {
    const m = squareAt(0)
    const out = offsetMesh(m, Z, 4)
    expect(zsOf(out)).toEqual([4, 4, 4, 4])
    expect(out.indices).toBe(m.indices)
    expect(zsOf(m)).toEqual([0, 0, 0, 0]) // 入参不被修改
  })
})

describe('scaleMeshAlongNormal', () => {
  it('平面上的顶点不动，离面顶点按比例外推', () => {
    const mesh: ManifoldMeshData = {
      positions: new Float32Array([0, 0, 0, 0, 0, 0.2, 0, 0, -1]),
      indices: new Uint32Array([0, 1, 2]),
    }
    const out = scaleMeshAlongNormal(mesh, Z, 0, 50)
    expect(zsOf(out)[0]).toBeCloseTo(0, 6)
    expect(zsOf(out)[1]).toBeCloseTo(10, 5)
    expect(zsOf(out)[2]).toBeCloseTo(-50, 5)
  })

  it('锚点为非零平面偏移时以该平面为不动面', () => {
    const mesh: ManifoldMeshData = {
      positions: new Float32Array([0, 0, 2, 0, 0, 2.2]),
      indices: new Uint32Array([0, 1, 0]),
    }
    const out = scaleMeshAlongNormal(mesh, Z, 2, 50)
    expect(zsOf(out)[0]).toBeCloseTo(2, 6)
    expect(zsOf(out)[1]).toBeCloseTo(12, 4) // 2 + 0.2*50
  })

  it('不修改入参，索引原样共享', () => {
    const mesh: ManifoldMeshData = {
      positions: new Float32Array([0, 0, 1]),
      indices: new Uint32Array([0, 0, 0]),
    }
    const out = scaleMeshAlongNormal(mesh, Z, 0, 3)
    expect(zsOf(mesh)).toEqual([1])
    expect(zsOf(out)).toEqual([3])
    expect(out.indices).toBe(mesh.indices)
  })
})

describe('buildExtrudeParts', () => {
  beforeEach(() => {
    computeSplitMock.mockReset()
  })

  /** 位于 z ∈ [0, SLICE_THICKNESS] 的薄壳（slice 法第二次 split 的 back）。 */
  function thinCap(): ManifoldMeshData {
    return {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, SLICE_THICKNESS]),
      indices: new Uint32Array([0, 1, 2]),
    }
  }

  it('三段位移正确，中段落在 [back, back+L]', async () => {
    computeSplitMock
      .mockResolvedValueOnce({ front: squareAt(0), back: squareAt(-1) })
      .mockResolvedValueOnce({ front: squareAt(3), back: thinCap() })

    const { front, back, extruded } = await buildExtrudeParts(squareAt(0), Z, 0, 10, 'centered')

    expect(zsOf(front!)).toEqual([5, 5, 5, 5]) // +L/2
    expect(zsOf(back!)).toEqual([-6, -6, -6, -6]) // -1 - L/2
    // 薄壳 z∈[0,0.2] 以平面 z=0 为锚点放大 L/0.2=50 倍 → [0,10]，再随 back 偏移 -5 → [-5,5]
    const ez = zsOf(extruded!)
    expect(Math.min(...ez)).toBeCloseTo(-5, 5)
    expect(Math.max(...ez)).toBeCloseTo(5, 5)
  })

  it('第二次 split 在 originOffset + SLICE_THICKNESS，薄片被放大到 L', async () => {
    computeSplitMock
      .mockResolvedValueOnce({ front: squareAt(0), back: squareAt(-1) })
      .mockResolvedValueOnce({ front: squareAt(3), back: thinCap() })

    const { extruded } = await buildExtrudeParts(squareAt(0), Z, 2, 10, 'forward')

    expect(computeSplitMock).toHaveBeenCalledTimes(2)
    expect(computeSplitMock.mock.calls[0][2]).toBe(2)
    expect(computeSplitMock.mock.calls[1][2]).toBeCloseTo(2 + SLICE_THICKNESS, 10)

    // forward 模式 back 偏移为 0；薄片以平面 z=2 为锚点放大 L/0.2=50 倍
    // 顶点 z=0 → 2 + (0-2)*50 = -98；z=0.2 → 2 + (0.2-2)*50 = -88
    const ez = zsOf(extruded!)
    expect(Math.min(...ez)).toBeCloseTo(-98, 4)
    expect(Math.max(...ez)).toBeCloseTo(-88, 4)
  })

  it('薄片为空时 extruded 为 null，但上下两半仍然产出', async () => {
    computeSplitMock
      .mockResolvedValueOnce({ front: squareAt(9), back: squareAt(-9) })
      .mockResolvedValueOnce({ front: squareAt(9), back: null })

    const { front, back, extruded } = await buildExtrudeParts(squareAt(0), Z, 0, 4, 'backward')

    expect(extruded).toBeNull()
    expect(zsOf(front!)).toEqual([9, 9, 9, 9]) // backward: front 偏移 0
    expect(zsOf(back!)).toEqual([-13, -13, -13, -13]) // -9 - 4
  })
})
