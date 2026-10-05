/**
 * 零件级元数据 brep 链 e2e（设计文档 2026-10-05-meta §3.3 / §2 ③）
 *
 * 背景：编辑器（desktop/web/weapp）worker 全部走 brep 链（createRuntime mode
 * 'brep' / auto→brep）。meta 方法与 `appearance` 同款挂载在产物构造点（solid/
 * curve → attachMetaMethods），mesh 与 brep 双支路的产物都可用
 * `box1.setName(...)`。本文件锁定 brep 链下：
 * - B1：成员调用语句形态 setName/setDescription 端到端生效。
 * - B2：brep 链几何 op 产物（translate）继承输入 meta。
 * - B3：brep 链布尔（union）产物继承第一个携带 meta 的输入。
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { initOcctWasm } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps } from '../_support/editor-runtime'
import { asPartName } from '@faicad/faijs/identity'
import type { ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { Shape } from '@faicad/faijs/api'

const cadNs = createApiNamespaceWithEditorOps()

function brepRuntime(): CadRuntime {
  return new CadRuntime(createNodePorts(), 'brep', { cad: cadNs })
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

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

describe('B: 零件级元数据 brep 链（编辑器默认链）', () => {
  it('B1：brep box setName/setDescription 成员调用语句形态', async () => {
    const rt = track(brepRuntime())
    const r = await rt.execute(`let box1 = cad.box(10, 10, 10)
box1.setName('gearbox')
box1.setDescription('brep housing')
return { shape: box1 }
`)
    expect(outputOf(r, 'box1').meta).toEqual({ name: 'gearbox', description: 'brep housing' })
  })

  it('B2：brep 链几何 op 产物继承输入 meta（translate 派生产物）', async () => {
    const rt = track(brepRuntime())
    const r = await rt.execute(`let box1 = cad.box(10, 10, 10)
box1.setName('gearbox')
let box2 = cad.translate(box1, { offset: [10, 0, 0] })
return { shape: box2 }
`)
    expect(outputOf(r, 'box2').meta).toEqual({ name: 'gearbox' })
  })

  it('B3：brep 链 union 产物继承第一个携带 meta 的输入', async () => {
    const rt = track(brepRuntime())
    const r = await rt.execute(`let box1 = cad.box(10, 10, 10)
box1.setName('main')
let box2 = cad.box(5, 5, 5)
let u = cad.union(box1, box2)
return { shape: u }
`)
    expect(outputOf(r, 'u').meta).toEqual({ name: 'main' })
  })
})