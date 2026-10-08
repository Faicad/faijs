/**
 * 引擎路由（静态门）端到端测试（D11）
 *
 * 红线（AGENTS.md）：BREP 链能否走由静态规则在**执行前**判定，禁止运行时 try-catch
 * 回退。本文件是这条红线的**端到端**形态（真引擎注册 + 真 runtime + 真脚本）；档位层
 * 形态见 `test/api/internal/compat-op.test.ts`，两门次序见
 * `test/brep/engine/engine-switch-declaration.test.ts`。
 *
 * 规则（现行为）：
 * - `engines` = 引擎身份白名单，判定置于最前（D11-2）。
 *   非白名单引擎上：brep 模式 → 执行前 BrepUnsupportedError（不静默回退）；
 *   auto 模式 → 静态降级走 mesh；brep-only 且无 mesh 实现 → MeshUnsupportedError。
 * - 测试替身 `brep_mock` 受 D11-3 豁免（平台门不拦）——反面断言：替身上不会出现
 *   `requires engine` 文案。
 * - 中立 op（无 `engines`）在两个引擎上都不被平台门拦截。
 *
 * 2026-10-08 改写说明：`capabilities` 声明轴已删除。本文件原按「能力路由」写
 * （memory 引擎的 evolution 为空 ⇒ union 被拦）。现按**唯一的收窄轴** `engines` 重述，
 * 语义等价：「声明的平台身份不被当前引擎满足 ⇒ 执行前拒绝 / 静态降级」。union 现已
 * 是中立 op（原声明的 `fuseWithHistory` brepkit 原生具备），故不再充当被拦样本——
 * 被拦样本改用显式 `engines:['occt']` 的探针 op。
 *
 * Run: npx vitest run src/brep/engine/capability-routing.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../../src/cad-runtime/ports'
import type { Shape } from '../../../src/mesh/types'
import type { Provenance } from '../../../src/topology/naming/lineage'
import { defineOp } from '../../../src/define-op'
import { solid, isShape } from '../../../src/shape'
import { asPartName } from '../../../src/identity'
import { __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerBrepMockEngine } from '../../../src/brep/engine/adapters/brep-mock'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'

/** 极小 mesh 立方体（positions/indices）——探针实现的产物。 */
function cubeMesh(size: number): Shape {
  const s = size / 2
  return {
    positions: new Float32Array([
      -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
      -s, -s, s, s, -s, s, s, s, s, -s, s, s,
    ]),
    indices: new Uint32Array([
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
    ]),
  }
}

/** 哪个实现被调用过（正面证据：门放行后确实落到预期的那条轨）。 */
const ran = { mesh: false, brep: false }

const TEST_NAMING: Provenance = { kind: 'unmodeled', reason: 'engine-gate probe' }

/**
 * 平台 op 探针：`engines: ['occt']`，mesh/brep 双实现都返回 mesh 立方体并打点。
 *
 * 为什么不需要真几何：被测的是**门**（执行前静态判定），不是几何。两个实现都成功返回，
 * 于是「谁被调用」可由 `ran` 直接读出；失败时 `failedAt` 由门抛出。
 */
const PROBE_OCT_ONLY = defineOp({
  name: 'probeOcctOnly',
  mesh: () => {
    ran.mesh = true
    return solid(cubeMesh(10))
  },
  brep: () => {
    ran.brep = true
    return solid(cubeMesh(10))
  },
  engines: ['occt'],
  naming: TEST_NAMING,
})

/** 中立 op 探针（无 engines）——证明「无平台身份声明 ⇒ 平台门不参与」。 */
const PROBE_NEUTRAL = defineOp({
  name: 'probeNeutral',
  brep: () => {
    ran.brep = true
    return solid(cubeMesh(10))
  },
  naming: TEST_NAMING,
})

function ports(): HostPorts {
  return { events: { emit: () => undefined } } as HostPorts
}

function makeRuntime(mode: ExecutionMode): CadRuntime {
  const cad = createApiNamespaceWithEditorOps()
  const withProbes = {
    ...cad,
    probeOcctOnly: PROBE_OCT_ONLY,
    probeNeutral: PROBE_NEUTRAL,
  } as typeof cad
  return new CadRuntime(ports(), mode, { cad: withProbes })
}

async function run(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return makeRuntime(mode).execute(code)
}

const INPUT = 'let part0 = cad.box(10, 10, 10, { centered: true })\n'
const PLATFORM_CALL = "let part1 = cad.probeOcctOnly(part0)\n"
const NEUTRAL_CALL = "let part1 = cad.probeNeutral(part0)\n"

beforeEach(() => {
  ran.mesh = false
  ran.brep = false
})

describe('D11-3 豁免 + 中立 op：brep_mock 替身', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
    registerBrepMockEngine()
  })

  it('平台 op 在替身上被豁免（无 requires engine 文案），实现体被调用', async () => {
    const result = await run('brep', INPUT + PLATFORM_CALL)
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine/)
    // 反面证据：能力门文案已随声明轴删除，不可能再出现。
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/lacks capability/)
    expect(ran.brep).toBe(true)
  })

  it('中立 op 在替身上不被平台门拦截', async () => {
    const result = await run('brep', INPUT + NEUTRAL_CALL)
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine/)
    expect(ran.brep).toBe(true)
  })
})

// GOTCHA: brepkit-wasm 是可选运行时注入（非声明依赖）——未安装时套件整体 skip 而非 FAIL
// （条件须在收集期同步求值，不能依赖 beforeAll 的异步结果）。
const require = createRequire(import.meta.url)
let brepkitAvailable: boolean
try {
  require.resolve('brepkit-wasm')
  brepkitAvailable = true
} catch {
  brepkitAvailable = false
}

describe.skipIf(!brepkitAvailable)('引擎门（D11-2/D11-4/D11-5）：非白名单真引擎 brepkit', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('brep 模式：平台 op 执行前 BrepUnsupportedError，实现体未执行（不静默回退）', async () => {
    const { registerBrepkitBrepEngine } = await import('../../../src/brep/engine/adapters/brepkit')
    await registerBrepkitBrepEngine()
    const result = await run('brep', INPUT + PLATFORM_CALL)
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('probeOcctOnly')
    expect(result.failedAt!.message).toMatch(/op 'probeOcctOnly' requires engine occt/)
    // 正面：门拦在执行之前 ⇒ 两个实现都没跑。
    expect(ran.brep).toBe(false)
    expect(ran.mesh).toBe(false)
  })

  it('auto 模式：平台 op 静态降级走 mesh（绝不伪造平台身份），mesh 实现被调用', async () => {
    const { registerBrepkitBrepEngine } = await import('../../../src/brep/engine/adapters/brepkit')
    await registerBrepkitBrepEngine()
    const result = await run('auto', INPUT + PLATFORM_CALL)
    expect(result.failedAt).toBeUndefined()
    expect(ran.mesh).toBe(true)
    expect(ran.brep).toBe(false)
  })

  it('中立 op 在 brepkit 上不被平台门拦截（无 engines ⇒ 门不参与）', async () => {
    const { registerBrepkitBrepEngine } = await import('../../../src/brep/engine/adapters/brepkit')
    await registerBrepkitBrepEngine()
    const result = await run('brep', INPUT + NEUTRAL_CALL)
    expect(result.failedAt).toBeUndefined()
    expect(ran.brep).toBe(true)
    expect(isShape(result.outputs.get(asPartName('part1')) as Shape)).toBe(true)
  })
})
