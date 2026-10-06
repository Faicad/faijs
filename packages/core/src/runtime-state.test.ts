import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRuntimeState, configureBackends, getBackends, setCurrentStmt,
  getCurrentStmt, keep, keepHidden, setKeepSink, setName, nameOf, CONTRACT_VERSION,
  setPendingAssemblyTransforms, takePendingAssemblyTransforms,
  setPendingDetectedUnit, takePendingDetectedUnits,
  setPendingMultiPartCount, takePendingMultiPartCounts,
  setPendingMeshSolid, takePendingMeshSolids,
  setPendingMeshTopology, takePendingMeshTopologies,
  setPendingAssemblyKinematics, takePendingAssemblyKinematics,
  type Backends, type ExecutionAnchor,
} from './runtime-state'
import { asPartName } from './identity'

function fakeBackends(): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto' },
    kernel: { brep: { tag: 'fake-brep' }, csg: undefined, sdf: undefined },
    fonts: undefined, texture: undefined, assets: undefined, events: undefined,
    cad: {},
  }
}

function stmt(id: string): ExecutionAnchor {
  return { id, outputs: [] }
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

  it('getCurrentStmt returns the stmt set by setCurrentStmt, and undefined when cleared', () => {
    setCurrentStmt(stmt('s9'))
    expect(getCurrentStmt()?.id).toBe('s9')
    setCurrentStmt(undefined)
    expect(getCurrentStmt()).toBeUndefined()
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

describe('pending assembly transforms (set/take)', () => {
  it('accumulates across calls and is consumed exactly once', () => {
    const c = {}
    setPendingAssemblyTransforms(c, [{} as never])
    setPendingAssemblyTransforms(c, [{} as never])
    const taken = takePendingAssemblyTransforms()
    expect(taken).toHaveLength(1)
    expect(taken[0].compound).toBe(c)
    expect(taken[0].transforms).toHaveLength(2)
    expect(takePendingAssemblyTransforms()).toHaveLength(0)
  })

  it('ignores empty arrays and tracks multiple distinct compounds', () => {
    const a = {}
    const b = {}
    setPendingAssemblyTransforms(a, [])
    setPendingAssemblyTransforms(a, [{} as never])
    setPendingAssemblyTransforms(b, [{} as never, {} as never])
    const taken = takePendingAssemblyTransforms()
    expect(taken).toHaveLength(2)
    const n = new Map(taken.map((t) => [t.compound, t.transforms.length]))
    expect(n.get(a)).toBe(1)
    expect(n.get(b)).toBe(2)
  })
})

describe('pending detected units / multi-part counts / mesh solid / topology', () => {
  it('detected units round-trip per part and clear on take', () => {
    setPendingDetectedUnit('a' as never, 'mm')
    setPendingDetectedUnit('b' as never, 'in')
    const m = takePendingDetectedUnits()
    expect(m.get('a' as never)).toBe('mm')
    expect(m.get('b' as never)).toBe('in')
    expect(takePendingDetectedUnits().size).toBe(0)
  })

  it('multi-part counts round-trip and clear on take', () => {
    setPendingMultiPartCount('p' as never, 4)
    expect(takePendingMultiPartCounts().get('p' as never)).toBe(4)
    expect(takePendingMultiPartCounts().size).toBe(0)
  })

  it('mesh solids / topologies stored independently per part and clear on take', () => {
    setPendingMeshSolid('p' as never, { handle: 7 })
    setPendingMeshTopology('p' as never, { faces: 6 })
    expect(takePendingMeshSolids().get('p' as never)).toEqual({ handle: 7 })
    expect(takePendingMeshTopologies().get('p' as never)).toEqual({ faces: 6 })
    expect(takePendingMeshSolids().size).toBe(0)
    expect(takePendingMeshTopologies().size).toBe(0)
  })

  it('assembly kinematics store and consume exactly once', () => {
    const c = {}
    setPendingAssemblyKinematics(c, { part: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } })
    const taken = takePendingAssemblyKinematics()
    expect(taken).toHaveLength(1)
    expect(taken[0].compound).toBe(c)
    expect(taken[0].kinematics.part.position).toEqual([0, 0, 0])
    expect(takePendingAssemblyKinematics()).toHaveLength(0)
  })
})
