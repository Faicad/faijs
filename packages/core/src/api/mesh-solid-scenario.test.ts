/**
 * mesh-solid-scenario — 端到端场景验收（方案 2026-10-01 的目标场景）
 *
 * 场景（用户原话）：
 *
 * > 用户上传一个 STL 文件以后，我可以对识别出来的边加圆角，可以在识别出来的平面上
 * > 画草图拉伸出新的实体。
 *
 * 本文件把这句场景走成一条**真实链路**，每一步都经公开 API（`cad.load` 走宿主资产
 * 通道、`cad.fillet` / `cad.sketchOnFace` / `cad.extrude` / `cad.union` / `cad.cut`
 * 走 op 分派），并且**选择器来自当前拓扑本身**——这正是宿主 UI 的行为：先在
 * 近似拓扑里读出可选的边/面并展示，用户点选后把该条目的序号写进脚本。
 *
 * 三条断言各自钉住的东西：
 * 1. **识别**：STL 零件的面/边可被枚举且带正确几何（10³ 立方体：6 个 100 的平面、
 *    12 条长 10 的边；32 边形棱柱：34 面 / 96 边）——这是"能选中"的前提。
 * 2. **改型**：倒圆角 → 面上草图 → 拉伸 → 布尔，全部产物仍是**网格零件**（无 BREP
 *    句柄、不进 solidCache），体积落在解析预期上（不是"跑通了就行"）。
 * 3. **导出**：同一条链的产物导 STL 正常，导 STEP 明确报错并指出 part 名
 *    （`E_STEP_MESH_PART`）——网格零件按定义不可导 STEP，不做 facet 重建。
 *
 * 体积解析值（10³ 立方体）：
 * - 单条棱倒 r=1 圆角磨掉 (1 − π/4)·r²·L = 0.2146×10 → 997.854
 * - 顶面 4×6 草图拉 5 = 120；前向融合 → 1117.854，背向切除 → 877.854
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../cad-runtime/ports'
import { createEditorRuntime } from '../test-support/editor-ops'
import type { CadRuntime } from '../cad-runtime/runtime'
import { asPartName } from '../identity'
import { __resetEngineRegistriesForTests, getMeshSolidBackend } from '../brep/engine/registry'
import { registerBrepkitMeshEngine } from '../brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../brepkit-kernel/brepkitKernel'
import { hasMeshSolid } from '../shape'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { exportModelSync, type ExportEntry } from '../brep/export/export-model'

// ── 二进制 STL 生成（与 mesh-solid-ops.test.ts 同口径：不引 fixture） ──

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
 * 32 边形棱柱（"上传的圆柱 STL"）：128 三角形（每扇区 2 侧面 + 2 端盖）。
 * 端盖共面三角形焊接后被 `unifyFaces` 合成**一张**端盖面 —— 曲面不还原，如实呈现。
 */
function prismTriangles(r: number, h: number, segments = 32): number[][] {
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
    tris.push([...bi, ...bj, ...tj])   // 侧面（外向）
    tris.push([...bi, ...tj, ...ti])
    tris.push([...cb, ...bj, ...bi])   // 下端盖（-Z）
    tris.push([...ct, ...ti, ...tj])   // 上端盖（+Z）
  }
  return tris
}

/** assets 按文件名寻址（与 mesh-solid-ops.test.ts 同口径）。 */
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

interface FaceRowLike {
  surfaceType?: string
  normal?: number[]
  center?: number[]
  area?: number
}
interface EdgeRowLike {
  curveType?: string
  length?: number
  center?: number[]
  faceCount?: number
}

const CUBE_STL = binaryStl(boxTriangles(10, 10, 10))
const PRISM_STL = binaryStl(prismTriangles(5, 10, 32))
const PORTS = () => portsFor({ 'cube.stl': CUBE_STL, 'prism.stl': PRISM_STL })

const LOAD_CUBE = "let a = await cad.load({ file: 'cube.stl' })"
const LOAD_PRISM = "let a = await cad.load({ file: 'prism.stl' })"

type Exec = Awaited<ReturnType<CadRuntime['execute']>>

/** 读某 part 的近似拓扑（宿主展示给用户的那份数据）。 */
function topologyOf(result: Exec, part: string): { faces: FaceRowLike[]; edges: EdgeRowLike[] } {
  const topo = result.topology?.get(asPartName(part))
  expect(topo, `topology for ${part}`).toBeDefined()
  return {
    faces: topo!.data.faces as unknown as FaceRowLike[],
    edges: topo!.data.edges as unknown as EdgeRowLike[],
  }
}

/** 网格零件句柄 → 体积（经网格后端的 L1 内核）。 */
function volumeOf(runtime: CadRuntime, part: string): number {
  const backend = getMeshSolidBackend()
  expect(backend, 'mesh backend assembled').not.toBeNull()
  const handle = runtime.meshSolids.get(asPartName(part))
  expect(handle, `mesh solid handle for ${part}`).toBeDefined()
  return backend!.kernel.getVolume(handle as BrepHandle)
}

