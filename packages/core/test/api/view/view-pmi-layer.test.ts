/**
 * view-pmi-layer — 工程图 PMI 图层（自动摆放 / 自动渲染）防回归测试
 *
 * 覆盖：
 * - **坐标系等价性**（本文件最重要的一条）：标注锚点的 2D 投影与 HLR 线稿坐标
 *   逐位一致。这条等式是 `pmi-layer.ts` 的全部前提；HLR 输出的坐标原点/基向量
 *   一旦变化，这个用例必须红。
 * - 图层结构：独立 `<g id="pmi" inkscape:groupmode="layer">`，叠在线稿 `<g>` 之后。
 * - 可见性：背面标注跳过；侧立面（`n·d≈0`）不算背面。
 * - 各类标注的默认渲染：线性尺寸（尺寸线/箭头/公差文本）、形位公差 FCF、
 *   基准符号、表面粗糙度、全局注释（右下角）、螺纹孔（formatThreadHole 文本）。
 * - 关闭开关 `pmi: false`；多视图图纸里图层 id 唯一。
 *
 * Run: npx vitest run test/api/view/view-pmi-layer.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { projectView, projectViewSvg } from '../../../src/api/view/view-projection'
import { projectSheet } from '../../../src/api/view/view-sheet'
import { buildPmiLayer } from '../../../src/api/view/pmi-layer'
import { viewCamera } from '../../../src/api/view/view-camera'
import { solid } from '../../../src/shape'
import type { Shape } from '../../../src/mesh/types'
import { createApiNamespace } from '../../../src/api/api-namespace'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/**
 * box(10,20,30) 不居中 → 占 [0,10]×[0,20]×[0,30]。
 * 面序号（实测）：1=x0(−x) 2=x10(+x) 3=y0(−y) 4=y20(+y) 5=z0(−z) 6=z30(+z)。
 *
 * front 视图（dir (0,-1,0)、xAxis (1,0,0)、yAxis (0,0,1)）：
 * - 面3 正面（n·d=1，可见）、面4 背面（n·d=−1，跳过）、面1/2 侧立（n·d=0，不算背面）。
 */
const BOX = 'let part0 = cad.box(10, 20, 30)'

describe('PMI 图层：坐标系与图层结构', () => {
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: createApiNamespace() })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  async function part(code: string): Promise<Shape> {
    const res = await rt.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get('part0' as never)
    expect(shape).toBeDefined()
    return shape as Shape
  }

  it('锚点投影与 HLR 线稿同坐标系（尺寸线端点 == 面心 u 坐标）', async () => {
    const p = await part(`${BOX}
part0.addDimension({
  dimType: 'linearX',
  targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)],
  nominal: 10,
})`)
    const r = projectViewSvg(p, 'front')
    expect(r.pmi?.count).toBe(1)
    // 尺寸线两端的 u 必须落在 x=0 与 x=10 两条线上（HLR 线稿的 bbox 也是 [0,10]）
    const line = /<line[^>]*data-pmi="dim-line"[^>]*x1="([-\d.]+)"[^>]*x2="([-\d.]+)"/.exec(r.pmi!.markup)
    expect(line).not.toBeNull()
    const xs = [Number(line![1]), Number(line![2])].sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(0, 2)
    expect(xs[1]).toBeCloseTo(10, 2)
    // 线稿 bbox 与标注 viewBox 同源：u ∈ [0,10]
    expect(r.viewBox.split(/\s+/).length).toBe(4)
  })

  it('图层是独立 <g>，位于线稿之后（文档顺序 = 堆叠顺序）', async () => {
    const p = await part(`${BOX}
part0.addDimension({ dimType: 'linearX', targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)], nominal: 10 })`)
    const svg = projectView(p, 'front')
    expect(svg).toContain('xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"')
    // 图层 id = `pmi-<视图>`（文档内唯一）；统一钩子是 data-layer="pmi"
    expect(svg).toContain('id="pmi-front"')
    expect(svg).toContain('inkscape:groupmode="layer"')
    expect(svg).toContain('inkscape:label="PMI"')
    expect(svg).toContain('data-layer="pmi"')
    // PMI 图层在线稿 <g> 之后
    expect(svg.indexOf('data-layer="pmi"')).toBeGreaterThan(svg.indexOf('<g stroke="#000" fill="none">'))
    // 箭头 marker 在图层内定义
    expect(svg).toContain('<marker id="__PMI_ARROW_front__"')
  })

  it('无 PMI 的 shape：不产生图层、输出与旧版一致（无 inkscape 命名空间）', async () => {
    const p = await part(BOX)
    const svg = projectView(p, 'front')
    expect(svg).not.toContain('data-layer="pmi"')
    expect(svg).not.toContain('inkscape')
  })

  it('pmi: false 关闭图层', async () => {
    const p = await part(`${BOX}
part0.addDimension({ dimType: 'linearX', targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)], nominal: 10 })`)
    const r = projectViewSvg(p, 'front', { pmi: false })
    expect(r.pmi).toBeUndefined()
    expect(r.svg).not.toContain('data-layer="pmi"')
  })
})

