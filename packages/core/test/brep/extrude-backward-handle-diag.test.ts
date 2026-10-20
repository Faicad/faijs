/**
 * 诊断：brepkit 引擎下，双向拉伸语句之后 part0（box）的 BREP handle 是否丢失。
 *
 * 复现（extrude-backward-boolean-brepkit-regression.test.ts）：union(part0, part1)
 * 报 "input is not on the BREP chain ... offenders: part0"。本文件逐步执行，
 * 检查每一条语句之后 outputs 里 part0 的 handle 状态，定位掉链发生的确切语句。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRuntime } from '../../src/index'
import { createNodePorts } from '../../src/node'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { configureBackends, CONTRACT_VERSION } from '../../src/runtime-state'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'

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

const STEP1 = `let part0 = cad.box(10, 20, 30)`
const STEP2 = `${STEP1}
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })`
const STEP3_BIDIR = `${STEP2}
let part1 = cad.extrude(sk0, { length:10, backwardLength:4, normal:[1,0,0] })`
const STEP3_SINGLE = `${STEP2}
let part1 = cad.extrude(sk0, { length:4, normal:[1,0,0] })`

function describeOut(shape: Shape | undefined, label: string): string {
  if (!shape) return `${label}: <missing>`
  const has = brepOf(shape) !== undefined
  const tri = shape.indices ? Math.floor(shape.indices.length / 3) : -1
  return `${label}: handle=${has} tris=${tri}`
}

describe('诊断：双向拉伸语句后 part0 handle 状态', () => {
  it('语句 1（box）后 part0 有 handle', async () => {
    const runtime = createRuntime(createNodePorts())
    const r = await runtime.execute(STEP1)
    expect(r.failedAt ?? null).toBeNull()
    expect(describeOut(r.outputs.get('part0'), 'part0')).toBe('part0: handle=true tris=12')
  })

  it('语句 2（sketch）后 part0 仍有 handle', async () => {
    const runtime = createRuntime(createNodePorts())
    const r = await runtime.execute(STEP2)
    expect(r.failedAt ?? null).toBeNull()
    expect(describeOut(r.outputs.get('part0'), 'part0')).toBe('part0: handle=true tris=12')
  })

  it('语句 3 单向拉伸后 part0 仍有 handle', async () => {
    const runtime = createRuntime(createNodePorts())
    const r = await runtime.execute(STEP3_SINGLE)
    expect(r.failedAt ?? null).toBeNull()
    expect(describeOut(r.outputs.get('part0'), 'part0')).toBe('part0: handle=true tris=12')
  })

  it('语句 3 双向拉伸后 part0 掉链（复现）', async () => {
    const runtime = createRuntime(createNodePorts())
    const r = await runtime.execute(STEP3_BIDIR)
    expect(r.failedAt ?? null).toBeNull()
    // 双向拉伸后 part0 的 handle 应仍在（box 没被消费）
    expect(describeOut(r.outputs.get('part0'), 'part0')).toBe('part0: handle=true tris=12')
  })
})
