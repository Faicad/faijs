/**
 * API-coverage call sites for the up-to feature parameters (P0-P2).
 *
 * The feature tests drive these ops through CadRuntime script strings, which
 * the AST-based API coverage gate cannot see as TS call-site object literals.
 * This file adds direct TS call sites so every newly added parameter key is
 * covered at a real call site. Calls use real shapes and assert concrete
 * behaviour — no no-op stubs.
 */

const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') || msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') || msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) || msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { getBackends } from '../../src/runtime-state'
import { asPartName } from '../../src/identity'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { ProfileLoop } from '../../src/api/profile'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { extrude } from '../../src/api/extrude'
import { buildPunchHole, punchSolidOf } from '../../src/api/punch-hole'
import { fai_drill } from '../../src/extra/ops/fai_drill'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function outputs(code: string): Promise<Map<string, Shape>> {
  const r = await new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() }).execute(code)
  if (r.failedAt) throw new Error(r.failedAt.message)
  return r.outputs as unknown as Map<string, Shape>
}

function kernel(): BrepEngineApi {
  return getBackends().kernel.brep! as BrepEngineApi
}

const SQUARE: ProfileLoop = {
  segments: [
    { kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
    { kind: 'line', x1: 2, y1: 0, x2: 2, y2: 2 },
    { kind: 'line', x1: 2, y1: 2, x2: 0, y2: 2 },
    { kind: 'line', x1: 0, y1: 2, x2: 0, y2: 0 },
  ],
}

describe('up-to parameter call-site coverage', () => {
  it('extrude: combine + backwardUpTo call site', async () => {
    const sk = (await outputs(`let sk = cad.profile({ contours: ${JSON.stringify([SQUARE])} })`)).get(asPartName('sk'))!
    const result = await extrude(sk, {
      upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } },
      backwardUpTo: { plane: { point: [0, 0, -10], normal: [0, 0, 1] } },
      combine: 'union',
      baseFeature: sk,
      offset: 0,
    }) as Shape
    const bb = kernel().getBoundingBox(brepOf(result) as BrepHandle)
    expect(bb.zmax - bb.zmin).toBeCloseTo(20, 1)
  })

  it('buildPunchHole + punchSolidOf: upTo + baseFeature + offset call sites', async () => {
    const base = (await outputs(`let base = cad.box(20, 20, 10)`)).get(asPartName('base'))!
    const holed = buildPunchHole(kernel(), {
      contours: [SQUARE],
      on: base,
      face: '>Z',
      upTo: { plane: { point: [0, 0, 2], normal: [0, 0, 1] } },
      baseFeature: base,
      offset: 0,
    })
    expect(brepOf(holed)).toBeDefined()
    const holedSolid = punchSolidOf(kernel(), brepOf(base) as BrepHandle, {
      contours: [SQUARE],
      on: base,
      face: '>Z',
      upTo: { plane: { point: [0, 0, 2], normal: [0, 0, 1] } },
      baseFeature: base,
      offset: 0,
    })
    expect(kernel().getVolume(holedSolid)).toBeGreaterThan(0)
  })

  it('fai_drill: upTo + baseFeature + offset call site', async () => {
    const base = (await outputs(`let base = cad.box(20, 20, 10)`)).get(asPartName('base'))!
    const baseHandle = brepOf(base) as BrepHandle
    const baseVolume = kernel().getVolume(baseHandle)
    const entryZ = kernel().getBoundingBox(baseHandle).zmax
    // entry at the top face, drill inward (-Z) to a plane 3mm below.
    const drilled = await fai_drill(base, {
      position: [0, 0, entryZ], direction: 'z', diameter: 6, holeType: 'simple',
      upTo: { plane: { point: [0, 0, entryZ - 3], normal: [0, 0, 1] } },
      baseFeature: base,
      offset: 0,
    }) as Shape
    const fixed = await fai_drill(base, {
      position: [0, 0, entryZ], direction: 'z', diameter: 6, holeType: 'simple', depth: 3,
    }) as Shape
    const drilledVolume = kernel().getVolume(brepOf(drilled) as BrepHandle)
    expect(drilledVolume).toBeCloseTo(kernel().getVolume(brepOf(fixed) as BrepHandle), 2)
    expect(drilledVolume).toBeLessThan(baseVolume)
  })
})
