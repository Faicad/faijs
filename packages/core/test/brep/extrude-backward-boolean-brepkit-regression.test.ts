/**
 * 回归测试：面上草图 + 双向拉伸（backwardLength）后布尔，part0（box）掉 BREP 链。
 *
 * 用户 bug（2026-10-20）：weapp 画面上草图（roundedRect）→ 双向拉伸 →
 * 自动布尔（union/subtract）→ canvas 不可见。端侧 worker 装配 brepkit 引擎，
 * 真 worker bundle 复现为：
 *   [api/boolean] union/subtract: input is not on the BREP chain (no OCCT handle)
 *   — non-solid geometry cannot take part in a boolean. offenders: part0
 *
 * 即 box 产物在双向拉伸语句之后丢失 BREP handle 槽。OCCT 引擎下不复现
 * （extrude-backward-boolean-regression.test.ts 的 occt 版验证通过），
 * 本文件用 brepkit 引擎复现（与端侧 worker 一致），用于定位与回归。
 *
 * 运行：npx vitest run packages/core/test/brep/extrude-backward-boolean-brepkit-regression.test.ts
 */

// ── brepkit stdout 噪声过滤 ──
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  if (msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRuntime } from '../../src/index'
import { asPartName } from '../../src/identity'
import { createNodePorts } from '../../src/node'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { configureBackends, CONTRACT_VERSION } from '../../src/runtime-state'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'brepkit' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Parameters<typeof configureBackends>[0])
}, 120000)

afterAll(() => {
  disposeBrepkit()
})

const USER_SCENE = (boolOp: 'union' | 'subtract'): string => `let part0 = cad.box(10, 20, 30)
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })
let part1 = cad.extrude(sk0, { length:10, backwardLength:4, normal:[1,0,0] })
let part2 = cad.${boolOp}(part0, part1)`

/** 对照：单向拉伸（backwardLength 缺省）后布尔应正常。 */
const SINGLE_SCENE = (boolOp: 'union' | 'subtract'): string => `let part0 = cad.box(10, 20, 30)
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })
let part1 = cad.extrude(sk0, { length:4, normal:[1,0,0] })
let part2 = cad.${boolOp}(part0, part1)`

/** 对照：双向拉伸但布尔输入换成新 box（检验是否只 part0 掉链）。 */
const FRESH_BOX_SCENE = (boolOp: 'union' | 'subtract'): string => `let part0 = cad.box(10, 20, 30)
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })
let part1 = cad.extrude(sk0, { length:10, backwardLength:4, normal:[1,0,0] })
let box3 = cad.box(1, 1, 1, { at: [5, 5, 5] })
let part2 = cad.${boolOp}(part0, box3)`

describe('regression: brepkit 双向拉伸后布尔 part0 掉 BREP 链', () => {
  it('用户场景 union（双向拉伸）', async () => {
    const runtime = createRuntime(createNodePorts())
    const result = await runtime.execute(USER_SCENE('union'))
    expect(result.failedAt ?? null).toBeNull()
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })

  it('用户场景 subtract（双向拉伸）', async () => {
    const runtime = createRuntime(createNodePorts())
    const result = await runtime.execute(USER_SCENE('subtract'))
    expect(result.failedAt ?? null).toBeNull()
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })

  it('对照：单向拉伸 + union 正常', async () => {
    const runtime = createRuntime(createNodePorts())
    const result = await runtime.execute(SINGLE_SCENE('union'))
    expect(result.failedAt ?? null).toBeNull()
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })

  it('对照：双向拉伸后对新 box 布尔（part0 是否独立掉链）', async () => {
    const runtime = createRuntime(createNodePorts())
    const result = await runtime.execute(FRESH_BOX_SCENE('union'))
    expect(result.failedAt ?? null).toBeNull()
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })
})
