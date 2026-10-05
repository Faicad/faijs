/**
 * 零件/文件级元数据 e2e（设计文档 2026-10-05-meta §3.3 / §4.4 / §2 ③）
 *
 * 锁定：
 * - M1：成员调用语句形态 `box1.setName('…').setDescription('…')` 端到端生效，
 *   与外观同款执行机制（复用 `asm1.solve()` 的 receiver 路径）。
 * - M2：链式分条 `setName` / `setDescription` / `setPartNumber` / `setMetaField`
 *   合并到 `shape.meta`。
 * - M3：几何 op 产物默认继承第一个携带 meta 的几何输入（translate 派生产物）。
 * - M4：产物自带 meta 优先于继承（先 setName 后对产物 setName 不被覆盖）。
 * - M5：空串清除（setName('') 删除 name）。
 * - M6：getMeta() 作为语句执行不抛错。
 * - M7：多输入 op 取第一个携带 meta 的几何输入（union）。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createNodePorts } from '@faicad/faijs/node'
import { CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps } from '../_support/editor-runtime'
import { asPartName } from '@faicad/faijs/identity'
import type { ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { Shape, ShapeMeta } from '@faicad/faijs/api'

/** 成员调用语句形态：setName + setDescription 后 return 该 shape。 */
const SET_META = `let box1 = cad.box(10, 10, 10)
box1.setName('gearbox')
box1.setDescription('input housing')
return { shape: box1 }
`

/** 分条合并：name + partNumber + 自定义键。 */
const CHAINED = `let box1 = cad.box(10, 10, 10)
box1.setName('gearbox')
box1.setPartNumber('GB-001')
box1.setMetaField('faijs:source', 'designed')
return { shape: box1 }
`

/** 继承：box1 设置 meta 后经 translate 派生 box2。 */
const INHERIT = `let box1 = cad.box(10, 10, 10)
box1.setName('gearbox')
let box2 = cad.translate(box1, { offset: [10, 0, 0] })
return { shape: box2 }
`

/** 产物自带 meta 优先：box2 先继承 box1 再自行 setName。 */
const PRODUCT_OVERRIDES = `let box1 = cad.box(10, 10, 10)
box1.setName('gearbox')
let box2 = cad.translate(box1, { offset: [10, 0, 0] })
box2.setName('cover')
return { shape: box2 }
`

/** 空串清除：box1 继承自 box2 的 name 被 setName('') 删除。 */
const CLEAR = `let box1 = cad.box(10, 10, 10)
box1.setName('gearbox')
let box2 = cad.translate(box1, { offset: [10, 0, 0] })
box2.setName('')
return { shape: box2 }
`

/** getMeta() 语句形态（不 return 该值，只验证执行不抛错）。 */
const GET_META = `let box1 = cad.box(10, 10, 10)
box1.setName('gearbox')
let m1 = box1.getMeta()
return { shape: box1 }
`

/** 多输入：union 取第一个携带 meta 的几何输入（box1 在前）。 */
const UNION_FIRST = `let box1 = cad.box(10, 10, 10)
box1.setName('main')
let box2 = cad.box(5, 5, 5)
box2.setName('sub')
let u = cad.union(box1, box2)
return { shape: u }
`

const cadNs = createApiNamespaceWithEditorOps()

function moduleRuntime(): CadRuntime {
  return new CadRuntime(createNodePorts(), 'mesh', { cad: cadNs })
}

const runtimes: CadRuntime[] = []

function track(rt: CadRuntime): CadRuntime {
  runtimes.push(rt)
  return rt
}

afterEach(() => {
  for (const rt of runtimes.splice(0)) rt.dispose()
})

function outputOf(result: ExecutionResult, name: string): Shape {
  expect(result.failedAt).toBeUndefined()
  const s = result.outputs.get(asPartName(name))
  expect(s, `output "${name}" missing`).toBeDefined()
  return s as Shape
}

function expectMeta(s: Shape): ShapeMeta {
  expect(s.meta, 'shape.meta missing').toBeDefined()
  return s.meta!
}

describe('M: 零件级元数据（.fai.js 端到端，mesh 链）', () => {
  it('M1：setName + setDescription 成员调用语句形态', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(SET_META)
    expect(expectMeta(outputOf(r, 'box1'))).toEqual({ name: 'gearbox', description: 'input housing' })
  })

  it('M2：setName/setPartNumber/setMetaField 分条合并', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(CHAINED)
    expect(expectMeta(outputOf(r, 'box1'))).toEqual({
      name: 'gearbox',
      partNumber: 'GB-001',
      metadata: { 'faijs:source': 'designed' },
    })
  })

  it('M3：几何 op 产物继承输入 meta（translate 派生产物）', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(INHERIT)
    expect(expectMeta(outputOf(r, 'box2'))).toEqual({ name: 'gearbox' })
  })

  it('M4：产物自带 meta 优先于继承（不被覆盖）', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(PRODUCT_OVERRIDES)
    expect(expectMeta(outputOf(r, 'box2'))).toEqual({ name: 'cover' })
  })

  it('M5：setName 空串清除继承来的 name', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(CLEAR)
    // 继承的 meta 已被空串清除 → 只剩空对象（继承引用已被清除，不再指向上游）
    expect(outputOf(r, 'box2').meta).toBeDefined()
    expect(outputOf(r, 'box2').meta!.name).toBeUndefined()
  })

  it('M6：getMeta() 作为语句执行不抛错', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(GET_META)
    expect(expectMeta(outputOf(r, 'box1'))).toEqual({ name: 'gearbox' })
  })

  it('M7：多输入 op 取第一个携带 meta 的几何输入（union）', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(UNION_FIRST)
    expect(expectMeta(outputOf(r, 'u'))).toEqual({ name: 'main' })
  })
})