describe('PMI 图层：可见性与各类标注渲染', () => {
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: createApiNamespace() })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  async function part(code: string): Promise<Shape> {
    const res = await rt.execute(code)
    expect(res.failedAt).toBeUndefined()
    return res.outputs.get('part0' as never) as Shape
  }

  it('背面标注跳过；侧立面（n·d≈0）照常渲染', async () => {
    // 面3(y=0) 是正面、面4(y=20) 是背面：跨二者的尺寸整条跳过
    const hidden = await part(`${BOX}
part0.addDimension({ dimType: 'linearY', targets: [cad.faceRef(part0, 3), cad.faceRef(part0, 4)], nominal: 20 })`)
    const rHidden = projectViewSvg(hidden, 'front')
    expect(rHidden.pmi?.count).toBe(0)
    expect(rHidden.pmi?.skipped).toBe(1)

    // 面1/面2 侧立：不算背面 → 渲染
    const side = await part(`${BOX}
part0.addDimension({ dimType: 'linearX', targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)], nominal: 10 })`)
    expect(projectViewSvg(side, 'front').pmi?.count).toBe(1)
  })

  it('showHiddenTargets 可强制渲染背面标注', async () => {
    // 面4(y=20) 法向 +y，front 视向下是背面 → 基准符号默认跳过
    const p = await part(`${BOX}
part0.addDatum({ identifier: 'C', datumType: 'datumPlane', target: cad.faceRef(part0, 4) })`)
    expect(projectViewSvg(p, 'front').pmi?.count).toBe(0)
    const forced = projectViewSvg(p, 'front', { pmi: { showHiddenTargets: true } })
    expect(forced.pmi?.count).toBe(1)
    expect(forced.pmi?.markup).toContain('>C<')
  })

  it('线性尺寸：尺寸线 + 双箭头 + 公差文本 + 延伸线', async () => {
    const p = await part(`${BOX}
part0.addDimension({
  dimType: 'linearX',
  targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)],
  nominal: 10,
  upperTolerance: 0.021,
  lowerTolerance: 0,
})`)
    const m = projectViewSvg(p, 'front').pmi!.markup
    expect(m).toContain('data-pmi="dim-line"')
    expect(m).toContain('marker-start="url(#__PMI_ARROW_front__)"')
    expect(m).toContain('marker-end="url(#__PMI_ARROW_front__)"')
    expect(m).toContain('data-pmi="dim-ext"')
    expect(m).toContain('10 +0.021/0')
  })

  it('名义值缺省时按几何量出（linearX = 面心 x 差）', async () => {
    const p = await part(`${BOX}
part0.addDimension({ dimType: 'linearX', targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)] })`)
    expect(projectViewSvg(p, 'front').pmi!.markup).toContain('>10<')
  })

  it('直径尺寸：从圆柱面拿到半径，渲染 Φ 文本', async () => {
    // cylinder 的面序（实测）：1=侧壁(cylinder, r=5) 2=顶面(z=20) 3=底面(z=0)
    const res = await rt.execute(`let part0 = cad.cylinder(5, 20)
part0.addDimension({ dimType: 'diameter', targets: [cad.faceRef(part0, 1)] })`)
    expect(res.failedAt).toBeUndefined()
    const p = res.outputs.get('part0' as never) as Shape
    const r = projectViewSvg(p, 'top')
    expect(r.pmi?.count).toBe(1)
    expect(r.pmi?.markup).toContain('Φ10')
    expect(r.pmi?.markup).toContain('data-pmi="dim-leader"')
  })

  it('形位公差：特征控制框（单元格 rect）+ 引线 + 符号', async () => {
    const p = await part(`${BOX}
part0.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(part0, 5) })
part0.addGdt({ gdtType: 'perpendicularity', target: cad.faceRef(part0, 3), tolerance: 0.05, datums: ['A'] })`)
    const m = projectViewSvg(p, 'front').pmi!.markup
    expect(m).toContain('data-pmi="gdt-frame"')
    expect(m).toContain('0.05')
    expect(m).toContain('⊥')
    expect(m).toContain('data-pmi="gdt-leader"')
  })

  it('基准符号：方框 + 实心三角 + 标识字母', async () => {
    const p = await part(`${BOX}
part0.addDatum({ identifier: 'B', datumType: 'datumPlane', target: cad.faceRef(part0, 3) })`)
    const m = projectViewSvg(p, 'front').pmi!.markup
    expect(m).toContain('data-pmi="datum-box"')
    expect(m).toContain('data-pmi="datum-triangle"')
    expect(m).toContain('>B<')
  })

  it('表面粗糙度：√ 符号 + Ra 参数', async () => {
    const p = await part(`${BOX}
part0.addSurfaceFinish({ target: cad.faceRef(part0, 3), parameter: 'Ra', value: 1.6 })`)
    const m = projectViewSvg(p, 'front').pmi!.markup
    expect(m).toContain('data-pmi="finish-symbol"')
    expect(m).toContain('Ra 1.6')
  })

  it('全局注释（无目标）落在零件右下方', async () => {
    const p = await part(`${BOX}
part0.addNote({ text: '未注公差按 GB/T 1804-m' })`)
    const r = projectViewSvg(p, 'front')
    expect(r.pmi?.count).toBe(1)
    const text = /<text[^>]*data-pmi="global-note"[^>]*x="([-\d.]+)" y="([-\d.]+)"/.exec(r.pmi!.markup)
    expect(text).not.toBeNull()
    const x = Number(text![1])
    const y = Number(text![2])
    // 零件 front 视图 bbox：u∈[0,10] v∈[0,30] → 「下方」= y 越过 v=30
    expect(y).toBeGreaterThan(30)
    expect(x).toBeGreaterThanOrEqual(0)
    // viewBox 必须为容纳全局块而向下扩展（否则文字被裁掉）
    const vb = r.viewBox.split(/\s+/).map(Number)
    expect(vb[1] + vb[3]).toBeGreaterThan(y)
  })

  it('螺纹孔：走 formatThreadHole，底孔与螺纹一体呈现', async () => {
    const res = await rt.execute(`let part0 = cad.box(40, 40, 10)
let part1 = cad.fai_drill(part0, { holeType: 'tapped', position: [20, 20, 10], diameter: 5, depth: 10, threadDepth: 8 })`)
    expect(res.failedAt).toBeUndefined()
    const p = res.outputs.get('part1' as never) as Shape
    const r = projectViewSvg(p, 'top', { pmi: { showHiddenTargets: true } })
    expect(r.pmi?.count).toBe(1)
    expect(r.pmi?.markup).toContain('底孔')
    expect(r.pmi?.markup).toMatch(/M\d/)
    expect(r.pmi?.markup).toContain('data-pmi="leader"')
  })
})

