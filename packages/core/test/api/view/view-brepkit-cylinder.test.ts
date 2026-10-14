/**
 * view-brepkit-cylinder — 圆柱投影在 brepkit 内核下的**已知限制留档**（GOTCHA）。
 *
 * 2026-10-14 3d_editor 工程图工作台反馈（圆柱渲染 bug）调查结论：
 *   - **母线缺失是 brepkit 内核 projectEdges 的已知限制**：内核 HLR 只输出
 *     锐边（sharp：顶/底圆 → 正投影为水平横线），不输出曲面的 smooth
 *     silhouette（圆柱面母线）——`cylinder(10,30)` 的 front/right/iso 视图
 *     **没有任何竖直母线**。4.1.49（npm dist-tag latest）与 weapp vendored
 *     内核行为一致，与版本无关。faijs 仅透传内核折线，无 3D 信息可补全。
 *     若内核 future 支持 silhouette，本测试的母线断言（下方 GOTCHA）可收紧。
 *   - **数据语义契约（flipY 依据）**：投影 2D 坐标按相机平面 yAxis =
 *     cross(direction, xAxis) 约定（y 向上）。iso 视图下顶部（y 大处）
 *     visible、底部（y 小处）hidden —— 3d_editor 的 wire-drawing 据此
 *     y 翻转绘制。本测试钉住此语义，防 faijs 投影方向变更导致下游静默颠倒。
 *
 * Run: npx vitest run test/api/view/view-brepkit-cylinder.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { createEditorRuntime } from '../../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerBrepkitMeshEngine, registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'
import { projectViewSvg } from '../../../src/api/view/view-projection'
import { asPartName } from '../../../src/identity'

function ports(): HostPorts {
  return { events: { emit: () => undefined } } as unknown as HostPorts
}

function firstTwo(d: string): [number, number] {
  const nums = d.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)!.map(Number)
  return [nums[0]!, nums[1]!]
}

describe('brepkit × 圆柱投影（已知限制留档 + 数据语义契约）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
    await registerBrepkitBrepEngine()
  })
  afterAll(() => {
    disposeBrepkit()
  })

  it('front/right/iso 无竖直母线（GOTCHA: brepkit 内核 projectEdges 不输出曲面 silhouette）', async () => {
    const runtime = createEditorRuntime(ports(), 'brep')
    const res = await runtime.execute('const p0 = cad.cylinder(10, 30, { centered: true })\n')
    expect(res.failedAt?.message ?? 'no failure').toBe('no failure')
    const s = res.outputs.get(asPartName('p0')) as Parameters<typeof projectViewSvg>[0]
    expect(s).toBeDefined()
    // front：可见 2 条、隐藏 0 —— 只有顶/底圆正投影（水平横线 y=±15），无母线。
    const front = projectViewSvg(s, 'front')
    expect(front.paths.visible).toHaveLength(2)
    expect(front.paths.hidden).toHaveLength(0)
    const ys = front.paths.visible.map(firstTwo).map(([, y]) => Math.abs(y))
    expect(ys).toEqual([expect.closeTo(15, 2), expect.closeTo(15, 2)])
    // right / iso：同样只有圆投影（无竖线）。若内核补 silhouette，收紧此处。
    const right = projectViewSvg(s, 'right')
    expect(right.paths.visible).toHaveLength(2)
    const iso = projectViewSvg(s, 'iso')
    expect(iso.paths.visible).toHaveLength(1)
    expect(iso.paths.hidden).toHaveLength(1)
  })

  it('iso 数据语义：顶部（y 大）visible、底部（y 小）hidden —— y 向上的相机平面坐标', async () => {
    const runtime = createEditorRuntime(ports(), 'brep')
    const res = await runtime.execute('const p0 = cad.cylinder(10, 30, { centered: true })\n')
    expect(res.failedAt?.message ?? 'no failure').toBe('no failure')
    const s = res.outputs.get(asPartName('p0')) as Parameters<typeof projectViewSvg>[0]
    expect(s).toBeDefined()
    const iso = projectViewSvg(s, 'iso')
    const visible = iso.paths.visible[0]!
    const hidden = iso.paths.hidden[0]!
    const vMin = Math.min(...visible.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1))
    const vMax = Math.max(...visible.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1))
    const hMin = Math.min(...hidden.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1))
    const hMax = Math.max(...hidden.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1))
    // 可见顶面椭圆整体在 y 大处、隐藏底面在 y 小处，两区间不重叠。
    expect(vMin).toBeGreaterThan(hMax)
    expect(vMax).toBeGreaterThan(hMin)
    expect(vMax).toBeGreaterThan(vMin)
    expect(hMax).toBeGreaterThan(hMin)
  })
})
