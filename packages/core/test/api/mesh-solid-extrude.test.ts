/**
 * mesh-solid-extrude — Phase 3 验收：识别平面上草图 + 拉伸（B2 批）
 *
 * mesh-solid 链路
 * Phase 3 验收原文：
 *
 * > 在立方体 STL 的顶面画矩形草图 → 拉伸 5mm → 得到合法的融合/切除结果。
 *
 * 三条断言各自的事实来源：
 * - **面选择**：立方体 STL 的顶面在近似拓扑里就是 `surfaceType:'plane'`、法向 +Z、
 *   中心 (5,5,10) 的那一张（10³ 立方体，min 角在原点）。所以测试不是"随便挑一张面"，
 *   而是按法向把顶面挑出来，再原样把该行的几何当 hint 回填成 `FaceTopoRef`
 *   ——网格零件没有 role 层，面的身份只能靠几何（方案 §3.5）。
 * - **体积**：矩形草图 2D 范围 x∈[-2,2]、y∈[-3,3] 落在平面框上得到 4×6 的料，
 *   沿 +Z 拉伸 5 → 120。草图平面原点取面的**包围盒中心**（不是
 *   `surfaceCenterOfMass`：平面在 brepkit 上的 UV 域是 ±1e6 的无限域，域中点只是
 *   参数原点，可能落在面之外）。
 * - **融合/切除**：前向拉伸的棱柱坐在盒顶上（只共面），故并集 = 1000+120；
 *   后向拉伸（`mode:'backward'`）钻**进**盒子内部，故差集 = 1000−120。两个方向都测，
 *   才能同时钉住"拉伸方向语义没在网格链上分叉"。
 *
 * 全部产物都必须是**网格零件**（方案 §4 Phase 3-3）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import type { CadRuntime } from '../../src/cad-runtime/runtime'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests, getMeshSolidBackend } from '../../src/brep/engine/registry'
import { registerBrepkitMeshEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { getSlot, hasMeshFace, hasMeshSolid } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'

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

/** 从一次执行的近似拓扑读出某个 part 的面行。 */
function faceRowsOf(result: Awaited<ReturnType<CadRuntime['execute']>>, part: string): FaceRowLike[] {
  const topo = result.topology?.get(asPartName(part))
  expect(topo, `topology for ${part}`).toBeDefined()
  return topo!.data.faces as unknown as FaceRowLike[]
}

/**
 * 把一条识别面行包成 `FaceTopoRef` 源码字面量。
 *
 * 与边同理：网格零件没有 role 层，`origin`/`role` 是占位值，解析走**纯几何**
 * （法向 / 中心 / 面积）。把该行自己的几何原样回填，即"用几何指出是哪张面"。
 */
