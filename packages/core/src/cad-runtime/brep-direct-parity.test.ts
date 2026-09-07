/**
 * T3/T5: BREP/topology/naming direct execution — auto 模式验证
 *
 * T5 后：module 路径已删除，不再做 direct vs module 对拍。
 * 改为 direct-only 行为验证：brepSolids/topology/naming 在 auto 模式下
 * 正确产出。
 *
 * 环境：initOcctWasm() + auto 模式（BREP 链活跃）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from './runtime'
import { createApiNamespace } from '../api/api-namespace'
import type { HostPorts } from './ports'
import { initOcctWasm } from '../occt-kernel/occtKernel'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const WARMUP = 'let warmup = cad.box(1, 1, 1, { centered: true })'

describe('T3/T5: BREP/topology/naming direct execution (auto 模式)', () => {
  const cadNs = createApiNamespace()
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: cadNs })
    await rt.execute(WARMUP)
  }, 120000)

  it('brepSolids 含 box→translate 链的终端', async () => {
    const code = [
      'let bp = cad.box(10, 20, 30, { centered: true })',
      'let t = cad.translate(bp, { offset: [5, 0, 0] })',
    ].join('\n')

    const result = await rt.execute(code)

    expect(result.failedAt).toBeUndefined()

    // direct 路径：bp 被 translate 消费不进终端；brepSolids 只含终端 t
    const solids = result.brepSolids ? [...result.brepSolids.keys()].map(String).sort() : []
    expect(solids).toEqual(['t'])
  })

  it('topology.source 在 auto 模式为 brep', async () => {
    const code = [
      'let bp = cad.box(20, 20, 20, { centered: true })',
    ].join('\n')

    const result = await rt.execute(code)

    expect(result.failedAt).toBeUndefined()

    const topo = result.topology
    expect(topo).toBeDefined()

    if (topo) {
      const sources = [...topo.entries()].map(([k, v]) => `${String(k)}:${v.source}`).sort()
      expect(sources.length).toBeGreaterThan(0)
    }
  })

  it('naming 逐 part 正确产出（box terminal）', async () => {
    const code = [
      'let bp = cad.box(15, 25, 35, { centered: true })',
    ].join('\n')

    const result = await rt.execute(code)

    expect(result.failedAt).toBeUndefined()

    const naming = result.naming
    expect(naming).toBeDefined()

    const keys = naming ? [...naming.keys()].map(String).sort() : []
    expect(keys).toEqual(['bp'])
  })

  it('多终端 BREP 链：brepSolids + topology + naming 正确产出', async () => {
    const code = [
      'let bp = cad.box(10, 10, 10, { centered: true })',
      'let cyl = cad.cylinder(5, 20, { centered: true, segments: 24 })',
      'let result = cad.subtract(bp, cyl)',
    ].join('\n')

    const result = await rt.execute(code)

    expect(result.failedAt).toBeUndefined()

    // brepSolids 键集
    const solids = result.brepSolids ? [...result.brepSolids.keys()].map(String).sort() : []
    expect(solids).toEqual(['bp', 'cyl', 'result'])

    // topology 键集 + source
    const topo = result.topology
    if (topo) {
      const sources = [...topo.entries()].map(([k, v]) => `${String(k)}:${v.source}`).sort()
      expect(sources.length).toBeGreaterThan(0)
    }

    // naming 键集
    const naming = result.naming
    const keys = naming ? [...naming.keys()].map(String).sort() : []
    expect(keys).toEqual(['bp', 'cyl', 'result'])
  })
})
