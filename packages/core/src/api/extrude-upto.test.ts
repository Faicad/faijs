/**
 * cad.extrude up-to mode tests — 拉伸到面 / 到支持体端面（extrude-upto-face 方案 §5-B DoD）
 *
 * 分层（AGENTS.md / 2026-09-15 port plan M4.6）：up-to 落在**平台 op `cad.extrude`**
 * （api/extrude.ts），不落在 `fai_extrude`（`fai_` 前缀的 faijs 扩展 op，FCStd
 * 移植已明确废弃该路线）。
 *
 * GOTCHA（方案 §4.2）：occt-wasm 不暴露 BRepFeat_MakePrism，up-to 用
 * 「长拉伸 → 与目标面侧半空间盒求交」等价组合；试探长度只作布尔构造辅助，
 * 结果几何由布尔决定。
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

/** 2x2 方形轮廓（XY 平面，[0,2]²）——up-to 用例共用。 */
const SQUARE_2X2 = `{"segments":[
  {"kind":"line","x1":0,"y1":0,"x2":2,"y2":0},{"kind":"line","x1":2,"y1":0,"x2":2,"y2":2},
  {"kind":"line","x1":2,"y1":2,"x2":0,"y2":2},{"kind":"line","x1":0,"y1":2,"x2":0,"y2":0}],"closed":true}`

describe('cad.extrude upTo mode (plan §5-B DoD)', () => {
  it('UpToFace via faceRef: extrude to the side face of a wall', async () => {
    // part0 = 竖墙 box(10,10,100)（沿 Z 向上）；轮廓 = XY 平面 2x2 方形，
    // 从 z=0 拉伸到墙面（part0 的 +Z 面 = face 6）
    const outputs = await runCode(`
      let part0 = cad.box(10, 10, 100, { centered: false })
      let sk = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, { upTo: cad.faceRef(part0, 6) })
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
      let sk = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, { upTo: 'last', baseFeature: base })
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
      let sk = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, { upTo: cad.faceRef(part0, 6), offset: 5 })
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const bb = bboxOf(p1)
    expect(bb.max[2]).toBeCloseTo(105, 3)
  })

  it('upTo without baseFeature for "last" → explicit error (no silent fallback)', async () => {
    await expect(runCode(`
      let sk = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, { upTo: 'last' })
    `)).rejects.toThrow(/E_UP_TO_NO_BASE/)
  })
})

describe('cad.extrude 长度形态向后兼容（生成投影委托不变语义）', () => {
  it('位置形态 cad.extrude(face, [0,0,10]) 仍可用（历史产物形态）', async () => {
    const outputs = await runCode(`
      let sk = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, [0,0,10])
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const bb = bboxOf(p1)
    expect(bb.max[2]).toBeCloseTo(10, 3)
    expect(bb.max[0]).toBeCloseTo(2, 3)
  })

  it('对象形态 cad.extrude(face, { length }) 与位置形态同几何', async () => {
    const outputs = await runCode(`
      let sk = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, [0,0,10])
      let sk2 = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part2 = cad.extrude(sk2, { length: 10 })
    `)
    const p1 = outputs.get(asPartName('part1'))
    const p2 = outputs.get(asPartName('part2'))
    expect(p1).toBeDefined()
    expect(p2).toBeDefined()
    if (!p1 || !p2) return
    expect(bboxOf(p2)).toEqual(bboxOf(p1))
  })

  it('backward 方向按 normal 取反', async () => {
    const outputs = await runCode(`
      let sk = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, { length: 10, mode: 'backward' })
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const bb = bboxOf(p1)
    expect(bb.min[2]).toBeCloseTo(-10, 3)
  })
})
