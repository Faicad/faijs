/**
 * fillet per-edge breakdown — brepkit 内核（weapp worker）缺陷清单固化（2026-10-16）。
 *
 * 用户主线 bug：weapp 真机「草图画矩形→拉伸→选边→圆角→预览→整个模型消失」。
 * 根因（协议层 weapp bundle 诊断 + OCCT 对照）：
 *   1. weapp worker = brepkit 内核。brepkit fillet 对 26×34×10 长方体 12 条边逐条圆角：
 *      - edge#3 / edge#6 → E_FILLET_RADIUS_TOO_LARGE（execute 失败）；
 *      - edge#0 / edge#7 / edge#10 → execute "成功"但 **mesh 输出退化**
 *        （bbox 压扁成线段/单点，顶点数骤减）——weapp 渲染只用 mesh，退化 → 不可见。
 *   2. 用户点边 → 圆角 execute 成功 → part0 移除、part1 mesh 退化 → 画布空白
 *      =「整个模型消失」；execute 成功所以 UI 不报错。
 *   3. OCCT（web 默认）同场景 12 边全部健康（见 fillet-per-edge-occt.test.ts）。
 *
 * 本文件只注册 brepkit（R8：默认引擎 = 第一个注册者，故与 OCCT 测试分文件隔离）。
 * 断言把缺陷清单钉死：清单以外必须全部健康；内核修复后翻转断言。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { createNodePorts } from '@faicad/faijs/node'
import { registerBrepkitBrepEngine } from '@faicad/faijs'
import { asPartName, type PartName } from '@faicad/faijs/identity'
import type { CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import { createEditorRuntime } from '../_support/editor-runtime'

const SKETCH_EXTRUDE = `
  const sk0 = cad.sketch({ shapes:[{kind:'rect', cx:0, cy:0, w:26, d:34}], constraints:[], plane:'XZ' })
  const part0 = cad.extrude(sk0, { length:10, normal:[0,-1,0] })
`

async function edgeRefsOf(runtime: CadRuntime, code: string): Promise<Array<{ ei: number; faces: unknown }>> {
  const base = await runtime.execute(code, { topology: 'auto' })
  expect(base.failedAt, 'sketch+extrude 基线').toBeUndefined()
  const rows = base.naming?.get(asPartName('part0'))?.edgeNaming ?? []
  expect(rows.length, 'edgeNaming 行数应为 12').toBe(12)
  const refs: Array<{ ei: number; faces: unknown }> = []
  for (let ei = 0; ei < rows.length; ei++) {
    const faces = rows[ei].faces
    if (Array.isArray(faces) && faces.length >= 2) refs.push({ ei, faces })
  }
  return refs
}

describe('fillet per-edge breakdown（brepkit 内核 = weapp worker）', () => {
  let runtime: CadRuntime

  beforeAll(async () => {
    await registerBrepkitBrepEngine()
  }, 120000)

  beforeEach(() => {
    runtime = createEditorRuntime(createNodePorts(), 'brep')
  })
  afterEach(() => runtime.dispose())

  it('T-K1: 12 条边逐条圆角——失败/退化边必须如实报错（物体不消失）', async () => {
    const refs = await edgeRefsOf(runtime, SKETCH_EXTRUDE)
    expect(refs.length).toBe(12)
    const failures: number[] = []
    const degenerateErrors: number[] = []
    for (const { ei, faces } of refs) {
      const code = `${SKETCH_EXTRUDE}\nconst part1 = cad.fillet(part0, { edges: [{kind:'edge',faces:${JSON.stringify(faces)},hint:{kind:'edge'}}], radius: 2 })`
      const res = await runtime.execute(code, { topology: 'auto' })
      if (res.failedAt) {
        const msg = res.failedAt.message
        if (msg.includes('E_FILLET_DEGENERATE_MESH')) {
          // 2026-10-16 契约翻转：退化几何必须如实报错（fillet.ts
          // assertNonDegenerateFilletMesh），绝不静默放行 —— 否则渲染不可见
          // =「物体消失」且 UI 无提示。报错时 execute 失败、场景保持操作前状态。
          console.log(`[T-K1] edge#${ei} 如实报错（退化几何）: ${msg}`)
          degenerateErrors.push(ei)
        } else {
          console.log(`[T-K1] edge#${ei} 失败: ${msg}`)
          failures.push(ei)
        }
        continue
      }
      // 未报错 → 结果必须健康（内核修复后的契约）：outputs mesh bbox 三维非退化。
      const out = res.outputs?.get(asPartName('part1'))
      expect(out, `edge#${ei} 未报错但 outputs 无 part1`).toBeTruthy()
      // part1 是单实体 mesh 输出（非 compound）；in 判定同时完成类型窄化
      if (!('positions' in out!)) throw new Error(`edge#${ei} 输出不是 mesh Shape`)
      const pos = out.positions
      const triCount = out.indices.length / 3
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2]
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      }
      const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ
      const degenerate = !(sx > 1e-6 && sy > 1e-6 && sz > 1e-6)
      console.log(
        `[T-K1] edge#${ei} 健康: verts=${pos.length / 3} tris=${triCount} bbox=[${minX.toFixed(2)},${minY.toFixed(2)},${minZ.toFixed(2)}]..[${maxX.toFixed(2)},${maxY.toFixed(2)},${maxZ.toFixed(2)}]`,
      )
      expect(degenerate, `edge#${ei} 未报错但 mesh 退化（bbox 压扁）`).toBe(false)
    }
    console.log(`[T-K1] failures=${JSON.stringify(failures)} degenerateErrors=${JSON.stringify(degenerateErrors)}`)
    // 已知内核缺陷清单（2026-10-16 协议层诊断，weapp bundle = brepkit-wasm 4.1.49）：
    //   失败边：edge#3、edge#6（E_FILLET_RADIUS_TOO_LARGE，内核直接拒绝）；
    //   退化边：edge#0、edge#7、edge#10（FilletBuilder 输出退化几何——现在必须
    //   E_FILLET_DEGENERATE_MESH 如实报错，而非静默输出不可见 mesh）。
    // 断言「缺陷存在、如实暴露且不扩散」：清单以外必须全部健康；内核修复后翻转此断言。
    expect(failures.sort((a, b) => a - b)).toEqual([3, 6])
    expect(degenerateErrors.sort((a, b) => a - b)).toEqual([0, 7, 10])
  })
})
