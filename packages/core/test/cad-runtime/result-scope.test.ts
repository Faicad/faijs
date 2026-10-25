/**
 * 结果范围 = 本轮代码产出的零件（跨 execute 不残留）。
 *
 * 回归背景（2026-10-25）：`collectDirectResult` 用 `new Map(this.topologyCache)` 起步，
 * 而 `topologyCache` 是按 partName 键控的**跨执行** memo —— 上一轮（旧代码 / 改名前的
 * 变量）零件的条目会被整体带进本轮结果，`naming` 又由 topology 派生，于是：
 *   - 结果描述的是「上一轮的场景」：`brep-direct-parity` 的 naming 键集断言被上一轮
 *     的 `warmup` / `t` 撞红（同 runtime 内用例顺序相关，单跑也会依赖前序用例）；
 *   - 幽灵条目永不回收（会话内只增不减）。
 *
 * 收敛判据 = 本轮 ctx 里的 shape 变量（与 outputs / terminals 同源）。
 * 同时钉住：指纹命中的缓存复用**不**因收敛而失效（同几何重跑仍复用同一份拓扑数据）。
 *
 * 环境：initOcctWasm() + auto 模式（BREP 链活跃）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { asPartName } from '../../src/identity'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 结果里的键集（排序后便于精确对拍）。 */
function keysOf(map: Map<string, unknown> | undefined): string[] {
  return map ? [...map.keys()].map(String).sort() : []
}

describe('执行结果范围 = 本轮零件（跨 execute 收敛）', () => {
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: createApiNamespaceWithEditorOps() })
  }, 120000)

  it('改名后 topology / naming 只剩本轮零件', async () => {
    const first = await rt.execute('let a = cad.box(10, 10, 10, { centered: true })')
    expect(first.failedAt).toBeUndefined()
    expect(keysOf(first.topology)).toEqual(['a'])

    const second = await rt.execute('let b = cad.cylinder(3, 10, { centered: true, segments: 24 })')
    expect(second.failedAt).toBeUndefined()

    // 三个结果面同一套键集：brepSolids / topology / naming 都只描述本轮 ctx。
    expect(keysOf(second.brepSolids)).toEqual(['b'])
    expect(keysOf(second.topology)).toEqual(['b'])
    expect(keysOf(second.naming)).toEqual(['b'])
    // 缓存里的孤儿条目一并回收（否则会话内只增不减）。
    expect(rt.getTopology(asPartName('a'))).toBeUndefined()
  }, 120000)

  it('同几何重跑仍走指纹复用（收敛不破坏缓存命中）', async () => {
    const code = 'let c = cad.box(12, 12, 12, { centered: true })'
    const first = await rt.execute(code)
    const second = await rt.execute(code)

    expect(keysOf(second.topology)).toEqual(['c'])
    // 指纹一致 → buildFor 顶部命中 → 同一份拓扑数据对象（不是重建）。
    expect(second.topology?.get(asPartName('c'))?.data).toBe(first.topology?.get(asPartName('c'))?.data)
  }, 120000)
})