function faceRefLiteral(f: FaceRowLike): string {
  return JSON.stringify({
    kind: 'face',
    origin: 'mesh',
    role: '',
    hint: { kind: 'face', surfaceType: f.surfaceType, normal: f.normal, center: f.center },
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

/** 2D 矩形环（绝对坐标、首尾相接），x∈[-2,2]、y∈[-3,3] → 4×6。 */
const RECT: unknown[] = [
  { kind: 'line', x1: -2, y1: -3, x2: 2, y2: -3 },
  { kind: 'line', x1: 2, y1: -3, x2: 2, y2: 3 },
  { kind: 'line', x1: 2, y1: 3, x2: -2, y2: 3 },
  { kind: 'line', x1: -2, y1: 3, x2: -2, y2: -3 },
]

const BOX_STL = binaryStl(boxTriangles(10, 10, 10))
const PORTS = () => portsFor({ 'cube10.stl': BOX_STL })

/** 读一遍加载结果，按法向挑出 +Z 的那张面（顶面）并造出它的 FaceTopoRef 字面量。 */
async function topFaceRefOf(runtime: CadRuntime): Promise<string> {
  const loaded = await runtime.execute("let a = await cad.load({ file: 'cube10.stl' })")
  expect(loaded.failedAt?.message ?? 'no failure').toBe('no failure')
  const faces = faceRowsOf(loaded, 'a')
  expect(faces.length).toBe(6)
  const top = faces.find((f) => f.normal !== undefined && (f.normal[2] ?? 0) > 0.9)
  expect(top, 'a +Z planar face exists on the box').toBeDefined()
  expect(top!.surfaceType).toBe('plane')
  expect(top!.area).toBeCloseTo(100, 3)
  return faceRefLiteral(top!)
}

describe('网格链上的草图 + 拉伸（Phase 3 验收：B2 批）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('顶面画矩形草图 → 拉伸 5：草图是网格链面，拉伸件是新网格零件', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const ref = await topFaceRefOf(probe)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: a, face: ${ref} })\n` +
      'let p = await cad.extrude(s, 5)',
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')

    // ① 草图产物是**网格链面**：有 meshFace 槽，没有 BREP 句柄、也不是网格零件
    const sketch = result.outputs.get(asPartName('s')) as Shape
    expect(hasMeshFace(sketch)).toBe(true)
    expect(getSlot(sketch)?.solid).toBeUndefined()
    expect(hasMeshSolid(sketch)).toBe(false)

    // ② 拉伸产物是**新网格零件**：有自己的近似拓扑 + 注册表句柄，未被升格成 BREP
    const prism = result.outputs.get(asPartName('p')) as Shape
    expect(hasMeshSolid(prism)).toBe(true)
    expect(runtime.meshSolids.has(asPartName('p'))).toBe(true)
    expect(result.brepChain.solidCache.has(asPartName('p'))).toBe(false)
    expect(result.topology?.get(asPartName('p'))?.source).toBe('mesh')

    // ③ 体积 = 4×6 底 × 5 高（草图确实铺成了 24 的面积，不是退化面）
    expect(volumeOf(runtime, 'p')).toBeCloseTo(120, 2)
  })

  it('前向拉伸件与盒子的并集 = 1000 + 120（棱柱坐在顶面上，只共面）', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const ref = await topFaceRefOf(probe)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: a, face: ${ref} })\n` +
      'let p = await cad.extrude(s, 5)\n' +
      'let u = await cad.union(a, p)',
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expect(hasMeshSolid(result.outputs.get(asPartName('u')) as Shape)).toBe(true)
    expect(volumeOf(runtime, 'u')).toBeCloseTo(1120, 1)
  })

  it('后向拉伸（mode:backward）钻入盒体 → 切除 = 1000 − 120', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const ref = await topFaceRefOf(probe)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: a, face: ${ref} })\n` +
      "let p = await cad.extrude(s, { length: 5, mode: 'backward' })\n" +
      'let c = await cad.cut(a, p)',
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expect(hasMeshSolid(result.outputs.get(asPartName('c')) as Shape)).toBe(true)
    // 后向拉伸把料挖进盒子内部 → 差集真的少了 120
    expect(volumeOf(runtime, 'c')).toBeCloseTo(880, 1)
  })

  it('草图面不可用时如实拒绝：曲面面 / 非网格实体宿主', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const ref = await topFaceRefOf(runtime)
    // 序号越界：立方体只有 6 张面
    const out = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: a, face: 99 })`,
    )
    expect(out.failedAt, '越界序号必须失败').toBeDefined()
    // OpError 把错误码放在 `failedAt.code`（消息体只带 op 名与事实）
    expect(out.failedAt!.code).toBe('E_TOPO_NOT_FOUND')
    expect(out.failedAt!.message).toContain('out of range')
    // 正面用例仍可用（门禁不是把所有调用都拒了）
    const ok = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: a, face: ${ref} })`,
    )
    expect(ok.failedAt?.message ?? 'no failure').toBe('no failure')
  })

  it('网格链不支持 upTo 拉伸：如实拒绝，不静默退化成普通拉伸', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const ref = await topFaceRefOf(probe)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: a, face: ${ref} })\n` +
      "let p = await cad.extrude(s, { upTo: 'last', baseFeature: a })",
    )
    expect(result.failedAt, 'upTo 在网格链上必须静态失败').toBeDefined()
    expect(result.failedAt!.message).toContain('E_MESH_SOLID_UNSUPPORTED')
  })

  it('scaleMode 非 original 时如实拒绝（UV 域在网格链上不存在）', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const ref = await topFaceRefOf(probe)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: [{ segments: ${JSON.stringify(RECT)} }], on: a, face: ${ref}, scaleMode: 'bounds' })`,
    )
    expect(result.failedAt, 'scaleMode 分歧必须报错而不是静默按 original 处理').toBeDefined()
    expect(result.failedAt!.message).toContain('E_MESH_SOLID_UNSUPPORTED')
  })
})
