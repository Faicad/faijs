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
 * 6. 脚本面可达 + TS 级直连（L1 覆盖门禁）；
 * 7. 宿主门（§2.5）：导出命令**只在 node 宿主开放**，browser / weapp / 未声明宿主
 *    报 E_HOST_UNSUPPORTED，且门在读取载荷之前、宿主门先于引擎门、与安全档位解耦；
 * 8. P6 双值：修复前 browser 下「正常返回产物」，修复后抛错——「返回产物」这一事实
 *    改钉在合法宿主（node）上。
 * 9. §2.6（DEC-3）脚本面 step / 3mf 出口 `cad.exportStep` / `cad.export3mf`：
 *    薄壳同源（与库面 `exportModelSync` 逐字节一致，B12 / B14）、双门（宿主门 +
 *    `exportStep` 的 occt 引擎门，B13 / B15 / B16）、单位成对写出（B17）、装配
 *    compound 层级入口（PRODUCT 数 == 叶数 + 成员名 / 颜色落 XCAF）、3MF 不得落
 *    「ZIP 合法、对象为空」的假成功（P8）、符号表在册（B5 / P5）。
 *
 * Run: npx vitest run test/api/export-stl-brep.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { getBrepEngine } from '../../src/brep/engine/registry'
import {
  configureBackends, CONTRACT_VERSION, HostUnsupportedError, type Backends,
} from '../../src/runtime-state'
import { brepOf } from '../../src/shape'
import { exportStl } from '../../src/api/export-stl'
import { exportBrep } from '../../src/api/export-brep'
import { exportStep } from '../../src/api/export-step'
import { export3mf } from '../../src/api/export-3mf'
import { exportModelSync, readDeclaredUnit } from '../../src/brep/export/export-model'
import { readZipEntries } from '../../src/io/zip'
import SYMBOL_TABLE from '../../src/lang/symbol-table.generated'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { configureHost, hostPorts, runtimeOn } from '../support/host-env'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

/**
 * node 宿主 harness：导出命令（`cad.exportStl` / `cad.exportBrep`）只在 `'node'`
 * 宿主开放（§2.5），因此装配点必须声明 `hostEnv`——漏声明等于非 node，导出用例
 * 会全部翻到 `E_HOST_UNSUPPORTED` 分支（宿主门用例见文件末尾的 describe）。
 */
async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

