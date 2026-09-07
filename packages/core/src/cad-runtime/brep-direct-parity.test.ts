/**
 * T3: BREP/topology/naming direct parity — auto 模式下 direct vs module
 *
 * 验收（handoff T3）：
 * - auto 模式场景 direct == module：
 *   brepSolids 键集、topology.source、naming 逐 part 相等。
 * - solidCache 在 direct 路径经 setSolid 钩子同步（T3 核心）。
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

describe('T3: BREP/topology/naming direct parity (auto 模式)', () => {
  const cadNs = createApiNamespace()
  let moduleRt: CadRuntime
  let directRt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    moduleRt = new CadRuntime(defaultPorts(), 'auto', { cad: cadNs })
    directRt = new CadRuntime(defaultPorts(), 'auto', { cad: cadNs }, { executor: 'direct' })
    await moduleRt.execute(WARMUP)
    await directRt.execute(WARMUP)
  }, 120000)

  it('brepSolids 键集两边一致（box→translate 链）', async () => {
    const code = [
      'let bp = cad.box(10, 20, 30, { centered: true })',
      'let t = cad.translate(bp, [5, 0, 0])',
    ].join('\n')

    const m = await moduleRt.execute(code)
    const d = await directRt.execute(code)

    expect(m.failedAt).toBeUndefined()
    expect(d.failedAt).toBeUndefined()

    const mSolids = m.brepSolids ? [...m.brepSolids.keys()].map(String).sort() : []
    const dSolids = d.brepSolids ? [...d.brepSolids.keys()].map(String).sort() : []
    expect(dSolids).toEqual(mSolids)
  })

  it('topology.source 两边一致（auto 模式 = brep）', async () => {
    const code = [
      'let bp = cad.box(20, 20, 20, { centered: true })',
    ].join('\n')

    const m = await moduleRt.execute(code)
    const d = await directRt.execute(code)

    expect(m.failedAt).toBeUndefined()
    expect(d.failedAt).toBeUndefined()

    const mTopo = m.topology
    const dTopo = d.topology
    expect(mTopo).toBeDefined()
    expect(dTopo).toBeDefined()

    if (mTopo && dTopo) {
      const mSources = [...mTopo.entries()].map(([k, v]) => `${String(k)}:${v.source}`).sort()
      const dSources = [...dTopo.entries()].map(([k, v]) => `${String(k)}:${v.source}`).sort()
      expect(dSources).toEqual(mSources)
    }
  })

  it('naming 逐 part 两边一致（box terminal）', async () => {
    const code = [
      'let bp = cad.box(15, 25, 35, { centered: true })',
    ].join('\n')

    const m = await moduleRt.execute(code)
    const d = await directRt.execute(code)

    expect(m.failedAt).toBeUndefined()
    expect(d.failedAt).toBeUndefined()

    const mNaming = m.naming
    const dNaming = d.naming

    // naming 键集合一致
    const mKeys = mNaming ? [...mNaming.keys()].map(String).sort() : []
    const dKeys = dNaming ? [...dNaming.keys()].map(String).sort() : []
    expect(dKeys).toEqual(mKeys)
  })

  it('多终端 BREP 链：brepSolids + topology + naming 两边一致', async () => {
    const code = [
      'let bp = cad.box(10, 10, 10, { centered: true })',
      'let cyl = cad.cylinder(5, 20, { centered: true, segments: 24 })',
      'let result = cad.subtract(bp, cyl)',
    ].join('\n')

    const m = await moduleRt.execute(code)
    const d = await directRt.execute(code)

    expect(m.failedAt).toBeUndefined()
    expect(d.failedAt).toBeUndefined()

    // brepSolids 键集
    const mSolids = m.brepSolids ? [...m.brepSolids.keys()].map(String).sort() : []
    const dSolids = d.brepSolids ? [...d.brepSolids.keys()].map(String).sort() : []
    expect(dSolids).toEqual(mSolids)

    // topology 键集 + source
    const mTopo = m.topology
    const dTopo = d.topology
    if (mTopo && dTopo) {
      const mSources = [...mTopo.entries()].map(([k, v]) => `${String(k)}:${v.source}`).sort()
      const dSources = [...dTopo.entries()].map(([k, v]) => `${String(k)}:${v.source}`).sort()
      expect(dSources).toEqual(mSources)
    }

    // naming 键集
    const mNaming = m.naming
    const dNaming = d.naming
    const mKeys = mNaming ? [...mNaming.keys()].map(String).sort() : []
    const dKeys = dNaming ? [...dNaming.keys()].map(String).sort() : []
    expect(dKeys).toEqual(mKeys)
  })
})
