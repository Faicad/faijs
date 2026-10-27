/**
 * @vitest-environment node
 *
 * smlib-kernel/smlib-stl-import-perf.probe — STL 导入「真 B-rep」路径性能探针
 *
 * 为什么先做这个：方案 §8 风险 R1 指出——「10 万三角的 STL 会生成 10 万个平面面，
 * smlib 侧 `SmApiStitchIntoSolid` 在万级面上的表现**未实测**」。这个探针把它测出来，
 * 用数据决定 STL 导入到底走真 B-rep 还是退回 mesh 路径，而不是靠猜。
 *
 * 被测路径（对应 brepkit `crates/io/src/stl/import.rs` 的算法，换成 SM_API 调用）：
 *   1. 顶点焊接（TS，按 tolerance 去重）
 *   2. 逐三角造 3 条线段      → SmApiCreateLineSegment
 *   3. 批量建平面面           → SmApiCreatePlanarFacesEx
 *   4. 缝合成实体             → SmApiStitchIntoSolidEx
 *
 * 这个探针**不改任何源码**，只调用既有 wasm 桥，测量其耗时与内存量级。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-stl-import-perf.probe.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initSmlibWasm, resetSmlibWasm, type SmlibKernel } from '../../src/smlib-kernel/smlibWasm'

const SM_SUCCESS = 1000

let k!: SmlibKernel

beforeAll(async () => {
  k = await initSmlibWasm()
}, 120000)

afterAll(() => {
  resetSmlibWasm()
})

/** 写入 3 个 f64 到 wasm 堆，返回指针。 */
function writeVec3(dv: DataView, ptr: number, x: number, y: number, z: number): void {
  dv.setFloat64(ptr, x, true)
  dv.setFloat64(ptr + 8, y, true)
  dv.setFloat64(ptr + 16, z, true)
}

/** 造一条线段曲线（SmApiCreateLineSegment：起点指针 + 终点指针 → SmLine* 句柄）。 */
function createLineSegment(a: [number, number, number], b: [number, number, number]): number {
  const dv = new DataView(k.memory.buffer)
  const p = k.malloc(48)
  const out = k.malloc(4)
  try {
    writeVec3(dv, p, a[0], a[1], a[2])
    writeVec3(dv, p + 24, b[0], b[1], b[2])
    dv.setUint32(out, 0, true)
    const st = k.find('SmApiCreateLineSegment')(p, p + 24, out)
    if (st !== SM_SUCCESS) throw new Error(`createLineSegment failed: ${st}`)
    return dv.getUint32(out, true)
  } finally {
    k.free(p)
    k.free(out)
  }
}

/** 批量建平面面：曲线句柄数组 → 新 brep 句柄。 */
function createPlanarFaces(curves: number[]): number {
  const dv = new DataView(k.memory.buffer)
  const arr = k.malloc(4 * curves.length)
  const out = k.malloc(4)
  try {
    curves.forEach((c, i) => dv.setUint32(arr + i * 4, c, true))
    dv.setUint32(out, 0, true)
    const st = k.find('SmApiCreatePlanarFacesEx')(arr, curves.length, out)
    if (st !== SM_SUCCESS) throw new Error(`createPlanarFaces failed: ${st}`)
    return dv.getUint32(out, true)
  } finally {
    k.free(arr)
    k.free(out)
  }
}

/** 缝合成实体：返回 {isSolid, stitched, vgap, egap}。 */
function stitchIntoSolid(brep: number): { isSolid: boolean; stitched: number; vgap: number; egap: number } {
  const dv = new DataView(k.memory.buffer)
  const out = k.malloc(24)
  try {
    const st = k.find('SmApiStitchIntoSolidEx')(brep, out)
    if (st !== SM_SUCCESS) throw new Error(`stitch failed: ${st}`)
    return {
      isSolid: dv.getUint32(out, true) === 1,
      stitched: dv.getUint32(out + 4, true),
      vgap: dv.getFloat64(out + 8, true),
      egap: dv.getFloat64(out + 16, true),
    }
  } finally {
    k.free(out)
  }
}

/** 生成单位立方体的三角形网格（12 个三角，8 个焊接后顶点）。 */
function unitCubeTriangles(): { positions: number[]; indices: number[] } {
  const positions: number[] = []
  const P: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ]
  for (const [x, y, z] of P) positions.push(x, y, z)
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]
  return { positions, indices }
}

