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

  it('同名零件换几何 → 面表随新几何重建（不复用上一轮）', async () => {
    // 2026-10-25：`topologyCache` 按 partName 键控，而 partName 在编辑器里是稳定
    // 的（`part0` / 参数编辑后整段重跑）——几何变了名字不变。旧行为在 buildFor 里
    // 命中"陈旧条目"分支直接 return，于是结果带着上一轮的**面表**（面数量、三角形
    // 归属都是旧几何的）。端侧探针就是这么炸的：drill 过的 part0（7 张面）换回素
    // box（6 张），面表行覆盖的三角形数与显示 mesh 对不上 → E_TOPO_FACE_MESH_MISMATCH。
    const drilled = await rt.execute([
      'let p = cad.box(10, 20, 30, { centered: true })',
      "p = cad.fai_drill(p, { diameter: 5, depth: 0, holeType: 'simple', direction: 'normal', tolerance: 0.3, snapEnabled: true, position: [0, 0, 15] })",
    ].join('\n'))
    expect(drilled.failedAt).toBeUndefined()
    const drilledTopo = drilled.topology?.get(asPartName('p'))
    // 带孔件：上下端面 + 4 侧壁 + 孔壁 = 7 张面。
    expect(drilledTopo?.data.faces?.length).toBe(7)

    const plain = await rt.execute('let p = cad.box(10, 20, 30, { centered: true })')
    expect(plain.failedAt).toBeUndefined()
    const plainTopo = plain.topology?.get(asPartName('p'))

    // 素 box 只有 6 张面：面表必须来自本轮几何，而不是上一轮的 7 张。
    expect(plainTopo?.data.faces?.length).toBe(6)
    expect(plainTopo?.data).not.toBe(drilledTopo?.data)
    // 面表与显示几何同源：面表声明的三角形总数 = 显示 mesh 三角形数
    // （同一次几何下 buildTopologyFromMesh 与显示 mesh 同源；跨轮复用才会不等）。
    const displayTris = plain.outputs.get(asPartName('p'))?.indices
      ? (plain.outputs.get(asPartName('p')) as { indices: ArrayLike<number> }).indices.length / 3
      : 0
    expect(displayTris).toBeGreaterThan(0)
    const faceTris = (plainTopo?.data.faces ?? []).reduce((n, f) => n + (f.triangleCount ?? 0), 0)
    expect(faceTris).toBe(displayTris)
  }, 120000)
})
