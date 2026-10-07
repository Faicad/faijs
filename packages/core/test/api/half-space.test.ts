/**
 * @vitest-environment node
 *
 * cad.halfSpace — 无限半空间实体（无界布尔工具），S3 平台 op（engines:['occt']）
 *
 * 覆盖：
 * 1. occt 引擎：可达；产物**无界**（brep 句柄有效、面载荷为空——该几何的真值，非失败）；
 * 2. 真实用途：作 `cad.cut` 的无界工具，把 10³ box 切出 z ∈ [0,5] → 体积 500；
 * 3. 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 * 4. brep_mock 下不被引擎判定拦截（D11-3 豁免）；
 * 5. 入参校验：origin/normal 非 [x,y,z] 有限数、normal 为零向量；
 * 6. normal 非单位向量可达（原语不要求单位化）；
 * 7. TS 级直连（L1 覆盖门禁）。
 *
 * 未覆盖（已实测钉在探针里，见 test/api/occt-s3-capability-probes.test.ts A/B/C）：
 * 无限半空间**不能**单独导出 STEP 作为有限体——它按定义无界，脚本面用法只有布尔工具位。
 *
 * Run: npx vitest run test/api/half-space.test.ts
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
import { halfSpace } from '../../src/api/half-space'
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

// 非居中 box → [0,10]³；半空间平面 z=5、法向 +Z（保留 z>=5 侧）。
const BOX = 'let part0 = cad.box(10, 10, 10)\n'
const HALF = 'let part1 = cad.halfSpace({ origin: [0, 0, 5], normal: [0, 0, 1] })\n'
const CUT = `${BOX}${HALF}let part2 = cad.cut(part0, part1)\n`

describe('cad.halfSpace — 无限半空间实体（平台 op engines:["occt"]）', () => {
  it('occt 引擎：可达，产物无界（brep 句柄是 solid，面载荷为空 = 无有限面可离散）', async () => {
    await useOcct()
    const s = await shapeOf('brep', `${BOX}${HALF}`, 'part1')
    // 无界体的真值：句柄有效、形状类型是 solid，但没有有限面 → 三角载荷为空。
    expect(s.positions.length).toBe(0)
    expect(s.indices.length).toBe(0)
    const handle = brepOf(s)
    expect(handle).toBeDefined()
    expect(getBrepApi().shapeType(handle as never)).toBe('solid')
    // 有向体积的绝对值必然大于 box（无界）；只钉「不是 0 / 不是 NaN」，不钉具体值。
    expect(Number.isNaN(getBrepApi().getVolume(handle as never))).toBe(false)
  })

  it('真实用途：作 cad.cut 的无界工具 → 10³ box 切出 z ∈ [0,5]，体积 500', async () => {
    await useOcct()
    const s = await shapeOf('brep', CUT, 'part2')
    const kernel = getBrepApi()
    const handle = brepOf(s) as never
    expect(Math.abs(kernel.getVolume(handle))).toBeCloseTo(500, 3)
    const bbox = kernel.getBoundingBox(handle)
    expect(bbox.zmin).toBeCloseTo(0, 3)
    expect(bbox.zmax).toBeCloseTo(5, 3)
    expect(bbox.xmin).toBeCloseTo(0, 3)
    expect(bbox.xmax).toBeCloseTo(10, 3)
    // 切割结果是**有限体** → 有三角载荷（与 part1 的空白形成对照）。
    expect(s.positions.length).toBeGreaterThan(0)
  })

  it('normal 不必单位化：{0,0,3} 与 {0,0,1} 切出同一结果', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${BOX}let part1 = cad.halfSpace({ origin: [0, 0, 5], normal: [0, 0, 3] })\n` +
        'let part2 = cad.cut(part0, part1)\n',
      'part2',
    )
    expect(Math.abs(getBrepApi().getVolume(brepOf(s) as never))).toBeCloseTo(500, 3)
  })

  it('brepkit 引擎：非目标引擎执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await exec('brep', `${BOX}${HALF}`)
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'halfSpace' requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
  })

  it('brep_mock 引擎：不被平台身份判定拦截（D11-3 豁免）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepMockEngine()
    const result = await exec('brep', `${BOX}${HALF}`)
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })

  it('origin 非 [x,y,z] 有限数 → E_HALF_SPACE_BAD_ORIGIN', async () => {
    await useOcct()
    const result = await exec('brep', 'let part1 = cad.halfSpace({ origin: [0, 0], normal: [0, 0, 1] })\n')
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_HALF_SPACE_BAD_ORIGIN/)
  })

  it('normal 为零向量 → E_HALF_SPACE_BAD_NORMAL', async () => {
    await useOcct()
    const result = await exec('brep', 'let part1 = cad.halfSpace({ origin: [0, 0, 5], normal: [0, 0, 0] })\n')
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_HALF_SPACE_BAD_NORMAL/)
  })
})

/**
 * L1 覆盖率门禁：`api/index.ts` 导出的 `halfSpace` 必须在 test/ 中被**直接引用**
 * （op 模块直连，先例 test/api/offset2d.test.ts）。
 */
describe('cad.halfSpace — TS 级直连（L1 覆盖）', () => {
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

  it('直连调用产出无界实体；喂给 L1 cut 与脚本级 cut 结果一致', async () => {
    const runtime = makeRuntime('brep')
    const result = await runtime.execute(`${BOX}${HALF}`)
    const box = result.outputs.get(asPartName('part0')) as Shape
    const half = await halfSpace({ origin: [0, 0, 5], normal: [0, 0, 1] })
    expect(half.positions.length).toBe(0)
    const kernel = getBrepApi()
    const cut = kernel.cut(brepOf(box) as never, brepOf(half) as never)
    expect(Math.abs(kernel.getVolume(cut))).toBeCloseTo(500, 3)
  })

  it('入参校验在直连路径同样生效：normal 零向量', async () => {
    await expect(halfSpace({ origin: [0, 0, 0], normal: [0, 0, 0] })).rejects.toThrow(
      /E_HALF_SPACE_BAD_NORMAL/,
    )
  })
})