describe('STL 导入「真 B-rep」路径性能探针（R1 量化）', () => {
  it('小样本可行性：立方体 12 三角 → 建面 + 缝合成实体', () => {
    const { positions, indices } = unitCubeTriangles()

    const t0 = Date.now()
    const curves: number[] = []
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]! * 3
      const b = indices[i + 1]! * 3
      const c = indices[i + 2]! * 3
      curves.push(createLineSegment(
        [positions[a]!, positions[a + 1]!, positions[a + 2]!],
        [positions[b]!, positions[b + 1]!, positions[b + 2]!],
      ))
      curves.push(createLineSegment(
        [positions[b]!, positions[b + 1]!, positions[b + 2]!],
        [positions[c]!, positions[c + 1]!, positions[c + 2]!],
      ))
      curves.push(createLineSegment(
        [positions[c]!, positions[c + 1]!, positions[c + 2]!],
        [positions[a]!, positions[a + 1]!, positions[a + 2]!],
      ))
    }
    const tCurves = Date.now() - t0

    const t1 = Date.now()
    const brep = createPlanarFaces(curves)
    const tFaces = Date.now() - t1

    const t2 = Date.now()
    const stitched = stitchIntoSolid(brep)
    const tStitch = Date.now() - t2

    // 打印探针数据（CI 日志可见，供决策用）
    const report = {
      triangles: indices.length / 3,
      curvesBuilt: curves.length,
      msCreateCurves: tCurves,
      msCreatePlanarFaces: tFaces,
      msStitch: tStitch,
      msTotal: tCurves + tFaces + tStitch,
      stitched: stitched,
    }
    console.log('[PERF-PROBE] ' + JSON.stringify(report))

    expect(curves.length).toBe(36)
    expect(brep).not.toBe(0)
    expect(stitched.stitched).toBeGreaterThan(0)
  })

  it('规模标定：1k / 10k 三角的耗时与内存量级', () => {
    const samples = [1000, 10000]
    const rows: unknown[] = []

    for (const triCount of samples) {
      // 构造 triCount 个互不相连的三角形（最坏情况：每个都独立焊接，面数 = triCount）
      const positions: number[] = []
      const indices: number[] = []
      for (let t = 0; t < triCount; t++) {
        const base = t * 3
        positions.push(base, 0, 0, base + 1, 0, 0, base + 0.5, 1, 0)
        indices.push(base, base + 1, base + 2)
      }

      const memBefore = k.memory.buffer.byteLength
      const t0 = Date.now()

      const curves: number[] = []
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i]! * 3
        const b = indices[i + 1]! * 3
        const c = indices[i + 2]! * 3
        curves.push(createLineSegment(
          [positions[a]!, positions[a + 1]!, positions[a + 2]!],
          [positions[b]!, positions[b + 1]!, positions[b + 2]!],
        ))
        curves.push(createLineSegment(
          [positions[b]!, positions[b + 1]!, positions[b + 2]!],
          [positions[c]!, positions[c + 1]!, positions[c + 2]!],
        ))
        curves.push(createLineSegment(
          [positions[c]!, positions[c + 1]!, positions[c + 2]!],
          [positions[a]!, positions[a + 1]!, positions[a + 2]!],
        ))
      }
      const tCurves = Date.now() - t0

      const t1 = Date.now()
      const brep = createPlanarFaces(curves)
      const tFaces = Date.now() - t1

      const t2 = Date.now()
      const stitch = stitchIntoSolid(brep)
      const tStitch = Date.now() - t2

      rows.push({
        triangles: triCount,
        curves: curves.length,
        msCreateCurves: tCurves,
        msCreatePlanarFaces: tFaces,
        msStitch: tStitch,
        msTotal: tCurves + tFaces + tStitch,
        pagesBefore: memBefore / 65536,
        pagesAfter: k.memory.buffer.byteLength / 65536,
        isSolid: stitch.isSolid,
        stitchedCount: stitch.stitched,
      })
    }

    console.log('[PERF-SCALE] ' + JSON.stringify(rows))
    expect(rows.length).toBe(2)
  }, 300000)
})
