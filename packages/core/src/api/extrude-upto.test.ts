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

describe('cad.extrude upTo { plane } 显式平面目标（PadTest Pad001 斜置基准面 GOTCHA 留档）', () => {
  // GOTCHA（PadTest V6 排障，2026-09-19）：斜置基准面不能转成定长拉伸——
  // 定长给平顶（1874.83），FreeCAD 真值是斜顶（4860.42）。必须发显式平面
  // 目标，由内核半空间求交产生斜截。三个错误用法均已实测踩坑：
  //   ① 轴对齐半空间盒（farSideBox 旧实现）→ 截断呈台阶（7076）
  //   ② reach 只按投影距离取 → 半空间盒横向盖不住 → common 为空 KERNEL_ERROR
  //   ③ 固定沿 +Z 拉 → 平面在反方向（t<0）→ 体积 597
  // 正确用法：定向盒（makeBasis(u,v,n) + transform）+ reach 覆盖全向 +
  // 自动定向（tAuto<0 时翻转拉伸方向）。
  it('斜平面目标产生斜顶棱柱（自动朝平面方向拉伸）', async () => {
    // 圆轮廓（PadTest Sketch001，r=7.728，面积 187.6）；斜平面法向
    // n=(−0.705,0.071,0.705)，圆心处交点 z=−26.06 → 真值体积 4860.42。
    const outputs = await runCode(`
      let sk = cad.sketch({ contours: [{"segments":[{"kind":"arc","cx":-33.057236,"cy":30.001772,"radius":7.728417011119,"startAngle":0,"endAngle":6.283185307179586,"ccw":true,"x1":-25.328818988881004,"y1":30.001772,"x2":-25.328818988881004,"y2":30.001772}],"closed":true}] })
      let part1 = cad.extrude(sk, { upTo: { plane: { point: [-50, 100, -49.99999999999997], normal: [-0.7053456158587508, 0.07053456158639328, 0.7053456158583923] } } })
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const kernel = getBackends().kernel.brep!
    const mesh = kernel.tessellate(brepOf(p1), 0.01)
    const pos = mesh.positions as Float32Array
    const idx = mesh.indices as Uint32Array
    let v6 = 0
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3
      v6 += pos[a]! * (pos[b + 1]! * pos[c + 2]! - pos[b + 2]! * pos[c + 1]!)
        - pos[a + 1]! * (pos[b]! * pos[c + 2]! - pos[b + 2]! * pos[c]!)
        + pos[a + 2]! * (pos[b]! * pos[c + 1]! - pos[b + 1]! * pos[c]!)
    }
    const vol = Math.abs(v6 / 6)
    // 真值（FreeCAD PadTest Pad001.AddShape）= 4860.423；斜截圆台无解析
    // 闭式（斜平面截圆柱为椭圆柱段），用 tessellate 噪声容忍度 2% 钉住。
    expect(vol).toBeGreaterThan(4860.423 * 0.98)
    expect(vol).toBeLessThan(4860.423 * 1.02)
  })

  it('平面目标在拉伸正方向时不翻转方向（正常 UpToFace）', async () => {
    // 平面 z=10（法向 +Z），轮廓 [0,2]² 沿 +Z 拉：体积 = 4×10 = 40
    const outputs = await runCode(`
      let sk = cad.sketch({ contours: [${SQUARE_2X2}] })
      let part1 = cad.extrude(sk, { upTo: { plane: { point: [0, 0, 10], normal: [0, 0, 1] } } })
    `)
    const p1 = outputs.get(asPartName('part1'))
    expect(p1).toBeDefined()
    if (!p1) return
    const bb = bboxOf(p1)
    expect(bb.max[2]).toBeCloseTo(10, 3)
    expect(bb.min[2]).toBeCloseTo(0, 3)
  })
})
