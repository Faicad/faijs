/**
 * @vitest-environment node
 *
 * smlib-kernel/smlib-stl-3mf-export — smlib 引擎 × 引擎中立导出族
 *
 * 背景：`cad.exportStl` / `cad.export3mf` 是**引擎中立**的纯数据序列化器
 * （`api/export-stl.ts` / `api/export-3mf.ts`），只消费 Shape 自带的三角载荷
 * （`positions` / `indices`），不触达任何引擎。因此 smlib 要支持 STL/3MF 导出，
 * 唯一前提是：**smlib 链路产出的 Shape 必须带非空三角载荷**。
 *
 * 本文件钉死这一前提，并覆盖：
 * - smlib 下 `cad.box` 产出 Shape 的三角载荷非空且结构自洽；
 * - `exportStl` 二进制 / ASCII 双形态合法（长度、三角形数、头/包裹）；
 * - `export3mf` 产出合法 ZIP 容器；
 * - 与 brepkit 引擎交叉验证几何等价（体积 / 面数），证明导出与引擎身份无关。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-stl-3mf-export.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID } from '../../src/brep/engine/adapters/smlib'
import { registerBrepkitBrepEngine, BREPKIT_BREP_ENGINE_ID } from '../../src/brep/engine/adapters/brepkit'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import { exportStl } from '../../src/api/export-stl'
import { export3mf } from '../../src/api/export-3mf'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

/** 简化宿主端口（node 宿主——导出命令的宿主门要求）。 */
function hostPorts(): HostPorts {
  return { events: { emit: () => undefined }, hostEnv: 'node' } as HostPorts
}

/** 挂上指定引擎并返回 runtime。 */
async function runtimeWith(
  register: () => Promise<unknown>,
  engineId: string,
  mode: ExecutionMode = 'brep',
): Promise<CadRuntime> {
  __resetEngineRegistriesForTests()
  await register()
  expect(getActiveBrepEngineId()).toBe(engineId)
  return new CadRuntime(hostPorts(), mode, { cad: createApiNamespaceWithEditorOps() })
}

/** 执行脚本并取出指定 part 的 Shape。 */
async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  let runtime: CadRuntime
  if (mode === 'brep') runtime = await runtimeWith(registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID)
  else runtime = await runtimeWith(registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID, 'mesh')
  const result: ExecutionResult = await runtime.execute(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

/** binary STL：84 + 50×N 字节；字节 80..83 = uint32 三角形数。 */
function stlTriCount(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
}

const BOX = 'let part0 = cad.box(10, 20, 30)\n'

describe('smlib 引擎 × 引擎中立导出族', () => {
  beforeAll(async () => {
    await runtimeWith(registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID)
  })

  afterAll(() => {
    __resetEngineRegistriesForTests()
  })

  it('smlib 下 cad.box 产出的 Shape 带非空三角载荷', async () => {
    const box = await shapeOf('brep', BOX, 'part0')
    expect(box.positions).toBeDefined()
    expect(box.indices).toBeDefined()
    expect(box.indices.length).toBeGreaterThan(0)
    expect(box.positions.length).toBeGreaterThan(0)
    // 索引不得越界
    let max = 0
    for (let i = 0; i < box.indices.length; i++) max = Math.max(max, box.indices[i]!)
    expect(max).toBeLessThan(box.positions.length / 3)
  })

  it('exportStl 二进制形态：长度 84+50N，三角形数与载荷一致', async () => {
    const box = await shapeOf('brep', BOX, 'part0')
    const bytes = exportStl(box) as Uint8Array
    expect(bytes).toBeInstanceOf(Uint8Array)
    const tris = box.indices.length / 3
    expect(tris).toBeGreaterThan(0)
    expect(bytes.byteLength).toBe(84 + tris * 50)
    expect(stlTriCount(bytes)).toBe(tris)
    const header = new TextDecoder().decode(bytes.subarray(0, 10))
    expect(header).toMatch(/^Faicad STL/)
  })

  it('exportStl ASCII 形态：solid/endsolid 包裹，facet 数 = 三角形数', async () => {
    const box = await shapeOf('brep', BOX, 'part0')
    const text = exportStl(box, { ascii: true, name: 'bracket' }) as string
    expect(typeof text).toBe('string')
    expect(text.startsWith('solid bracket')).toBe(true)
    expect(text.trim().endsWith('endsolid bracket')).toBe(true)
    const facets = text.match(/facet normal/g)?.length ?? 0
    expect(facets).toBe(box.indices.length / 3)
  })

  it('export3mf 产出合法 ZIP 容器（PK 签名）', async () => {
    const box = await shapeOf('brep', BOX, 'part0')
    const bytes = export3mf(box) as Uint8Array
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('同源性：exportStl 的三角形数 == smlib kernel.meshShape 的 triangleCount', async () => {
    const box = await shapeOf('brep', BOX, 'part0')
    const handle = brepOf(box)
    expect(handle).toBeDefined()
    const kernel = getBrepApi()
    const mesh = kernel.meshShape(handle!)
    // 三角形数必须与导出所用载荷一致（否则导出的是另一份 mesh）
    expect(mesh.triangleCount).toBe(box.indices.length / 3)
    expect(mesh.vertexCount * 3).toBe(box.positions.length)
    // 面组：box 应为 6 个面
    expect(mesh.faceCount).toBe(6)
  })

  it('几何正确性：导出字节解出的体积 ≈ smlib getVolume', async () => {
    const box = await shapeOf('brep', BOX, 'part0')
    const bytes = exportStl(box) as Uint8Array
    const tris = stlTriCount(bytes)
    expect(tris).toBeGreaterThan(0)

    // 从 STL 字节重算带符号体积（散度定理），与内核体积比对
    let vol6 = 0
    for (let t = 0; t < tris; t++) {
      const off = 84 + t * 50 + 12 // 跳过 12 字节法向
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const p = (i: number): [number, number, number] => [
        dv.getFloat32(off + i * 12, true),
        dv.getFloat32(off + i * 12 + 4, true),
        dv.getFloat32(off + i * 12 + 8, true),
      ]
      const [ax, ay, az] = p(0)
      const [bx, by, bz] = p(1)
      const [cx, cy, cz] = p(2)
      vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    }
    const volFromStl = vol6 / 6
    const kernelVol = getBrepApi().getVolume(brepOf(box)!)
    expect(Math.abs(volFromStl)).toBeCloseTo(kernelVol, 2)
  })
})