/** 断言产物是网格零件（有 meshSolid 身份、无 BREP 句柄、不进 solidCache、拓扑 source='mesh'）。 */
function expectMeshPart(runtime: CadRuntime, result: Exec, part: string): void {
  const shape = result.outputs.get(asPartName(part)) as Shape
  expect(hasMeshSolid(shape), `${part} is a mesh part`).toBe(true)
  expect(runtime.meshSolids.has(asPartName(part)), `${part} has a mesh registry handle`).toBe(true)
  expect(result.brepChain.solidCache.has(asPartName(part)), `${part} is not in the BREP cache`).toBe(false)
  expect(result.topology?.get(asPartName(part))?.source, `${part} topology source`).toBe('mesh')
}

/** 2D 矩形环（绝对坐标、首尾相接），x∈[-2,2]、y∈[-3,3] → 4×6 = 24。 */
const RECT: unknown[] = [
  { kind: 'line', x1: -2, y1: -3, x2: 2, y2: -3 },
  { kind: 'line', x1: 2, y1: -3, x2: 2, y2: 3 },
  { kind: 'line', x1: 2, y1: 3, x2: -2, y2: 3 },
  { kind: 'line', x1: -2, y1: 3, x2: -2, y2: -3 },
]

const NO_FAIL = (r: Exec): string => r.failedAt?.message ?? 'no failure'

