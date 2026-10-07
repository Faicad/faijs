/**
 * @vitest-environment node
 *
 * cad.offset2d — 2D 轮廓偏置（1D 轮廓），S3 平台 op（engines:['occt']）
 *
 * 覆盖：
 * 1. occt 引擎：可达，产出 1D 轮廓（kind='curve'，三角载荷为空），bbox 为方形环偏置结果；
 * 2. 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 * 3. brep_mock 下不被引擎判定拦截（D11-3 豁免）；
 * 4. 入参校验：delta 非有限数 / joinType 非法值；
 * 5. TS 级直连（L1 覆盖门禁）+ STEP 往返（方案 §9.3）。
 *
 * Run: npx vitest run test/api/offset2d.test.ts
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
import { offset2d } from '../../src/api/offset2d'
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

/** Shape 的 kind 判别位（1D = 'curve'）。 */
const kindOf = (s: Shape): string | undefined => (s as { kind?: string }).kind

// 10×10 闭合方形轮廓（原点角）。
const SQUARE_WIRE =
  'let part0 = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,0]], { closed: true })\n'
const OFFSET_CODE = `${SQUARE_WIRE}let part1 = cad.offset2d(part0, 2)\n`

describe('cad.offset2d — 2D 轮廓偏置（平台 op engines:["occt"]）', () => {
  it('occt 引擎：可达，产出 1D 轮廓（kind="curve"），bbox 撑到偏置后的方形', async () => {
    await useOcct()
    const s = await shapeOf('brep', OFFSET_CODE, 'part1')
    // 1D 轮廓：kind='curve' 且无三角载荷
    expect(kindOf(s)).toBe('curve')
    expect(s.indices.length).toBe(0)
    const bbox = getBrepApi().getBoundingBox(brepOf(s) as never)
    // 外扩 2 → 边长 14；内缩 2 → 边长 6。二者宽度相同，钉住跨度与中心。
    const spanX = bbox.xmax - bbox.xmin
    const spanY = bbox.ymax - bbox.ymin
    expect(Math.round(spanX)).toBe(14)
    expect(Math.round(spanY)).toBe(14)
    expect(bbox.xmin + bbox.xmax).toBeCloseTo(10, 4)
    expect(bbox.ymin + bbox.ymax).toBeCloseTo(10, 4)
    expect(Math.abs(bbox.zmax - bbox.zmin)).toBeLessThanOrEqual(1e-6)
  })

  it('joinType 三值均可达（arc / tangent / intersection）', async () => {
    await useOcct()
    for (const jt of ['arc', 'tangent', 'intersection']) {
      const s = await shapeOf(
        'brep',
        `${SQUARE_WIRE}let part1 = cad.offset2d(part0, 2, { joinType: '${jt}' })\n`,
        'part1',
      )
      expect(kindOf(s)).toBe('curve')
    }
  })

  it('brepkit 引擎：非目标引擎执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await exec('brep', OFFSET_CODE)
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'offset2d' requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
  })

  it('brep_mock 引擎：不被平台身份判定拦截（D11-3 豁免）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepMockEngine()
    const result = await exec('brep', OFFSET_CODE)
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })

  it('delta 非有限数 → E_OFFSET2D_BAD_DELTA', async () => {
    await useOcct()
    const result = await exec('brep', `${SQUARE_WIRE}let part1 = cad.offset2d(part0, 'x')\n`)
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_OFFSET2D_BAD_DELTA/)
  })

  it('joinType 非法值 → E_OFFSET2D_BAD_JOIN', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      `${SQUARE_WIRE}let part1 = cad.offset2d(part0, 2, { joinType: 'bevel' })\n`,
    )
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_OFFSET2D_BAD_JOIN/)
  })
})

/**
 * L1 覆盖率门禁：`api/index.ts` 导出的 `offset2d` 必须在 test/ 中被**直接引用**
 * （op 模块直连，先例 test/api/surface.test.ts）。
 */
describe('cad.offset2d — TS 级直连（L1 覆盖）', () => {
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

  it('直连调用产出与脚本级一致的 1D 轮廓', async () => {
    const runtime = makeRuntime('brep')
    const result = await runtime.execute(SQUARE_WIRE)
    const wire = result.outputs.get(asPartName('part0')) as Shape
    const s = await offset2d(wire, 2)
    expect(kindOf(s)).toBe('curve')
    const bbox = getBrepApi().getBoundingBox(brepOf(s) as never)
    expect(Math.round(bbox.xmax - bbox.xmin)).toBe(14)
  })

  it('入参校验在直连路径同样生效：delta 非有限数', async () => {
    const runtime = makeRuntime('brep')
    const result = await runtime.execute(SQUARE_WIRE)
    const wire = result.outputs.get(asPartName('part0')) as Shape
    await expect(offset2d(wire, Number.NaN)).rejects.toThrow(/E_OFFSET2D_BAD_DELTA/)
  })

  it('STEP 往返（方案 §9.3）：导出 STEP → OCCT 回读 → bbox 一致（精确 BREP，非 mesh 回填）', async () => {
    const runtime = makeRuntime('brep')
    const result = await runtime.execute(SQUARE_WIRE)
    const wire = result.outputs.get(asPartName('part0')) as Shape
    const s = await offset2d(wire, 2)
    const kernel = getBrepApi()
    const handle = brepOf(s) as never
    const step = kernel.exportStep(handle)
    expect(step).toMatch(/ISO-10303/)
    const back = kernel.importStep(step)
    const bbox = kernel.getBoundingBox(back)
    expect(Math.round(bbox.xmax - bbox.xmin)).toBe(14)
    expect(bbox.xmin + bbox.xmax).toBeCloseTo(10, 3)
  })
})
