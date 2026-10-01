/**
 * mesh-solid-modeling — 方案 2026-10-01 §4 Phase 4 / B3 批：常规建模 op 的网格路径
 *
 * 覆盖三族：
 * - **transform 族**（translate / rotate_euler / scale / scale3d）：判定标准是
 *   "身份不丢"——产物必须仍是网格零件（`meshSolid` 槽 + 注册表句柄 + source='mesh'
 *   的近似拓扑），且几何确实动了（体积/包围盒是解析值，不是估算）。
 * - **shell**：以**序号**选出要开口的面（序号来自近似拓扑 `faces` 数组下标 + 1，
 *   正是宿主在 UI 上选中的那张面），产物是新的网格零件。
 * - **门禁**：网格链输入在**未声明**该网格后端的 op 上必须静态报错，不得静默降级。
 *
 * 数值全部有解析解（10³ 立方体）：体积 1000；绕原点转 45° 后包围盒 = 10√2；
 * 抽壳 1mm、顶面开口 → 1000 − 8×8×9 = 424。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../cad-runtime/ports'
import { createEditorRuntime } from '../test-support/editor-ops'
import type { CadRuntime } from '../cad-runtime/runtime'
import { asPartName } from '../identity'
import { __resetEngineRegistriesForTests, getMeshSolidBackend } from '../brep/engine/registry'
import { registerBrepkitMeshEngine } from '../brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../brepkit-kernel/brepkitKernel'
import { hasMeshFace, hasMeshSolid, solid } from '../shape'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { area, centerOfMass, volume } from './measurement'

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

const BOX_STL = binaryStl(boxTriangles(10, 10, 10))
const PORTS = () => portsFor({ 'cube10.stl': BOX_STL })

/** 网格实体句柄 → 体积（经网格后端的 L1 内核，测的是真几何不是估算）。 */
function volumeOf(runtime: CadRuntime, part: string): number {
  const backend = getMeshSolidBackend()
  expect(backend, 'mesh backend assembled').not.toBeNull()
  const handle = runtime.meshSolids.get(asPartName(part))
  expect(handle, `mesh solid handle for ${part}`).toBeDefined()
  return backend!.kernel.getVolume(handle as BrepHandle)
}

/** 网格实体句柄 → 包围盒（L1 getBoundingBox）。 */
function bboxOf(runtime: CadRuntime, part: string): { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number } {
  const backend = getMeshSolidBackend()!
  const handle = runtime.meshSolids.get(asPartName(part)) as BrepHandle
  return backend.kernel.getBoundingBox(handle)
}

/** 断言产物是**网格零件**（身份 + 注册表句柄 + 近似拓扑三处一致）。 */
function expectMeshPart(runtime: CadRuntime, result: Awaited<ReturnType<CadRuntime['execute']>>, part: string): Shape {
  const shape = result.outputs.get(asPartName(part)) as Shape
  expect(hasMeshSolid(shape), `${part} stays a mesh solid`).toBe(true)
  expect(hasMeshFace(shape), `${part} is not a mesh-chain face`).toBe(false)
  expect(runtime.meshSolids.has(asPartName(part)), `${part} has a registry handle`).toBe(true)
  expect(result.brepChain.solidCache.has(asPartName(part)), `${part} never enters the BREP cache`).toBe(false)
  expect(result.topology?.get(asPartName(part))?.source, `${part} approximate topology`).toBe('mesh')
  return shape
}

/** 从一次执行的近似拓扑里读面行（序号 = 下标 + 1，与宿主看到的一致）。 */
function faceRowsOf(result: Awaited<ReturnType<CadRuntime['execute']>>, part: string): FaceRowLike[] {
  const topo = result.topology?.get(asPartName(part))
  expect(topo, `topology for ${part}`).toBeDefined()
  return topo!.data.faces as unknown as FaceRowLike[]
}

const LOAD = "let a = await cad.load({ file: 'cube10.stl' })"

describe('网格零件上的常规建模（B3 批）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('translate：几何移动了，身份没丢（仍是网格零件 + 近似拓扑）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.translate(a, { offset: [5, 0, 0] })`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(1000, 3)
    const bb = bboxOf(runtime, 'b')
    expect(bb.xmin).toBeCloseTo(5, 3)
    expect(bb.xmax).toBeCloseTo(15, 3)
    // 拓扑仍在（面/边选择没有因变换而失去）
    expect(faceRowsOf(result, 'b').length).toBe(6)
  })

  it('rotate_euler：绕原点转 45° → 包围盒张开到 10√2（真转了，不是原地不动）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.rotate_euler(a, { angles: [0, 0, 45] })`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(1000, 3)
    const bb = bboxOf(runtime, 'b')
    expect(bb.xmax - bb.xmin).toBeCloseTo(10 * Math.SQRT2, 2)
    expect(bb.ymax - bb.ymin).toBeCloseTo(10 * Math.SQRT2, 2)
  })

  it('scale：×2 → 体积 ×8（2000 料变 8000），仍是网格零件', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.scale(a, 2)`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(8000, 2)
  })

  it('scale3d：非等比 [2,1,1] → 体积 2000（走 generalTransform，不是等比近似）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.scale3d(a, { factor: [2, 1, 1] })`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(2000, 2)
  })

  it('shell：按序号在识别出的顶面开口抽壳 1mm → 424 = 1000 − 8×8×9', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const loaded = await probe.execute(LOAD)
    expect(loaded.failedAt?.message ?? 'no failure').toBe('no failure')
    // 序号从近似拓扑读数里来：宿主选中的就是这一张（法向 +Z 的面）
    const rows = faceRowsOf(loaded, 'a')
    const topIndex = rows.findIndex((f) => (f.normal?.[2] ?? 0) > 0.9)
    expect(topIndex, '立方体有一个 +Z 面').toBeGreaterThanOrEqual(0)
    expect(rows[topIndex]!.surfaceType).toBe('plane')
    expect(rows[topIndex]!.area).toBeCloseTo(100, 3)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD}\nlet b = cad.shell(a, { openFaces: [${topIndex + 1}], thickness: 1 })`,
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    // 壁厚 1 向内：内腔 = (10−2)×(10−2)×(10−1)
    expect(volumeOf(runtime, 'b')).toBeCloseTo(1000 - 8 * 8 * 9, 1)
  })

  it('shell：openFaces 空数组 → 全封闭薄壁 488 = 1000 − 8³', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.shell(a, { openFaces: [], thickness: 1 })`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(1000 - 512, 1)
  })

  it('面序号越界 → 如实报错，不静默取一张别的面', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.shell(a, { openFaces: [99], thickness: 1 })`)
    expect(result.failedAt, '越界序号必须失败').toBeDefined()
    expect(result.failedAt!.code).toBe('E_TOPO_NOT_FOUND')
    expect(result.failedAt!.message).toContain('out of range')
  })

  it('变换不吞掉子序列：变换后的零件仍能继续被网格 op 处理（倒圆角）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD}\n` +
      'let m = cad.translate(a, { offset: [0, 0, 5] })\n' +
      'let f = cad.fillet(m, { edges: [1], radius: 1 })',
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'f')
    // 圆角磨掉的是真实的料：棱长 10 的单条棱倒 r=1 的圆角 → 1000 − (1 − π/4)·1²·10
    expect(volumeOf(runtime, 'f')).toBeCloseTo(1000 - (1 - Math.PI / 4) * 10, 1)
  })
})

