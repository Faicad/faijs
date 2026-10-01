/**
 * mesh-solid — 网格实体驱动与注册表的单元契约
 *
 * 本文件只钉两件在 Phase 1 里无法从端到端看不出的事：
 * 1. **规范化顺序不可交换**（`importMesh → weld → unify`，且 `unify` 的返回值是
 *    「合并面数」而**不是**句柄——把它当句柄是本方案最容易犯的错）；
 * 2. `MeshSolidRegistry` 的释放语义与 `brepChain.solidCache` **对齐**
 *    （`set` 覆盖不释放、`delete`/`clear` 释放）——不新造一套句柄所有权规则。
 *
 * 端到端（真内核）的验收在 `api/load-mesh-solid.test.ts`；这里用假后端把调用序
 * 与释放语义钉死，避免"内核行为变了才发现顺序写错"。
 */
import { describe, it, expect, vi } from 'vitest'
import type { BrepHandle, BrepMeshResult } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import type { PartName } from '../identity'
import {
  MeshSolidRegistry, normalizeMeshSolid, weldToleranceFor,
  type MeshSolidBackend, type MeshSolidKernelOps,
} from './mesh-solid'

const handle = (n: number): BrepHandle => n as unknown as BrepHandle

/** 只实现被 normalizeMeshSolid / weldToleranceFor 用到的内核面。 */
function fakeKernel(opts: {
  bbox?: { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number }
  valid?: boolean
  faces?: number
  edges?: number
  vertices?: number
  triangles?: number
} = {}): BrepEngineApi {
  const bbox = opts.bbox ?? { xmin: 0, ymin: 0, zmin: 0, xmax: 10, ymax: 10, zmax: 10 }
  const faces = opts.faces ?? 6
  const edges = opts.edges ?? 12
  const vertices = opts.vertices ?? 8
  const triangles = opts.triangles ?? 12
  return {
    getBoundingBox: () => bbox,
    getSubShapes: (_s: BrepHandle, t: string) =>
      Array.from({ length: t === 'face' ? faces : t === 'edge' ? edges : vertices }, (_, i) => handle(i)),
    isValid: () => opts.valid ?? true,
    meshShape: (): BrepMeshResult => ({
      positions: new Float32Array(triangles * 9),
      normals: new Float32Array(triangles * 9),
      indices: new Uint32Array(triangles * 3),
      vertexCount: triangles * 3,
      faceCount: faces,
      triangleCount: triangles,
      faceGroups: new Int32Array(faces * 3),
    }),
  } as unknown as BrepEngineApi
}

/** 记录调用顺序的假后端。 */
function fakeBackend(opts: {
  kernel?: BrepEngineApi
  unifyReturns?: number
} = {}): { backend: MeshSolidBackend; calls: string[]; weldTol: number[] } {
  const calls: string[] = []
  const weldTol: number[] = []
  const kernel = opts.kernel ?? fakeKernel()
  const ops: MeshSolidKernelOps = {
    importMesh: () => { calls.push('importMesh'); return handle(100) },
    weld: (_faces, tol) => { calls.push('weld'); weldTol.push(tol); return handle(200) },
    unify: () => { calls.push('unify'); return opts.unifyReturns ?? 6 },
  }
  const backend: MeshSolidBackend = {
    id: 'fake',
    kernel,
    ops,
    normalize: (mesh, o) => normalizeMeshSolid(backend, mesh, o),
    describe: () => { throw new Error('unused') },
    buildTopologyData: () => { throw new Error('unused') },
    release: () => { calls.push('release') },
  }
  return { backend, calls, weldTol }
}

const mesh = { positions: new Float32Array(3), indices: new Uint32Array(3) }

