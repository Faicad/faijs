/**
 * 诊断 v2：brepkit 引擎下，双向拉伸语句后 ctx.part0 与 outputs.part0 是否同一对象、
 * 各自 handle 状态。
 *
 * v1（extrude-backward-handle-diag.test.ts）证明 outputs.get('part0') 的 handle 在；
 * 但 union 语句读的是 **ctx** 里的 part0（direct-executor 的持久变量表）——
 * 若 ctx.part0 被 extrude 语句重绑定成无 handle 的对象，布尔即报 offenders: part0。
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

const STEP3_BIDIR = `let part0 = cad.box(10, 20, 30)
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })
let part1 = cad.extrude(sk0, { length:10, backwardLength:4, normal:[1,0,0] })`
const STEP3_SINGLE = `let part0 = cad.box(10, 20, 30)
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })
let part1 = cad.extrude(sk0, { length:4, normal:[1,0,0] })`

function h(s: Shape | undefined): string {
  if (!s) return 'missing'
  const tri = s.indices ? Math.floor(s.indices.length / 3) : -1
  return `handle=${brepOf(s) !== undefined} tris=${tri}`
}

describe('诊断 v2：ctx vs outputs 的 part0', () => {
  it('双向拉伸后 ctx.part0 与 outputs.part0 同对象且都有 handle', async () => {
    const runtime = createRuntime(createNodePorts()) as unknown as {
      execute(code: string): Promise<{ outputs: Map<string, Shape> }>
      directExecutor?: { getCtxVar(name: string): unknown }
    }
    const r = await runtime.execute(STEP3_BIDIR)
    const out0 = r.outputs.get('part0')
    const ctx0 = (runtime as unknown as { directExecutor?: { getCtxVar(name: string): unknown } }).directExecutor?.getCtxVar('part0')
    const same = (ctx0 as object) === (out0 as object)
    console.log(`[diag] 双向: same=${same} ctx.part0=${h(ctx0 as Shape)} outputs.part0=${h(out0)} ctx.sk0=${h((runtime.directExecutor!.getCtxVar('sk0')) as Shape)} ctx.part1=${h((runtime.directExecutor!.getCtxVar('part1')) as Shape)}`)
    expect(same).toBe(true)
    expect(brepOf(out0)).not.toBeUndefined()
  })

  it('单向拉伸后 ctx.part0 与 outputs.part0 同对象且都有 handle', async () => {
    const runtime = createRuntime(createNodePorts()) as unknown as {
      execute(code: string): Promise<{ outputs: Map<string, Shape> }>
      directExecutor?: { getCtxVar(name: string): unknown }
    }
    const r = await runtime.execute(STEP3_SINGLE)
    const out0 = r.outputs.get('part0')
    const ctx0 = (runtime as unknown as { directExecutor?: { getCtxVar(name: string): unknown } }).directExecutor?.getCtxVar('part0')
    const same = (ctx0 as object) === (out0 as object)
    console.log(`[diag] 单向: same=${same} ctx.part0=${h(ctx0 as Shape)} outputs.part0=${h(out0)}`)
    expect(same).toBe(true)
    expect(brepOf(out0)).not.toBeUndefined()
  })
})
