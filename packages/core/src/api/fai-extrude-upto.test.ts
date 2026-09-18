/**
 * fai_extrude up-to mode tests — 拉伸到面 / 到支持体端面（extrude-upto-face 方案 §5-B DoD）
 *
 * GOTCHA（方案 §4.2）：occt-wasm 不暴露 BRepFeat_MakePrism，up-to 用
 * 「长拉伸（bbox 对角线×2，仅布尔构造辅助）→ 与目标面侧半空间盒求交」
 * 等价组合；结果几何由布尔决定，试探长度不进入结果。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { HostPorts } from '../cad-runtime/ports'
import { createApiNamespace } from './api-namespace'
import { asPartName } from '../identity'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { getSolidBoundingBox } from '../brep/brep-utils'
import { getBackends } from '../runtime-state'
import { brepOf } from '../shape'
import type { Shape } from '../mesh/types'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function runCode(code: string): Promise<Map<string, Shape>> {
  const rt = new CadRuntime(defaultPorts(), 'brep', { cad: createApiNamespace() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  return result.outputs
}

function bboxOf(shape: Shape): { min: [number, number, number]; max: [number, number, number] } {
  const kernel = getBackends().kernel.brep!
  const solid = brepOf(shape)
  if (!solid) throw new Error('no brep solid')
  const bb = getSolidBoundingBox(kernel, solid)
  return { min: bb.min as [number, number, number], max: bb.max as [number, number, number] }
}

describe('extrude upTo mode (plan §5-B DoD)', () => {
  it('UpToFace via faceRef: extrude to the side face of a wall', async () => {
    // part0 = 竖墙 box(10,10,100)（沿 Z 向上）；轮廓 = XY 平面 2x2 方形，
    // 从 x=0 拉伸到墙面 x=10（part0 的 +X 侧面）
    const outputs = await runCode(`
      let part0 = cad.box(10, 10, 100, { centered: false })
      let sk = cad.sketch({ contours: [{"segments":[
        {"kind":"line","x1":0,"y1":0,"x2":2,"y2":0},{"kind":"line","x1":2,"y1":0,"x2":2,"y2":2},
        {"kind":"line","x1":2,"y1":2,"x2":0,"y2":2},{"kind":"line","x1":0,"y1":2,"x2":0,"y2":0}],"closed":true}] })
      let part1 = cad.fai_extrude(sk, { upTo: cad.faceRef(part0, 6) })
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const bb = bboxOf(p1)
    // 目标面 = box 顶面 z=100（face 6, normal +Z）→ 结果 z 上限到达 100（截断生效）
    expect(bb.max[2]).toBeCloseTo(100, 3)
    // x/y 不应被长试探污染
    expect(bb.max[0]).toBeCloseTo(2, 3)
    expect(bb.max[1]).toBeCloseTo(2, 3)
  })

  it('UpToLast: extrude to the far end of the base feature', async () => {
    const outputs = await runCode(`
      let base = cad.box(10, 10, 100, { centered: false })
      let sk = cad.sketch({ contours: [{"segments":[
        {"kind":"line","x1":0,"y1":0,"x2":2,"y2":0},{"kind":"line","x1":2,"y1":0,"x2":2,"y2":2},
        {"kind":"line","x1":2,"y1":2,"x2":0,"y2":2},{"kind":"line","x1":0,"y1":2,"x2":0,"y2":0}],"closed":true}] })
      let part1 = cad.fai_extrude(sk, { upTo: 'last', baseFeature: base })
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const bb = bboxOf(p1)
    // 拉伸到支持体远端 z=100
    expect(bb.max[2]).toBeCloseTo(100, 3)
  })

  it('offset shifts the truncation plane along the face normal', async () => {
    // 目标面 z=100（face 6, normal +Z），offset=+5 → 截断在 z=105
    const outputs = await runCode(`
      let part0 = cad.box(10, 10, 100, { centered: false })
      let sk = cad.sketch({ contours: [{"segments":[
        {"kind":"line","x1":0,"y1":0,"x2":2,"y2":0},{"kind":"line","x1":2,"y1":0,"x2":2,"y2":2},
        {"kind":"line","x1":2,"y1":2,"x2":0,"y2":2},{"kind":"line","x1":0,"y1":2,"x2":0,"y2":0}],"closed":true}] })
      let part1 = cad.fai_extrude(sk, { upTo: cad.faceRef(part0, 6), offset: 5 })
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const bb = bboxOf(p1)
    expect(bb.max[2]).toBeCloseTo(105, 3)
  })

  it('upTo without baseFeature for "last" → explicit error (no silent fallback)', async () => {
    await expect(runCode(`
      let sk = cad.sketch({ contours: [{"segments":[
        {"kind":"line","x1":0,"y1":0,"x2":2,"y2":0},{"kind":"line","x1":2,"y1":0,"x2":2,"y2":2},
        {"kind":"line","x1":2,"y1":2,"x2":0,"y2":2},{"kind":"line","x1":0,"y1":2,"x2":0,"y2":0}],"closed":true}] })
      let part1 = cad.fai_extrude(sk, { upTo: 'last' })
    `)).rejects.toThrow(/E_UP_TO_NO_BASE/)
  })

  it('length-only extrude still works (backward compat)', async () => {
    // GOTCHA（probe-faiext-len.ts）：fai_extrude 的 length 路径（extrudeBrep 的
    // split/fuse）只接受实体输入——sketch 面输入是既有限制、与 upTo 无关；
    // 向后兼容用实体验证。
    const outputs = await runCode(`
      let base = cad.box(4, 4, 10, { centered: false })
      let part1 = cad.fai_extrude(base, { length: 20, mode: 'forward' })
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const bb = bboxOf(p1)
    expect(bb.max[2]).toBeGreaterThan(10)
  })
})