function makeRuntime(mode: ExecutionMode): CadRuntime {
  return new CadRuntime(hostPorts('node'), mode, { cad: createApiNamespaceWithEditorOps() })
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

// ── 宿主 / 引擎装配工具 ──
// 宿主装配（`hostPorts` / `runtimeOn` / `configureHost`）在 `test/support/host-env.ts`
// 与 L1 序列化用例共用（同一个门禁前提，只有一份定义）。

/** 三角载荷为 getter 陷阱的 Shape：被读取即抛 `PAYLOAD_READ`。 */
function payloadTrapShape(): Shape {
  return {
    get positions(): Float32Array {
      throw new Error('PAYLOAD_READ: positions')
    },
    get indices(): Uint32Array {
      throw new Error('PAYLOAD_READ: indices')
    },
  } as unknown as Shape
}

/** 调用 `fn` 并把抛出的错误返回（调用方断言错误类与文案）。 */
function caught(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected the call to throw, but it returned')
}

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
      config: { mode: 'auto', brepEngineId: 'occt', hostEnv: 'node' },
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

/**
 * 宿主门（§2.5 / DEC-1、DEC-2）——导出命令只在 node 宿主开放。
 *
 * 判据读 `config.hostEnv`（端口装配期声明一次，`HostPorts.hostEnv`），与安全扫描
 * 档位解耦；门写在 op 函数体第一行，所以脚本面（`cad.*`）与库面直连（TS import
 * 同一函数）被同一门禁覆盖，且门在读取 Shape 载荷之前。
 *
 * GOTCHA（修复前后双值）：修复前 browser / weapp / 未声明宿主下
 * `cad.exportStl(part0)` **正常返回产物**（`exportStl` 只校验载荷、`exportBrep`
 * 只断言引擎），`failedAt` 为空；修复后一律抛 `E_HOST_UNSUPPORTED`。本文件不保留
 * 「当前错误值」断言（该值已随本次修复翻转），而是把「返回产物」这一事实钉在合法
 * 宿主（node）上——见最后一个用例；越界宿主一律钉「抛错」。
 */
describe('导出命令宿主门 — 仅 node 开放（§2.5，DEC-1 / DEC-2）', () => {
  afterEach(() => {
    // 直连用例会改写全局 backends；还原成 node 宿主，避免污染后续用例。
    configureHost('node')
  })

  it('browser 宿主：cad.exportStl 拒绝，failedAt 带错误码与当前宿主', async () => {
    await useOcct()
    const r = await runtimeOn('browser').execute(`${BOX}let part1 = cad.exportStl(part0)\n`)
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt?.callee).toMatch(/exportStl/)
    expect(r.failedAt?.message).toMatch(/^E_HOST_UNSUPPORTED:/)
    expect(r.failedAt?.message).toContain("op 'exportStl' requires host node")
    expect(r.failedAt?.message).toContain('current=browser')
    expect(r.failedAt?.code).toBe('E_HOST_UNSUPPORTED')
    // 没有产物：命令没有在 activeValues 通道留下任何字节
    expect(r.activeValues?.get('part1' as never)).toBeUndefined()
  })

  it('weapp 宿主：同口径拒绝（current=weapp）', async () => {
    await useOcct()
    const r = await runtimeOn('weapp').execute(`${BOX}let part1 = cad.exportStl(part0)\n`)
    expect(r.failedAt?.message).toMatch(/^E_HOST_UNSUPPORTED:/)
    expect(r.failedAt?.message).toContain('current=weapp')
  })

  it('未声明 hostEnv（只给 events）：同样拒绝，current=<none>，不兜底放行', async () => {
    await useOcct()
    const r = await runtimeOn(undefined).execute(`${BOX}let part1 = cad.exportStl(part0)\n`)
    expect(r.failedAt?.message).toMatch(/^E_HOST_UNSUPPORTED:/)
    expect(r.failedAt?.message).toContain('current=<none>')
  })

  it('门序：宿主门先于引擎门（browser + 仅 brepkit → 报宿主错误，不是引擎错误）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const r = await runtimeOn('browser').execute(`${BOX}let part1 = cad.exportBrep(part0)\n`)
    const msg = JSON.stringify(r.failedAt)
    expect(msg).toMatch(/E_HOST_UNSUPPORTED/)
    expect(msg).not.toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toContain('current=browser')
  })

  it('库面直连（TS import 同一函数）同样被拒，且门在实现体之前：载荷陷阱未被读取', () => {
    configureHost('browser')
    const err = caught(() => exportStl(payloadTrapShape()))
    // 载荷被读取会抛 PAYLOAD_READ；实际抛的是宿主门错误 → 门在函数体第一行
    expect(err).toBeInstanceOf(HostUnsupportedError)
    expect((err as Error).message).toMatch(/^E_HOST_UNSUPPORTED:/)
    expect((err as Error).message).toContain("op 'exportStl' requires host node")
  })

  it('反证：同一陷阱 Shape 在 node 宿主下门放行、实现体确实读取载荷', () => {
    configureHost('node')
    expect(() => exportStl(payloadTrapShape())).toThrow(/PAYLOAD_READ/)
  })

  it('exportBrep：门在实现体之前（node 报无 BREP 槽，browser 报宿主门）', async () => {
    await useOcct()
    const box = await shapeOf('mesh', BOX, 'part0')
    configureHost('node')
    expect(() => exportBrep(box)).toThrow(/E_EXPORT_BREP_NO_BREP/)
    configureHost('browser')
    const err = caught(() => exportBrep(box))
    expect(err).toBeInstanceOf(HostUnsupportedError)
    expect((err as Error).message).toMatch(/^E_HOST_UNSUPPORTED:/)
  })

  it('安全档位放宽（security: off）不解除导出门禁', async () => {
    await useOcct()
    const r = await runtimeOn('browser', 'brep', { security: 'off' }).execute(
      `${BOX}let part1 = cad.exportStl(part0)\n`,
    )
    expect(r.failedAt?.message).toMatch(/^E_HOST_UNSUPPORTED:/)
    expect(r.failedAt?.message).toContain('current=browser')
  })

  it('node 宿主：命令放行并返回产物（P6 的「返回产物」钉在合法宿主上）', async () => {
    await useOcct()
    const r = await runtimeOn('node').execute(`${BOX}let part1 = cad.exportStl(part0)\n`)
    expect(r.failedAt).toBeUndefined()
    expect(r.activeValues?.get('part1' as never)).toBeInstanceOf(Uint8Array)
  })
})

