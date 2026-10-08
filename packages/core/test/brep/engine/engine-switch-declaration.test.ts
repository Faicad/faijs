/**
 * @vitest-environment node
 *
 * engines 单轴声明（D11）——2026-10-08 删除 capabilities 双轴
 *
 * 现行为：`defineOp` 只有**一条**收窄轴 —— `engines`，即引擎身份白名单。
 * 判定次序（`cad-runtime/backend-dispatch.ts` 的 `decidePath`）：
 *   mode='mesh' 先行（D11-6）→ 引擎身份（D11-2）→ chain（BREP/mesh）。
 * `brep_mock` 受 D11-3 豁免（由 engine-switch-p5 钉住）。
 *
 * GOTCHA-1（实测，报错文案）：引擎门文案是
 *   `E_BREP_UNSUPPORTED: op '<name>' requires engine occt (current=<engine>)`
 * 断言用 `/requires engine occt/`，不要用「能力门」时代的 `/lacks capability/`。
 *
 * GOTCHA-2（实测，本用例的输入选择）：本文件测的是**门控次序**，不是几何 ——
 * 门在执行实现之前触发，故实现体写成「一旦被调用就打点」，用**未打点**反证门确实拦在
 * 执行之前（正面证据 + 反面证据）。
 *
 * GOTCHA-3（2026-10-08，声明轴的删除）：`capabilities` 已从 `DualOpOptions` /
 * `DUAL_OP_META` 移除。本文件额外钉住「meta 字段集不含 capabilities」这一形态，
 * 防止该轴被悄悄重新引入（字段集与 defineOp product 相等的完整断言见
 * `test/api/internal/compat-op.test.ts` 的 single-entry 用例）。
 *
 * Run: npx vitest run src/brep/engine/engine-switch-declaration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../../src/cad-runtime/ports'
import type { Shape } from '../../../src/mesh/types'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { defineOp, assertLibConforms, dualOpMetaOf } from '../../../src/define-op'
import { CONTRACT_VERSION } from '../../../src/runtime-state'
import { solid } from '../../../src/shape'
import { __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import { registerBrepMockEngine } from '../../../src/brep/engine/adapters/brep-mock'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'

/** 极小 mesh 立方体——探针实现产物（本文件不验几何）。 */
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

/** 门放行后实现体确实被调用的正面证据（见文件头 GOTCHA-2）。 */
let implRuns = 0

/**
 * 单轴声明探针：`engines: ['occt']`。
 *
 * 在 brepkit 上：引擎门在实现之前拦住 ⇒ `implRuns` 不增。
 * 在 occt 上：引擎门放行 ⇒ `implRuns` +1。
 * 在 brep_mock 上：D11-3 豁免 ⇒ 门不参与，`implRuns` +1（由能力声明轴删除后的
 * 「替身不被任何门拦」钉住）。
 */
const PROBE_ENGINE_GATED = defineOp({
  name: 'probeEngineGated',
  brep: () => {
    implRuns += 1
    return solid(cubeMesh(10))
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'engine-identity declaration probe' },
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 把探针挂进 cad 命名空间（宿主装配面的等价做法：命名空间即普通对象）。 */
function makeRuntime(mode: ExecutionMode): CadRuntime {
  const cad = createApiNamespaceWithEditorOps()
  const withProbe = { ...cad, probeEngineGated: PROBE_ENGINE_GATED } as typeof cad
  return new CadRuntime(ports(), mode, { cad: withProbe })
}

const SCRIPT = 'let part1 = cad.probeEngineGated()\n'

describe('声明轴形态：capabilities 已删除，engines 是唯一收窄轴', () => {
  it('DUAL_OP_META 不含 capabilities 字段（防该轴被重新引入）', () => {
    const meta = dualOpMetaOf(PROBE_ENGINE_GATED)
    expect(meta).toBeDefined()
    expect(Object.keys(meta as object)).not.toContain('capabilities')
    expect(meta!.engines).toEqual(['occt'])
  })

  it('assertLibConforms 接受带 engines 的平台 op（反证控制：缺 contractVersion 必须抛）', () => {
    // 反证控制：同一个 lib 去掉 contractVersion 必须抛错 —— 证明该 op 确实被
    // assertLibConforms 走到了（否则下面的 not.toThrow 可能是"压根没校验"的空洞通过）。
    expect(() => assertLibConforms({ probeEngineGated: PROBE_ENGINE_GATED })).toThrow(/contractVersion/)
    expect(() =>
      assertLibConforms({ probeEngineGated: PROBE_ENGINE_GATED, contractVersion: CONTRACT_VERSION }),
    ).not.toThrow()
  })
})

describe('引擎门（D11-2/D11-4）：非白名单真引擎 brepkit', () => {
  it('brep 模式：报「requires engine occt」，且实现体未执行', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    implRuns = 0

    const result: ExecutionResult = await makeRuntime('brep').execute(SCRIPT)
    expect(result.failedAt).toBeDefined()
    const msg = `${result.failedAt!.callee}:${result.failedAt!.message}`
    expect(msg).toMatch(/requires engine occt/)
    // 反面证据：能力门文案已随声明轴删除，不可能出现；实现体未被执行。
    expect(msg).not.toMatch(/lacks capability/)
    expect(implRuns).toBe(0)
  })
})

describe('D11-3 豁免：brep_mock 替身不受引擎门拦截', () => {
  it('brep 模式：门不参与，实现体被调用', async () => {
    __resetEngineRegistriesForTests()
    registerBrepMockEngine()
    implRuns = 0

    const result: ExecutionResult = await makeRuntime('brep').execute(SCRIPT)
    const msg = `${result.failedAt?.callee ?? ''}:${result.failedAt?.message ?? ''}`
    expect(msg).not.toMatch(/requires engine/)
    expect(implRuns).toBe(1)
  })
})

describe('引擎门放行：目标引擎 occt', () => {
  it('brep 模式：门放行，实现体被调用', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    implRuns = 0

    const result: ExecutionResult = await makeRuntime('brep').execute(SCRIPT)
    expect(result.failedAt).toBeUndefined()
    expect(implRuns).toBe(1)
  })
})

beforeAll(async () => {
  await initOcctWasm()
}, 120000)