describe('场景：上传 STL → 识别边倒圆角 → 识别面草图 → 拉伸（端到端）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('第 1 步「上传」：立方体 STL 得到 6 个平面（area=100）+ 12 条边（length=10），可被选中', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const loaded = await runtime.execute(LOAD_CUBE)
    expect(NO_FAIL(loaded)).toBe('no failure')

    const { faces, edges } = topologyOf(loaded, 'a')
    expect(faces.length).toBe(6)
    expect(edges.length).toBe(12)
    for (const f of faces) {
      expect(f.surfaceType).toBe('plane')
      expect(f.area).toBeCloseTo(100, 3)
    }
    for (const e of edges) {
      expect(e.curveType).toBe('LINE')
      expect(e.length).toBeCloseTo(10, 3)
      expect(e.faceCount, '每条识别边邻接两面').toBe(2)
    }
    // 立方体上还有非盒体几何走同一条链：32 边形棱柱 34 面 / 96 边
    const prismRuntime = createEditorRuntime(PORTS(), 'mesh')
    const prism = await prismRuntime.execute(LOAD_PRISM)
    expect(NO_FAIL(prism)).toBe('no failure')
    const pt = topologyOf(prism, 'a')
    expect(pt.faces.length, '32 侧面 + 上下端盖各合成 1 张').toBe(34)
    expect(pt.edges.length).toBe(96)
    expect(prism.outputs.get(asPartName('a')) && hasMeshSolid(prism.outputs.get(asPartName('a')) as Shape)).toBe(true)
  })

  it('第 2 步「识别边倒圆角」+ 第 3 步「识别面上草图」+ 第 4 步「拉伸/融合」：体积 = 997.854 + 120', async () => {
    // ── 选择器来自当前拓扑（宿主 UI 的读数 → 用户点选 → 写进脚本）──
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const loaded = await probe.execute(LOAD_CUBE)
    const { edges } = topologyOf(loaded, 'a')
    // 底面的一条边（中点 z=0）：倒圆角不动顶面，便于下一步在同一张顶面上画草图
    const bottomEdge = edges.findIndex((e) => Math.abs((e.center?.[2] ?? -1) - 0) < 1e-6)
    expect(bottomEdge, '存在一条 z=0 的底边').toBeGreaterThanOrEqual(0)

    const filleted = await probe.execute(`${LOAD_CUBE}\nlet b = cad.fillet(a, { edges: [${bottomEdge + 1}], radius: 1 })`)
    expect(NO_FAIL(filleted)).toBe('no failure')
    expectMeshPart(probe, filleted, 'b')
    // 倒圆角磨掉的是真实的料
    expect(volumeOf(probe, 'b')).toBeCloseTo(1000 - (1 - Math.PI / 4) * 10, 0)

    // 圆角后**重新读拓扑**：这一步证明"改型产物仍带可选的近似拓扑"，面序号从这里来
    const afterFillet = topologyOf(filleted, 'b')
    const topIndex = afterFillet.faces.findIndex((f) => (f.normal?.[2] ?? 0) > 0.9)
    expect(topIndex, '圆角后仍能识别出 +Z 顶面').toBeGreaterThanOrEqual(0)
    expect(afterFillet.faces[topIndex]!.area).toBeCloseTo(100, 1)
    expect(afterFillet.edges.length, '圆角后边数变多（磨出了新棱）').toBeGreaterThan(12)

    // ── 完整脚本（选择器 = 上面读到的序号）──
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD_CUBE}\n` +
      `let b = cad.fillet(a, { edges: [${bottomEdge + 1}], radius: 1 })\n` +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: b, face: ${topIndex + 1} })\n` +
      'let p = await cad.extrude(s, 5)\n' +
      'let u = await cad.union(b, p)',
    )
    expect(NO_FAIL(result)).toBe('no failure')

    // 草图 / 拉伸件 / 融合件：全部是近似链上的产物，没有一处滑进 BREP
    const sketch = result.outputs.get(asPartName('s')) as Shape
    expect(hasMeshSolid(sketch), '草图是网格链面而不是网格零件').toBe(false)
    expectMeshPart(runtime, result, 'p')
    expectMeshPart(runtime, result, 'u')

    // 体积：圆角后的盒体 + 顶面 4×6 拉 5 的棱柱
    const expected = 1000 - (1 - Math.PI / 4) * 10 + 120
    expect(volumeOf(runtime, 'u')).toBeCloseTo(expected, 0)
    // 融合件上仍能继续识别、继续量测
    expect(topologyOf(result, 'u').faces.length).toBeGreaterThan(6)
  })

  it('第 4 步（切除分支）：背向拉伸钻入盒体 → 差集 = 997.854 − 120', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const loaded = await probe.execute(LOAD_CUBE)
    const { edges } = topologyOf(loaded, 'a')
    const bottomEdge = edges.findIndex((e) => Math.abs((e.center?.[2] ?? -1) - 0) < 1e-6)
    const filleted = await probe.execute(`${LOAD_CUBE}\nlet b = cad.fillet(a, { edges: [${bottomEdge + 1}], radius: 1 })`)
    const topIndex = topologyOf(filleted, 'b').faces.findIndex((f) => (f.normal?.[2] ?? 0) > 0.9)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD_CUBE}\n` +
      `let b = cad.fillet(a, { edges: [${bottomEdge + 1}], radius: 1 })\n` +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: b, face: ${topIndex + 1} })\n` +
      "let p = await cad.extrude(s, { length: 5, mode: 'backward' })\n" +
      'let c = await cad.cut(b, p)',
    )
    expect(NO_FAIL(result)).toBe('no failure')
    expectMeshPart(runtime, result, 'c')
    expect(volumeOf(runtime, 'c')).toBeCloseTo(1000 - (1 - Math.PI / 4) * 10 - 120, 0)
  })

  it('第 5 步「导出」：同一条链的产物导 STL 正常，导 STEP 明确拒绝并指出 part 名', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD_CUBE}\nlet b = cad.fillet(a, { edges: [1], radius: 1 })`)
    expect(NO_FAIL(result)).toBe('no failure')
    const shape = result.outputs.get(asPartName('b')) as Shape
    const entry: ExportEntry = {
      mesh: { positions: shape.positions, indices: shape.indices },
      name: 'b',
    }

    // STL：网格载荷直接写出，不做任何重建
    const stl = exportModelSync([entry], 'stl')
    expect(stl.byteLength).toBeGreaterThan(84)
    // 三角形数写回读：与网格载荷一致（不是空的、也不是重建出来的另一份）
    expect(new DataView(stl).getUint32(80, true)).toBe(shape.indices.length / 3)

    // STEP：明确拒绝，并指出是哪个 part
    expect(() => exportModelSync([entry], 'step')).toThrow(/E_STEP_MESH_PART/)
    expect(() => exportModelSync([entry], 'step')).toThrow(/"b"/)
    // 拒绝理由与 BREP 引擎是否装配无关（本运行时装的是网格后端，没有 OCCT）
    expect(() => exportModelSync([entry], 'step')).toThrow(/mesh part cannot be exported to STEP/)
  })

  it('非盒体（32 边形棱柱）也走同一条链：按序号对识别边倒圆角 → 仍是网格零件', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const loaded = await probe.execute(LOAD_PRISM)
    const { edges } = topologyOf(loaded, 'a')
    // 竖向棱：中点 z = 5（上下端盖的边中点分别在 z=0 / z=10）
    const vertical = edges.findIndex((e) => Math.abs((e.center?.[2] ?? -1) - 5) < 1e-6)
    expect(vertical, '32 边形棱柱有竖向棱').toBeGreaterThanOrEqual(0)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD_PRISM}\nlet b = cad.fillet(a, { edges: [${vertical + 1}], radius: 0.5 })`,
    )
    expect(NO_FAIL(result)).toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    // 倒圆角只可能磨掉料：体积严格小于棱柱解析体积 10·(n/2)·r²·sin(2π/n)
    const analytic = 10 * (32 / 2) * 25 * Math.sin((2 * Math.PI) / 32)
    const v = volumeOf(runtime, 'b')
    expect(v).toBeLessThan(analytic)
    expect(v).toBeGreaterThan(analytic - (1 - Math.PI / 4) * 0.25 * 10 - 0.5)
  })
})
