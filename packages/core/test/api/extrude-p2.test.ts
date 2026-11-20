/**
 * cad.extrude P2 semantics: extent 'next', combine:'cut', backwardUpTo.
 *
 * - 'next' picks the first qualifying face along travel (face-center projection
 *   approximation, documented boundary) — here it coincides with 'last' on a box.
 * - combine:'cut' subtracts the extruded (up-to) prism from baseFeature.
 * - backwardUpTo builds a bidirectional prism: positive up-to + negative up-to.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { getBackends } from '../../src/runtime-state'
import { asPartName } from '../../src/identity'
import { brepOf } from '../../src/shape'
import { getSolidBoundingBox } from '../../src/brep/brep-utils'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
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
  const k = kernel()
  const bb = getSolidBoundingBox(k, brepOf(shape) as BrepHandle)
  return { min: bb.min as [number, number, number], max: bb.max as [number, number, number] }
}

function volumeOf(shape: Shape): number {
  return kernel().getVolume(brepOf(shape) as BrepHandle)
}

const SQUARE_2X2 = `{"segments":[
  {"kind":"line","x1":0,"y1":0,"x2":2,"y2":0},{"kind":"line","x1":2,"y1":0,"x2":2,"y2":2},
  {"kind":"line","x1":2,"y1":2,"x2":0,"y2":2},{"kind":"line","x1":0,"y1":2,"x2":0,"y2":0}],"closed":true}`

describe('cad.extrude extent next (P2)', () => {
  it('upTo next reaches the first +Z face of the base (matches last here)', async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 100, { centered: false })
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, { upTo: 'next', baseFeature: base })
      let sk2 = cad.profile({ contours: [${SQUARE_2X2}] })
      let part2 = cad.extrude(sk2, { upTo: 'last', baseFeature: base })
    `)
    expect(bboxOf(outputs.get(asPartName('part1'))!).max[2]).toBeCloseTo(100, 3)
    expect(volumeOf(outputs.get(asPartName('part1'))!)).toBeCloseTo(volumeOf(outputs.get(asPartName('part2'))!), 2)
  })

  it('upTo next without base throws E_UP_TO_NO_BASE', async () => {
    await expect(runCode(`
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, { upTo: 'next' })
    `)).rejects.toThrow(/E_UP_TO_NO_BASE/)
  })
})

describe('cad.extrude combine cut (P2)', () => {
  it('combine cut subtracts the up-to prism from baseFeature', async () => {
    // base box 10×10×100; extrude [0,2]² up to z=100 with cut → base minus prism.
    // base volume 10000; prism 4×100=400 → 9600.
    const outputs = await runCode(`
      let base = cad.box(10, 10, 100, { centered: false })
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let result = cad.extrude(sk, { upTo: 'last', baseFeature: base, combine: 'cut' })
    `)
    expect(volumeOf(outputs.get(asPartName('result'))!)).toBeCloseTo(10000 - 4 * 100, 1)
  })

  it('combine cut without base throws E_EXTRUDE_CUT_NO_BASE', async () => {
    await expect(runCode(`
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let result = cad.extrude(sk, { upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } }, combine: 'cut' })
    `)).rejects.toThrow(/E_EXTRUDE_CUT_NO_BASE/)
  })

  it('combine cut without upTo throws E_EXTRUDE_CUT_REQUIRES_UPTO', async () => {
    await expect(runCode(`
      let base = cad.box(10, 10, 100, { centered: false })
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let result = cad.extrude(sk, { length: 10, baseFeature: base, combine: 'cut' })
    `)).rejects.toThrow(/E_EXTRUDE_CUT_REQUIRES_UPTO/)
  })
})

describe('cad.extrude backwardUpTo (P2)', () => {
  it('bidirectional up-to fuses positive and negative prisms', async () => {
    // profile at z∈[0,2]² plane z=0 (XY). Positive upTo plane z=10 → +10 prism.
    // Negative backwardUpTo plane z=-10 → -10 prism. Total height 20, volume 4×20=80.
    const outputs = await runCode(`
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let part = cad.extrude(sk, {
        upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } },
        backwardUpTo: { plane: { point: [0, 0, -10], normal: [0, 0, 1] } },
      })
    `)
    const p = outputs.get(asPartName('part'))!
    const bb = bboxOf(p)
    expect(bb.max[2]).toBeCloseTo(10, 2)
    expect(bb.min[2]).toBeCloseTo(-10, 2)
    expect(volumeOf(p)).toBeCloseTo(80, 1)
  })

  it('upTo next stops at the closest intermediate face, not the far end', async () => {
    const outputs = await runCode(`
      let low = cad.box(10, 10, 50, { centered: false })
      let high = cad.box(10, 10, 50, { at: [0, 0, 50], centered: false })
      let stack = cad.compound({ members: [low, high] })
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let part = cad.extrude(sk, { upTo: 'next', baseFeature: stack })
    `)
    const bb = bboxOf(outputs.get(asPartName('part'))!)
    expect(bb.max[2]).toBeCloseTo(50, 3)
  })

  it('backwardUpTo with mode:"backward" throws E_EXTRUDE_BACKWARD_CONFLICT', async () => {
    await expect(runCode(`
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let part = cad.extrude(sk, {
        length: 5, mode: 'backward',
        backwardUpTo: { plane: { point: [0, 0, -10], normal: [0, 0, 1] } },
      })
    `)).rejects.toThrow(/E_EXTRUDE_BACKWARD_CONFLICT/)
  })

  it('backwardUpTo with backwardLength throws E_EXTRUDE_BACKWARD_UPTO', async () => {
    await expect(runCode(`
      let sk = cad.profile({ contours: [${SQUARE_2X2}] })
      let part = cad.extrude(sk, {
        upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } },
        backwardLength: 5,
        backwardUpTo: { plane: { point: [0, 0, -10], normal: [0, 0, 1] } },
      })
    `)).rejects.toThrow(/E_EXTRUDE_BACKWARD_UPTO/)
  })
})
