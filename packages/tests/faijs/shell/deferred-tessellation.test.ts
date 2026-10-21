/**
 * deferred-tessellation.test — 'defer' 模式延迟三角化（方案 2026-10-21-weapp-tessellation-defer-plan §2）
 *
 * 核心收益：BREP op 产出**不**急切三角化；结果收尾只对**终端**物化，中间产物永不
 * 物化（face.fai.js 全量执行 meshShape 次数 ~30 → 13）。
 *
 * 断言矩阵：
 * 1. defer 模式下 `kernel.meshShape` 次数 == 终端数（中间链产物 0 次）——同时验证
 *    拓扑构建命中 meshShapeCache（若走 buildSolidTopologyRuntime 兜底会多调 meshShape）。
 * 2. defer 几何产出与 eager 模式**逐字节一致**（物化参数 == eager 参数）。
 * 3. defer 拓扑与 eager 同源（source:'brep'，面行区间来自同一份 mesh）。
 * 4. topoMode 'off'：隐藏终端不物化；getCachedOutput 按需物化且幂等。
 * 5. topoMode 'brep'：全部 shape（含中间产物）物化（拓扑为全部 shape 构建）。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { registerBrepkitBrepEngine } from '@faicad/faijs/brep/engine/adapters/brepkit'
import { createNodePorts } from '@faicad/faijs/node'
import { createRuntime } from '@faicad/faijs/cad-runtime/runtime'
import { getActiveBrepEngine } from '@faicad/faijs/brep/engine/registry'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { Shape } from '@faicad/faijs/mesh/types'

beforeAll(async () => {
  // 与 weapp 一致：brepkit 是端侧专属 BREP 引擎（cross-kernel 测试同款生产装配）。
  await registerBrepkitBrepEngine()
}, 120000)

/** 链式脚本：head/eye 是 keepHidden 源（被 subtract 消费），result 可见终端。 */
const CHAIN_CODE = `let head = cad.sphere({ radius: 10 * MM, segments: 64 })
head = cad.scale3d(head, { factor: [0.9, 1.0, 1.15] })
let eye = cad.sphere({ radius: 2 * MM, segments: 32 })
eye = cad.translate(eye, { offset: [0, 0, 5 * MM] })
let result = cad.subtract(head, eye)`

async function countMeshShape(
  code: string,
  rtOpts: Record<string, unknown>,
  execOpts?: Record<string, unknown>,
): Promise<number> {
  const engine = await getActiveBrepEngine()
  const kernel = engine.primitives as BrepEngineApi
  const spy = vi.spyOn(kernel, 'meshShape')
  try {
    const rt = createRuntime(createNodePorts(), 'brep', undefined, rtOpts)
    const res = await rt.execute(code, execOpts as never)
    expect(res.failedAt, `执行失败: ${JSON.stringify(res.failedAt)}`).toBeUndefined()
    return spy.mock.calls.length
  } finally {
    spy.mockRestore()
  }
}

/** 一次执行，返回 { 结果, meshShape 次数, rt }。 */
async function runOnce(code: string, rtOpts: Record<string, unknown>, execOpts?: Record<string, unknown>) {
  const engine = await getActiveBrepEngine()
  const kernel = engine.primitives as BrepEngineApi
  const spy = vi.spyOn(kernel, 'meshShape')
  try {
    const rt = createRuntime(createNodePorts(), 'brep', undefined, rtOpts)
    const res = await rt.execute(code, execOpts as never)
    expect(res.failedAt, `执行失败: ${JSON.stringify(res.failedAt)}`).toBeUndefined()
    return { res, count: spy.mock.calls.length, rt }
  } finally {
    spy.mockRestore()
  }
}

function positionsOf(shape: Shape | undefined): Float32Array | null {
  return shape && shape.positions instanceof Float32Array ? shape.positions : null
}

describe('defer 模式：中间产物不三角化、终端各一次', () => {
  it('eager: 5 次 meshShape（sphere×2 + scale + translate + subtract）', async () => {
    const n = await countMeshShape(CHAIN_CODE, { tessellationTiming: 'eager' })
    expect(n).toBe(5)
  })

  it('defer: 3 次 meshShape == 终端数（中间链产物 0 次；拓扑命中缓存不兜底）', async () => {
    const n = await countMeshShape(CHAIN_CODE, { tessellationTiming: 'defer' })
    expect(n).toBe(3)
  })
})

