/**
 * @vitest-environment node
 *
 * engines × capabilities 双轴声明（2026-09-24 撤销 D11-7 互斥）
 *
 * 规则（现行为）：
 *   `defineOp` 的 `engines` 与 `capabilities` 是**两条正交的声明轴**，可以并存：
 *     - `engines`    = 引擎身份**白名单**（本实现只在列出的引擎上能跑）；
 *     - `capabilities` = 实现所需的**内核能力清单**（要用哪些方法）。
 *   判定次序 `engines` 在先（dispatchPath，D11-2），能力门随后对**同一引擎**继续求交。
 *   故「同时声明」的语义 = 「只在这些引擎上，且要求这些能力」。
 *
 * 为什么撤销：原 D11-7 的理由是「平台能力由平台自己保证，能力名空间只收 L1 中立名」，
 * 与事实不符 —— `BrepCapabilityName` 含 `BrepMethodKind` **逐核真名**
 * （isNull / dispose / chamfer / shell / ...，见 `brep/engine/types.ts`），本就是内核名
 * 空间；平台 op 声明能力名并不越界。互斥只导致作者被迫丢信息（如 `arg-spec.ts` 的
 * `fuse` 只剩 engines，其真实依赖 isNull/dispose 的声明被移除），以及
 * 「能力声明全覆盖」的测试只能写成两个集合相加的绕行口径。
 *
 * GOTCHA-1（实测，报错文案）：引擎门与能力门的文案不同前缀 ——
 *   引擎门：`E_BREP_UNSUPPORTED: op '<name>' requires engine occt (current=<engine>)`
 *   能力门：`E_BREP_UNSUPPORTED: current engine lacks capability '<cap>' (brepEngineId=<engine>)`
 *   断言必须区分，否则会把「引擎门生效」误判成「能力门生效」。
 *
 * GOTCHA-2（实测，本用例的输入选择）：本文件测的是**门控次序**，不是几何 ——
 * 两道门都在执行实现之前触发，故实现体写成「一旦被调用就抛 sentinel」，用
 * `IMPL-MUST-NOT-RUN` 的出现与否**反证**门确实拦在执行之前（正面证据 + 反面证据）。
 *
 * Run: npx vitest run src/brep/engine/engine-switch-declaration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../cad-runtime/runtime'
import type { ExecutionResult } from '../../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../cad-runtime/ports'
import { initOcctWasm } from '../../occt-kernel/occtKernel'
import { defineOp, assertLibConforms } from '../../define-op'
import { CONTRACT_VERSION } from '../../runtime-state'
import { __resetEngineRegistriesForTests } from './registry'
import { registerOcctBrepEngine } from './adapters/occt'
import { registerBrepkitBrepEngine } from './adapters/brepkit'
import { createApiNamespaceWithEditorOps } from '../../test-support/editor-ops'

/** 门已被拦下的证据：实现体一旦被执行就抛这个（见文件头 GOTCHA-2）。 */
const IMPL_RAN = 'IMPL-MUST-NOT-RUN'

/**
 * 双轴声明探针：`engines: ['occt']` + `capabilities: ['meshLift']`。
 *
 * `meshLift` 是 occt 声明的能力表里**没有**的一项（`adapters/occt.ts` 只给
 * heal/directEdit/advSurface/assembly）⇒ 在 occt 上引擎门通过、能力门必然拦住；
 * 在 brepkit 上引擎门先拦住。两个引擎下实现体都不该被执行。
 */
const PROBE_BOTH_AXES = defineOp({
  name: 'probeBothAxes',
  brep: () => {
    throw new Error(IMPL_RAN)
  },
  engines: ['occt'],
  capabilities: ['meshLift'],
  naming: { kind: 'unmodeled', reason: 'declaration probe for engines × capabilities' },
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 把探针挂进 cad 命名空间（宿主装配面的等价做法：命名空间即普通对象）。 */
function makeRuntime(mode: ExecutionMode): CadRuntime {
  const cad = createApiNamespaceWithEditorOps()
  const withProbe = { ...cad, probeBothAxes: PROBE_BOTH_AXES } as typeof cad
  return new CadRuntime(ports(), mode, { cad: withProbe })
}

const SCRIPT = 'let part0 = cad.probeBothAxes()\n'

describe('engines × capabilities 可以同时声明（2026-09-24 撤销 D11-7 互斥）', () => {
  it('assertLibConforms 不再以「两者同时出现」为由拒绝', () => {
    // 反证控制：同一个 lib 去掉 contractVersion 必须抛错 —— 证明该 op 确实被
    // assertLibConforms 走到了（否则下面的 not.toThrow 可能是"压根没校验"的空洞通过）。
    expect(() => assertLibConforms({ probeBothAxes: PROBE_BOTH_AXES })).toThrow(/contractVersion/)
    // 第三方库通道（registerLib → admitCompatLib → assertLibConforms）：这条曾抛错。
    expect(() =>
      assertLibConforms({ probeBothAxes: PROBE_BOTH_AXES, contractVersion: CONTRACT_VERSION }),
    ).not.toThrow()
  })

  it('engines 门在先：非目标引擎（brepkit）下报「requires engine occt」，且实现体未执行', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()

    const result: ExecutionResult = await makeRuntime('brep').execute(SCRIPT)
    expect(result.failedAt).toBeDefined()
    const msg = `${result.failedAt!.callee}:${result.failedAt!.message}`
    // 正面：引擎门文案
    expect(msg).toMatch(/requires engine occt/)
    // 反面：能力门未参与（能力名不出现在文案里），实现体未被执行
    expect(msg).not.toMatch(/meshLift/)
    expect(msg).not.toMatch(new RegExp(IMPL_RAN))
  })

  it('能力门在引擎匹配后仍然生效：occt 上缺 meshLift → 报「lacks capability」，且实现体未执行', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()

    const result: ExecutionResult = await makeRuntime('brep').execute(SCRIPT)
    expect(result.failedAt).toBeDefined()
    const msg = `${result.failedAt!.callee}:${result.failedAt!.message}`
    // 正面：引擎门已通过（无 requires engine 文案），能力门接住
    expect(msg).not.toMatch(/requires engine/)
    expect(msg).toMatch(/lacks capability 'meshLift'/)
    // 反面：仍然拦在执行之前
    expect(msg).not.toMatch(new RegExp(IMPL_RAN))
  })
})

beforeAll(async () => {
  await initOcctWasm()
}, 120000)
