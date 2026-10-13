/**
 * face-group-units.test — L1 三角化/线框分组的**单位与 hash 口径**跨引擎一致性
 *
 * 为什么必须钉住（AGENTS.md「与预期不一致的 API 用法必须留档为测试」）：
 * `BrepMeshResult.faceGroups` 与 `BrepEdgeData.edgeGroups` 的前两元是 L1 契约的一部分，
 * 由**两个引擎各自生产**、由 `occt-kernel/topologyExt.ts` **统一消费**。生产端单位
 * 或取模上界写错，消费端不会报错——只会静默把面/边区间算成 0 或缩小 3 倍，
 * 于是「按面高亮」「按面拾取」全错，且没有任何测试会红。
 *
 * 实测基线（2026-10-01，两个引擎各自跑同一 box）：
 * - `faceGroups` = `[triStart, triCount, faceHash]`，前两元**索引单位**（3/三角形）；
 * - `wireframe().edgeGroups` = `[pointStart, pointCount, edgeHash]`，前两元**浮点单位**；
 * - face/edge hash 由 `hashCode(handle, BREP_HASH_BOUND)` 产出，与分组里的 hash 相等。
 *
 * 修复前 brepkit 适配器生产端是「三角形单位 + 1e9 上界」，消费端是「索引单位 +
 * INT32_MAX」→ 面行 triangleCount 恒 0。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { createOcctPrimitives } from '../../src/occt-kernel/occt-primitives'
import { createBrepkitPrimitives, disposeBrepkit, type BrepkitPrimitives } from '../../src/brepkit-kernel/brepkitKernel'
import { buildTopologyFromMesh } from '../../src/brep/brep-topology'
import { BREP_HASH_BOUND, type BrepMeshResult } from '../../src/brep/engine/types'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { SelectorRuntime } from '../../src/topology/types'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let brepkitAvailable = false
try {
  require.resolve('brepkit-wasm')
  brepkitAvailable = true
} catch {
  brepkitAvailable = false
}

/** 同一几何在两个引擎上的产物契约断言（单位 + hash 同源）。 */
function assertGroupContract(
  engine: string,
  api: BrepEngineApi,
  solid: Parameters<BrepEngineApi['meshShape']>[0],
  mesh: BrepMeshResult,
): void {
  const fg = mesh.faceGroups
  expect(fg, `${engine}: meshShape 必须返回 faceGroups`).toBeDefined()
  expect(mesh.faceCount, `${engine}: faceCount 缺省`).toBe(fg!.length / 3)

  // 1) 索引单位：全部面组的 count 之和 == 索引数组长度（三角形单位下会少 3 倍）
  let totalIndexCount = 0
  for (let i = 0; i < fg!.length; i += 3) totalIndexCount += fg![i + 1]!
  expect(totalIndexCount, `${engine}: faceGroups 必须是索引单位`).toBe(mesh.indices.length)

  // 2) hash 与 hashCode(subShape, BREP_HASH_BOUND) 同源
  const faces = api.getSubShapes(solid, 'face')
  const faceHashes = new Set(faces.map((f) => api.hashCode(f, BREP_HASH_BOUND)))
  const groupHashes = Array.from({ length: fg!.length / 3 }, (_, i) => fg![i * 3 + 2]!)
  for (const h of groupHashes) {
    expect(faceHashes.has(h), `${engine}: faceGroups hash ${h} 不在 hashCode(face) 集合内（取模上界不同源）`).toBe(true)
  }

  // 3) 线框分组同为浮点单位、且边 hash 可被同一 collection 命中
  const wf = api.wireframe(solid, 0.1)
  let totalPointFloats = 0
  for (let i = 0; i < wf.edgeGroups.length; i += 3) totalPointFloats += wf.edgeGroups[i + 1]!
  expect(totalPointFloats, `${engine}: edgeGroups 必须是浮点单位`).toBe(wf.points.length)
  const edgeHashes = new Set(api.getSubShapes(solid, 'edge').map((e) => api.hashCode(e, BREP_HASH_BOUND)))
  const edgeGroupHashes = Array.from({ length: wf.edgeGroups.length / 3 }, (_, i) => wf.edgeGroups[i * 3 + 2]!)
  for (const h of edgeGroupHashes) {
    expect(edgeHashes.has(h), `${engine}: edgeGroups hash ${h} 不在 hashCode(edge) 集合内`).toBe(true)
  }
}

