/**
 * api/brep-topology — BREP 拓扑查询 / 构造面 出口单测
 *
 * 直接跑 occt-wasm（initOcctWasm），经 configureBackends 把内核注入
 * `getBrepApi()` 的读取通道，随后用 box solid 验证: getEdges / getFaces /
 * getSolids / bounds3D / getSurfaceType / curveStartPoint / curveEndPoint /
 * outerWire / isClosedWire / isPlanarWire / assembleWire / wireLoop /
 * line / polygon（未在覆盖面但顺带验证）。
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  configureBackends,
  CONTRACT_VERSION,
  type Backends,
} from '../runtime-state'
import { initOcctWasm, getOcctKernel } from '../occt-kernel/occtKernel'
import { primitiveToBrepSolid, primitiveToBrepStep } from '../primitives/brep-primitives'
import {
  getEdges,
  getFaces,
  getSolids,
  bounds3D,
  getSurfaceType,
  curveStartPoint,
  curveEndPoint,
  outerWire,
  isClosedWire,
  assembleWire,
  wireLoop,
  isPlanarWire,
  line,
  polygon,
  normalAt,
} from './brep-topology'
import { fromBrep } from '../shape'
import { isOk } from '../result/result'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'

let kernel: any

beforeAll(async () => {
  await initOcctWasm()
  kernel = getOcctKernel() as any
  configureBackends(makeBackends(kernel))
}, 120000)

function makeBackends(kernelBrep: unknown): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep', brepCapabilities: undefined },
    kernel: { brep: kernelBrep, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
}

function wrapSolid(solid: BrepHandle) {
  return fromBrep({ positions: new Float32Array(0), indices: new Uint32Array(0) } as unknown as Shape, { solid })
}

describe('brep-topology queries on a box', () => {
  let box: ReturnType<typeof wrapSolid>

  beforeAll(() => {
    const result = primitiveToBrepSolid(kernel, 'box', { width: 20, depth: 10, height: 30 })
    box = wrapSolid(result.solid)
  })

  it('getEdges returns the 12 edges of a box, each with distinct endpoints', () => {
    const edges = getEdges(box)
    expect(edges.length).toBe(12)
    for (const e of edges) {
      const a = curveStartPoint(e)
      const b = curveEndPoint(e)
      expect(a).not.toEqual(b)
    }
  })

  it('getFaces returns the 6 faces of a box', () => {
    expect(getFaces(box)).toHaveLength(6)
  })

  it('getSolids returns the single box solid', () => {
    expect(getSolids(box)).toHaveLength(1)
  })

  it('bounds3D returns a finite box with min <= max (componentwise)', () => {
    const b = bounds3D(box)
    for (const v of [b.min, b.max]) {
      for (const c of v) expect(Number.isFinite(c)).toBe(true)
    }
    expect(b.min[0]).toBeLessThanOrEqual(b.max[0])
    expect(b.min[1]).toBeLessThanOrEqual(b.max[1])
    expect(b.min[2]).toBeLessThanOrEqual(b.max[2])
  })

  it('getSurfaceType of every box face resolves to plane', () => {
    for (const f of getFaces(box)) {
      const st = getSurfaceType(f)
      expect(isOk(st)).toBe(true)
      if (isOk(st)) expect(st.value).toBe('plane')
    }
  })

  it('outerWire of a box face is a closed planar wire', () => {
    const w = outerWire(getFaces(box)[0]!)
    expect(isClosedWire(w)).toBe(true)
    expect(isPlanarWire(w)).toBe(true)
  })

  it('assembleWire and wireLoop close four line edges into a loop', () => {
    const pts: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]]
    const edges = pts.map((p1, i) => {
      const p2 = pts[(i + 1) % pts.length]
      return line([p1[0], p1[1], 0], [p2[0], p2[1], 0])
    })
    const rw = wireLoop(edges)
    expect(isOk(rw)).toBe(true)
    if (isOk(rw)) {
      expect(isClosedWire(rw.value)).toBe(true)
      expect(isPlanarWire(rw.value)).toBe(true)
    }
    expect(isOk(assembleWire(edges))).toBe(true)
  })

  it('wireLoop rejects an unclosed open chain', () => {
    const e1 = line([0, 0, 0], [10, 0, 0])
    const e2 = line([10, 0, 0], [10, 10, 0])
    expect(isOk(wireLoop([e1, e2]))).toBe(false)
  })

  it('polygon builds a closed planar face from four coplanar points', () => {
    const r = polygon([
      [0, 0, 0],
      [8, 0, 0],
      [8, 8, 0],
      [0, 8, 0],
    ])
    expect(isOk(r)).toBe(true)
    if (isOk(r)) {
      const st = getSurfaceType(r.value)
      expect(isOk(st)).toBe(true)
      if (isOk(st)) expect(st.value).toBe('plane')
    }
  })

  it('normalAt of a box face returns a finite unit-ish normal', () => {
    const face = getFaces(box)[0]!
    const n = normalAt(face)
    for (const c of n) expect(Number.isFinite(c)).toBe(true)
    // normalAt(face, point) falls back to UV-center normal when projection fails
    const n2 = normalAt(face, [0, 0, 0])
    for (const c of n2) expect(Number.isFinite(c)).toBe(true)
  })

  it('primitiveToBrepStep exports a box to a STEP string', () => {
    const { step, path } = primitiveToBrepStep(kernel, 'box', { width: 10, depth: 10, height: 10 })
    expect(path).toBe('primitive')
    expect(step).toContain('FILE_NAME')
    expect(step.length).toBeGreaterThan(100)
  })
})