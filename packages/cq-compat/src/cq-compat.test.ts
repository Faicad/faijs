/**
 * cq-compat smoke tests — Workplane carrier + basic ops through runtime.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { hasBrep } from '@faicad/faijs-core/shape'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  // warm up
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

describe('cq-compat Workplane basic ops', () => {
  it('box + faces + workplane + hole produces a brep shape', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 100, 80, 10)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.hole(wp3, 10)',
      'let result = cq.val(wp4)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
  }, 60000)

  it('rect+extrude pattern via box + cutBlind', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.cutBlind(wp3, -3, { w: 20, d: 20 })',
      'let result = cq.val(wp4)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
  }, 60000)

  it('pushPoints + hole (multiple holes)', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.pushPoints(wp3, [[-15, 0], [15, 0]])',
      'let wp5 = cq.hole(wp4, 5)',
      'let result = cq.val(wp5)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
  }, 60000)

  it('translate + union', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 30, 30, 10)',
      'let wp2 = cq.box(wp, 15, 15, 10)',
      'let wp3 = cq.translate(wp2, [20, 0, 0])',
      'let wp4 = cq.union(wp1, wp3)',
      'let result = cq.val(wp4)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
  }, 60000)
})
