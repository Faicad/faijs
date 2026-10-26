/**
 * smlib-kernel/smlib-tessellate-bridge — SmApiTessellateEx 内核桥验证（node 直跑）
 *
 * P1 验收（方案文档 §5.4.3）：桥把 SmApiTessellate 的多边形网格（SmPolyBrep，
 * 无公共三角形导出 API）展平为独立三角形数组，供适配器 meshShape 直接消费。
 * 桥是 wasm-probe/src/SmApiTessellateEx.cpp（极薄内核桥，§5.5 P3 机制 P1 提前使用，
 * 不改 SM_API/SMLib 任何现有源文件）。
 *
 * 输出布局（单块 malloc 缓冲，free 释放）：
 *   u32[3] header = { numVerts, numTris, numFaces }
 *   f32 verts[3V] / normals[3V]（V = 3T，独立三角形顶点，flat 面法向）
 *   u32 indices[3T]（0..V-1 顺序）
 *   u32 faceGroups[3F] = { triStart, triCount, facePtr }（facePtr = SmFace*，0 无）
 *
 * 断言锚：box(10,20,30) 的 SmApiTessellate 输出 12 个三角形 PolyFace
 * （每三角形一个 PolyFace），facePtr 每 2 个相同（6 个原始面 × 2 三角形）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initSmlibWasm, resetSmlibWasm, type SmlibKernel } from '../../src/smlib-kernel/smlibWasm'

const SM_SUCCESS = 1000

let k!: SmlibKernel

function createBox10x20x30(): { brep: number; arg: number } {
  const mem = new DataView(k.memory.buffer)
  const arg = k.malloc(64)
  mem.setFloat64(arg, 0, true)
  mem.setFloat64(arg + 8, 0, true)
  mem.setFloat64(arg + 16, 0, true)
  mem.setUint32(arg + 24, 0, true)
  const st = k.find('SmApiCreateBox')(arg, 10, 20, 30, arg + 24)
  if (st !== SM_SUCCESS) throw new Error(`createBox failed: ${st}`)
  return { brep: mem.getUint32(arg + 24, true), arg }
}

beforeAll(async () => {
  k = await initSmlibWasm()
})

afterAll(() => {
  resetSmlibWasm()
})

describe('SmApiTessellateEx 内核桥', () => {
  it('box(10,20,30) 输出独立三角形网格（36 verts / 12 tris / 12 groups）', () => {
    const { brep, arg } = createBox10x20x30()
    const status = k.malloc(4)
    const buf = k.find('SmApiTessellateEx')(brep, 0, status)
    try {
      expect(new DataView(k.memory.buffer).getUint32(status, true)).toBe(SM_SUCCESS)
      expect(buf).not.toBe(0)
      const u32 = new Uint32Array(k.memory.buffer, buf, 3)
      const numVerts = u32[0]
      const numTris = u32[1]
      const numFaces = u32[2]
      expect(numVerts).toBe(numTris * 3) // 独立三角形：V = 3T
      expect(numTris).toBe(12) // box 6 面 × 2 三角形
      expect(numFaces).toBe(12) // SmApiTessellate 每三角形一个 PolyFace
      // indices 0..V-1 顺序
      const idxOff = buf + 12 + numVerts * 24
      const idx = new Uint32Array(k.memory.buffer, idxOff, numTris * 3)
      for (let i = 0; i < idx.length; i++) expect(idx[i]).toBe(i)
      // faceGroups：triStart 0..11 递增、triCount=1、facePtr 每 2 个相同（6 个原始面）
      const fgOff = idxOff + numTris * 12
      const fg = new Uint32Array(k.memory.buffer, fgOff, numFaces * 3)
      const uniqueFacePtrs = new Set<number>()
      for (let i = 0; i < numFaces; i++) {
        expect(fg[i * 3]).toBe(i) // triStart 递增
        expect(fg[i * 3 + 1]).toBe(1) // triCount = 1
        uniqueFacePtrs.add(fg[i * 3 + 2])
      }
      expect(uniqueFacePtrs.size).toBe(6) // box 6 个原始面
      // 顶点/法向区非空且有限
      const f32 = new Float32Array(k.memory.buffer, buf + 12, numVerts * 3 * 2)
      for (let i = 0; i < 6; i++) expect(Number.isFinite(f32[i])).toBe(true)
      k.free(buf)
    } finally {
      k.free(status)
      k.free(arg)
    }
  })

  it('默认 SmTessellationParams 与显式参数均可传入', () => {
    const { brep, arg } = createBox10x20x30()
    const status = k.malloc(4)
    const params = k.malloc(40) // 5 × f64
    try {
      const dv = new DataView(k.memory.buffer)
      // 显式参数：全部 0 = 使用默认（SmTessellationDefaults：curve/surface 25°）
      for (let i = 0; i < 5; i++) dv.setFloat64(params + i * 8, 0, true)
      const buf = k.find('SmApiTessellateEx')(brep, params, status)
      expect(dv.getUint32(status, true)).toBe(SM_SUCCESS)
      expect(buf).not.toBe(0)
      const u32 = new Uint32Array(k.memory.buffer, buf, 3)
      expect(u32[1]).toBe(12)
      k.free(buf)
    } finally {
      k.free(status)
      k.free(params)
      k.free(arg)
    }
  })
})

describe('SmApiBridgeEx 子形状与边界桥', () => {
  it('GetFacesEx box = 6 个面句柄', () => {
    const { brep, arg } = createBox10x20x30()
    const count = k.malloc(4)
    try {
      const arr = k.find('SmApiGetFacesEx')(brep, count)
      const n = new DataView(k.memory.buffer).getUint32(count, true)
      expect(arr).not.toBe(0)
      expect(n).toBe(6)
      const faces = new Uint32Array(k.memory.buffer, arr, n)
      for (let i = 0; i < n; i++) expect(faces[i]).not.toBe(0)
      // 面句柄互不相同
      expect(new Set(Array.from(faces)).size).toBe(6)
      k.free(arr)
    } finally {
      k.free(count)
      k.free(arg)
    }
  })

  it('GetEdgesEx box = 12 条边句柄', () => {
    const { brep, arg } = createBox10x20x30()
    const count = k.malloc(4)
    try {
      const arr = k.find('SmApiGetEdgesEx')(brep, count)
      const n = new DataView(k.memory.buffer).getUint32(count, true)
      expect(arr).not.toBe(0)
      expect(n).toBe(12)
      const edges = new Uint32Array(k.memory.buffer, arr, n)
      expect(new Set(Array.from(edges)).size).toBe(12)
      k.free(arr)
    } finally {
      k.free(count)
      k.free(arg)
    }
  })

  it('TessellateBoundariesEx box = 12 条边的折线采样', () => {
    const { brep, arg } = createBox10x20x30()
    const status = k.malloc(4)
    try {
      const buf = k.find('SmApiTessellateBoundariesEx')(brep, 5, status)
      expect(new DataView(k.memory.buffer).getUint32(status, true)).toBe(SM_SUCCESS)
      expect(buf).not.toBe(0)
      const u32 = new Uint32Array(k.memory.buffer, buf, 2)
      const numEdges = u32[0]
      const numPoints = u32[1]
      expect(numEdges).toBe(12) // box 12 条边
      expect(numPoints).toBeGreaterThanOrEqual(numEdges * 2)
      // points: f64[3N] at buf+8
      const pts = new Float64Array(k.memory.buffer, buf + 8, numPoints * 3)
      for (let i = 0; i < Math.min(12, numPoints * 3); i++) expect(Number.isFinite(pts[i])).toBe(true)
      // 坐标落在 box 尺寸范围（±10/20/30，含容差）
      const xs = Array.from({ length: numPoints }, (_, i) => pts[i * 3])
      const ys = Array.from({ length: numPoints }, (_, i) => pts[i * 3 + 1])
      const zs = Array.from({ length: numPoints }, (_, i) => pts[i * 3 + 2])
      for (const v of [...xs, ...ys, ...zs]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(30.001)
      }
      // counts: u32[N] at buf+8+24N；总和 = numPoints
      const countsOff = buf + 8 + numPoints * 24
      const counts = new Uint32Array(k.memory.buffer, countsOff, numEdges)
      let sum = 0
      for (let i = 0; i < numEdges; i++) sum += counts[i]
      expect(sum).toBe(numPoints)
      // edges: u32[N] at countsOff+4N
      const edges = new Uint32Array(k.memory.buffer, countsOff + numEdges * 4, numEdges)
      expect(new Set(Array.from(edges)).size).toBe(12)
      k.free(buf)
    } finally {
      k.free(status)
      k.free(arg)
    }
  })

  it('DeleteBrepEx 释放句柄返回成功', () => {
    const { brep, arg } = createBox10x20x30()
    try {
      const st = k.find('SmApiDeleteBrepEx')(brep)
      expect(st).toBe(SM_SUCCESS)
    } finally {
      k.free(arg)
    }
  })
})
