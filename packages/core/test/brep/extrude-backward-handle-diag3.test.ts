/**
 * 诊断 v3：brepkit 引擎下，执行用户完整场景（union 失败）后，
 * ctx.part0 / ctx.part1 的 handle 状态 —— 定位失败发生在 booleanBrep 内部
 * brepOf 读取之前还是之后，part0 的 handle 何时消失。
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

const USER_UNION = `let part0 = cad.box(10, 20, 30)
let sk0 = cad.sketch({ shapes:[{kind:'roundedRect', cx:0.5, cy:-1, w:9, d:10, r:2.25}], constraints:[], plane:{origin:[10,10,15], normal:[1,0,0], xAxis:[0,1,0]} })
let part1 = cad.extrude(sk0, { length:10, backwardLength:4, normal:[1,0,0] })
let part2 = cad.union(part0, part1)`

function h(s: unknown): string {
  if (!s || typeof s !== 'object') return String(s)
  const sh = s as Shape
  const tri = sh.indices ? Math.floor(sh.indices.length / 3) : -1
  return `handle=${brepOf(sh) !== undefined} tris=${tri}`
}

describe('诊断 v3：union 失败后 ctx 状态', () => {
  it('union 失败后 ctx.part0 handle 状态', async () => {
    const runtime = createRuntime(createNodePorts()) as unknown as {
      execute(code: string): Promise<{ failedAt?: unknown; outputs: Map<string, Shape> }>
      directExecutor?: { getCtxVar(name: string): unknown; listCtxKeys(): string[] }
    }
    const r = await runtime.execute(USER_UNION)
    const de = runtime.directExecutor!
    console.log(`[diag3] failedAt=${JSON.stringify(r.failedAt ?? null)}`)
    for (const k of de.listCtxKeys()) {
      console.log(`[diag3] ctx.${k} = ${h(de.getCtxVar(k))}`)
    }
    console.log(`[diag3] outputs keys = ${[...r.outputs.keys()].join(',')}`)
    expect(true).toBe(true)
  })
})
