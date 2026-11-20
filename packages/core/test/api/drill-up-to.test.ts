/**
 * cad.drill up-to mode tests (P1).
 *
 * Drilling can now terminate against a plane / face / extent instead of a bare
 * numeric depth. The tool is an over-long cylinder trimmed by the shared
 * termination-plane machinery (api/up-to), then subtracted. These tests prove
 * up-to depth == the equivalent fixed depth (geometry contract), the mutual
 * exclusion error, and that the fixed-depth paths are untouched.
 */

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
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { drillBrep } from '../../src/api/brep-operations/compoundFns'

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

function volumeOf(shape: Shape): number {
  const k = getBackends().kernel.brep! as BrepEngineApi
  const solid = brepOf(shape) as BrepHandle | undefined
  if (!solid) throw new Error('no brep solid')
  return k.getVolume(solid)
}

describe('cad.drill upTo (P1)', () => {
  it('upTo plane z=10 equals fixed depth 10 (blind hole geometry)', async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 20, { centered: false })
      let up = cad.drill(base, { at: [5, 5], radius: 2, upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } } })
      let base2 = cad.box(10, 10, 20, { centered: false })
      let fixed = cad.drill(base2, { at: [5, 5], radius: 2, depth: 10 })
    `)
    const vUp = volumeOf(outputs.get(asPartName('up'))!)
    const vFixed = volumeOf(outputs.get(asPartName('fixed'))!)
    expect(vUp).toBeGreaterThan(0)
    expect(vUp).toBeCloseTo(vFixed, 2)
    // 2000 - pi*2^2*10 ≈ 1874.34
    expect(vUp).toBeCloseTo(2000 - Math.PI * 4 * 10, 1)
  })

  it('upTo extent last drills through the support (through hole geometry)', async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 20, { centered: false })
      let up = cad.drill(base, { at: [5, 5], radius: 2, upTo: 'last', baseFeature: base })
    `)
    // Through hole full height 20 → 2000 - pi*4*20 ≈ 1748.67
    expect(volumeOf(outputs.get(asPartName('up'))!)).toBeCloseTo(2000 - Math.PI * 4 * 20, 1)
  })

  it('depth + upTo is rejected with E_DRILL_DEPTH_UPTO', async () => {
    await expect(runCode(`
      let base = cad.box(10, 10, 20, { centered: false })
      let up = cad.drill(base, { at: [5, 5], radius: 2, depth: 5, upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } } })
    `)).rejects.toThrow(/E_DRILL_DEPTH_UPTO/)
  })

  it('fixed-depth blind hole remains unchanged (no upTo)', async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 20, { centered: false })
      let d = cad.drill(base, { at: [5, 5], radius: 2, depth: 10 })
    `)
    expect(volumeOf(outputs.get(asPartName('d'))!)).toBeCloseTo(2000 - Math.PI * 4 * 10, 1)
  })

  it('fixed through hole (no depth, no upTo) remains unchanged', async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 20, { centered: false })
      let d = cad.drill(base, { at: [5, 5], radius: 2 })
    `)
    expect(volumeOf(outputs.get(asPartName('d'))!)).toBeCloseTo(2000 - Math.PI * 4 * 20, 1)
  })

  it('upTo a picked face (FaceTopoRef) drills to that face', async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 20, { centered: false })
      let up = cad.drill(base, { at: [5, 5], radius: 2, upTo: cad.faceRef(base, 6) })
    `)
    // faceRef(base, 6) is the +Z cap at z=20 → through hole.
    expect(volumeOf(outputs.get(asPartName('up'))!)).toBeCloseTo(2000 - Math.PI * 4 * 20, 1)
  })

  it("upTo a '>Z' selector resolves on baseFeature and stops at its top face", async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 20, { centered: false })
      let stop = cad.box(10, 10, 12, { centered: false })
      let up = cad.drill(base, { at: [5, 5], radius: 2, upTo: '>Z', baseFeature: stop })
    `)
    // The selector reads the support body (depth 12), not the drilled solid.
    expect(volumeOf(outputs.get(asPartName('up'))!)).toBeCloseTo(2000 - Math.PI * 4 * 12, 1)
  })

  it('hole bottom follows the target plane (depth 5 / 10 / 15), bbox unchanged', async () => {
    for (const z of [5, 10, 15]) {
      const outputs = await runCode(`
        let base = cad.box(10, 10, 20, { centered: false })
        let up = cad.drill(base, { at: [5, 5], radius: 2, upTo: { plane: { point: [0, 0, ${z}], normal: [0, 0, 1] } } })
      `)
      const result = outputs.get(asPartName('up'))!
      expect(volumeOf(result)).toBeCloseTo(2000 - Math.PI * 4 * z, 1)
      const bb = (getBackends().kernel.brep! as BrepEngineApi).getBoundingBox(brepOf(result) as BrepHandle)
      expect([bb.xmin, bb.xmax, bb.ymin, bb.ymax, bb.zmin, bb.zmax]).toEqual([0, 10, 0, 10, 0, 20])
    }
  })

  it('upTo preserves the hole centre and radius of the fixed-depth path', async () => {
    const outputs = await runCode(`
      let b1 = cad.box(10, 10, 20, { centered: false })
      let up1 = cad.drill(b1, { at: [5, 5], radius: 2, upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } } })
      let b2 = cad.box(10, 10, 20, { centered: false })
      let fixed1 = cad.drill(b2, { at: [5, 5], radius: 2, depth: 10 })
      let b3 = cad.box(10, 10, 20, { centered: false })
      let up2 = cad.drill(b3, { at: [4, 4], radius: 2, upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } } })
      let b4 = cad.box(10, 10, 20, { centered: false })
      let fixed2 = cad.drill(b4, { at: [4, 4], radius: 2, depth: 10 })
    `)
    const v = (name: string) => volumeOf(outputs.get(asPartName(name))!)
    expect(v('up1')).toBeCloseTo(v('fixed1'), 2)
    expect(v('up2')).toBeCloseTo(v('fixed2'), 2)
    expect(v('up1')).toBeCloseTo(v('up2'), 2)
    for (const name of ['up1', 'up2']) {
      const bb = (getBackends().kernel.brep! as BrepEngineApi).getBoundingBox(brepOf(outputs.get(asPartName(name))!) as BrepHandle)
      expect([bb.xmin, bb.xmax, bb.ymin, bb.ymax, bb.zmin, bb.zmax]).toEqual([0, 10, 0, 10, 0, 20])
    }
  })

  it('offset shifts the termination plane along its normal', async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 20, { centered: false })
      let up = cad.drill(base, {
        at: [5, 5], radius: 2,
        upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } }, offset: 3,
      })
    `)
    expect(volumeOf(outputs.get(asPartName('up'))!)).toBeCloseTo(2000 - Math.PI * 4 * 13, 1)
  })

  it('an axis parallel to the target plane is rejected with E_DRILL_UPTO_AXIS', async () => {
    const outputs = await runCode(`let base = cad.box(10, 10, 20, { centered: false })`)
    const base = outputs.get(asPartName('base'))!
    // Call the BREP op directly: the script schema drops `axis`, so only the
    // library surface can pin the degenerate axis/plane combination.
    const result = drillBrep(base, {
      at: [5, 5], radius: 2, axis: [1, 0, 0],
      upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } },
    } as never)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('E_DRILL_UPTO_AXIS')
  })
})
