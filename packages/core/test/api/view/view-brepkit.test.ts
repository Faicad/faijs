/**
 * view-brepkit — SVG 视图投影在 brepkit 引擎下的方言通道测试
 *
 * 方案：docs/plans/2026-10-11-brepkit-svg-view.md（与 STEP 引擎中立化同基调：
 * projectPolylines 按引擎 id 静态分派通道，无门禁、无 engines 声明、不报错）。
 *
 * 覆盖：
 * - brepkit 下 projectView：非空 SVG、含可见线 path、隐藏虚线（内核精确
 *   point-in-solid 遮挡测试，iso 视图下 box 远角棱为隐藏线）；
 * - brepkit 下 projectViewSvg：结构化结果（viewBox 尺寸 > 0、纯数据不修改 shape）；
 * - brepkit 下 projectSheet：多视图组合 SVG；
 * - 投影是纯数据：不消费输入 shape。
 *
 * occt 通道行为不变由 test/api/view/view.test.ts 钉住（本文件不动它）。
 *
 * Run: npx vitest run test/api/view/view-brepkit.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { createEditorRuntime } from '../../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerBrepkitMeshEngine, registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'
import { projectView, projectViewSvg } from '../../../src/api/view/view-projection'
import { projectSheet } from '../../../src/api/view/view-sheet'
import type { Shape } from '../../../src/mesh/types'
import { asPartName } from '../../../src/identity'

function ports(): HostPorts {
  return { events: { emit: () => undefined } } as unknown as HostPorts
}

describe('brepkit × SVG 视图投影（原生折线通道）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
    await registerBrepkitBrepEngine()
  })
  afterAll(() => { disposeBrepkit() })

  async function boxShape(mode: 'brep' | 'auto' = 'brep'): Promise<Shape> {
    const runtime = createEditorRuntime(ports(), mode)
    const res = await runtime.execute('const p0 = cad.box(10, 20, 30)\n')
    expect(res.failedAt?.message ?? 'no failure').toBe('no failure')
    const s = res.outputs.get(asPartName('p0')) as Shape | undefined
    expect(s).toBeDefined()
    return s!
  }

  it('projectView(front)：非空 SVG，含可见线 path', async () => {
    const part = await boxShape()
    const svg = projectView(part, 'front')
    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox=')
    expect(svg).toContain('<path')
  })

  it('projectView(iso)：含隐藏虚线（box 远角棱被精确遮挡测试判为隐藏）', async () => {
    const part = await boxShape()
    const svg = projectView(part, 'iso')
    expect(svg).toContain('<path')
    expect(svg).toContain('stroke-dasharray')
  })

  it('结构化结果：viewBox 覆盖 10×20×30 box 的投影尺寸（含 margin）', async () => {
    const part = await boxShape()
    const r = projectViewSvg(part, 'front')
    const nums = r.viewBox.split(/\s+/).map(Number)
    expect(nums).toHaveLength(4)
    expect(nums[2]).toBeGreaterThan(0)
    expect(nums[3]).toBeGreaterThan(0)
    expect(r.width).toBe(nums[2])
    expect(r.height).toBe(nums[3])
    // front 视图（沿 -Y 看）：投影宽 = 10（X），高 = 30（Z）
    expect(r.paths.visible.length).toBeGreaterThan(0)
    expect(nums[2]).toBeCloseTo(12, 0) // 10 + 2×margin(1)
    expect(nums[3]).toBeCloseTo(32, 0) // 30 + 2×margin(1)
  })

  it('投影是纯数据：不修改输入 shape（positions 逐位不变）', async () => {
    const part = await boxShape()
    const before = Array.from(part.positions)
    const svg = projectView(part, 'front')
    expect(svg.length).toBeGreaterThan(0)
    expect(Array.from(part.positions)).toEqual(before)
  })

  it('projectSheet：多视图组合 SVG，每格含 path', async () => {
    const part = await boxShape()
    const sheet = projectSheet(part, ['front', 'top', 'right', 'iso'])
    expect(sheet).toContain('<svg')
    const subs = sheet.match(/<svg x="/g) ?? []
    expect(subs.length).toBe(4)
    expect(sheet).toContain('>front</text>')
    expect(sheet).toContain('<path')
  })

  it('auto 模式（BREP 链活跃）下同样可用', async () => {
    const part = await boxShape('auto')
    const svg = projectView(part, 'front')
    expect(svg).toContain('<path')
  })
})