describe('normalizeMeshSolid：顺序与返回值语义', () => {
  it('调用序固定为 importMesh → weld → unify（顺序不可交换）', () => {
    const { backend, calls } = fakeBackend()
    normalizeMeshSolid(backend, mesh)
    // 前 3 个动作必须是这三步，且顺序固定；之后是释放原始实体的 release
    expect(calls.slice(0, 3)).toEqual(['importMesh', 'weld', 'unify'])
  })

  it('unify 的返回值被当作「合并面数」，不当作句柄', () => {
    const { backend } = fakeBackend({ unifyReturns: 6 })
    const r = normalizeMeshSolid(backend, mesh)
    // 句柄必须仍来自 weld（200），不是 unify 的返回值
    expect(r.solid).toBe(handle(200))
    expect(r.mergedFaceCount).toBe(6)
  })

  it('容差由 bbox 对角线定标（不写死绝对值）', () => {
    const kernel = fakeKernel({ bbox: { xmin: 0, ymin: 0, zmin: 0, xmax: 10, ymax: 10, zmax: 10 } })
    expect(weldToleranceFor(kernel, handle(1))).toBeCloseTo(Math.sqrt(300) * 1e-6, 12)
    // 显式容差优先
    const { backend, weldTol } = fakeBackend({ kernel })
    normalizeMeshSolid(backend, mesh, { weldTolerance: 1e-4 })
    expect(weldTol).toEqual([1e-4])
  })

  it('退化 bbox（零厚网格）→ 容差有下限 1e-6', () => {
    const flat = fakeKernel({ bbox: { xmin: 0, ymin: 0, zmin: 0, xmax: 0, ymax: 0, zmax: 0 } })
    expect(weldToleranceFor(flat, handle(1))).toBe(1e-6)
  })

  it('weld 后仍不合法 → 抛 E_MESH_SOLID_UNWELDABLE，并释放原始实体', () => {
    const { backend, calls } = fakeBackend({ kernel: fakeKernel({ valid: false }) })
    expect(() => normalizeMeshSolid(backend, mesh)).toThrow(/E_MESH_SOLID_UNWELDABLE/)
    expect(calls).toContain('release')
  })

  it('成功路径也释放原始逐三角形实体（新路径不添句柄泄漏）', () => {
    const { backend, calls } = fakeBackend()
    const r = normalizeMeshSolid(backend, mesh)
    expect(r.faceCount).toBe(6)
    expect(r.edgeCount).toBe(12)
    expect(calls.filter((c) => c === 'release')).toHaveLength(1)
  })
})

describe('MeshSolidRegistry：释放语义与 solidCache 对齐', () => {
  const part = (s: string): PartName => s as PartName

  it('set 覆盖**不**释放旧句柄（旧输出 Shape 可能仍在引用）', () => {
    const reg = new MeshSolidRegistry()
    const release = vi.fn()
    reg.setBackend({ release } as unknown as MeshSolidBackend)
    reg.set(part('a'), handle(1))
    reg.set(part('a'), handle(2))
    expect(release).not.toHaveBeenCalled()
    expect(reg.get(part('a'))).toBe(handle(2))
  })

  it('delete 释放该 part 的句柄并删键；未知 part 静默', () => {
    const reg = new MeshSolidRegistry()
    const release = vi.fn()
    reg.setBackend({ release } as unknown as MeshSolidBackend)
    reg.set(part('a'), handle(1))
    reg.delete(part('a'))
    expect(release).toHaveBeenCalledWith(handle(1))
    expect(reg.has(part('a'))).toBe(false)
    reg.delete(part('missing')) // 不抛
  })

  it('deleteMany / clear 批量释放', () => {
    const reg = new MeshSolidRegistry()
    const release = vi.fn()
    reg.setBackend({ release } as unknown as MeshSolidBackend)
    reg.set(part('a'), handle(1))
    reg.set(part('b'), handle(2))
    reg.deleteMany([part('a')])
    expect(release).toHaveBeenCalledTimes(1)
    reg.clear()
    expect(release).toHaveBeenCalledTimes(2)
    expect(reg.size).toBe(0)
  })

  it('release 抛错不阻断删除（句柄可能已释放）', () => {
    const reg = new MeshSolidRegistry()
    reg.setBackend({ release: () => { throw new Error('already released') } } as unknown as MeshSolidBackend)
    reg.set(part('a'), handle(1))
    expect(() => reg.delete(part('a'))).not.toThrow()
    expect(reg.size).toBe(0)
  })

  it('未装配后端时 delete/clear 不抛（装配期与执行期解耦）', () => {
    const reg = new MeshSolidRegistry()
    reg.set(part('a'), handle(1))
    expect(() => reg.delete(part('a'))).not.toThrow()
    reg.set(part('b'), handle(2))
    expect(() => reg.clear()).not.toThrow()
  })
})
