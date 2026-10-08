/**
 * @vitest-environment node
 *
 * cad.exportStl / cad.exportBrep — 导出族，S3 接入
 *
 * 覆盖：
 * 1. exportStl（**中立**）：二进制/ASCII 双形态结构正确；三角形数与 Shape 三角载荷一致；
 *    经 L1 `importStl` 回读 → bbox 一致（真正往返，不是只看字节长度）；
 * 2. exportStl 中立性：brep 链路与 mesh 链路同一份实现（不触达任何引擎）；
 * 3. exportStl 边界：空三角载荷（无界体 cad.halfSpace）显式报错，不产空文件；
 * 4. exportBrep（**平台** engines:['occt']）：文本 BREP 可达，经 L1 `fromBREP` 回读 → 体积一致；
 * 5. exportBrep 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 * 6. 脚本面可达 + TS 级直连（L1 覆盖门禁）。
 *
 * Run: npx vitest run test/api/export-stl-brep.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { getBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { brepOf } from '../../src/shape'
import { exportStl } from '../../src/api/export-stl'
import { exportBrep } from '../../src/api/export-brep'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

function makeRuntime(mode: ExecutionMode): CadRuntime {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() })
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return makeRuntime(mode).execute(code)
}

async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

// 非居中 10³ box（原点到 +10）。脚本面用 cad.box（中立 dual op）。
const BOX = 'let part0 = cad.box(10, 10, 10)\n'

/** binary STL：84 + 50×N 字节；字节 80..83 = uint32 三角形数。 */
function stlTriCount(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
}

describe('cad.exportStl — STL 导出（中立：纯数据序列化）', () => {
  it('二进制形态：Uint8Array，长度 84+50N，三角形数与 Shape 三角载荷一致', async () => {
    await useOcct()
    const box = await shapeOf('brep', BOX, 'part0')
    const bytes = exportStl(box)
    expect(bytes).toBeInstanceOf(Uint8Array)
    const tris = box.indices.length / 3
    expect(tris).toBeGreaterThan(0)
    expect(bytes.byteLength).toBe(84 + tris * 50)
    expect(stlTriCount(bytes)).toBe(tris)
    // 80 字节头写入实体名
    const header = new TextDecoder().decode(bytes.subarray(0, 10))
    expect(header).toMatch(/^Faicad STL/)
  })

  it('ASCII 形态：solid/endsolid 包裹，facet 数 = 三角形数', async () => {
    await useOcct()
    const box = await shapeOf('brep', BOX, 'part0')
    const text = exportStl(box, { ascii: true, name: 'bracket' })
    expect(typeof text).toBe('string')
    const s = text as string
    expect(s.startsWith('solid bracket')).toBe(true)
    expect(s.trimEnd().endsWith('endsolid bracket')).toBe(true)
    expect(s.match(/facet normal/g)?.length).toBe(box.indices.length / 3)
  })

  it('往返：导出的二进制 STL 经 L1 importStl 回读 → bbox 与源一致', async () => {
    await useOcct()
    const box = await shapeOf('brep', BOX, 'part0')
    const kernel = getBrepApi()
    const back = kernel.importStl((exportStl(box) as Uint8Array).buffer as ArrayBuffer)
    const a = kernel.getBoundingBox(brepOf(box) as never)
    const b = kernel.getBoundingBox(back)
    expect(b.xmin).toBeCloseTo(a.xmin, 3)
    expect(b.xmax).toBeCloseTo(a.xmax, 3)
    expect(b.ymin).toBeCloseTo(a.ymin, 3)
    expect(b.ymax).toBeCloseTo(a.ymax, 3)
    expect(b.zmin).toBeCloseTo(a.zmin, 3)
    expect(b.zmax).toBeCloseTo(a.zmax, 3)
  })

  it('脚本面可达：cad.exportStl 的返回值落在 activeValues（非 Shape 产物通道）', async () => {
    await useOcct()
    const result = await exec('brep', `${BOX}let part1 = cad.exportStl(part0, { ascii: true })\n`)
    expect(result.failedAt).toBeUndefined()
    const v = result.activeValues?.get('part1' as never)
    expect(typeof v).toBe('string')
    expect(v as string).toMatch(/^solid /)
  })

  it('边界：无界体（cad.halfSpace）三角载荷为空 → E_EXPORT_STL_EMPTY，不产空文件', async () => {
    await useOcct()
    const half = await shapeOf(
      'brep',
      'let part1 = cad.halfSpace({ origin: [0, 0, 5], normal: [0, 0, 1] })\n',
      'part1',
    )
    expect(() => exportStl(half)).toThrow(/E_EXPORT_STL_EMPTY/)
  })

  it('中立性：mesh 链路同样可达（同一份实现，无引擎分支）', async () => {
    __resetEngineRegistriesForTests()
    const box = await shapeOf('mesh', BOX, 'part0')
    const bytes = exportStl(box) as Uint8Array
    expect(bytes.byteLength).toBe(84 + (box.indices.length / 3) * 50)
  })
})