/** 面行区间（triangleStart/triangleCount）必须与几何自洽：面积和 = 盒表面积。 */
function faceRowsOf(api: BrepEngineApi, solid: Parameters<BrepEngineApi['meshShape']>[0]): SelectorRuntime {
  const mesh = api.meshShape(solid, { linearDeflection: 0.1, angularDeflection: 0.2 })
  return buildTopologyFromMesh(api, solid, mesh)
}

describe('L1 分组单位与 hash 口径（跨引擎）', () => {
  // 两个 wasm 内核各自**只初始化一次**、只在文件级 afterAll 释放。
  // GOTCHA（2026-10-01 实测）：`disposeBrepkit()` 只 `free()` 内核，不重置 brepkitWasm.ts 里
  // 缓存在 globalThis 的 `initPromise`，因此「释放后再 createBrepkitPrimitives()」会拿到
  // 已释放的内核 → `Error: null pointer passed to rust`。测试内禁止中途 dispose 重建。
  let occt!: BrepEngineApi
  let kit: BrepkitPrimitives | null = null

  beforeAll(async () => {
    await initOcctWasm()
    occt = await createOcctPrimitives()
    if (brepkitAvailable) kit = await createBrepkitPrimitives()
  }, 60000)

  afterAll(() => { if (kit) disposeBrepkit() })

  it('occt：faceGroups 索引单位 / edgeGroups 浮点单位 / hash 同源', () => {
    const box = occt.makeBox(10, 10, 10)
    assertGroupContract('occt', occt, box, occt.meshShape(box, { linearDeflection: 0.1, angularDeflection: 0.2 }))
  })

  it.skipIf(!brepkitAvailable)('brepkit：faceGroups 索引单位 / edgeGroups 浮点单位 / hash 同源', () => {
    const box = kit!.makeBox(10, 10, 10)
    assertGroupContract('brepkit', kit!, box, kit!.meshShape(box, { linearDeflection: 0.1, angularDeflection: 0.2 }))
  })

  it.skipIf(!brepkitAvailable)('同一 box 在 occt / brepkit 上的面行区间与面积一致', () => {
    const occtRows = faceRowsOf(occt, occt.makeBox(10, 10, 10))
    const occtByArea = occtRows.faces.map((f) => Math.round(Number(f.area))).sort((a, b) => a - b)
    expect(occtRows.faces.length).toBe(6)
    expect(occtRows.faces.every((f) => f.triangleCount === 2)).toBe(true)
    expect(occtByArea).toEqual([100, 100, 100, 100, 100, 100])

    const kitRows = faceRowsOf(kit!, kit!.makeBox(10, 10, 10))
    const kitByArea = kitRows.faces.map((f) => Math.round(Number(f.area))).sort((a, b) => a - b)
    // 面数、每个面的三角形区间、面积三者都必须与 occt 侧一致（单位缺陷会直接打破前两者）
    expect(kitRows.faces.length).toBe(occtRows.faces.length)
    expect(kitRows.faces.map((f) => f.triangleCount)).toEqual(occtRows.faces.map((f) => f.triangleCount))
    expect(kitRows.faces.map((f) => f.triangleStart)).toEqual(occtRows.faces.map((f) => f.triangleStart))
    expect(kitByArea).toEqual(occtByArea)
    // 边：数量与长度一致（10mm 立方体 12 条边）
    expect(kitRows.edges.length).toBe(occtRows.edges.length)
    expect(kitRows.edges.map((e) => Math.round(Number(e.length)))).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10])
  }, 60000)
})
