/**
 * @vitest-environment node
 *
 * cad.surface — B 样条曲面（控制点阵 → 面），S3 平台 op（engines:['occt']）
 *
 * 覆盖：
 * 1. occt 引擎：可达，产出面（三角载荷非空，bbox == 控制点阵包围盒）；
 * 2. 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 * 3. brep_mock 下不被引擎判定拦截（D11-3 豁免）；
 * 4. 入参校验：点数为 rows*cols、点形态为有限三元组、rows/cols >= 2。
 *
 * Run: npx vitest run test/api/surface.test.ts
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
import { surface } from '../../src/api/surface'
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

// 2×2 控制点阵（行优先展开）：四角 (±5, ±5, 0) → 双线性面片撑满 [-5,5]²。
const SURFACE_CODE =
  'let part0 = cad.surface({ points: [[-5,-5,0],[5,-5,0],[-5,5,0],[5,5,0]], rows: 2, cols: 2 })\n'

describe('cad.surface — B 样条面（平台 op engines:["occt"]）', () => {
  it('occt 引擎：可达，产出面（三角载荷非空）且 bbox 等于控制点阵包围盒', async () => {
    await useOcct()
    const s = await shapeOf('brep', SURFACE_CODE, 'part0')
    // 面产物有三角载荷（非 1D 曲线）
    expect(s.indices.length).toBeGreaterThan(0)
    const bbox = getBrepApi().getBoundingBox(brepOf(s) as never)
    expect(bbox.xmin).toBeCloseTo(-5, 6)
    expect(bbox.xmax).toBeCloseTo(5, 6)
    expect(bbox.ymin).toBeCloseTo(-5, 6)
    expect(bbox.ymax).toBeCloseTo(5, 6)
    // 平面面片：Z 全零
    expect(Math.abs(bbox.zmin)).toBeLessThanOrEqual(1e-6)
    expect(Math.abs(bbox.zmax)).toBeLessThanOrEqual(1e-6)
  })

  it('brepkit 引擎：非目标引擎执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await exec('brep', SURFACE_CODE)
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'surface' requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
  })

  it('brep_mock 引擎：不被平台身份判定拦截（D11-3 豁免）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepMockEngine()
    const result = await exec('brep', SURFACE_CODE)
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })

  it('点数为 rows*cols 校验：3 点配 2×2 → E_SURFACE_POINT_COUNT', async () => {
    await useOcct()
    const result = await exec('brep', 'let part0 = cad.surface({ points: [[0,0,0],[1,0,0],[0,1,0]], rows: 2, cols: 2 })\n')
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SURFACE_POINT_COUNT/)
  })

  it('rows/cols 下界校验：1 → E_SURFACE_BAD_SHAPE', async () => {
    await useOcct()
    const result = await exec('brep', 'let part0 = cad.surface({ points: [[0,0,0],[1,0,0]], rows: 1, cols: 2 })\n')
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SURFACE_BAD_SHAPE/)
  })

  it('点形态校验：非三元组 → E_SURFACE_BAD_POINT', async () => {
    await useOcct()
    const result = await exec('brep', 'let part0 = cad.surface({ points: [[0,0,0],[1,0,0],[0,1,0],[1,1]], rows: 2, cols: 2 })\n')
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SURFACE_BAD_POINT/)
  })
})

/**
 * L1 覆盖率门禁：`api/index.ts` 导出的 `surface` 必须在 test/ 中被**直接引用**
 * （op 模块直连，先例 test/api/brep-operations/brep-operations-g5.test.ts）。
 * 这里做 TS 级直连调用，与脚本级用例（上方）互为交叉印证。
 */
describe('cad.surface — TS 级直连（L1 覆盖）', () => {
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

  it('直连调用产出与脚本级一致的面（bbox = [-5,5]²）', async () => {
    const s = await surface({
      points: [[-5, -5, 0], [5, -5, 0], [-5, 5, 0], [5, 5, 0]],
      rows: 2,
      cols: 2,
    })
    expect(s.indices.length).toBeGreaterThan(0)
    const bbox = getBrepApi().getBoundingBox(brepOf(s) as never)
    expect(bbox.xmin).toBeCloseTo(-5, 6)
    expect(bbox.xmax).toBeCloseTo(5, 6)
    expect(bbox.ymin).toBeCloseTo(-5, 6)
    expect(bbox.ymax).toBeCloseTo(5, 6)
  })

  it('入参校验在直连路径同样生效：点数为 rows*cols', async () => {
    await expect(surface({ points: [[0, 0, 0]], rows: 2, cols: 2 })).rejects.toThrow(
      /E_SURFACE_POINT_COUNT/,
    )
  })

  it('STEP 往返（方案 §9.3）：导出 STEP → OCCT 回读 → bbox 一致（精确 BREP，非 mesh 回填）', async () => {
    const s = await surface({
      points: [[-5, -5, 0], [5, -5, 0], [-5, 5, 0], [5, 5, 0]],
      rows: 2,
      cols: 2,
    })
    const kernel = getBrepApi()
    const handle = brepOf(s) as never
    const step = kernel.exportStep(handle)
    expect(typeof step).toBe('string')
    expect(step).toMatch(/ISO-10303/)
    const back = kernel.importStep(step)
    const bbox = kernel.getBoundingBox(back)
    expect(bbox.xmin).toBeCloseTo(-5, 6)
    expect(bbox.xmax).toBeCloseTo(5, 6)
    expect(bbox.ymin).toBeCloseTo(-5, 6)
    expect(bbox.ymax).toBeCloseTo(5, 6)
  })
})
