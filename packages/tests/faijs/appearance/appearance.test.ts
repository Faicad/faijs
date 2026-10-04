/**
 * PBR 外观 e2e（设计文档 2026-10-05 v2 §3.2 / §4.2 / §6.1）
 *
 * 锁定：
 * - A1：成员调用语句形态 `box1.setColor('#e53935')`（复用 `asm1.solve()` 的
 *   receiver 路径）端到端生效，module 与 direct 双执行器产出同一外观。
 * - A2：链式 `setColor([...]).setMaterial({...})` 合并；#rrggbbaa / 数组第 4
 *   分量的 alpha 归一为 opacity（权威字段）。
 * - A3：几何 op 产物默认继承第一个携带外观的几何输入（translate 单产物）。
 * - A4：产物自带外观优先于继承（先 setColor 后对产物 setColor 不被覆盖）。
 * - A5：return 旧三字段（color/metalness/roughness）死特性不再注入外观。
 * - A6：getAppearance() 作为语句执行不抛错。
 * - A7：多输入 op（union）取第一个携带外观的输入（inputs.find 语义）。
 *
 * 限制：多输出（outputs: [...]）record 分支的继承目前只存在于 brep-only op
 * （splitByPlane/split），需 OCCT wasm——本文件 mesh 模式不覆盖该分支；
 * wrapByKeys 路径与单产物共用 inheritInputAppearance（define-op.ts），
 * 单产物行为已由 A3/A4 锁定。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createNodePorts } from '@faicad/faijs/node'
import { CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps } from '../_support/editor-runtime'
import { asPartName } from '@faicad/faijs/identity'
import type { ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { Shape, PbrAppearance } from '@faicad/faijs/api'

/** 成员调用语句形态：setColor 后 return 该 shape。 */
const SET_COLOR = `let box1 = cad.box(10, 10, 10)
box1.setColor('#e53935')
return { shape: box1 }
`

/** 链式：数组颜色（带 alpha）+ setMaterial。
 * 注：脚本面（.fai.js）一次一条 setX 语句（解析器只识别单层 receiver 调用，
 * 链式 `a.setX(...).setY(...)` 是 CallExpression receiver，见 v2 §3.3.1 注记）；
 * TS 库面方法返回 this 仍可链式（core 单测 appearance.test.ts 覆盖）。 */
const CHAINED = `let box1 = cad.box(10, 10, 10)
box1.setColor([1, 0, 0, 0.5])
box1.setMaterial({ metalness: 0.8, roughness: 0.2 })
return { shape: box1 }
`

/** 继承：box1 设色后经 translate 派生 box2。 */
const INHERIT = `let box1 = cad.box(10, 10, 10)
box1.setColor('#e53935')
let box2 = cad.translate(box1, { offset: [10, 0, 0] })
return { shape: box2 }
`

/** 产物自带外观优先：box2 先继承 box1 再自行 setColor。 */
const PRODUCT_OVERRIDES = `let box1 = cad.box(10, 10, 10)
box1.setColor('#e53935')
let box2 = cad.translate(box1, { offset: [10, 0, 0] })
box2.setColor('#2196f3')
return { shape: box2 }
`

/** 死特性回归：return 三字段不再注入外观（shape 未 setColor → 无外观）。 */
const LEGACY_RETURN = `let box1 = cad.box(10, 10, 10)
return { shape: box1, color: '#ff0000', metalness: 1, roughness: 0 }
`

/** getAppearance() 语句形态（不 return 该值，只验证执行不抛错）。 */
const GET_APPEARANCE = `let box1 = cad.box(10, 10, 10)
box1.setColor('#00ff00')
let a1 = box1.getAppearance()
return { shape: box1 }
`

/** 多输入：union 取第一个携带外观的几何输入（box1 在前）。 */
const UNION_FIRST = `let box1 = cad.box(10, 10, 10)
box1.setColor('#e53935')
let box2 = cad.box(5, 5, 5)
box2.setColor('#2196f3')
let u = cad.union(box1, box2)
return { shape: u }
`

const cadNs = createApiNamespaceWithEditorOps()

function moduleRuntime(): CadRuntime {
  return new CadRuntime(createNodePorts(), 'mesh', { cad: cadNs })
}

function directRuntime(): CadRuntime {
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

function expectAppearance(s: Shape): PbrAppearance {
  expect(s.appearance, 'shape.appearance missing').toBeDefined()
  return s.appearance!
}

describe('A: PBR 外观（.fai.js 端到端）', () => {
  it('A1：box1.setColor(...) 成员调用语句形态（module 与 direct 一致）', async () => {
    const m = track(moduleRuntime())
    const d = track(directRuntime())
    const mr = await m.execute(SET_COLOR)
    const dr = await d.execute(SET_COLOR)
    const expected = { color: [0xe5 / 255, 0x39 / 255, 0x35 / 255] }
    expect(expectAppearance(outputOf(mr, 'box1'))).toEqual(expected)
    expect(expectAppearance(outputOf(dr, 'box1'))).toEqual(expected)
  })

  it('A2：setColor(数组带 alpha) + setMaterial 分条语句；alpha 归一为 opacity', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(CHAINED)
    expect(expectAppearance(outputOf(r, 'box1'))).toEqual({
      color: [1, 0, 0],
      opacity: 0.5,
      metalness: 0.8,
      roughness: 0.2,
    })
  })

  it('A3：几何 op 产物继承输入外观（translate 派生产物）', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(INHERIT)
    expect(expectAppearance(outputOf(r, 'box2'))).toEqual({ color: [0xe5 / 255, 0x39 / 255, 0x35 / 255] })
  })

  it('A4：产物自带外观优先于继承（不被覆盖）', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(PRODUCT_OVERRIDES)
    expect(expectAppearance(outputOf(r, 'box2'))).toEqual({ color: [0x21 / 255, 0x96 / 255, 0xf3 / 255] })
  })

  it('A5：return 旧三字段（color/metalness/roughness）不再注入外观（死特性回归）', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(LEGACY_RETURN)
    const s = outputOf(r, 'box1')
    expect(s.appearance).toBeUndefined()
  })

  it('A6：getAppearance() 作为语句执行不抛错', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(GET_APPEARANCE)
    const s = outputOf(r, 'box1')
    expect(s.appearance).toEqual({ color: [0, 1, 0] })
  })

  it('A7：多输入 op 取第一个携带外观的几何输入（union）', async () => {
    const m = track(moduleRuntime())
    const r = await m.execute(UNION_FIRST)
    expect(expectAppearance(outputOf(r, 'u'))).toEqual({ color: [0xe5 / 255, 0x39 / 255, 0x35 / 255] })
  })
})
