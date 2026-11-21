/**
 * GOTCHA (2026-11-21): `cad.loft({closed:true})` is the closed ThruSections
 * path. faijs repeats the first section, lofts an open **shell**
 * (`kernel.loftShell`, occt `isSolid=false`), sews the seam, then solidifies.
 *
 * A ring of four square sections: centre line on a circle of radius 10, each
 * section square to the path. Expected bbox is ±12 in X/Y and ±2 in Z.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import { asPartName } from '../../src/identity'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

const ports = (): HostPorts => ({ events: { emit: () => {} } } as HostPorts)

function run(code: string) {
  return new CadRuntime(ports(), 'brep' as ExecutionMode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

describe('cad.loft closed', () => {
  it('lofts four sections into a closed ring', async () => {
    const square = (rx: number, ry: number, x: number, y: number): string =>
      `cad.translate(cad.rotate_euler(cad.wire([[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]], { closed: true }), ` +
      `{ angles: [${rx},${ry},0] }), [${x},${y},0])`

    const code = [
      `let s0 = ${square(-90, 0, 10, 0)}`,
      `let s1 = ${square(0, -90, 0, 10)}`,
      `let s2 = ${square(90, 0, -10, 0)}`,
      `let s3 = ${square(0, 90, 0, -10)}`,
      'let part = cad.loft([s0,s1,s2,s3], { closed: true })',
    ].join('\n')

    const result = await run(code)
    if (result.failedAt) throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
    const part = result.outputs.get(asPartName('part')) as Shape | undefined
    expect(part).toBeDefined()

    const kernel = getBrepApi()
    const bbox = kernel.getBoundingBox(brepOf(part!) as never)
    expect(bbox.xmin).toBeLessThanOrEqual(-11)
    expect(bbox.xmax).toBeGreaterThanOrEqual(11)
    expect(bbox.ymin).toBeLessThanOrEqual(-11)
    expect(bbox.ymax).toBeGreaterThanOrEqual(11)
    expect(bbox.zmin).toBeLessThanOrEqual(-1.5)
    expect(bbox.zmax).toBeGreaterThanOrEqual(1.5)
    expect(kernel.getVolume(brepOf(part!) as never)).toBeGreaterThan(0)
  })

  it('rejects fewer than three sections', async () => {
    const result = await run(
      [
        'let s0 = cad.wire([[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]], { closed: true })',
        'let s1 = cad.translate(s0, [0,0,10])',
        'let part = cad.loft([s0,s1], { closed: true })',
      ].join('\n'),
    )
    expect(result.failedAt?.message).toContain('E_LOFT_CLOSED_SECTIONS')
  })
})