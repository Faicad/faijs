/**
 * @vitest-environment node
 *
 * cad.solidFromFaces — 面集一次成型为实体，S3 平台 op（engines:['occt']）
 *
 * 覆盖：
 * 1. occt 引擎：6 张立方体面 → 实体（volume==1000，bbox [0,10]³）；
 * 2. 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 * 3. brep_mock 下不被引擎判定拦截（D11-3 豁免）；
 * 4. 入参校验：空面表 / 非法 tolerance；
 * 5. TS 级直连（L1 覆盖门禁，面集来自 L1 getSubShapes）+ STEP 往返（方案 §9.3）。
 *
 * 脚本级 6 面构造：`cad.profile` 产出 z=0 平面方形面，经 `cad.place` 的四元数
 * 旋转/平移摆到立方体的 6 个面上（四元数按 place 的 Hamilton [x,y,z,w] 约定给出：
 * 绕 X 轴 +90° = [√½,0,0,√½]；绕 Y 轴 +90° = [0,√½,0,√½]）。
 *
 * Run: npx vitest run test/api/solid-from-faces.test.ts
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
import { registerBrepMockEngine } from '../../src/brep/engine/adapters/brep-mock'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { getBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { brepOf } from '../../src/shape'
import { getFaces } from '../../src/api/brep-topology'
import { solidFromFaces } from '../../src/api/solid-from-faces'
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

/** 重置注册表并注册 occt（默认引擎）。 */
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

/** 执行代码并取回命名产物（失败即抛）。 */
async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

const volumeOf = (s: Shape): number => getBrepApi().getVolume(brepOf(s) as never)

// 10×10 平面方形面（z=0）。
const SQ = `cad.profile({ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
] }] })`

/** 立方体 [0,10]³ 的 6 个面（place 四元数摆位）。 */
const CUBE_FACES =
  `const q = 0.7071067811865476\n` +
  `const sq = ${SQ}\n` +
  `const fz0 = sq\n` +
  `const fz1 = cad.place(sq, { position: [0, 0, 10] })\n` +
  `const fy0 = cad.place(sq, { rotation: [q, 0, 0, q] })\n` +
  `const fy1 = cad.place(sq, { rotation: [q, 0, 0, q], position: [0, 10, 0] })\n` +
  `const fx0 = cad.place(sq, { rotation: [0, q, 0, q], position: [0, 0, 10] })\n` +
  `const fx1 = cad.place(sq, { rotation: [0, q, 0, q], position: [10, 0, 10] })\n`

const SOLID_CODE =
  CUBE_FACES + `let part0 = await cad.solidFromFaces([fz0, fz1, fy0, fy1, fx0, fx1])\n`

