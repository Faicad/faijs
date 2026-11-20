/**
 * Shared up-to machinery tests (P0 extraction).
 *
 * The termination-plane logic used to live inside extrude.ts. It is now in
 * api/up-to so drill / pocket / punch-hole can share it. These tests pin both:
 * - normalizeUpToTarget: every legacy ExtrudeUpTo shape maps to the right kind;
 * - resolveUpToPlane: all four target kinds resolve to the same plane values
 *   the original extrude implementation produced;
 * - clipByUpToPlane: the trimmed solid matches the original geometry (bbox
 *   proof) and the degenerate cases throw explicit error codes.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { getBackends } from '../../src/runtime-state'
import { faceRef } from '../../src/api/face-ref'
import { asPartName } from '../../src/identity'
import { brepOf } from '../../src/shape'
import { getSolidBoundingBox } from '../../src/brep/brep-utils'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import {
  normalizeUpToTarget,
  resolveUpToPlane,
  clipByUpToPlane,
} from '../../src/api/up-to'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function runCode(code: string): Promise<Map<string, Shape>> {
  const rt = new CadRuntime(defaultPorts(), 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  return result.outputs as unknown as Map<string, Shape>
}

function kernel(): BrepEngineApi {
  return getBackends().kernel.brep! as BrepEngineApi
}

function bboxOf(shape: Shape): { min: [number, number, number]; max: [number, number, number] } {
  const solid = brepOf(shape) as BrepHandle | undefined
  if (!solid) throw new Error('no brep solid')
  const bb = getSolidBoundingBox(kernel(), solid)
  return { min: bb.min as [number, number, number], max: bb.max as [number, number, number] }
}

const SQUARE_2X2 = `{"segments":[
  {"kind":"line","x1":0,"y1":0,"x2":2,"y2":0},{"kind":"line","x1":2,"y1":0,"x2":2,"y2":2},
  {"kind":"line","x1":2,"y1":2,"x2":0,"y2":2},{"kind":"line","x1":0,"y1":2,"x2":0,"y2":0}],"closed":true}`

describe('normalizeUpToTarget', () => {
  it('maps every legacy ExtrudeUpTo shape to the canonical kind', () => {
    expect(normalizeUpToTarget('last')).toEqual({ kind: 'extent', which: 'last' })
    expect(normalizeUpToTarget('first')).toEqual({ kind: 'extent', which: 'first' })
    expect(normalizeUpToTarget('>Z')).toEqual({ kind: 'selector', selector: '>Z' })
    expect(normalizeUpToTarget({ plane: { point: [0, 0, 10], normal: [0, 0, 1] } })).toEqual({
      kind: 'plane', point: [0, 0, 10], normal: [0, 0, 1],
    })
  })

  it('rejects a bare number (fixed length is handled at the op layer, not here)', () => {
    expect(() => normalizeUpToTarget(10)).toThrow(/E_UP_TO_BAD_TARGET/)
  })
})

describe('resolveUpToPlane', () => {
  it('plane target normalizes the normal and applies offset along it', () => {
    // Plane resolution is pure; no kernel access needed (stub is never touched).
    const ctx = {
      kernel: {} as BrepEngineApi,
      origin: [0, 0, 0] as [number, number, number],
      direction: [0, 0, 1] as [number, number, number],
      offset: 5,
    }
    const plane = resolveUpToPlane({ kind: 'plane', point: [0, 0, 10], normal: [0, 0, 2] }, ctx)
    expect(plane.normal).toEqual([0, 0, 1])
    expect(plane.point[2]).toBeCloseTo(15, 3)
  })

  it('extent last/first resolves to the support body far/near end along direction', async () => {
    const outputs = await runCode(`let base = cad.box(10, 10, 100, { centered: false })`)
    const base = outputs.get(asPartName('base'))!
    const bb = bboxOf(base)
    const ctx = {
      kernel: kernel(), base,
      origin: [0, 0, 0] as [number, number, number],
      direction: [0, 0, 1] as [number, number, number],
    }
    const last = resolveUpToPlane({ kind: 'extent', which: 'last' }, ctx)
    const first = resolveUpToPlane({ kind: 'extent', which: 'first' }, ctx)
    expect(last.point[2]).toBeCloseTo(bb.max[2], 3)
    expect(first.point[2]).toBeCloseTo(bb.min[2], 3)
    expect(last.normal).toEqual([0, 0, 1])
  })

  it('face target uses the faceRef hint snapshot', async () => {
    const outputs = await runCode(`let base = cad.box(10, 10, 100, { centered: false })`)
    const base = outputs.get(asPartName('base'))!
    const ref = faceRef(base, 6) // +Z top face at z=100
    const ctx = {
      kernel: kernel(), base,
      origin: [0, 0, 0] as [number, number, number],
      direction: [0, 0, 1] as [number, number, number],
    }
    const plane = resolveUpToPlane({ kind: 'face', ref }, ctx)
    expect(plane.point[2]).toBeCloseTo(100, 3)
  })

  it('extent without a base throws E_UP_TO_NO_BASE', async () => {
    await runCode(`let sk = cad.profile({ contours: [${SQUARE_2X2}] })`) // configure backends
    const ctx = {
      kernel: kernel(),
      origin: [0, 0, 0] as [number, number, number],
      direction: [0, 0, 1] as [number, number, number],
    }
    expect(() => resolveUpToPlane({ kind: 'extent', which: 'last' }, ctx)).toThrow(/E_UP_TO_NO_BASE/)
  })
})

describe('clipByUpToPlane', () => {
  it('trims a long prism to the target plane (bbox proof)', async () => {
    const outputs = await runCode(`let sk = cad.profile({ contours: [${SQUARE_2X2}] })`)
    const profile = outputs.get(asPartName('sk'))!
    const handle = brepOf(profile) as BrepHandle
    const clipped = clipByUpToPlane(
      kernel(), handle,
      { kind: 'plane', point: [0, 0, 10], normal: [0, 0, 1] },
      { kernel: kernel(), origin: [1, 1, 0], direction: [0, 0, 1], offset: 0 },
    )
    const k = kernel()
    const bb = getSolidBoundingBox(k, clipped)
    expect(bb.max[2]).toBeCloseTo(10, 3)
    expect(bb.min[2]).toBeCloseTo(0, 3)
    expect(bb.max[0]).toBeCloseTo(2, 3)
    expect(bb.max[1]).toBeCloseTo(2, 3)
  })

  it('auto-orients toward a plane behind the profile (direction flip)', async () => {
    const outputs = await runCode(`let sk = cad.profile({ contours: [${SQUARE_2X2}] })`)
    const profile = outputs.get(asPartName('sk'))!
    const handle = brepOf(profile) as BrepHandle
    const clipped = clipByUpToPlane(
      kernel(), handle,
      { kind: 'plane', point: [0, 0, -10], normal: [0, 0, 1] },
      { kernel: kernel(), origin: [1, 1, 0], direction: [0, 0, 1], offset: 0 },
    )
    const bb = getSolidBoundingBox(kernel(), clipped)
    expect(bb.min[2]).toBeCloseTo(-10, 3)
    expect(bb.max[2]).toBeCloseTo(0, 3)
  })

  it('rejects a travel direction parallel to the target plane', async () => {
    const outputs = await runCode(`let sk = cad.profile({ contours: [${SQUARE_2X2}] })`)
    const profile = outputs.get(asPartName('sk'))!
    const handle = brepOf(profile) as BrepHandle
    expect(() => clipByUpToPlane(
      kernel(), handle,
      { kind: 'plane', point: [0, 0, 10], normal: [0, 0, 1] },
      { kernel: kernel(), origin: [1, 1, 0], direction: [1, 0, 0], offset: 0 },
    )).toThrow(/E_UP_TO_PARALLEL/)
  })
})