describe('defer 几何与 eager 逐字节一致（物化参数 == eager 参数）', () => {
  it('head/eye/result 三个终端的 positions/indices 完全一致', async () => {
    const eager = await runOnce(CHAIN_CODE, { tessellationTiming: 'eager' })
    const defer = await runOnce(CHAIN_CODE, { tessellationTiming: 'defer' })
    for (const name of ['head', 'eye', 'result'] as const) {
      const e = positionsOf(eager.res.outputs.get(name as never) as Shape)
      const d = positionsOf(defer.res.outputs.get(name as never) as Shape)
      expect(e, `${name} eager positions 缺失`).not.toBeNull()
      expect(d, `${name} defer positions 缺失（应已物化）`).not.toBeNull()
      expect(new Float32Array(e as Float32Array)).toEqual(new Float32Array(d as Float32Array))
      const ei = (eager.res.outputs.get(name as never) as Shape).indices
      const di = (defer.res.outputs.get(name as never) as Shape).indices
      expect(new Uint32Array(ei)).toEqual(new Uint32Array(di))
    }
  })

  it('defer 拓扑与 eager 同源（3 个终端全部 source=brep）', async () => {
    const eager = await runOnce(CHAIN_CODE, { tessellationTiming: 'eager' })
    const defer = await runOnce(CHAIN_CODE, { tessellationTiming: 'defer' })
    expect(defer.res.terminals.map((t) => t.id).sort()).toEqual(['eye', 'head', 'result'])
    const eagerParts = [...(eager.res.topology?.keys() ?? [])].sort()
    const deferParts = [...(defer.res.topology?.keys() ?? [])].sort()
    expect(deferParts).toEqual(eagerParts)
    for (const name of deferParts) {
      expect(defer.res.topology?.get(name)?.source).toBe('brep')
    }
  })
})

describe('topoMode off：隐藏终端不物化；getCachedOutput 按需物化且幂等', () => {
  it('隐藏终端 mesh 留空 → getCachedOutput 物化一次', async () => {
    const engine = await getActiveBrepEngine()
    const kernel = engine.primitives as BrepEngineApi
    const spy = vi.spyOn(kernel, 'meshShape')
    try {
      const rt = createRuntime(createNodePorts(), 'brep', undefined, { tessellationTiming: 'defer' })
      const res = await rt.execute(CHAIN_CODE, { topology: 'off' } as never)
      expect(res.failedAt, `执行失败: ${JSON.stringify(res.failedAt)}`).toBeUndefined()
      // 可见终端 result 物化 1 次；隐藏 head/eye 不物化
      expect(spy.mock.calls.length).toBe(1)
      const headOut = res.outputs.get('head' as never) as Shape
      expect(headOut.positions.length).toBe(0)

      const got = rt.getCachedOutput('head' as never) as Shape
      expect(got.positions.length).toBeGreaterThan(0)
      expect(spy.mock.calls.length).toBe(2)
      // 幂等：二次读取不再 meshShape
      rt.getCachedOutput('head' as never)
      expect(spy.mock.calls.length).toBe(2)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('topoMode brep：全部 ctx shape（含隐藏终端/非终端）物化（拓扑为全部 shape 构建）', () => {
  it('sphere + scale + box 三个命名 shape：3 次 meshShape（隐藏终端不跳过，无兜底三角化）', async () => {
    const code = `let a = cad.sphere({ radius: 5 * MM, segments: 32 })
let b = cad.scale3d(a, { factor: [1, 1.2, 1] })
let c = cad.box(10 * MM, 20 * MM, 30 * MM)`
    // 与 'off'（只物化可见终端）对比：'brep' 物化全部 ctx shape——此处 a/b/c 全在 ctx，
    // 3 次；若走隐藏跳过/兜底会少于 3 或引入额外调用。
    const n = await countMeshShape(code, { tessellationTiming: 'defer' }, { topology: 'brep' })
    expect(n).toBe(3)
  })
})
