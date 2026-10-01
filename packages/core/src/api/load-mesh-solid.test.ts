/**
 * load-mesh-solid — Phase 1 验收：STL 导入产出「网格实体 + 近似拓扑」
 *
 * 方案 docs/plans/2026-10-01-mesh-solid-brepkit-mesh-ops-and-approximate-topology.md
 * §4 Phase 1 验收原文：
 *
 * > host 拿到 STL 零件的拓扑后，能在 UI 上选中"6 个平面 / 12 条边"并读到正确的
 * > `surfaceType/area/normal/params/curveType/length`；立方体 STL 的 6 个面
 * > `area = 100`（10×10）。
 *
 * 两条边界必须同时钉住：
 * - **装了网格后端** → 网格零件 + 近似拓扑（本文件主路径）；
 * - **没装网格后端** → 保持历史行为（裸网格、无拓扑），**不是**静默降级：
 *   "宿主没有网格内核"是装配事实，与"规范化失败必须报错"是两回事。
 *
 * STL 由本文件自己生成（二进制 STL，12 三角形），不依赖外部 fixture——被测对象
 * 正是"任意网格文件 → 网格实体"这条链路，自己造的输入最能把数值卡死。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../cad-runtime/ports'
import { createEditorRuntime } from '../test-support/editor-ops'
import { asPartName } from '../identity'
import { __resetEngineRegistriesForTests, getMeshSolidBackend } from '../brep/engine/registry'
import { registerBrepkitMeshEngine } from '../brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../brepkit-kernel/brepkitKernel'
import { hasBrep, hasMeshSolid } from '../shape'
import type { Shape } from '../mesh/types'

// ── 二进制 STL 生成（不引 fixture） ──

/**
 * 由「三角形顶点三元组」构造二进制 STL。
 *
 * 格式：80 字节头 + uint32 三角形数 + 每三角形 50 字节
 * （法向 3×f32 + 顶点 3×3×f32 + uint16 属性计数）。
 *
 * @param tris - flat list of 9 numbers per triangle (v0,v1,v2).
 * @returns the binary STL bytes as an ArrayBuffer.
 */
function binaryStl(tris: number[][]): ArrayBuffer {
  const n = tris.length
  const buf = new ArrayBuffer(84 + n * 50)
  const view = new DataView(buf)
  view.setUint32(80, n, true)
  let off = 84
  for (const t of tris) {
    // 法向由两条边叉积导出（STL 消费者普遍忽略它，但格式要求存在）。
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t as number[]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(off, v, true)
      off += 4
    }
    view.setUint16(off, 0, true)
    off += 2
  }
  return buf
}

/**
 * 轴对齐立方体的 12 个三角形（min corner 在原点，右手系，**外向**绕序）。
 *
 * 绕序必须是外向的——否则 weld 后 `validateSolid` 非 0，规范化会（正确地）失败。
 * 每个面的绕序按右手法则取外向法向校验过（见各面注释）。
 */
function boxTriangles(dx: number, dy: number, dz: number): number[][] {
  const O = [0, 0, 0], X = [dx, 0, 0], Y = [0, dy, 0], Z = [0, 0, dz]
  const XY = [dx, dy, 0], XZ = [dx, 0, dz], YZ = [0, dy, dz], XYZ = [dx, dy, dz]
  const quad = (a: number[], b: number[], c: number[], d: number[]): number[][] => [
    [...a, ...b, ...c], [...a, ...c, ...d],
  ]
  return [
    ...quad(O, Y, XY, X),      // z = 0   → 法向 -Z
    ...quad(O, Z, YZ, Y),      // x = 0   → 法向 -X
    ...quad(O, X, XZ, Z),      // y = 0   → 法向 -Y
    ...quad(Z, XZ, XYZ, YZ),   // z = dz  → 法向 +Z
    ...quad(X, XY, XYZ, XZ),   // x = dx  → 法向 +X
    ...quad(Y, YZ, XYZ, XY),   // y = dy  → 法向 +Y
  ]
}

/** assets 按文件名寻址（与 load-file-param.test.ts 同口径）。 */
function portsFor(files: Record<string, ArrayBuffer>): HostPorts {
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async (key: string) => {
        const bytes = files[key]
        if (!bytes) throw new Error(`[test] no asset for file: ${key}`)
        return { bytes }
      },
      resolveFile: async () => { throw new Error('[test] resolveFile unused') },
      resolveUrl: async () => { throw new Error('[test] resolveUrl unused') },
    },
  } as unknown as HostPorts
}

const BOX_STL = binaryStl(boxTriangles(10, 10, 10))

interface FaceRowLike {
  surfaceType?: string
  area?: number
  normal?: number[]
  params?: unknown
}
interface EdgeRowLike {
  curveType?: string
  length?: number
  faceStart?: number
  faceCount?: number
}