describe('cad.solidFromFaces — 面集一次成型（平台 op engines:["occt"]）', () => {
  it('occt 引擎：6 面 → 实体（|volume|==1000，bbox [0,10]³）', async () => {
    await useOcct()
    const s = await shapeOf('brep', SOLID_CODE, 'part0')
    // 实体产物有三角载荷
    expect(s.indices.length).toBeGreaterThan(0)
    // ⚠️ 有向体积：occt 的 buildSolidFromFaces 继承输入面朝向，本用例构造的面
    // 法向朝内 ⇒ 实体壳朝向内翻，getVolume 返回 **-1000**（同 reverseShape 的
    // GOTCHA-6：getVolume 是**有向**体积）。几何本身正确（bbox 精确、|vol| 精确）。
    expect(Math.abs(volumeOf(s))).toBeCloseTo(1000, 6)
    expect(volumeOf(s)).toBeLessThan(0)
    const bbox = getBrepApi().getBoundingBox(brepOf(s) as never)
    expect(bbox.xmin).toBeCloseTo(0, 6)
    expect(bbox.xmax).toBeCloseTo(10, 6)
    expect(bbox.ymin).toBeCloseTo(0, 6)
    expect(bbox.ymax).toBeCloseTo(10, 6)
    expect(bbox.zmin).toBeCloseTo(0, 6)
    expect(bbox.zmax).toBeCloseTo(10, 6)
  })

  it('§4.5 边界：同 6 面走中立 sewAndSolidify（L1）与平台 solidFromFaces 的既有差异', async () => {
    await useOcct()
    const sff = await shapeOf('brep', SOLID_CODE, 'part0')
    const sewCode = CUBE_FACES + `let part0 = await cad.sewAndSolidify([fz0, fz1, fy0, fy1, fx0, fx1])\n`
    const sewn = await shapeOf('brep', sewCode, 'part0')
    // 两条路径的 |体积| 一致（同一几何体）；本仓 getVolume 是**有向**体积，
    // 朝向由各自内核路径的缝合结果决定 —— 差异记在这里，作为 §4.5 分工的实测依据。
    expect(Math.abs(volumeOf(sff))).toBeCloseTo(1000, 6)
    expect(Math.abs(volumeOf(sewn))).toBeCloseTo(1000, 6)
    // 两条路径的朝向一致（同输入面 ⇒ 同壳朝向），故有向体积同号。
    expect(Math.sign(volumeOf(sewn))).toBe(Math.sign(volumeOf(sff)))
  })

  it('tolerance 显式给出可达（同几何）', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      CUBE_FACES + `let part0 = await cad.solidFromFaces([fz0, fz1, fy0, fy1, fx0, fx1], { tolerance: 1e-6 })\n`,
      'part0',
    )
    expect(Math.abs(volumeOf(s))).toBeCloseTo(1000, 6)
  })

  it('brepkit 引擎：非目标引擎执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await exec('brep', SOLID_CODE)
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'solidFromFaces' requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
  })

  it('brep_mock 引擎：不被平台身份判定拦截（D11-3 豁免）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepMockEngine()
    const result = await exec('brep', SOLID_CODE)
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })

  it('空面表 → E_SOLID_FROM_FACES_NO_FACES（执行前）', async () => {
    await useOcct()
    const result = await exec('brep', `let part0 = await cad.solidFromFaces([])\n`)
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SOLID_FROM_FACES_NO_FACES/)
  })

  it('非法 tolerance（0）→ E_SOLID_FROM_FACES_BAD_TOLERANCE（执行前）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      CUBE_FACES + `let part0 = await cad.solidFromFaces([fz0, fz1, fy0, fy1, fx0, fx1], { tolerance: 0 })\n`,
    )
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SOLID_FROM_FACES_BAD_TOLERANCE/)
  })
})

/**
 * L1 覆盖率门禁：`api/index.ts` 导出的 `solidFromFaces` 必须在 test/ 中被**直接引用**。
 * 这里用 L1 的 `getFaces`（getSubShapes）从 box 取 6 面，与脚本级用例互为交叉印证。
 */
describe('cad.solidFromFaces — TS 级直连（L1 覆盖）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const brep = await getBrepEngine()
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
      kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: { emit: () => undefined },
    } as unknown as Backends)
  }, 120000)

  it('box 的 6 个面 → solidFromFaces → volume==1000（bbox 不变）', async () => {
    const runtime = makeRuntime('brep')
    const result = await runtime.execute('let part0 = cad.box(10, 10, 10)\n')
    const boxShape = result.outputs.get(asPartName('part0')) as Shape
    const faces = getFaces(boxShape) as unknown as Shape[]
    expect(faces.length).toBe(6)
    const s = await solidFromFaces(faces)
    expect(Math.abs(volumeOf(s))).toBeCloseTo(1000, 6)
    const bbox = getBrepApi().getBoundingBox(brepOf(s) as never)
    expect(bbox.xmax - bbox.xmin).toBeCloseTo(10, 6)
    expect(bbox.ymax - bbox.ymin).toBeCloseTo(10, 6)
    expect(bbox.zmax - bbox.zmin).toBeCloseTo(10, 6)
  })

  it('入参校验在直连路径同样生效：空面表', async () => {
    await expect(solidFromFaces([])).rejects.toThrow(/E_SOLID_FROM_FACES_NO_FACES/)
  })

  it('STEP 往返（方案 §9.3）：导出 STEP → OCCT 回读 → 体积/bbox 一致（精确 BREP）', async () => {
    const runtime = makeRuntime('brep')
    const result = await runtime.execute('let part0 = cad.box(10, 10, 10)\n')
    const boxShape = result.outputs.get(asPartName('part0')) as Shape
    const s = await solidFromFaces(getFaces(boxShape) as unknown as Shape[])
    const kernel = getBrepApi()
    const step = kernel.exportStep(brepOf(s) as never)
    expect(step).toMatch(/ISO-10303/)
    const back = kernel.importStep(step)
    expect(Math.abs(kernel.getVolume(back))).toBeCloseTo(1000, 3)
  })
})
