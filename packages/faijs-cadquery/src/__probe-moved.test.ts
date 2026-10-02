import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/faijs-cadquery' } as never)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

describe('probe moved', () => {
  it('single loc twice', async () => {
    const res = await runtime.execute(
      [
        "import * as cq from '@faicad/faijs-cadquery'",
        'let wp0 = cq.Workplane("XY")',
        'let b = await cq.box(wp0, 1, 1, 1)',
        'let m1 = await cq.moved(b, [1, 0, 0])',
        'let m2 = await cq.moved(m1, [0, 0, 1])',
      ].join('\n'),
    )
    expect(res.failedAt).toBeUndefined()
  }, 60000)

  it('compound identity / translate / two-loc', async () => {
    for (const last of [
      'let x = await cq.moved(c1)',
      'let x = await cq.translate(c1, [0, 0, 1])',
      'let x = await cq.moved(c1, cq.Location([1, 0, 0]), cq.Location([2, 0, 0]))',
    ]) {
      const res = await runtime.execute(
        [
          "import * as cq from '@faicad/faijs-cadquery'",
          'let wp0 = cq.Workplane("XY")',
          'let b = await cq.box(wp0, 1, 1, 1)',
          'let c1 = await cq.moved(b, cq.Location([-1, 0, 0]), cq.Location([1, 0, 0]))',
          last,
        ].join('\n'),
      )
      expect(res.failedAt).toBeUndefined()
    }
    expect(true).toBe(true)
  }, 60000)

  it('compound then move', async () => {
    const res = await runtime.execute(
      [
        "import * as cq from '@faicad/faijs-cadquery'",
        'let wp0 = cq.Workplane("XY")',
        'let b = await cq.box(wp0, 1, 1, 1)',
        'let c1 = await cq.moved(b, cq.Location([-1, 0, 0]), cq.Location([1, 0, 0]))',
        'let s1 = cq.val(c1)',
        'let c2 = await cq.moved(c1, [0, 0, 1])',
      ].join('\n'),
    )
    const s = res.outputs.get('s1' as never) as Shape | undefined
    expect(s).toBeDefined()
    expect(res.failedAt).toBeUndefined()
  }, 60000)
})
