/**
 * runtime-consume-rule — `CadRuntime` 的 `consumeRule` 档位接线（方案 2026-11-08 §9）
 *
 * `consume-rule.test.ts` 只覆盖 `DirectExecutor` + 手工装配的 `ConsumeRuleOptions`，
 * `packages/tests/faijs/consume-release.test.ts` 只覆盖 `createRuntime`（门面路径）。
 * 本文件补 `CadRuntime` 构造选项这一层：档位 → `consumeRuleOpts` → 执行器，
 * 以及 warn 档收进 `ExecutionResult.infos` / error 档冒泡成 `failedAt.code`。
 *
 * 为什么必须有：API 测试覆盖门禁（scripts/check-api-test-coverage.ts 的 L2）要求
 * 构造选项的每个属性都在本包测试的调用点出现。`consumeRule` 是 2026-11-08 新增的
 * 构造选项，缺这条用例时门禁直接判红（CadRuntime: missing [consumeRule]）。
 *
 * Run: npx vitest run test/cad-runtime/runtime-consume-rule.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ConsumeRuleMode } from '../../src/cad-runtime/consume-rule'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/**
 * 四行脚本：a / b 建件，第 3 行 `subtract(a, b)` 消费 a、b（唯一消费点），
 * 第 4 行再读 a → R-B 违规。
 */
const CODE = [
  'let a = cad.box(20, 20, 20)',
  'let b = cad.box(10, 10, 10)',
  'let c = cad.subtract(a, b)',
  'let d = cad.subtract(a, c)',
].join('\n')

/**
 * 按指定档位建一个真实 BREP 运行时。
 *
 * GOTCHA：`consumeRule` 是构造函数第 4 个参数（`options`）；写到第 3 个参数
 * （`libs`）里会被当成第三方库命名空间，档位静默保持缺省 'warn'——用例会假绿。
 *
 * @param consumeRule - 语言级消费规则档位
 * @returns 已注册 cad 命名空间的运行时
 */
function makeRuntime(consumeRule: ConsumeRuleMode): CadRuntime {
  return new CadRuntime(
    { events: { emit() {} } },
    'brep',
    { cad: createApiNamespaceWithEditorOps() },
    { consumeRule },
  )
}

/** @param consumeRule - 档位 @returns 四行脚本的执行结果 */
async function run(consumeRule: ConsumeRuleMode): Promise<ExecutionResult> {
  return makeRuntime(consumeRule).execute(CODE)
}

describe('CadRuntime + consumeRule 档位接线', () => {
  // GOTCHA（2026-11-11）：error 档走的是**抛 ParseError**，不是 `failedAt`。
  // `DirectExecutor.precheckConsume` 在语句执行前的预检里 throw，`CadRuntime.execute`
  // 不把它折成 `ExecutionResult.failedAt`（那条路只接执行期失败）。宿主必须自己 try/catch。
  // 断言文案而不是错误码：describeViolation 的 message 里没有 'E_USE_AFTER_CONSUME'
  // 字面量（错误码只在文档/PMI 语境使用），按 message 断言才不脆。
  it('error 档：消费后再引用 → 抛 ParseError（第 4 行）', async () => {
    await expect(run('error')).rejects.toThrow(/was already consumed at line 3/)
  }, 180000)

  it('warn 档（缺省）：执行不中断，违规进 infos', async () => {
    const res = await run('warn')
    expect(res.failedAt).toBeUndefined()
    expect(res.infos.join('\n')).toContain('was already consumed at line 3')
    // 四行全部执行完：d 也在 outputs 里（warn 不释放、不阻断）。
    expect(res.outputs.has('d' as never)).toBe(true)
  }, 180000)

  it('off 档：完全不检查（无违规、不中断），行为与改前一致', async () => {
    const res = await run('off')
    expect(res.failedAt).toBeUndefined()
    expect(res.infos.join('\n')).not.toContain('was already consumed')
    expect(res.outputs.has('d' as never)).toBe(true)
  }, 180000)
})
