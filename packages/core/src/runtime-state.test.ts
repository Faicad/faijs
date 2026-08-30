import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRuntimeState, configureBackends, getBackends, setCurrentStmt,
  keep, keepHidden, setKeepSink, nameOf, setName, CONTRACT_VERSION,
  type Backends,
} from './runtime-state'
import { asPartName, type StmtId } from './identity'
import type { StatementIR } from './lang/types'

function fakeBackends(): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto' },
    kernel: { brep: { tag: 'fake-brep' }, csg: undefined, sdf: undefined },
    fonts: undefined, texture: undefined, assets: undefined, events: undefined,
    cad: {},
  }
}

function stmt(id: string): StatementIR {
  return { id: id as StmtId, callee: 'box', args: {}, inputs: [], outputs: [] }
}

describe('runtime-state', () => {
  beforeEach(() => {
    setCurrentStmt(undefined)
    setKeepSink(undefined)
  })

  it('getRuntimeState 是单例且 stateVersion 稳定', () => {
    expect(getRuntimeState()).toBe(getRuntimeState())
    expect(getRuntimeState().stateVersion).toBe(1)
  })

  it('未配置 backends 时 getBackends 抛错（不静默兜底）', () => {
    const st = getRuntimeState()
    const saved = st.backends
    st.backends = undefined
    expect(() => getBackends()).toThrow(/backends not configured/)
    st.backends = saved
  })

  it('configureBackends 后 getBackends 返回同一引用（可变引用可运行期切换）', () => {
    const b = fakeBackends()
    configureBackends(b)
    expect(getBackends()).toBe(b)
    b.config.mode = 'mesh'                    // config 是可变对象
    expect(getBackends().config.mode).toBe('mesh')
  })

  it('keep/keepHidden 归属当前语句，且经 shapeToName 反查', () => {
    const calls: Array<{ id: string; names: string[]; hidden: boolean }> = []
    setKeepSink((id, names, hidden) => calls.push({ id, names: names.map(String), hidden }))

    const a = { positions: new Float32Array(), indices: new Uint32Array() }
    const b = { positions: new Float32Array(), indices: new Uint32Array() }
    setName(a, asPartName('part0'))
    setName(b, asPartName('part1'))

    setCurrentStmt(stmt('s3'))
    keep(a)
    keepHidden(b)

    expect(calls).toEqual([
      { id: 's3', names: ['part0'], hidden: false },
      { id: 's3', names: ['part1'], hidden: true },
    ])
  })

  it('无当前语句时 keep 静默丢弃（不抛错）', () => {
    const calls: unknown[] = []
    setKeepSink((...a) => calls.push(a))
    setCurrentStmt(undefined)
    expect(() => keep({})).not.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('未登记在 shapeToName 的对象被忽略', () => {
    const calls: unknown[] = []
    setKeepSink((...a) => calls.push(a))
    setCurrentStmt(stmt('s1'))
    keep({ notRegistered: true })
    expect(calls).toHaveLength(0)
    expect(nameOf({ notRegistered: true })).toBeUndefined()
  })
})
