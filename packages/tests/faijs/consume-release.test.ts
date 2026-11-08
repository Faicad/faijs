/**
 * R-C 释放端到端（真实 brep/OCCT 运行时）
 *
 * 验证（`CadRuntime` + `consumeRule` 档位对照，方案 §9.5）：
 * - `error` 档：`cad.subtract(a, b)` 消费 a、b 后，`result.brepChain.solidCache`
 *   里不再有 a/b 的键（宿主 `releasePartCaches` 真被调用），活着的 c 仍在。
 * - `warn` 档（缺省）：只报不释放，a/b 键保留 —— 行为与改前一致，不打死存量脚本。
 *
 * 注：`createRuntime(ports, mode, libs, options)`——options 是第 4 个参数，
 * 传错位置会静默退回缺省档位（本用例就是按这个坑写出来的）。
 *
 * Run: npx vitest run faijs/consume-release.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { CadRuntime } from '@faicad/faijs/cad-runtime/runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** 三段最小脚本：a、b 各自建件，c = a - b（唯一消费点在第 3 行）。 */
const CODE = [
  'let a = cad.box(20, 20, 20)',
  'let b = cad.box(10, 10, 10)',
  'let c = cad.subtract(a, b)',
].join('\n')

/** @param mode - 消费规则档位 @returns 执行结果里的 solidCache 键（升序） */
async function solidCacheKeys(mode: 'warn' | 'error'): Promise<string[]> {
  const rt: CadRuntime = createRuntime(createNodePorts(), undefined, undefined, { consumeRule: mode })
  const res = await rt.execute(CODE)
  expect(res.failedAt).toBeUndefined()
  return [...res.brepChain.solidCache.keys()].map(String).sort()
}

describe('R-C 释放（真实 BREP）', () => {
  it('error 档：被消费的 a/b 句柄当场从 solidCache 消失', async () => {
    expect(await solidCacheKeys('error')).toEqual(['c'])
  }, 300000)

  it('warn 档：不释放，a/b 仍在（缺省行为与改前一致）', async () => {
    expect(await solidCacheKeys('warn')).toEqual(['a', 'b', 'c'])
  }, 300000)
})
