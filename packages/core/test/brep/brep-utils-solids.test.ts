/**
 * GOTCHA (2026-11-19, faijs-sand3d M2 feedback): a boolean may legally return
 * a multi-solid compound — a through-cut splits one solid into two. Library
 * authors need (a) a stable, lower-case `shapeType` and (b) a one-level
 * "which solids does this handle carry" helper so they do not have to
 * hand-roll unwrap logic.
 *
 * This pins both: `shapeType` is normalized to `ShapeType` (lower case) and
 * `getSolids` / `isCompoundHandle` report a compound without rejecting it.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { getBrepApi } from '../../src/brep/handle-bridge'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import { isCompoundHandle, getSolids } from '../../src/brep/brep-utils'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
  const active = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep' },
    kernel: { brep: active.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  kernel = getBrepApi()
}, 120000)

describe('shapeType / compound helpers', () => {
  it('shapeType is lower case and typed', () => {
    const box = kernel.makeBox(10, 10, 10)
    expect(kernel.shapeType(box)).toBe('solid')
    kernel.release(box)
  })

  it('a solid yields itself, a compound yields its solids', () => {
    const a = kernel.makeBox(10, 10, 10)
    const b = kernel.makeBox(5, 5, 5)
    expect(isCompoundHandle(kernel, a)).toBe(false)
    expect(getSolids(kernel, a)).toEqual([a])

    const c = kernel.makeCompound([a, b])
    expect(kernel.shapeType(c)).toBe('compound')
    expect(isCompoundHandle(kernel, c)).toBe(true)
    expect(getSolids(kernel, c)).toHaveLength(2)
  })

  it('a through-cut leaves a multi-solid compound (not an error)', () => {
    const block = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 20 })
    const tool = kernel.makeBoxFromCorners({ x: 8, y: -5, z: -5 }, { x: 12, y: 25, z: 25 })
    const cut = kernel.cut(block, tool)
    expect(isCompoundHandle(kernel, cut)).toBe(true)
    expect(getSolids(kernel, cut)).toHaveLength(2)
  })
})