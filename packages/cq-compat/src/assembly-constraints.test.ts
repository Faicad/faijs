/**
 * cq-compat 约束翻译层单测（P1.5，对齐 assembly-global-solver-plan §4.4）
 *
 * 覆盖 constraintEx 的 7 类映射：Plane→mate / Axis→angle:180（纯方向反平行，
 * 2026-09-17 对照 CQ 2.8.0 solver.py 标定修正，原误映射 align）/ Point→coincident /
 * Cylinder→[concentric,coincident] / Distance→distance / Fixed→fixed /
 * Revolute→fixed（降级占位）。pointRef/axisRef 为字面引用构造（无内核）。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { hasBrep, brepOf } from '@faicad/faijs-core/shape'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import type { AssemblyConstraint } from '@faicad/faijs-core/api/assembly/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>
let boxShape: Shape
let cylShape: Shape

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)

  const boxRes = await runtime.execute([
    "import * as cq from '@faicad/cq-compat'",
    "let wp = cq.Workplane('XY')",
    'let b = cq.box(wp, 100, 80, 10)',
    'let boxShape = cq.val(b)',
  ].join('\n'))
  expect(boxRes.failedAt).toBeUndefined()
  boxShape = boxRes.outputs.get(asPartName('boxShape')) as Shape
  expect(boxShape).toBeDefined()
  expect(hasBrep(boxShape)).toBe(true)

  const cylRes = await runtime.execute([
    "import * as cq from '@faicad/cq-compat'",
    'let cyl = cq.cylinder(cq.Workplane("XY"), 30, 10)',
    'let cylShape = cq.val(cyl)',
  ].join('\n'))
  expect(cylRes.failedAt).toBeUndefined()
  cylShape = cylRes.outputs.get(asPartName('cylShape')) as Shape
  expect(cylShape).toBeDefined()
  expect(hasBrep(cylShape)).toBe(true)
}, 120000)

describe('cq-compat: 字面引用构造（无内核）', () => {
  it('pointRef 产出 point EntityRef', () => {
    const r = cq.pointRef('A', [1, 2, 3])
    expect(r).toEqual({ part: 'A', point: [1, 2, 3] })
  })
  it('axisRef 产出 edge.axis EntityRef', () => {
    const r = cq.axisRef('B', [0, 0, 5], [0, 0, 1])
    expect(r).toEqual({ part: 'B', edge: { axis: { origin: [0, 0, 5], direction: [0, 0, 1] } } })
  })
})

describe('cq-compat: constraintEx 映射', () => {
  it('Plane → [mate]，两侧为 face 引用', async () => {
    const out = await cq.constraintEx('A', '>Z', boxShape, 'B', '>Z', boxShape, 'Plane')
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('mate')
    const m = out[0] as Extract<AssemblyConstraint, { type: 'mate' }>
    expect('face' in m.a).toBe(true)
    expect('face' in m.b).toBe(true)
  })

  it('Axis → [angle:180]，两侧为 face 引用', async () => {
    const out = await cq.constraintEx('A', '>Z', boxShape, 'B', '>Z', boxShape, 'Axis')
    expect(out).toHaveLength(1)
    // GOTCHA (2026-09-17)：错误映射是 'align'（同向 val=0 + 面心重合）——CQ 2.8.0 的独立
    // Axis 约束是**纯方向反平行**（axis_cost 缺省 val=pi，无点项），对齐后为 angle:180。
    // 误映射会凭空引入 CQ 没有的面心重合项（mini_lathe e2e c4 被拖向 mb z=-1）。
    expect(out[0].type).toBe('angle')
    const ang = out[0] as Extract<AssemblyConstraint, { type: 'angle' }>
    expect(ang.value).toBe(180)
    expect('face' in ang.a).toBe(true)
    expect('face' in ang.b).toBe(true)
  })

  it('Point → [coincident]，两侧为 point 引用', async () => {
    const out = await cq.constraintEx('A', '1,2,3', null, 'B', '4,5,6', null, 'Point')
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('coincident')
    const c = out[0] as Extract<AssemblyConstraint, { type: 'coincident' }>
    expect(c.a).toEqual({ part: 'A', point: [1, 2, 3] })
    expect(c.b).toEqual({ part: 'B', point: [4, 5, 6] })
  })

  it('Distance（point-point）→ [distance(value)]', async () => {
    const out = await cq.constraintEx('A', '0,0,0', null, 'B', '3,4,0', null, 'Distance', 5)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('distance')
    const d = out[0] as Extract<AssemblyConstraint, { type: 'distance' }>
    expect(d.value).toBe(5)
    expect(d.a).toEqual({ part: 'A', point: [0, 0, 0] })
    expect(d.b).toEqual({ part: 'B', point: [3, 4, 0] })
  })

  it('Fixed → [fixed(part)]', async () => {
    const out = await cq.constraintEx('BASE', '', null, '', '', null, 'Fixed')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ type: 'fixed', part: 'BASE' })
  })

  it('Revolute → 降级 [fixed(part)] 占位', async () => {
    const out = await cq.constraintEx('HINGE', '', null, '', '', null, 'Revolute')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ type: 'fixed', part: 'HINGE' })
  })

  it('Cylinder → [concentric, coincident]，圆边解析出轴', async () => {
    const out = await cq.constraintEx('A', '', cylShape, 'B', '', cylShape, 'Cylinder')
    expect(out).toHaveLength(2)
    expect(out[0].type).toBe('concentric')
    expect(out[1].type).toBe('coincident')
    const a = (out[0] as Extract<AssemblyConstraint, { type: 'concentric' }>).a
    expect('edge' in a && 'axis' in (a as { edge: { axis: unknown } }).edge).toBe(true)
    const axis = (a as { edge: { axis: { origin: number[]; direction: number[] } } }).edge.axis
    // 圆柱 axis 默认 +Z：方向 |z|≈1
    expect(Math.abs(axis.direction[2])).toBeGreaterThan(0.99)
    expect(Math.hypot(axis.direction[0], axis.direction[1], axis.direction[2])).toBeCloseTo(1, 6)
  })
})

describe('cq-compat: constraint() 向后兼容', () => {
  it('Plane 走 constraint() 等价于 constraintEx', async () => {
    const single = await cq.constraint('A', '>Z', boxShape, 'B', '>Z', boxShape, 'Plane')
    expect(single.type).toBe('mate')
  })
  it('Axis 走 constraint() 等价于 constraintEx（angle:180，非 align）', async () => {
    const single = await cq.constraint('A', '>Z', boxShape, 'B', '>Z', boxShape, 'Axis')
    expect(single.type).toBe('angle')
    expect((single as { value?: number }).value).toBe(180)
  })
})
