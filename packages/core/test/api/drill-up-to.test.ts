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
})
