/**
 * PBR 外观 brep 链 e2e（设计文档 2026-10-05 v2 §3.2 / §4.2；P4c 补充）
 *
 * 背景：编辑器（desktop/web/weapp）worker 全部走 brep 链（createRuntime mode
 * 'brep' / auto→brep）。P4a 面级 API 初版只覆盖 mesh 链（mode='mesh' 的 A8–A11），
 * brep 链下 `box1.setFaceColor(...)` 曾抛 E_FACE_UNAVAILABLE——编辑器主场景不可用。
 * P4c 在 api/primitives.ts 的 brepPrimitiveMesh 补契约序 faceRanges：
 * - box：OCCT 面枚举序（实测 0=−X,1=+Y,…）与契约（+X/−X/+Y/−Y/+Z/−Z）不一致 →
 *   按面法线重排 indices 到契约序；
 * - cylinder/cone：OCCT 枚举序与契约一致（实测锁定：cylinder 0=侧面,1=顶,2=底；
 *   cone radiusTop=0 0=侧面,1=底）→ 直接透传；
 * - 布尔/组合产物不挂 faceRanges → setFaceColor 仍 E_FACE_UNAVAILABLE。
 *
 * 锁定：
 * - B1：brep 链 box `setFaceColor([0], '#ff0000')` → materialGroups 契约序
 *   （面 0 = +X，tri 0..1）。
 * - B2：brep 链 cylinder `setFaceColor([1], ...)` → 顶面分组生效（start 在侧面
 *   之后；不锁具体值，segments 相关）。
 * - B3：brep 链布尔（union）产物 `setFaceColor` → E_FACE_UNAVAILABLE。
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

describe('B: PBR 外观 brep 链面级（编辑器默认链）', () => {
  it('B1：brep box setFaceColor([0]) → 契约序 materialGroups（面 0 = +X, tri 0..1）', async () => {
    const rt = track(brepRuntime())
    const r = await rt.execute(`let box1 = cad.box(10, 10, 10)
box1.setFaceColor([0], '#ff0000')
return { shape: box1 }
`)
    const s = outputOf(r, 'box1')
    expect(s.materialGroups).toBeDefined()
    expect(s.materialGroups!.length).toBe(1)
    expect(s.materialGroups![0]).toMatchObject({ start: 0, count: 2 })
    expect(s.materialGroups![0].appearance.color).toEqual([1, 0, 0])
    // brep 链 box 共 6 面 × 2 三角形 = 12（契约序重排后）
    expect(s.indices.length / 3).toBe(12)
  })

  it('B2：brep cylinder setFaceColor([1]) → 顶面分组（侧面之后）', async () => {
    const rt = track(brepRuntime())
    const r = await rt.execute(`let cyl1 = cad.cylinder(5, 10)
cyl1.setFaceColor([1], [0, 0, 1])
return { shape: cyl1 }
`)
    const s = outputOf(r, 'cyl1')
    expect(s.materialGroups).toBeDefined()
    const g = s.materialGroups![0]
    // 面 1 = 顶（契约）：分组起点在侧面三角形之后
    expect(g.start).toBeGreaterThan(0)
    expect(g.count).toBeGreaterThan(0)
    expect(g.appearance.color).toEqual([0, 0, 1])
  })

  it('B3：brep 布尔产物 setFaceColor → E_FACE_UNAVAILABLE', async () => {
    const rt = track(brepRuntime())
    const r = await rt.execute(`let box1 = cad.box(10, 10, 10)
let box2 = cad.box(5, 5, 5)
let u = cad.union(box1, box2)
u.setFaceColor([0], '#ff0000')
return { shape: u }
`)
    expect(r.failedAt).toBeDefined()
    expect(JSON.stringify(r.failedAt)).toMatch(/E_FACE_UNAVAILABLE/)
  })
})
