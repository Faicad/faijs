/**
 * Probe: siblings semantics (Phase 3) — matches test_shapes.py::test_siblings vars.
 * Expected values from cadquery 2.8.0:
 *   simple_box = box(1,1,1) (xy-centred, z 0..1, 6 faces)
 *   f = simple_box.face("<Z")  → single -Z face
 *   f.siblings(simple_box, "Edge", 1)     → 4 side faces
 *   f.siblings(simple_box, "Edge", (1,2)) → 5 faces (4 sides + top)
 *   f.siblings(simple_box, "Edge", (2,))  → 1 face (top)
 *   simple_box.edges(">Z").siblings(simple_box, "Vertex", (1,2)) → 8 edges
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { brepOf } from '@faicad/faijs/shape'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

async function runVar(lines: string[]): Promise<Shape> {
  const code = ["import * as cq from '@faicad/cq-compat'", ...lines, 'let result = cq.val(wp_out)'].join('\n')
  const res = await runtime.execute(code)
  expect(res.failedAt).toBeUndefined()
  const shape = res.outputs.get(asPartName('result')) as Shape | undefined
  expect(shape).toBeDefined()
  return shape!
}

function countSub(shape: Shape, kind: 'face' | 'edge'): number {
  const k = getKernel()
  const h = brepOf(shape)
  expect(h).toBeDefined()
  return (k.getSubShapes(h as never, kind) as unknown[]).length
}

function bboxZ(shape: Shape): { zmin: number; zmax: number } {
  const k = getKernel()
  const h = brepOf(shape)
  expect(h).toBeDefined()
  const b = k.getBoundingBox(h as never)
  return { zmin: b.zmin, zmax: b.zmax }
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
})

describe('siblings probe (Phase 3)', () => {
  it('siblings_1: <Z face, Edge, level 1 → 4 side faces', async () => {
    const s = await runVar([
      'let wp0 = cq.Workplane("XY")',
      'let wp1 = await cq.box(wp0, 1, 1, 1)',
      'let b = await cq.translate(wp1, [0, 0, 0.5])',
      'let f = cq.faces(b, "<Z")',
      'let siblings_1 = await cq.siblings(f, b, "Edge", 1)',
      'let wp_out = siblings_1',
    ])
    expect(countSub(s, 'face')).toBe(4)
    const z = bboxZ(s)
    expect(z.zmin).toBeCloseTo(0, 6)
    expect(z.zmax).toBeCloseTo(1, 6)
  })

  it('siblings_12: <Z face, Edge, (1,2) → 5 faces (4 sides + top)', async () => {
    const s = await runVar([
      'let wp0 = cq.Workplane("XY")',
      'let wp1 = await cq.box(wp0, 1, 1, 1)',
      'let b = await cq.translate(wp1, [0, 0, 0.5])',
      'let f = cq.faces(b, "<Z")',
      'let siblings_12 = await cq.siblings(f, b, "Edge", [1, 2])',
      'let wp_out = siblings_12',
    ])
    expect(countSub(s, 'face')).toBe(5)
  })

  it('siblings_2: <Z face, Edge, (2,) → 1 face (top)', async () => {
    const s = await runVar([
      'let wp0 = cq.Workplane("XY")',
      'let wp1 = await cq.box(wp0, 1, 1, 1)',
      'let b = await cq.translate(wp1, [0, 0, 0.5])',
      'let f = cq.faces(b, "<Z")',
      'let siblings_2 = await cq.siblings(f, b, "Edge", [2])',
      'let wp_out = siblings_2',
    ])
    expect(countSub(s, 'face')).toBe(1)
    const z = bboxZ(s)
    expect(z.zmin).toBeCloseTo(1, 6)
  })

  it('siblings_cmp_edges_12: edges(">Z"), Vertex, (1,2) → 8 edges', async () => {
    const s = await runVar([
      'let wp0 = cq.Workplane("XY")',
      'let wp1 = await cq.box(wp0, 1, 1, 1)',
      'let b = await cq.translate(wp1, [0, 0, 0.5])',
      'let e = cq.edges(b, ">Z")',
      'let siblings_edges_12 = await cq.siblings(e, b, "Vertex", [1, 2])',
      'let wp_out = siblings_edges_12',
    ])
    expect(countSub(s, 'edge')).toBe(8)
  })

  it('siblings_cmp_edges_12 single level (1,) → 4 side edges', async () => {
    const s = await runVar([
      'let wp0 = cq.Workplane("XY")',
      'let wp1 = await cq.box(wp0, 1, 1, 1)',
      'let b = await cq.translate(wp1, [0, 0, 0.5])',
      'let e = cq.edges(b, ">Z")',
      'let siblings_edges_1 = await cq.siblings(e, b, "Vertex", 1)',
      'let wp_out = siblings_edges_1',
    ])
    expect(countSub(s, 'edge')).toBe(4)
  })
})
