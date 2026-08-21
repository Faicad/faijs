/**
 * BREP chain state management unit tests.
 *
 * Tests: createBrepChainState, initBrepChainState, releaseBrepChainState,
 * BREP_NATIVE_OPS, MESH_ONLY_OPS, isCadFormat.
 *
 * Note: breakBrepChain / lastSolidOfChain / brepActive / breakReason
 * have been removed in the per-part BREP redesign.
 * BREP status is now determined per-part by solidCache presence.
 *
 * Run: npx vitest run src/brep/brep-chain.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createBrepChainState, initBrepChainState, releaseBrepChainState,
  BREP_NATIVE_OPS, MESH_ONLY_OPS,
  isCadFormat,
} from './brep-chain'
import { initOcctWasm } from '../occt-kernel/occtKernel'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

describe('createBrepChainState', () => {
  it('should create an empty chain state with kernel=null', () => {
    const state = createBrepChainState()
    expect(state.solidCache.size).toBe(0)
    expect(state.kernel).toBeNull()
  })
})

describe('initBrepChainState', () => {
  it('should initialize with an OCCT kernel instance', async () => {
    const state = await initBrepChainState()
    expect(state.kernel).toBeDefined()
    expect(state.solidCache.size).toBe(0)
    releaseBrepChainState(state)
  })
})

describe('releaseBrepChainState', () => {
  it('should release all solid handles and clear solidCache', async () => {
    const state = await initBrepChainState()
    const kernel = state.kernel!

    // Create two solids
    const box1 = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const box2 = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 })
    state.solidCache.set('s1', box1)
    state.solidCache.set('s2', box2)

    // Persistent SolidCache 方案：releaseBrepChainState 语义收窄为全量释放 + 清空
    // （keepIds 参数已删除，见 docs/plans/2026-08-18-brepchain-persistent-solid-cache.md §9 决策 1）
    releaseBrepChainState(state)

    expect(state.solidCache.size).toBe(0)
  })

  it('should release all handles when no keepIds', async () => {
    const state = await initBrepChainState()
    const kernel = state.kernel!

    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    state.solidCache.set('s1', box)

    releaseBrepChainState(state)

    expect(state.solidCache.size).toBe(0)
  })
})

// ─── BREP 能力集合 ───

describe('BREP_NATIVE_OPS', () => {
  it('should contain all ops with BREP implementation', () => {
    expect(BREP_NATIVE_OPS.has('box')).toBe(true)
    expect(BREP_NATIVE_OPS.has('sphere')).toBe(true)
    expect(BREP_NATIVE_OPS.has('cylinder')).toBe(true)
    expect(BREP_NATIVE_OPS.has('cone')).toBe(true)
    expect(BREP_NATIVE_OPS.has('wedge')).toBe(true)
    expect(BREP_NATIVE_OPS.has('translate')).toBe(true)
    expect(BREP_NATIVE_OPS.has('rotate')).toBe(true)
    expect(BREP_NATIVE_OPS.has('scale')).toBe(true)
    expect(BREP_NATIVE_OPS.has('boolean')).toBe(true)
    expect(BREP_NATIVE_OPS.has('drill')).toBe(true)
    expect(BREP_NATIVE_OPS.has('split')).toBe(true)
    expect(BREP_NATIVE_OPS.has('extrude')).toBe(true)
    expect(BREP_NATIVE_OPS.has('engrave')).toBe(true)
    expect(BREP_NATIVE_OPS.has('text')).toBe(true)
    expect(BREP_NATIVE_OPS.has('screw')).toBe(true)
    expect(BREP_NATIVE_OPS.has('svgExtrude')).toBe(true)
    expect(BREP_NATIVE_OPS.has('load')).toBe(true)
  })

  it('should NOT contain mesh-only ops (sdf, knurl)', () => {
    expect(BREP_NATIVE_OPS.has('sdf')).toBe(false)
    expect(BREP_NATIVE_OPS.has('knurl')).toBe(false)
  })
})

describe('MESH_ONLY_OPS', () => {
  it('should contain sdf and knurl', () => {
    expect(MESH_ONLY_OPS.has('sdf')).toBe(true)
    expect(MESH_ONLY_OPS.has('knurl')).toBe(true)
    expect(MESH_ONLY_OPS.size).toBe(2)
  })
})

// ─── isCadFormat ───

describe('isCadFormat', () => {
  it('should return true for CAD formats with isSource=true', () => {
    expect(isCadFormat({ format: 'step' }, true)).toBe(true)
    expect(isCadFormat({ format: 'stp' }, true)).toBe(true)
    expect(isCadFormat({ format: 'brep' }, true)).toBe(true)
  })

  it('should return false for non-CAD formats', () => {
    expect(isCadFormat({ format: '3mf' }, true)).toBe(false)
    expect(isCadFormat({ format: 'stl' }, true)).toBe(false)
    expect(isCadFormat({ format: 'obj' }, true)).toBe(false)
    expect(isCadFormat({ format: 'iges' }, true)).toBe(false)
  })

  it('should return false when isSource=false', () => {
    expect(isCadFormat({ format: 'step' }, false)).toBe(false)
  })

  it('should infer from path/url extension when format is not specified', () => {
    expect(isCadFormat({ path: 'model.step' }, true)).toBe(true)
    expect(isCadFormat({ path: 'model.stp' }, true)).toBe(true)
    expect(isCadFormat({ path: 'model.3mf' }, true)).toBe(false)
    expect(isCadFormat({ path: 'model' }, true)).toBe(false)
    expect(isCadFormat({ url: 'https://example.com/model.step' }, true)).toBe(true)
    expect(isCadFormat({ url: 'https://example.com/model.3mf' }, true)).toBe(false)
  })
})
