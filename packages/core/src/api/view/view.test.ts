/**
 * view — 视图投影能力测试（P25：faijs 视图投影与截图能力）
 *
 * 环境：initOcctWasm() + auto 模式（BREP 链活跃——projectView/projectSheet
 * 需要带 BREP 槽的 faijs Shape，borrowBrepjsShape 借入 OCCT 句柄）。
 *
 * 覆盖：
 * - viewCamera：标准视图/iso/轴对平面/任意方向/非法视图；
 * - projectView：SVG 结构、隐藏虚线、纯数据（不修改 shape）、无 BREP 槽报错；
 * - projectSheet：网格排布、标签、空列表。
 *
 * Run: npx vitest run src/api/view/view.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../cad-runtime/runtime'
import { createApiNamespace } from '../api-namespace'
import type { HostPorts } from '../../cad-runtime/ports'
import { initOcctWasm } from '../../occt-kernel/occtKernel'
import { viewCamera } from './view-camera'
import { projectView, projectViewSvg } from './view-projection'
import { projectSheet } from './view-sheet'
import { solid } from '../../shape'
import type { Shape } from '../../mesh/types'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const WARMUP = 'let warmup = cad.box(1, 1, 1, { centered: true })'
const BOX_CODE = 'let part0 = cad.box(10, 20, 30, { centered: true })'

describe('viewCamera：视图规格 → 相机纯数据', () => {
  it('六个标准视图方向映射（vendored PROJECTION_PLANES / FreeCAD 惯例）', () => {
    expect(viewCamera('front').direction).toEqual([0, -1, 0])
    expect(viewCamera('back').direction).toEqual([0, 1, 0])
    expect(viewCamera('top').direction).toEqual([0, 0, -1])
    expect(viewCamera('bottom').direction).toEqual([0, 0, 1])
    expect(viewCamera('left').direction).toEqual([1, 0, 0])
    expect(viewCamera('right').direction).toEqual([-1, 0, 0])
  })

  it('iso 方向 (1,-1,1)（归一化），isometric 同义', () => {
    const c = viewCamera('iso')
    const n = Math.sqrt(3)
    expect(c.direction[0]).toBeCloseTo(1 / n, 6)
    expect(c.direction[1]).toBeCloseTo(-1 / n, 6)
    expect(c.direction[2]).toBeCloseTo(1 / n, 6)
    expect(viewCamera('isometric').direction).toEqual(c.direction)
  })

  it('轴对平面（XY/XZ/YZ）', () => {
    expect(viewCamera('XY').direction).toEqual([0, 0, 1])
    expect(viewCamera('XZ').direction).toEqual([0, -1, 0])
    expect(viewCamera('YZ').direction).toEqual([1, 0, 0])
  })

  it('任意方向对象（dir + 可选 xAxis）', () => {
    const c = viewCamera({ dir: [1, 0, 0], xAxis: [0, 1, 0] })
    expect(c.direction).toEqual([1, 0, 0])
    expect(c.xAxis).toEqual([0, 1, 0])
    // 缺省 xAxis 由方向自动推导（与 direction 正交）
    const d = viewCamera({ dir: [0, 1, 0] })
    expect(Math.abs(d.xAxis[0] * 0 + d.xAxis[1] * 1 + d.xAxis[2] * 0)).toBeCloseTo(0, 6)
  })

  it('未知视图名抛错', () => {
    expect(() => viewCamera('northwest' as never)).toThrow(/unknown view/)
  })

  it('零方向向量抛错（vendored CAMERA_ZERO_DIRECTION）', () => {
    expect(() => viewCamera({ dir: [0, 0, 0] })).toThrow()
  })
})

describe('projectView：单视图投影 SVG', () => {
  const cadNs = createApiNamespace()
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: cadNs })
    await rt.execute(WARMUP)
  }, 120000)

  async function boxShape(): Promise<Shape> {
    const res = await rt.execute(BOX_CODE)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get('part0' as never)
    expect(shape).toBeDefined()
    return shape as Shape
  }

  it('front 视图返回完整 SVG（svg/viewBox/path/隐藏虚线）', async () => {
    const part = await boxShape()
    const svg = projectView(part, 'front')
    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox=')
    expect(svg).toContain('<path')
    // 隐藏线以虚线呈现
    expect(svg).toContain('stroke-dasharray')
  })

  it('iso 视图非空且含隐藏线', async () => {
    const part = await boxShape()
    const svg = projectView(part, 'iso')
    expect(svg).toContain('<path')
    expect(svg).toContain('stroke-dasharray')
  })

  it('投影是纯数据：不修改输入 shape（positions 逐位不变）', async () => {
    const part = await boxShape()
    const positionsBefore = Array.from(part.positions)
    const svg = projectView(part, 'front')
    expect(svg.length).toBeGreaterThan(0)
    expect(Array.from(part.positions)).toEqual(positionsBefore)
  })

  it('结构化结果：viewBox 尺寸 > 0 且 width/height 一致', async () => {
    const part = await boxShape()
    const r = projectViewSvg(part, 'top')
    const nums = r.viewBox.split(/\s+/).map(Number)
    expect(nums).toHaveLength(4)
    expect(nums[2]).toBeGreaterThan(0) // 宽
    expect(nums[3]).toBeGreaterThan(0) // 高
    expect(r.width).toBe(nums[2])
    expect(r.height).toBe(nums[3])
    expect(r.paths.visible.length).toBeGreaterThan(0)
  })

  it('自定义线宽/虚线/透明度生效', async () => {
    const part = await boxShape()
    const svg = projectView(part, 'front', { strokeWidth: 2, dash: '2,2', hiddenOpacity: 0.3 })
    expect(svg).toContain('stroke-width="2"')
    expect(svg).toContain('stroke-dasharray="2,2"')
    expect(svg).toContain('opacity="0.3"')
  })

  it('无 BREP 槽的 mesh-only shape 抛 E_BREP_ONLY_INPUT', () => {
    const bare = solid({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    })
    expect(() => projectView(bare, 'front')).toThrow(/E_BREP_ONLY_INPUT/)
  })
})

describe('projectSheet：多视图图纸 SVG', () => {
  const cadNs = createApiNamespace()
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: cadNs })
    await rt.execute(WARMUP)
  }, 120000)

  async function boxShape(): Promise<Shape> {
    const res = await rt.execute(BOX_CODE)
    return res.outputs.get('part0' as never) as Shape
  }

  it('三视图 + iso 四格排布 + 默认标签', async () => {
    const part = await boxShape()
    const sheet = projectSheet(part, ['front', 'top', 'right', 'iso'])
    expect(sheet).toContain('<svg')
    // 4 个嵌套子 svg（网格格子）
    const subs = sheet.match(/<svg x="/g) ?? []
    expect(subs.length).toBe(4)
    // 默认标签 = 视图名
    expect(sheet).toContain('>front</text>')
    expect(sheet).toContain('>iso</text>')
    // 每格含路径
    expect(sheet).toContain('<path')
  })

  it('自定义标签与列数（labels 开关）', async () => {
    const part = await boxShape()
    const sheet = projectSheet(
      part,
      [{ view: 'front', label: '主视图' }, { view: 'iso', label: '等轴测' }],
      { cols: 2, gap: 40 },
    )
    expect(sheet).toContain('>主视图</text>')
    expect(sheet).toContain('>等轴测</text>')
    const noLabel = projectSheet(part, ['front', 'iso'], { labels: false })
    expect(noLabel).not.toContain('<text')
  })

  it('空视图列表返回空 svg（不抛错）', async () => {
    const part = await boxShape()
    const sheet = projectSheet(part, [])
    expect(sheet).toContain('<svg')
    expect(sheet).toContain('width="0"')
  })

  it('方向对象视图标签取方向分量', async () => {
    const part = await boxShape()
    const sheet = projectSheet(part, [{ view: { dir: [1, -1, 1] } }])
    expect(sheet).toContain('>1,-1,1</text>')
  })
})
