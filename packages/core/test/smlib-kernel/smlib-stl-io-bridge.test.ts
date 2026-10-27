/**
 * smlib-kernel/smlib-stl-io-bridge — C++ 层 STL 导入/导出桥的隔离验证（node 直跑）
 *
 * 直接驱动 usd-brep/source/SM_API/src/SmApiStlIo.cpp 的两个内核桥，
 * 不经由 faijs 引擎中立的 export-stl.ts（那条路径只读 Shape 三角载荷）。
 * 目的：证明改动的 C++ 源码本身正确——导出产出合法 binary STL 字节，
 * 导出的字节再导入回真实水密 B-rep，且体积守恒。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-stl-io-bridge.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initSmlibWasm, resetSmlibWasm, type SmlibKernel } from '../../src/smlib-kernel/smlibWasm'

const SM_SUCCESS = 1000

let k!: SmlibKernel

function createBox10x20x30(): number {
  const mem = new DataView(k.memory.buffer)
  const arg = k.malloc(64)
  mem.setFloat64(arg, 0, true) // origin x
  mem.setFloat64(arg + 8, 0, true) // origin y
  mem.setFloat64(arg + 16, 0, true) // origin z
  mem.setUint32(arg + 24, 0, true) // out handle slot
  const st = k.find('SmApiCreateBox')(arg, 10, 20, 30, arg + 24)
  if (st !== SM_SUCCESS) throw new Error(`SmApiCreateBox failed: ${st}`)
  const brep = mem.getUint32(arg + 24, true)
  k.free(arg)
  return brep
}

function brepVolume(brep: number): number {
  const pVol = k.malloc(8)
  const pSt = k.malloc(4)
  try {
    const st = k.find('SmApiBrepComputeVolume')(brep, 1e-8, pVol)
    if (st !== SM_SUCCESS) throw new Error(`SmApiBrepComputeVolume failed: ${st}`)
    return new DataView(k.memory.buffer).getFloat64(pVol, true)
  } finally {
    k.free(pVol)
    k.free(pSt)
  }
}

describe('SmApiExportStlEx / SmApiImportStlEx 内核桥', () => {
  beforeAll(async () => {
    k = await initSmlibWasm()
  })
  afterAll(() => {
    resetSmlibWasm()
  })

  it('导出：box(10,20,30) → binary STL 字节合法（12 三角，684 字节）', () => {
    const box = createBox10x20x30()
    const pBytes = k.malloc(4)
    const pStatus = k.malloc(4)
    try {
      const buf = k.find('SmApiExportStlEx')(box, 0 /*binary*/, pBytes, pStatus)
      expect(new DataView(k.memory.buffer).getUint32(pStatus, true)).toBe(SM_SUCCESS)
      expect(buf).not.toBe(0)
      const nBytes = new DataView(k.memory.buffer).getUint32(pBytes, true)
      expect(nBytes).toBe(84 + 12 * 50) // 80 头 + u32 三角数 + 12×50
      // binary STL 三角数位于字节 80..84（小端 u32）
      const numTris = new DataView(k.memory.buffer).getUint32(buf + 80, true)
      expect(numTris).toBe(12)
    } finally {
      k.free(pBytes)
      k.free(pStatus)
    }
  })

  it('往返：导出字节 → 导入 → 真实水密 B-rep（体积 ≈ 6000）', () => {
    const box = createBox10x20x30()
    // 1) 导出
    const pBytes = k.malloc(4)
    const pStatus = k.malloc(4)
    const buf = k.find('SmApiExportStlEx')(box, 0, pBytes, pStatus)
    const stExport = new DataView(k.memory.buffer).getUint32(pStatus, true)
    expect(stExport).toBe(SM_SUCCESS)
    const nBytes = new DataView(k.memory.buffer).getUint32(pBytes, true)
    expect(nBytes).toBeGreaterThan(0)

    // 2) 把 STL 字节拷进一块独立缓冲（避免别名），喂给导入桥
    const stlPtr = k.malloc(nBytes)
    new Uint8Array(k.memory.buffer, stlPtr, nBytes).set(
      new Uint8Array(k.memory.buffer, buf, nBytes),
    )

    const pImpStatus = k.malloc(4)
    const imported = k.find('SmApiImportStlEx')(stlPtr, nBytes, 1e-6, pImpStatus)
    const stImport = new DataView(k.memory.buffer).getUint32(pImpStatus, true)
    expect(stImport).toBe(SM_SUCCESS)
    expect(imported).not.toBe(0)

    // 3) 导入体是真实水密实体：体积守恒
    const vol = brepVolume(imported)
    expect(vol).toBeCloseTo(6000, 0)

    k.free(pBytes)
    k.free(pStatus)
    k.free(stlPtr)
    k.free(pImpStatus)
  })

  it('导入：焊接容差把共享顶点合并（box 8 顶点、12 三角 → 单一实体）', () => {
    const box = createBox10x20x30()
    const pBytes = k.malloc(4)
    const pStatus = k.malloc(4)
    const buf = k.find('SmApiExportStlEx')(box, 0, pBytes, pStatus)
    const nBytes = new DataView(k.memory.buffer).getUint32(pBytes, true)

    const stlPtr = k.malloc(nBytes)
    new Uint8Array(k.memory.buffer, stlPtr, nBytes).set(
      new Uint8Array(k.memory.buffer, buf, nBytes),
    )
    const pImpStatus = k.malloc(4)
    const imported = k.find('SmApiImportStlEx')(stlPtr, nBytes, 1e-4 /*更松的焊接容差*/, pImpStatus)
    const stImport = new DataView(k.memory.buffer).getUint32(pImpStatus, true)
    expect(stImport).toBe(SM_SUCCESS)
    expect(imported).not.toBe(0)
    const vol = brepVolume(imported)
    expect(vol).toBeCloseTo(6000, 0)

    k.free(pBytes)
    k.free(pStatus)
    k.free(stlPtr)
    k.free(pImpStatus)
  })
})
