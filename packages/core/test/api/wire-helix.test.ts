/**
 * @vitest-environment node
 *
 * wire / helix — Phase 3 造线能力（G-D 门控层）验收
 *
 * 覆盖：
 * 1. wire 可达 + kind='curve'（1D 产物，无三角载荷）；
 * 2. wire 的 kind 不随 mode 漂移（brep=curve / mesh=curve）——§7.1 建议 1 附带子项②；
 * 3. 1D 产物喂给 extrude（面 op）→ 执行前报错（不许运行时报错）；
 * 4. helix 可达（occt 原生 makeHelixWire）+ kind='curve'；
 * 5. helix 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 * 6. helix 在 brep_mock 下不被引擎判定拦截（D11-3 豁免）；
 * 7. sketch as:'wire' 交出 1D 曲线形态。
 *
 * Run: npx vitest run src/api/wire-helix.test.ts
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
import { brepOf } from '../../src/shape'
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

const WIRE_CODE =
  'let part0 = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,0]], { closed: true })\n'
const HELIX_CODE = 'let part0 = cad.helix({ radius: 5, pitch: 2, turns: 3 })\n'

describe('wire — 1D 造线（中立 dual op）', () => {
  it('brep 模式：可达，产出 kind="curve"（无三角载荷）', async () => {
    await useOcct()
    const s = await shapeOf('brep', WIRE_CODE, 'part0')
    expect(kindOf(s)).toBe('curve')
    // 1D 载荷为空（wire 实测 0/0，不抛错）
    expect(s.indices.length).toBe(0)
  })

  it('kind 不随 mode 漂移：brep=curve 且 mesh=curve（§7.1 附带子项②推荐 (i)）', async () => {
    await useOcct()
    const brepShape = await shapeOf('brep', WIRE_CODE, 'part0')
    const meshShape = await shapeOf('mesh', WIRE_CODE, 'part0')
    expect(kindOf(brepShape)).toBe('curve')
    expect(kindOf(meshShape)).toBe('curve')
    // mesh 路径载荷必须是真实点（闭合 4 点 + 首点回环 = 5 点 × 3 = 15），
    // 防回归：wireMesh 曾按元组索引 {x,y,z} 取点 → 载荷全 NaN。
    expect(meshShape.positions.length).toBe(15)
    for (const v of meshShape.positions) expect(Number.isFinite(v)).toBe(true)
  })

  it('点列少于 2 点 → E_WIRE_TOO_FEW_POINTS', async () => {
    await useOcct()
    const result = await exec('brep', 'let part0 = cad.wire([[0,0,0]])\n')
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_WIRE_TOO_FEW_POINTS/)
  })

  it('显示口径：1D 产物可经 L1 wireframe 取点列（§7.1 附带子项③）', async () => {
    await useOcct()
    const s = await shapeOf('brep', WIRE_CODE, 'part0')
    const handle = brepOf(s)
    expect(handle).toBeDefined()
    const frame = getBrepApi().wireframe(handle as never)
    expect(frame.edgeCount).toBeGreaterThan(0)
    expect(frame.pointCount).toBeGreaterThan(0)
    for (const v of frame.points) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('Phase 3 验收：1D 产物作终结产物（导出链路单独确认）', () => {
  it('wire 进入 brepSolids 为终结产物；STEP 走 brep（occt 能写 wire）', async () => {
    await useOcct()
    const result = await exec('brep', WIRE_CODE)
    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids).toBeDefined()
    const entry = result.brepSolids!.get(asPartName('part0'))
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(typeof step).toBe('string')
    expect(step.length).toBeGreaterThan(0)
  })
})

describe('Phase 3 验收：1D 产物喂给面 op 必须执行前报错', () => {
  it('wire → extrude（面 op）→ 执行前明确报错（非运行时报错）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      WIRE_CODE + 'let part1 = cad.extrude(part0, [0, 0, 10])\n',
    )
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('extrude')
    // 执行前（预检）失败：明确的维度不符错误，而非内核深层「操作失败」
    expect(JSON.stringify(result.failedAt)).toMatch(/E_EXTRUDE_NEEDS_FACE/)
    expect(JSON.stringify(result.failedAt)).not.toMatch(/EXTRUDE_FAILED/)
  })
})

describe('helix — 螺旋线（平台 op engines:["occt"]）', () => {
  it('occt 引擎：可达，产出 kind="curve"', async () => {
    await useOcct()
    const s = await shapeOf('brep', HELIX_CODE, 'part0')
    expect(kindOf(s)).toBe('curve')
  })

  it('几何语义钉死（Phase 0 makeHelixWire 探针留档）：radius/pitch/turns → bbox', async () => {
    await useOcct()
    const s = await shapeOf('brep', HELIX_CODE, 'part0')
    const bbox = getBrepApi().getBoundingBox(brepOf(s) as never)
    // radius=5 → XY 撑满 ±5
    expect(bbox.xmin).toBeLessThanOrEqual(-4.9)
    expect(bbox.xmax).toBeGreaterThanOrEqual(4.9)
    expect(bbox.ymin).toBeLessThanOrEqual(-4.9)
    expect(bbox.ymax).toBeGreaterThanOrEqual(4.9)
    // pitch=2 × turns=3 → 高 6，自原点沿 +Z 起（z ∈ [0, 6]）
    expect(Math.abs(bbox.zmin)).toBeLessThanOrEqual(0.1)
    expect(bbox.zmax).toBeGreaterThanOrEqual(5.9)
    expect(bbox.zmax).toBeLessThanOrEqual(6.1)
  })

  it('brepkit 引擎：非目标引擎执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await exec('brep', HELIX_CODE)
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/helix/)
    expect(msg).toMatch(/op requires engine occt/)
    expect(msg).toMatch(/brepkit/)
  })

  it('brep_mock 引擎：不被平台身份判定拦截（D11-3 豁免）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepMockEngine()
    const result = await exec('brep', HELIX_CODE)
    // 豁免语义 = 报错形态必不是"引擎不匹配"（与 brepkit 用例对照）。
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })
})

describe('sketch as:"wire" — 2D 轮廓直接交出 1D 形态', () => {
  it('sketch({ as:"wire" }) 产出 kind="curve"（供扫掠族作 spine）', async () => {
    await useOcct()
    const code =
      'let part0 = cad.profile({ ' +
      'contours: [{ segments: [ ' +
      '{ kind: "line", x1: 0, y1: 0, x2: 10, y2: 0 }, ' +
      '{ kind: "line", x1: 10, y1: 0, x2: 10, y2: 10 }, ' +
      '{ kind: "line", x1: 10, y1: 10, x2: 0, y2: 10 }, ' +
      '{ kind: "line", x1: 0, y1: 10, x2: 0, y2: 0 } ] }], as: "wire" })\n'
    const s = await shapeOf('brep', code, 'part0')
    expect(kindOf(s)).toBe('curve')
  })
})
