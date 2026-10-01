/**
 * mesh-solid-ops — Phase 2 验收：B1 批 mesh op（倒圆角 / 倒角 / 布尔）
 *
 * 方案 docs/plans/2026-10-01-mesh-solid-brepkit-mesh-ops-and-approximate-topology.md
 * §4 Phase 2 验收原文：
 *
 * > 对立方体 STL 的任一识别边 `fillet(r=1)`，结果仍为合法网格实体、体积落在解析
 * > 预期区间；圆柱 STL 96 条边全部可倒角；网格实体与 BREP 实体**不可**混进同一次
 * > 布尔（静态报错）。
 *
 * 三条结论各自对应的**事实来源**（不靠文档转述）：
 * - 体积区间来自解析式：立方体棱倒圆角 r 的体积 = a³ − (1 − π/4)·r²·a。r=0.1a 时
 *   收敛得很紧，可以直接卡数值区间；磨掉的是真实的圆柱形料。
 * - 圆柱 96 条边 = 32 条竖向棱 + 上下端盖各 32 条边（32 边形棱柱的解析边数，
 *   不是"跑出来多少算多少"）。逐条可倒角的实测结论由
 *   `brepkit-kernel/mesh-solid-topology.test.ts` 钉住（96/96），本文件钉住**走 op
 *   路径**时同样成立。
 * - "不可混"是 `dispatchPath` 的静态门禁，故断言必须落在 `failedAt` 上，并且要能
 *   与"几何失败"区分开——所以卡错误码，不卡"有没有报错"。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../cad-runtime/ports'
import { createEditorRuntime } from '../test-support/editor-ops'
import type { CadRuntime } from '../cad-runtime/runtime'
import { asPartName } from '../identity'
import { __resetEngineRegistriesForTests, getMeshSolidBackend } from '../brep/engine/registry'
import { registerBrepkitMeshEngine } from '../brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../brepkit-kernel/brepkitKernel'
import { getSlot, hasMeshSolid } from '../shape'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'

// ── 二进制 STL 生成（与 load-mesh-solid.test.ts 同口径：不引 fixture） ──

/**
 * 由「三角形顶点三元组」构造二进制 STL（80 字节头 + uint32 计数 + 每三角形 50 字节）。
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

/** 轴对齐立方体 12 三角形（min corner 在原点，外向绕序）。 */
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

/**
 * 32 边形棱柱（`segments = 32`，r/h 给定）→ 128 三角形（每扇区 2 侧面 + 2 端盖），
 * 与 brepkit 自产圆柱同一量级。
 *
 * 端盖用**中心扇形**：32 个共面三角形焊接后会被 `unifyFaces` 合成**一张**端盖面
 * （这正是"曲面不还原、平面可合并"的如实形态）。绕序全部外向——否则 weld 后
 * `validateSolid` 非 0，规范化会正确地失败（同 load 的 GOTCHA）。
 *
 * @param r - circumradius (mm).
 * @param h - height (mm).
 * @param segments - side count (32 → 96 edges: 32 vertical + 2×32 rim).
 * @returns the prism's triangles.
 */
function cylinderTriangles(r: number, h: number, segments = 32): number[][] {
  const ring = (z: number): number[][] =>
    Array.from({ length: segments }, (_, i) => {
      const th = (2 * Math.PI * i) / segments
      return [r * Math.cos(th), r * Math.sin(th), z]
    })
  const bot = ring(0)
  const top = ring(h)
  const cb = [0, 0, 0]
  const ct = [0, 0, h]
  const tris: number[][] = []
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments
    const bi = bot[i]!, bj = bot[j]!, ti = top[i]!, tj = top[j]!
    tris.push([...bi, ...bj, ...tj])   // 侧面（外向：切向 × 向上 = 径向外）
    tris.push([...bi, ...tj, ...ti])
    tris.push([...cb, ...bj, ...bi])   // 下端盖（-Z）
    tris.push([...ct, ...ti, ...tj])   // 上端盖（+Z）
  }
  return tris
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

