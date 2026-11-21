/**
 * GOTCHA (2026-11-21): `snap`/`dent` need a real closest point on a face.
 * `projectPointOnFace` is the neutral projection (occt-native); brepkit/smlib
 * fail explicitly rather than sampling the face centre.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { getBrepApi } from '../../src/brep/handle-bridge'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'

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

describe('projectPointOnFace', () => {
  it('projects a point onto the box boundary', () => {
    const box = kernel.makeBox(10, 10, 10)
    const faces = kernel.getSubShapes(box, 'face')
    expect(faces.length).toBeGreaterThan(0)

    const projected = kernel.projectPointOnFace(faces[0]!, { x: 20, y: 5, z: 5 })
    expect(projected.x).toBeGreaterThanOrEqual(-0.01)
    expect(projected.x).toBeLessThanOrEqual(10.01)
    expect(projected.y).toBeGreaterThanOrEqual(-0.01)
    expect(projected.y).toBeLessThanOrEqual(10.01)
    expect(projected.z).toBeGreaterThanOrEqual(-0.01)
    expect(projected.z).toBeLessThanOrEqual(10.01)
    // At least one coordinate sits on a box side.
    expect(
      Math.min(Math.abs(projected.x), Math.abs(projected.x - 10)) < 0.01 ||
      Math.min(Math.abs(projected.y), Math.abs(projected.y - 10)) < 0.01 ||
      Math.min(Math.abs(projected.z), Math.abs(projected.z - 10)) < 0.01,
    ).toBe(true)
  })
})