/**
 * 脚本面 step / 3mf 出口（方案 §2.6 / DEC-3）——`cad.exportStep` / `cad.export3mf`。
 *
 * 两者是库面序列化器 `exportModelSync` 的**薄壳**：门禁（宿主门；`exportStep` 另有
 * occt 引擎门）→ 入参转 `ExportEntry[]`（按格式分派：step 给 `solid`，3mf 必须给
 * `mesh`）→ 调库面序列化器。因此「脚本面 == 库面」的同源关系（矩阵 B12 / B14）是
 * 逐字节可测的，而不是靠约定。
 *
 * 覆盖：B5 / P5（符号表在册）、B12（step 同源）、B13（引擎门，触碰句柄前报出）、
 * B14（3mf 同源 + ZIP 结构）、B15 / B16（宿主门，含未声明宿主）、B17（单位成对写出）、
 * 层级入口（compound 的 PRODUCT 数 == 叶数 + 成员名 / 颜色落 XCAF）、P8（3MF 不得
 * 落「ZIP 合法、对象为空」的假成功）。
 */
describe('cad.exportStep / cad.export3mf — 脚本面 step / 3mf 出口（§2.6）', () => {
  /** 两件装配（显式 memberNames，使 memberColors 的键确定）。 */
  const ASM = [
    BOX.trimEnd(),
    'let part1 = cad.box(10, 10, 10)',
    // 颜色取**非预定义色**：OCCT 对精确原色会写 DRAUGHTING_PRE_DEFINED_COLOUR('red')，
    // 任意色才写 COLOUR_RGB——两者都是合法 XCAF 形态，这里用任意色以便逐值核对
    // （sRGB → linear 存储 → 写出时线性→sRGB）。
    "let asm1 = cad.assembly({ name: 'A', members: [part0, part1], memberNames: ['base', 'cap'], memberColors: { base: [0.2, 0.4, 0.6], cap: [0.1, 0.3, 0.5] } })",
  ].join('\n') + '\n'

  /** STEP 文本里的 PRODUCT 条数（XCAF 每个 label 一个 PRODUCT）。 */
  function productCount(stepText: string): number {
    return (stepText.match(/\bPRODUCT\s*\(/g) ?? []).length
  }

  /** STEP 文本里 COLOUR_RGB 三元组（XCAF 线性存储 → 写出时线性→sRGB，即入参原值）。 */
  function colours(stepText: string): number[][] {
    return [...stepText.matchAll(/COLOUR_RGB\s*\(\s*[^,]*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/g)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
  }

  it('B5 / P5 在册：符号表与 cad 命名空间都含四个导出命令，不含库面入口', () => {
    const keys = Object.keys(SYMBOL_TABLE)
    for (const name of ['exportStl', 'exportBrep', 'exportStep', 'export3mf']) {
      expect(keys).toContain(name)
    }
    // 库面入口（字节通道）不进脚本面：导出命令是四个固定符号，不是「任意写出器」。
    expect(keys).not.toContain('exportModel')
    expect(keys).not.toContain('exportModelSync')
    const ns = createApiNamespaceWithEditorOps() as unknown as Record<string, unknown>
    for (const name of ['exportStl', 'exportBrep', 'exportStep', 'export3mf']) {
      expect(typeof ns[name]).toBe('function')
    }
  })

  /** FILE_NAME 的 time_stamp 由内核读当前时间写出——两次序列化必然差若干秒，
   *  故逐字节比对前先把该字段归一（这是唯一允许存在的差异，且不在几何/单位上）。 */
  function normalizeTimestamp(stepText: string): string {
    return stepText.replace(/(FILE_NAME\([^,]*,\s*')[^']*(')/, '$1<ts>$2')
  }

  /** DATA 段（几何 + 单位声明）——同源关系的真正落点，必须逐字节一致。 */
  function dataSection(stepText: string): string {
    const at = stepText.indexOf('DATA;')
    return at < 0 ? stepText : stepText.slice(at)
  }

  it('B12 同源（step）：cad.exportStep(part0) 文本 == 库面 exportModelSync([entry],"step") 文本（逐字节）', async () => {
    await useOcct()
    const r = await runtimeOn('node').execute(`${BOX}let out = cad.exportStep(part0)\n`)
    expect(r.failedAt).toBeUndefined()
    const scriptText = r.activeValues?.get('out' as never) as string
    const box = r.outputs.get(asPartName('part0')) as Shape
    // 单件入参不带名 / 色（与 cli.ts#writeOutput 同口径），条目形态与 op 内部逐字一致。
    const libText = new TextDecoder().decode(
      new Uint8Array(exportModelSync([{ solid: brepOf(box) as never }], 'step')),
    )
    expect(normalizeTimestamp(scriptText)).toBe(normalizeTimestamp(libText))
    // 几何 / 单位声明段落更严格：连 header 都不参与，必须逐字节相同。
    expect(dataSection(scriptText)).toBe(dataSection(libText))
    expect(scriptText.startsWith('ISO-10303-21')).toBe(true)
    expect(productCount(scriptText)).toBe(1)
  })

  it('B17 单位成对写出：cad.exportStep(part0,{unit:"inch"}) 的声明单位回读为 inch', async () => {
    await useOcct()
    // 修复前的错误值（2026-10-08 实测）：`rewriteStepUnitEntities` 的 inch/foot 分支
    // 用 `[^)]*` 匹配实体体，跨不过 OCCT 真实写出的 `LENGTH_UNIT() NAMED_UNIT(*)` 自带
    // 的括号，必然抛 `[export/step] no SI_UNIT(.MILLI.,.METRE.) entity found`——即
    // 「非 mm 的 STEP 导出」从未真正可用（旧测试只用 fixture 字符串覆盖 detectStepUnit，
    // 没覆盖真实写出）。本用例钉的是修复后的正确值：声明回读 == 'inch'。
    const r = await runtimeOn('node').execute(
      `${BOX}let inches = cad.exportStep(part0, { unit: 'inch' })\nlet mms = cad.exportStep(part0)\n`,
    )
    expect(r.failedAt).toBeUndefined()
    const inches = r.activeValues?.get('inches' as never) as string
    const mms = r.activeValues?.get('mms' as never) as string
    expect(readDeclaredUnit(new TextEncoder().encode(inches), 'step')).toBe('inch')
    // 缺省 mm：声明与坐标同为 mm（同一 scale 变量产出）。
    expect(readDeclaredUnit(new TextEncoder().encode(mms), 'step')).toBe('mm')
  })

  it('B13 引擎门：非 occt 引擎下 cad.exportStep 报 E_BREP_UNSUPPORTED，且实现体未执行', async () => {
    // 直连形态：门在函数体第一行，载荷陷阱未被读取 → 证明门在触碰句柄 / 载荷之前。
    configureHost('node', 'brepkit')
    const err = caught(() => exportStep(payloadTrapShape()))
    expect((err as Error).message).toMatch(/^E_BREP_UNSUPPORTED:/)
    expect((err as Error).message).toContain("op 'exportStep' requires engine occt")
    expect((err as Error).message).not.toContain('PAYLOAD_READ')
    // 脚本面同门：宿主放行（node）后由引擎门拦下。
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const r = await runtimeOn('node').execute(`${BOX}let out = cad.exportStep(part0)\n`)
    expect(r.failedAt?.message).toMatch(/^E_BREP_UNSUPPORTED:/)
    expect(r.failedAt?.message).toContain("op 'exportStep' requires engine occt")
    expect(r.activeValues?.get('out' as never)).toBeUndefined()
  })

  it('B14 同源（3mf）：cad.export3mf(part0) 字节 == 库面 exportModelSync([entry],"3mf") 字节；ZIP 结构正确', async () => {
    await useOcct()
    const r = await runtimeOn('node').execute(`${BOX}let out = cad.export3mf(part0)\n`)
    expect(r.failedAt).toBeUndefined()
    const scriptBytes = r.activeValues?.get('out' as never) as Uint8Array
    const box = r.outputs.get(asPartName('part0')) as Shape
    const libBytes = new Uint8Array(
      exportModelSync([{ mesh: { positions: box.positions, indices: box.indices } }], '3mf'),
    )
    expect(scriptBytes).toEqual(libBytes)
    const zip = readZipEntries(scriptBytes)
    expect([...zip.keys()].sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    const model = new TextDecoder().decode(zip.get('3D/3dmodel.model')!)
    expect(model).toContain('<model unit="millimeter"')
    expect(model).toContain('<object')
    expect(model.match(/<triangle /g)?.length).toBe(box.indices.length / 3)
  })

  it('层级入口：cad.exportStep(compound) 的 PRODUCT 数 == 叶数，成员名与 memberColors 落在 label 上', async () => {
    await useOcct()
    const r = await runtimeOn('node').execute(`${ASM}let out = cad.exportStep(asm1)\n`)
    expect(r.failedAt).toBeUndefined()
    const text = r.activeValues?.get('out' as never) as string
    expect(typeof text).toBe('string')
    expect(productCount(text)).toBe(2)
    expect(text).toContain("'base'")
    expect(text).toContain("'cap'")
    const cols = colours(text)
    // 成员色是 sRGB 0–1；XCAF 内部按 linear 存储、写出时换回 sRGB，故文件里的
    // COLOUR_RGB 就是入参原值（±浮点往返）。每个成员一条 STYLED_ITEM。
    const near = (c: number[], r: number, g: number, b: number): boolean =>
      Math.abs(c[0]! - r) < 0.01 && Math.abs(c[1]! - g) < 0.01 && Math.abs(c[2]! - b) < 0.01
    expect(cols.some((c) => near(c, 0.2, 0.4, 0.6))).toBe(true)
    expect(cols.some((c) => near(c, 0.1, 0.3, 0.5))).toBe(true)
    expect((text.match(/STYLED_ITEM/g) ?? []).length).toBe(2)
  })

  it('B15 宿主门：browser 下两个新 op 都在实现体之前拒绝（同一门，不存在旁路）', async () => {
    // 脚本面
    await useOcct()
    for (const call of ['cad.exportStep(part0)', 'cad.export3mf(part0)']) {
      const r = await runtimeOn('browser').execute(`${BOX}let out = ${call}\n`)
      expect(r.failedAt?.message).toMatch(/^E_HOST_UNSUPPORTED:/)
      expect(r.failedAt?.message).toContain('current=browser')
      expect(r.activeValues?.get('out' as never)).toBeUndefined()
    }
    // 库面直连（TS import 同一函数）同样被拒，且门在读取载荷之前。
    configureHost('browser')
    const stepErr = caught(() => exportStep(payloadTrapShape()))
    const mfErr = caught(() => export3mf(payloadTrapShape()))
    for (const err of [stepErr, mfErr]) {
      expect(err).toBeInstanceOf(HostUnsupportedError)
      expect((err as Error).message).toMatch(/^E_HOST_UNSUPPORTED:/)
      expect((err as Error).message).not.toContain('PAYLOAD_READ')
    }
    configureHost('node')
  })

  it('B16 未声明宿主：与 B10 同口径（current=<none>），不兜底放行', async () => {
    await useOcct()
    const r = await runtimeOn(undefined).execute(`${BOX}let out = cad.export3mf(part0)\n`)
    expect(r.failedAt?.message).toMatch(/^E_HOST_UNSUPPORTED:/)
    expect(r.failedAt?.message).toContain('current=<none>')
  })

  it('P8 双值：库面吃无 mesh 条目静默跳过（假成功）；op 层显式报错，不落空文件', () => {
    // 当前（错误）值：3MF 写出器对无 mesh 的条目直接 return，产出「ZIP 合法、对象为空」。
    const fake = exportModelSync([{ name: 'ghost' }], '3mf')
    const model = new TextDecoder().decode(readZipEntries(fake).get('3D/3dmodel.model')!)
    expect(model).toContain('<model')
    expect(model).not.toContain('<object')
    // 应有（正确）值：op 层把「无三角载荷」当不可导出成员，全体不可导出即显式报错。
    configureHost('node')
    const empty = { positions: new Float32Array(), indices: new Uint32Array() } as Shape
    expect(() => export3mf(empty)).toThrow(/^E_EXPORT_3MF_EMPTY:/)
    expect(() => exportStep(empty)).toThrow(/^E_EXPORT_STEP_EMPTY:/)
  })
})
