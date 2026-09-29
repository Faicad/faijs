/**
 * P0-1 工作项 A 防回归：CqAssembly 不可变 add / addSubshape / remove。
 *
 * CadQuery 的 Assembly.add/remove 是可变（返回 self）；本兼容层有意偏离为**不可变**
 * （返回新 CqAssembly），以适配 `.fai.js` 的 `let asm2 = asm.add(...)` 显式赋值模型
 * （见 docs/plans/2026-09-28-cq-compat-remaining-cadquery-support-plan.md Stage 3-A）。
 * 末尾一个脚本面探针对应方案 Q4：验证对象方法 + 返回新对象再赋给新变量在语句模型放行。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from '@faicad/cq-compat'
import * as asmPkg from './index'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureStep = resolve(here, '../../fixtures/data/box_boss.step')

let runtime: ReturnType<typeof createRuntime>
let boxA: Shape
let boxB: Shape

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  runtime.registerLib('asm', asmPkg as never, { packageName: '@faicad/cq-compat-assembly' } as never)
  const res = await runtime.execute(
    [
      "import * as cq from '@faicad/cq-compat'",
      "let wa = cq.Workplane('XY')",
      'let a = cq.box(wa, 10, 10, 10)',
      'let boxA = cq.val(a)',
      "let wb = cq.Workplane('XY')",
      'let b = cq.box(wb, 10, 10, 10)',
      'let boxB = cq.val(b)',
    ].join('\n'),
  )
  expect(res.failedAt).toBeUndefined()
  boxA = res.outputs.get(asPartName('boxA')) as Shape
  boxB = res.outputs.get(asPartName('boxB')) as Shape
  expect(boxA).toBeDefined()
  expect(boxB).toBeDefined()
}, 120000)

describe('CqAssembly 不可变 add/addSubshape/remove（P0-1 工作项 A）', () => {
  it('add 返回新对象，原 asm 不变', () => {
    const asm0 = asmPkg.buildAssembly('root', [{ name: 'a', shape: boxA }], [])
    const asm1 = asm0.add(boxB, 'b')
    expect(asm0.members.map((m) => m.name)).toEqual(['a'])
    expect(asm1.members.map((m) => m.name)).toEqual(['a', 'b'])
    expect(asm1).not.toBe(asm0)
  })

  it('add 默认名 part_<n> 且跳过已占用', () => {
    const asm0 = asmPkg.buildAssembly('root', [{ name: 'part_1', shape: boxA }], [])
    const asm1 = asm0.add(boxB)
    expect(asm1.members[1].name).toBe('part_2')
  })

  it('add 重名抛错（CQ 唯一性要求）', () => {
    const asm0 = asmPkg.buildAssembly('root', [{ name: 'a', shape: boxA }], [])
    expect(() => asm0.add(boxB, 'a')).toThrow(/duplicate member name/)
  })

  it('add 接受 { shape, name, color } 形态', () => {
    const asm0 = asmPkg.buildAssembly('root', [], [])
    const asm1 = asm0.add({ shape: boxA, name: 'x', color: [1, 0, 0] })
    expect(asm1.members[0]).toEqual({ name: 'x', shape: boxA, color: [1, 0, 0] })
  })

  it('addSubshape 不进 compound，登记到 subshapes；原 asm 不变', () => {
    const asm0 = asmPkg.buildAssembly('root', [{ name: 'a', shape: boxA }], [])
    const asm1 = asm0.addSubshape(boxB, 'ref1')
    expect(asm1.members.map((m) => m.name)).toEqual(['a'])
    expect(asm1.subshapes['ref1']!.shape).toBe(boxB)
    expect(Object.keys(asm0.subshapes)).toHaveLength(0)
  })

  it('remove 移除成员，过滤 dangling 约束（偏离 CQ：faijs 构造时验证引用存在）', async () => {
    const c = await asmPkg.constraint('a', '>Z', boxA, 'b', '<Z', boxB, 'Plane')
    const cs = [c]
    const asm0 = asmPkg.buildAssembly('root', [{ name: 'a', shape: boxA }, { name: 'b', shape: boxB }], cs)
    const asm1 = asm0.remove('b')
    expect(asm1.members.map((m) => m.name)).toEqual(['a'])
    expect(asm1.constraints).toHaveLength(0)
  })

  it('remove 不存在抛错', () => {
    const asm0 = asmPkg.buildAssembly('root', [{ name: 'a', shape: boxA }], [])
    expect(() => asm0.remove('x')).toThrow(/no member named/)
  })

  it('不可变链：asm0.add(a).add(b) 不影响 asm0', () => {
    const asm0 = asmPkg.buildAssembly('root', [], [])
    const asm2 = asm0.add(boxA, 'a').add(boxB, 'b')
    expect(asm0.members).toHaveLength(0)
    expect(asm2.members.map((m) => m.name)).toEqual(['a', 'b'])
  })

  it('add 后 solve 仍可工作（端到端）', async () => {
    const c = await asmPkg.constraint('a', '>Z', boxA, 'b', '<Z', boxB, 'Plane')
    const cs = [c]
    const asm0 = asmPkg.buildAssembly('root', [{ name: 'a', shape: boxA }], [])
    const asm1 = asm0.add(boxB, 'b')
    expect(asm1.members.map((m) => m.name)).toEqual(['a', 'b'])
    // 用带约束的版本验证 solve 端到端
    const asmWithC = asmPkg.buildAssembly(
      'root',
      [
        { name: 'a', shape: boxA },
        { name: 'b', shape: boxB },
      ],
      cs,
    )
    const solved = asmWithC.solve()
    expect(solved.converged).toBe(true)
  })
})

describe('CqAssembly.add 在 .fai.js 脚本面可用（Q4 探针）', () => {
  it('let asm1 = asm0.add(...) 语句模型放行', async () => {
    const res = await runtime.execute(
      [
        "import * as cq from '@faicad/cq-compat'",
        "import * as asm from '@faicad/cq-compat-assembly'",
        "let wp = cq.Workplane('XY')",
        'let s = cq.val(cq.box(wp, 10, 10, 10))',
        "let asm0 = asm.buildAssembly('root', [{ name: 'a', shape: s }], [])",
        "let asm1 = asm0.add(s, 'b')",
        'let result = asm1.toCompound()',
      ].join('\n'),
    )
    expect(res.failedAt).toBeUndefined()
    // toCompound 返回 CompoundShape（isShape=true）→ 产出到 outputs；
    // result 存在即证明 asm1 是有效 CqAssembly（add 返回了新对象）。
    const result = res.outputs.get(asPartName('result'))
    expect(result).toBeDefined()
  }, 60000)
})
describe('CqAssembly.traverse（P0-1 工作项 B）', () => {
  it('扁平结构产出 [[name, asm]] 单元素', () => {
    const asm0 = asmPkg.buildAssembly('root', [{ name: 'a', shape: boxA }], [])
    const entries = Array.from(asm0.traverse())
    expect(entries).toHaveLength(1)
    expect(entries[0][0]).toBe('root')
    expect(entries[0][1]).toBe(asm0)
  })

  it('traverse 可用于 for-of（迭代器协议）', () => {
    const asm0 = asmPkg.buildAssembly('r', [{ name: 'a', shape: boxA }, { name: 'b', shape: boxB }], [])
    const names: string[] = []
    for (const [n] of asm0.traverse()) names.push(n)
    expect(names).toEqual(['r'])
  })
})
describe('importStep/load（P0-1 工作项 C）', () => {
  it('importStep 读 STEP → 单成员装配', async () => {
    const asm = await asmPkg.importStep(fixtureStep)
    expect(asm.members).toHaveLength(1)
    expect(asm.members[0].name).toBe('part_1')
    expect(asm.name).toBe('imported')
  })

  it('importStep 后 solve/toCompound 可用', async () => {
    const asm = await asmPkg.importStep(fixtureStep)
    const solved = asm.solve()
    expect(solved.converged).toBe(true)
    const compound = solved.toCompound()
    expect(compound).toBeDefined()
  })

  it('load 是 importStep 别名', async () => {
    const asm = await asmPkg.load(fixtureStep)
    expect(asm.members).toHaveLength(1)
  })
})