describe('PMI 图层：多视图图纸', () => {
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: createApiNamespace() })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it('projectSheet：分到标注的视图各一份图层，id 与 marker id 均唯一', async () => {
    // 两条标注会被分派到不同视图（linearX → front，z0 面基准 → top），两个图层因此
    // 同时存在；没有任何视图拿到标注时不会凭空产生空图层（见 view-pmi-layout 的
    // 「一条标注只出现一次」）。
    const res = await rt.execute(`${BOX}
part0.addDimension({ dimType: 'linearX', targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)], nominal: 10 })
part0.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(part0, 5) })`)
    const p = res.outputs.get('part0' as never) as Shape
    const sheet = projectSheet(p, ['front', 'top'])
    expect(sheet).toContain('id="pmi-front"')
    expect(sheet).toContain('id="pmi-top"')
    expect(sheet).toContain('marker id="__PMI_ARROW_front__"')
    expect(sheet).toContain('marker id="__PMI_ARROW_top__"')
    // 不能出现重复的 id="pmi"
    expect(sheet.match(/id="pmi"/g)).toBeNull()
  })

  it('projectSheet + pmi:false 不产生图层', async () => {
    const res = await rt.execute(`${BOX}
part0.addDimension({ dimType: 'linearX', targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)], nominal: 10 })`)
    const p = res.outputs.get('part0' as never) as Shape
    const sheet = projectSheet(p, ['front', 'top'], { pmi: false })
    expect(sheet).not.toContain('data-layer="pmi"')
  })
})

describe('buildPmiLayer：直接调用（宿主自定义摆放的入口）', () => {
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: createApiNamespace() })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it('返回 markup/count/skipped/extent，可自行塞进任意 SVG', async () => {
    const res = await rt.execute(`${BOX}
part0.addDimension({ dimType: 'linearX', targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)], nominal: 10 })`)
    const p = res.outputs.get('part0' as never) as Shape
    const r = buildPmiLayer(p, viewCamera('front'), { minX: 0, minY: 0, maxX: 10, maxY: 30 }, { layerName: '尺寸' })
    expect(r.count).toBe(1)
    expect(r.skipped).toBe(0)
    expect(r.markup).toContain('inkscape:label="尺寸"')
    expect(r.extent).toBeDefined()
    // 图层内容必然越出零件包围盒（自动外移），否则标注会压在图上
    const e = r.extent!
    const outside = e.maxX > 10.01 || e.minX < -0.01 || e.maxY > 30.01 || e.minY < -0.01
    expect(outside).toBe(true)
  })

  it('无 pmi 字段的 shape 返回空标记（solid() 产物也可安全调用）', async () => {
    const bare = solid({ positions: new Float32Array(), indices: new Uint32Array(), normals: new Float32Array() } as never)
    const r = buildPmiLayer(bare, viewCamera('front'), { minX: 0, minY: 0, maxX: 1, maxY: 1 })
    expect(r.markup).toBe('')
    expect(r.count).toBe(0)
  })
})