interface EdgeRowLike {
  curveType?: string
  length?: number
  center?: number[]
}
interface FaceRowLike { surfaceType?: string; area?: number }

/** 从一次执行的近似拓扑读出某个 part 的边行。 */
function edgeRowsOf(result: Awaited<ReturnType<CadRuntime['execute']>>, part: string): EdgeRowLike[] {
  const topo = result.topology?.get(asPartName(part))
  expect(topo, `topology for ${part}`).toBeDefined()
  return topo!.data.edges as unknown as EdgeRowLike[]
}

/**
 * 把一条识别边包成 `EdgeTopoRef` 源码字面量。
 *
 * 网格零件**没有 role 层**（Phase 1.8：approximate topology 的行 origin/role 显式
 * 为 null），所以两个 RoleQualifier 只能是占位值——解析走几何兜底（length/midpoint）。
 * 占位 origin 用一个稳定串，避免"看起来像真 StmtId"。
 */
function edgeRefLiteral(e: EdgeRowLike): string {
  return JSON.stringify({
    kind: 'edge',
    faces: [{ origin: 'mesh', role: '' }, { origin: 'mesh', role: '' }],
    hint: { kind: 'edge', length: e.length, midpoint: e.center },
  })
}

/** 网格实体句柄 → 体积（经网格后端的 L1 内核，测的是真几何不是估算）。 */
function volumeOf(runtime: CadRuntime, part: string): number {
  const backend = getMeshSolidBackend()
  expect(backend, 'mesh backend assembled').not.toBeNull()
  const handle = runtime.meshSolids.get(asPartName(part))
  expect(handle, `mesh solid handle for ${part}`).toBeDefined()
  return backend!.kernel.getVolume(handle as BrepHandle)
}

const BOX_STL = binaryStl(boxTriangles(10, 10, 10))
const CYL_STL = binaryStl(cylinderTriangles(10, 30, 32))

