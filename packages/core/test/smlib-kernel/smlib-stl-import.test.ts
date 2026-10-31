/**
 * @vitest-environment node
 *
 * smlib-kernel/smlib-stl-import — STL 导入「真 B-rep」路径端到端验证
 *
 * 验证的是方案 §4.2 的实现：把 brepkit `crates/io/src/stl/import.rs`
 * 的算法搬到 smlib 上——顶点焊接 → 逐三角建平面面 → 缝合 → heal，
 * 产出**带面-边邻接的流形实体**，而不是 mesh 路径的产物。
 *
 * 判据不是「调用没抛错」，而是几何等价：
 *   box(10,20,30) → exportStl → binary STL → importStl → getVolume ≈ 6000
 * 若 importStl 走的是 mesh 路径（或产出了空壳），体积会对不上或为 0。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-stl-import.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID } from '../../src/brep/engine/adapters/smlib'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { exportStl } from '../../src/api/export-stl'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

/** 10×20×30 box，原点在 (0,0,0)；12 个三角，8 个唯一顶点。 */
const CUBE_POS: number[] = [
  0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0,
  0, 0, 30, 10, 0, 30, 10, 20, 30, 0, 20, 30,
]
const CUBE_IDX: number[] = [
  0, 2, 1, 0, 3, 2,
  4, 5, 6, 4, 6, 7,
  0, 1, 5, 0, 5, 4,
  1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6,
  3, 0, 4, 3, 4, 7,
]

const DX = 10
const DY = 20
const DZ = 30
const EXPECTED_VOLUME = DX * DY * DZ // 6000

function hostPorts(): HostPorts {
  return { events: { emit: () => undefined }, hostEnv: 'node' } as HostPorts
}

/** 挂 smlib 引擎，执行脚本，返回 result。 */
async function exec(code: string): Promise<ExecutionResult> {
  __resetEngineRegistriesForTests()
  await registerSmlibBrepEngine()
  expect(getActiveBrepEngineId()).toBe(SMLIB_BREP_ENGINE_ID)
  const runtime = new CadRuntime(hostPorts(), 'brep', {
    cad: createApiNamespaceWithEditorOps(),
  })
  return runtime.execute(code)
}

async function shapeOf(code: string, part: string): Promise<Shape> {
  const result = await exec(code)
  if (result.failedAt) {
    throw new Error(
      `execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`,
    )
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

let kernel!: SmlibPrimitives

beforeAll(async () => {
  await exec('let part0 = cad.box(10, 20, 30)\n')
  kernel = await createSmlibPrimitives()
}, 120000)

afterAll(() => {
  disposeSmlib()
  __resetEngineRegistriesForTests()
})

describe('smlib importStl — 真 B-rep 路径', () => {
  it('往返：box(10,20,30) → exportStl → importStl → 体积 ≈ 6000', async () => {
    const box = await shapeOf('let part0 = cad.box(10, 20, 30)\n', 'part0')

    // 导出：引擎中立的纯数据序列化（只读 Shape 三角载荷）
    const bytes = exportStl(box) as Uint8Array
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.byteLength).toBe(84 + (box.indices.length / 3) * 50)

    // 导入：新内核桥 —— 输出是**真 B-rep 实体**（有面-边邻接、可布尔/圆角）
    const solid = kernel.importStl(bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer) as BrepHandle
    expect(solid).toBeTruthy()

    const vol = kernel.getVolume(solid)
    expect(vol).toBeGreaterThan(0)
    expect(vol).toBeCloseTo(EXPECTED_VOLUME, 1)
  })

  it('往返：是真 B-rep（面数 ≥ 6 且体积守恒）', async () => {
    const box = await shapeOf('let part0 = cad.box(10, 20, 30)\n', 'part0')
    const bytes = exportStl(box) as Uint8Array
    const solid = kernel.importStl(bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer) as BrepHandle

    const faces = kernel.getSubShapes(solid, 'face')
    // 立方体至少 6 个面；逐三角建面 + stitch 后可能保留 12 个三角面，
    // 也可能把共面相邻三角归并成 6 个四边形面——两种都算真 B-rep（有面-边邻接）
    expect(faces.length).toBeGreaterThanOrEqual(6)
    // 体积守恒是水密实体最硬的证据：导入体体积 ≈ 原始 box 体积
    expect(kernel.getVolume(solid)).toBeCloseTo(EXPECTED_VOLUME, 1)
  })

  it('载荷校验：过短载荷（<84 字节）显式报错，不返回空壳', () => {
    const short = new Uint8Array(40)
    expect(() => kernel.importStl(short.buffer as ArrayBuffer)).toThrow(
      /shorter than an 84-byte binary STL header/,
    )
  })
})