describe('cad.load（STL）→ 网格实体 + 近似拓扑（Phase 1 验收）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('装了网格后端：立方体 STL 得到 6 个平面面（area=100）+ 12 条边（length=10）', async () => {
    expect(getMeshSolidBackend(), 'mesh backend assembled').not.toBeNull()
    const runtime = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const result = await runtime.execute("let a = await cad.load({ file: 'cube10.stl' })")
    expect(result.failedAt).toBeUndefined()

    // ── 拓扑来源与规模 ──
    const topo = result.topology?.get(asPartName('a'))
    expect(topo, 'topology entry for the loaded part').toBeDefined()
    expect(topo!.source).toBe('mesh')
    const faces = topo!.data.faces as unknown as FaceRowLike[]
    const edges = topo!.data.edges as unknown as EdgeRowLike[]
    expect(faces.length).toBe(6)
    expect(edges.length).toBe(12)

    // ── 面行：6 个平面、每个 10×10 = 100 ──
    for (const f of faces) {
      expect(f.surfaceType).toBe('plane')
      expect(f.area).toBeCloseTo(100, 6)
      const n = f.normal as number[]
      // 近似拓扑的平面法向必须是某个坐标轴（±1 在某一轴，其余为 0）
      const abs = n.map(Math.abs).sort((x, y) => y - x)
      expect(abs[0]).toBeCloseTo(1, 9)
      expect(abs[1]).toBeCloseTo(0, 9)
      expect(abs[2]).toBeCloseTo(0, 9)
      expect(f.params, 'plane params present').toBeTruthy()
    }
    // 六面法向两两成对反向：3 个轴向各 ±1
    const normals = faces.map((f) => (f.normal as number[]).map((v) => Math.round(v)).join(','))
    expect(new Set(normals).size).toBe(6)

    // ── 边行：12 条 LINE、每条长 10、每条恰邻接 2 个面 ──
    for (const e of edges) {
      expect(e.curveType).toBe('LINE')
      expect(e.length).toBeCloseTo(10, 6)
      expect(e.faceCount, '每条识别边邻接两个面（双角色限定符的前提）').toBe(2)
    }

    // ── 形状侧：网格零件身份（有 meshSolid、无 BREP 句柄） ──
    const shape = result.outputs.get(asPartName('a')) as Shape
    expect(hasMeshSolid(shape)).toBe(true)
    expect(hasBrep(shape)).toBe(false)
    // 句柄登记进独立注册表（**不**进 brepChain.solidCache）
    expect(runtime.meshSolids.has(asPartName('a'))).toBe(true)
    expect(result.brepChain.solidCache.has(asPartName('a'))).toBe(false)
  })

  it('显示 mesh 与拓扑 mesh 同源：faceRuns 覆盖全部三角形（规则 1）', async () => {
    const runtime = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const result = await runtime.execute("let a = await cad.load({ file: 'cube10.stl' })")
    const shape = result.outputs.get(asPartName('a')) as Shape
    const topo = result.topology!.get(asPartName('a'))!
    const faces = topo.data.faces as unknown as Array<{ triangleStart?: number; triangleCount?: number }>

    // 显示 mesh 的三角形数 = 各面 triangleCount 之和（同一份三角化的直接证据）
    const total = faces.reduce((s, f) => s + (f.triangleCount ?? 0), 0)
    expect(total).toBe(shape.indices.length / 3)
    // 立方体 STL 12 三角形 → 规范化后仍是 12 个三角形（6 面 × 2）
    expect(total).toBe(12)
    // 面区间首尾相接、恰好铺满 [0, 12)：tile[i].start + tile[i].count === tile[i+1].start
    const tile = faces
      .map((f) => ({ start: f.triangleStart ?? -1, count: f.triangleCount ?? 0 }))
      .sort((a, b) => a.start - b.start)
    expect(tile[0]!.start).toBe(0)
    let cursor = 0
    for (const t of tile) {
      expect(t.start).toBe(cursor)
      cursor += t.count
    }
    expect(cursor).toBe(12)
  })

  it('未装配网格后端：退回裸网格、无拓扑（历史行为，非静默降级）', async () => {
    __resetEngineRegistriesForTests() // 清掉网格后端
    const runtime = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const result = await runtime.execute("let a = await cad.load({ file: 'cube10.stl' })")
    expect(result.failedAt).toBeUndefined()
    const shape = result.outputs.get(asPartName('a')) as Shape
    expect(shape.indices.length).toBe(36)
    expect(hasMeshSolid(shape)).toBe(false)
    expect(result.topology?.get(asPartName('a'))).toBeUndefined()
    // 恢复装配，供后续用例（afterAll 只做内核释放）
    await registerBrepkitMeshEngine()
  })

  it('开放网格（两张三角形组成的开口面）→ 明确报错，不退化成无拓扑裸网格', async () => {
    // 共一条边的两张三角形：weld 能把重复顶点/边缝上，但结果是一个**开口壳**，
    // 不是闭合实体 → 必须在导入处失败（而不是留下一个"有句柄无拓扑"的怪零件）。
    const open = binaryStl([
      [0, 0, 0, 10, 0, 0, 10, 10, 0],
      [0, 0, 0, 10, 10, 0, 0, 10, 0],
    ])
    const runtime = createEditorRuntime(portsFor({ 'open.stl': open }), 'mesh')
    const result = await runtime.execute("let a = await cad.load({ file: 'open.stl' })")
    expect(result.failedAt, '开放网格必须在导入处失败').toBeDefined()
    expect(result.failedAt!.message).toContain('E_MESH_SOLID_UNWELDABLE')
  })

  it('退化网格（单个三角形，缝不上）→ 同样明确报错（内核前置条件失败）', async () => {
    const single = binaryStl([[0, 0, 0, 10, 0, 0, 0, 10, 0]])
    const runtime = createEditorRuntime(portsFor({ 'single.stl': single }), 'mesh')
    const result = await runtime.execute("let a = await cad.load({ file: 'single.stl' })")
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.message).toContain('E_MESH_SOLID_UNWELDABLE')
  })

  it('PartName 被 BREP 输出顶替时，不把网格实体身份写上去（互斥不变量）', async () => {
    const runtime = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      "a = cad.box(1, 1, 1)",
    )
    expect(result.failedAt).toBeUndefined()
    const shape = result.outputs.get(asPartName('a')) as Shape
    // 末态是纯 mesh box（1×1×1，无网格实体身份，也无拓扑）
    expect(hasMeshSolid(shape)).toBe(false)
    expect(result.topology?.get(asPartName('a'))).toBeUndefined()
  })
})