describe('网格实体的 mesh op（Phase 2 验收：B1 批）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('立方体 STL 的一条识别边 fillet(r=1) → 合法网格实体，体积落在解析预期区间', async () => {
    // 第一趟：只为读出识别边的几何 hint（load 是确定性的，第二趟拿到同一条边）。
    const probe = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const loaded = await probe.execute("let a = await cad.load({ file: 'cube10.stl' })")
    expect(loaded.failedAt).toBeUndefined()
    const edges = edgeRowsOf(loaded, 'a')
    expect(edges.length).toBe(12)
    const ref = edgeRefLiteral(edges[0]!)

    const runtime = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let b = await cad.fillet(a, { edges: [${ref}], radius: 1 })`,
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')

    const shape = result.outputs.get(asPartName('b')) as Shape
    // ① 产物仍是**网格零件**：携带网格实体句柄，且没有被升格成 BREP
    expect(hasMeshSolid(shape)).toBe(true)
    expect(runtime.meshSolids.has(asPartName('b'))).toBe(true)
    expect(result.brepChain.solidCache.has(asPartName('b'))).toBe(false)

    // ② 体积：a³ − (1 − π/4)·r²·a（磨掉一条 10 长棱的直角坯料）
    const expected = 1000 - (1 - Math.PI / 4) * 1 * 10
    const vol = volumeOf(runtime, 'b')
    expect(vol).toBeGreaterThan(expected - 0.5)
    expect(vol).toBeLessThan(expected + 0.5)
    expect(vol).toBeLessThan(1000)

    // ③ 新零件带自己的近似拓扑（6+1 个面：6 个原面被圆角面切开，数量不减反增）
    const topo = result.topology?.get(asPartName('b'))
    expect(topo, 'filleted part carries approximate topology').toBeDefined()
    expect(topo!.source).toBe('mesh')
    const faces = topo!.data.faces as unknown as FaceRowLike[]
    expect(faces.length).toBeGreaterThan(6)
    for (const f of faces) expect(f.surfaceType).toBeTruthy()

    // ④ 槽位互斥：产物没有 BREP 句柄
    expect(getSlot(shape)?.solid).toBeUndefined()
  })

  it('网格实体路径如实不产出面演化 / roleTable（近似拓扑没有 hash 演化）', async () => {
    const probe = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const loaded = await probe.execute("let a = await cad.load({ file: 'cube10.stl' })")
    const ref = edgeRefLiteral(edgeRowsOf(loaded, 'a')[0]!)

    const runtime = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let b = await cad.fillet(a, { edges: [${ref}], radius: 1 })`,
    )
    expect(result.failedAt).toBeUndefined()
    const shape = result.outputs.get(asPartName('b')) as Shape
    // 不造恒等映射：面演化槽必须**缺席**（造了就是把"没有演化"说成"演化是恒等"）
    expect(getSlot(shape)?.faceEvolution).toBeUndefined()
  })

  it('圆柱 STL 的 96 条识别边逐条可倒角（同一输入零件，每次一条）', async () => {
    const probe = createEditorRuntime(portsFor({ 'cyl.stl': CYL_STL }), 'mesh')
    const loaded = await probe.execute("let a = await cad.load({ file: 'cyl.stl' })")
    expect(loaded.failedAt).toBeUndefined()
    const edges = edgeRowsOf(loaded, 'a')
    // 32 边形棱柱的解析边数：32 竖向棱 + 上下端盖各 32 条
    expect(edges.length).toBe(96)

    // 一次程序里 96 条语句，每条都从**同一个未变的** a 出发（op 不改写输入）。
    // 这也正是实测口径：逐条边倒圆角 96/96 成功，而 96 条**一次性**交给内核会被
    // 整体拒绝（共面边链自交）——所以验收按"逐条"来，不假装一次性可行。
    const lines = ["let a = await cad.load({ file: 'cyl.stl' })"]
    edges.forEach((e, i) => {
      lines.push(`let f${i} = await cad.fillet(a, { edges: [${edgeRefLiteral(e)}], radius: 1 })`)
    })
    const runtime = createEditorRuntime(portsFor({ 'cyl.stl': CYL_STL }), 'mesh')
    const result = await runtime.execute(lines.join('\n'))
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')

    // 全部 96 条都产出了合法的网格零件（逐条核身份，不只看最后一条）
    for (let i = 0; i < edges.length; i++) {
      const shape = result.outputs.get(asPartName(`f${i}`)) as Shape | undefined
      expect(shape, `f${i} produced`).toBeDefined()
      expect(hasMeshSolid(shape!), `f${i} is a mesh part`).toBe(true)
      expect(runtime.meshSolids.has(asPartName(`f${i}`))).toBe(true)
    }
    // 抽样核体积：任一单边倒圆角后体积必须**小于**原棱柱（真的磨掉了料）
    const prism = 0.5 * 32 * 100 * Math.sin((2 * Math.PI) / 32) * 30
    expect(volumeOf(runtime, 'f0')).toBeLessThan(prism)
    expect(volumeOf(runtime, 'f95')).toBeLessThan(prism)
  })

  it('网格实体与链外几何混进同一次布尔 → 静态报错 E_MESH_SOLID_MIXED', async () => {
    const runtime = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      'let b = cad.box(5, 5, 5)\n' +
      'let c = await cad.union(a, b)',
    )
    expect(result.failedAt, '混链必须静态失败').toBeDefined()
    expect(result.failedAt!.message).toContain('E_MESH_SOLID_MIXED')
  })

  it('两个网格实体的 union → 合法网格实体（brepkit 网格内核真在跑）', async () => {
    const runtime = createEditorRuntime(portsFor({ 'cube10.stl': BOX_STL }), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      "let b = await cad.load({ file: 'cube10.stl' })\n" +
      'let c = await cad.union(a, b)',
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    const shape = result.outputs.get(asPartName('c')) as Shape
    expect(hasMeshSolid(shape)).toBe(true)
    expect(runtime.meshSolids.has(asPartName('c'))).toBe(true)
    // 同一实体自并集：体积仍是立方体体积（不多不少）
    expect(volumeOf(runtime, 'c')).toBeCloseTo(1000, 3)
    // 产出自己的近似拓扑
    expect(result.topology?.get(asPartName('c'))?.source).toBe('mesh')
  })
})
