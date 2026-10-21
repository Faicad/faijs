/**
 * 回归测试：面上草图 + 双向拉伸（backwardLength）后布尔，part0（box）掉 BREP 链。
 *
 * 用户 bug（2026-10-20）：weapp 画面上草图（roundedRect）→ 双向拉伸 →
 * 自动布尔（union/subtract）→ canvas 不可见。真 worker bundle 复现为：
 *   [api/boolean] union/subtract: input is not on the BREP chain (no OCCT handle)
 *   — non-solid geometry cannot take part in a boolean. offenders: part0
 *
 * 即 box 产物在双向拉伸语句之后丢失 OCCT handle 槽。本文件在 node + OCCT 引擎
 * 上直接复现（与 worker bundle 同一 faijs 源码），用于定位与回归。
 *
 * 运行：npx vitest run packages/core/test/brep/extrude-backward-boolean-regression.test.ts
 */

// ── OCCT stdout 噪声过滤（与 brep-mesh-equivalence.test.ts 一致） ──
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { createNodePorts } from '../../src/node-host'
import { asPartName } from '../../src/identity'
import { createEditorRuntime } from '../support/editor-ops'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

const USER_SCENE = (boolOp: 'union' | 'subtract'): string => `let part0 = cad.box(10, 20, 30)
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })
let part1 = cad.extrude(sk0, { length:10, backwardLength:4, normal:[1,0,0] })
let part2 = cad.${boolOp}(part0, part1)`

/** 对照：单向拉伸（backwardLength=0）后布尔应正常。 */
const SINGLE_SCENE = (boolOp: 'union' | 'subtract'): string => `let part0 = cad.box(10, 20, 30)
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })
let part1 = cad.extrude(sk0, { length:4, normal:[1,0,0] })
let part2 = cad.${boolOp}(part0, part1)`

describe('regression: 双向拉伸后布尔 part0 掉 BREP 链', () => {
  it('brep 模式：用户场景 union（双向拉伸）', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const result = await runtime.execute(USER_SCENE('union'))
    expect(result.failedAt ?? null).toBeNull()
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })

  it('brep 模式：用户场景 subtract（双向拉伸）', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const result = await runtime.execute(USER_SCENE('subtract'))
    expect(result.failedAt ?? null).toBeNull()
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })

  it('对照：单向拉伸 + union 正常', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const result = await runtime.execute(SINGLE_SCENE('union'))
    expect(result.failedAt ?? null).toBeNull()
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })
})