describe('cad.exportBrep — BREP 文本导出（平台：occt 专属，普通函数形态）', () => {
  it('occt 引擎：可达，返回文本 BREP；经 L1 fromBREP 回读 → 体积一致', async () => {
    await useOcct()
    const box = await shapeOf('brep', BOX, 'part0')
    const text = exportBrep(box)
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
    const kernel = getBrepApi()
    const back = kernel.fromBREP(text)
    expect(Math.abs(kernel.getVolume(back))).toBeCloseTo(1000, 3)
  })

  it('brepkit 引擎：非目标引擎执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await exec('brep', `${BOX}let part1 = cad.exportBrep(part0)\n`)
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'exportBrep' requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
  })

  it('mesh-only 输入 → E_EXPORT_BREP_NO_BREP（不静默产空文本）', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const box = await shapeOf('mesh', BOX, 'part0')
    expect(brepOf(box)).toBeUndefined()
    expect(() => exportBrep(box)).toThrow(/E_EXPORT_BREP_NO_BREP/)
  })

  it('脚本面可达：cad.exportBrep 的文本落在 activeValues（非 Shape 产物通道）', async () => {
    await useOcct()
    const result = await exec('brep', `${BOX}let part1 = cad.exportBrep(part0)\n`)
    expect(result.failedAt).toBeUndefined()
    const v = result.activeValues?.get('part1' as never)
    expect(typeof v).toBe('string')
    expect((v as string).length).toBeGreaterThan(0)
  })
})

/** L1 覆盖率门禁：两个导出必须在 test/ 中被直接引用（本文件顶部已 import）。 */
describe('导出族 — TS 级直连（L1 覆盖）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const brep = await getBrepEngine()
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'auto', brepEngineId: 'occt' },
      kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: { emit: () => undefined },
    } as unknown as Backends)
  }, 120000)

  it('直连：ASCII 与二进制两种形态的三角形数一致', async () => {
    const runtime = makeRuntime('brep')
    const result = await runtime.execute(BOX)
    const box = result.outputs.get(asPartName('part0')) as Shape
    const bytes = exportStl(box) as Uint8Array
    const text = exportStl(box, { ascii: true }) as string
    expect(stlTriCount(bytes)).toBe(text.match(/facet normal/g)?.length)
  })

  it('直连：exportBrep 文本可被 fromBREP 回读且体积不变', async () => {
    const runtime = makeRuntime('brep')
    const result = await runtime.execute(BOX)
    const box = result.outputs.get(asPartName('part0')) as Shape
    const kernel = getBrepApi()
    const back = kernel.fromBREP(exportBrep(box))
    expect(Math.abs(kernel.getVolume(back))).toBeCloseTo(1000, 3)
  })
})