describe('网格零件上的阵列与镜像（B3 批）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('linearPattern：3 份 × 间距 20（互不相邻）→ 体积 3000，仍是网格零件', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.linearPattern(a, [1, 0, 0], 3, 20)`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(3000, 1)
  })

  it('circularPattern：绕 Z 轴 4 份（仅棱相触）→ 体积 4000', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.circularPattern(a, [0, 0, 1], 4)`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(4000, 1)
  })

  it('gridPattern：2×2（间距 20）→ 体积 4000', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD}\nlet b = cad.gridPattern(a, [1, 0, 0], [0, 1, 0], 2, 2, 20, 20)`,
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(4000, 1)
  })

  it('rectangularPattern：2×2 → 体积 4000', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD}\nlet b = cad.rectangularPattern(a, { xDir: [1,0,0], xCount: 2, xSpacing: 20, yDir: [0,1,0], yCount: 2, ySpacing: 20 })`,
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(4000, 1)
  })

  it('mirrorJoin：以 x=0 为镜面 → 原物 + 镜像融合 = 2000（贴面处真的接上了）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.mirrorJoin(a, { normal: [1, 0, 0] })`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(2000, 1)
    const bb = bboxOf(runtime, 'b')
    expect(bb.xmin).toBeCloseTo(-10, 2)
    expect(bb.xmax).toBeCloseTo(10, 2)
  })

  it('mirror：只产出镜像件（体积 1000，落在 x<0），源零件保留', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.mirror(a, { normal: [1, 0, 0] })`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(1000, 2)
    const bb = bboxOf(runtime, 'b')
    expect(bb.xmin).toBeCloseTo(-10, 2)
    expect(bb.xmax).toBeCloseTo(0, 2)
    // keep 语义：源零件仍是活的网格零件
    expectMeshPart(runtime, result, 'a')
    expect(volumeOf(runtime, 'a')).toBeCloseTo(1000, 2)
  })

  it('clone：独立副本（体积相同、句柄分离），源零件保留', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(`${LOAD}\nlet b = cad.clone(a)`)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    expect(volumeOf(runtime, 'b')).toBeCloseTo(1000, 3)
    expect(runtime.meshSolids.get(asPartName('b'))).not.toBe(runtime.meshSolids.get(asPartName('a')))
  })

  it('阵列后的零件仍能继续建模（在阵列件上倒圆角）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD}\n` +
      'let p = cad.linearPattern(a, [1, 0, 0], 2, 20)\n' +
      'let f = cad.fillet(p, { edges: [1], radius: 1 })',
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'f')
    expect(volumeOf(runtime, 'f')).toBeLessThan(2000)
  })
})

describe('网格零件的只读量测（B4 批）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('volume / area / centerOfMass 读网格零件自己的句柄（10³ 立方体：1000 / 600 / 质心 (5,5,5)）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(LOAD)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    const shape = result.outputs.get(asPartName('a')) as Shape

    expect(await volume(shape)).toBeCloseTo(1000, 3)
    expect(await area(shape)).toBeCloseTo(600, 3)
    const c = await centerOfMass(shape)
    expect(c.x).toBeCloseTo(5, 3)
    expect(c.y).toBeCloseTo(5, 3)
    expect(c.z).toBeCloseTo(5, 3)
  })

  it('量测值是脚本里可消费的数字（用测得的体积当缩放系数）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      `${LOAD}\n` +
      'let v = await cad.volume(a)\n' +
      'let b = cad.scale(a, v / 500)',
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'b')
    // v = 1000 → 系数 2 → 体积 ×8
    expect(volumeOf(runtime, 'b')).toBeCloseTo(8000, 2)
  })

  it('裸网格（加载时没有网格后端）→ 如实报 E_MEASUREMENT_NO_HANDLE，不返回 0', async () => {
    const bare = solid({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) })
    await expect(volume(bare)).rejects.toThrow(/E_MEASUREMENT_NO_HANDLE/)
  })
})
