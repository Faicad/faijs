/**
 * view-pmi-layout — PMI 自动摆放的**版面不变量**防回归测试。
 *
 * 三条不变量（都是出图肉眼发现问题后才定下来的，见 pmi-layer.ts 文件头）：
 *
 * 1. **同侧只用一条基准**：band 游标量的必须是"距零件轮廓的深度"，绘制也按同一个
 *    深度落位。曾经尺寸线按"锚点位移"推进、引线类按"距轮廓"推进——同一条带里
 *    装了两个不同基准的东西，实测 front 视图 `dim-text` 与螺纹孔 `note-text`
 *    只差 0.7，小于字号 1.52，直接压在一起。
 * 2. **文字不重叠**：整份标注（尺寸/公差框/基准/粗糙度/注释/螺纹孔）在同一视图里
 *    逐个做矩形相交检查，一条都不许压。
 * 3. **全局 PMI 整张图纸只出现一次**：技术要求是零件级信息，与视图无关，四视图
 *    各印一遍等于把同一段文字印四遍；它只该在图纸右下角出现一次。
 * 4. **每条标注也只出现一次**：多视图图纸里同一条尺寸/公差/基准/粗糙度/孔标注在
 *    四个视图各画一遍，等于把同一份信息印四遍、还各自挤压摆位。`assignPmiToViews`
 *    按"正对程度 / 轴向对齐 / 投影张开度"给它挑一个**最看得清该特征**的视图，其余
 *    视图图层用 `only` 把自己不负责的条目滤掉。
 *
 * Run: npx vitest run test/api/view/view-pmi-layout.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { projectViewSvg } from '../../../src/api/view/view-projection'
import { projectSheet } from '../../../src/api/view/view-sheet'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'
import type { Shape } from '../../../src/mesh/types'

/** 一份"什么标注都有"的零件：尺寸 ×2 + 公差框 + 基准 + 粗糙度 + 全局注释 + 螺纹孔。 */
const FULLY_ANNOTATED = `
let part0 = cad.box(60, 40, 10)
part0.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(part0, 5) })
part0.addDimension({ dimType: 'linearX', targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)], upperTolerance: 0.1, lowerTolerance: -0.1, symmetric: true })
part0.addDimension({ dimType: 'linearZ', targets: [cad.faceRef(part0, 5), cad.faceRef(part0, 6)] })
part0.addGdt({ gdtType: 'flatness', target: cad.faceRef(part0, 5), tolerance: 0.02 })
part0.addSurfaceFinish({ target: cad.faceRef(part0, 6), parameter: 'Ra', value: 3.2 })
part0.addGeneralNote({ items: [{ text: '未注公差按 GB/T 1804-m' }] })
let part1 = cad.fai_drill(part0, { position: [30, 20, 10], direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
`

let rt: CadRuntime

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
  rt = new CadRuntime({ events: { emit: () => {} } } as HostPorts, 'brep', {
    cad: createApiNamespaceWithEditorOps(),
  })
  await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
}, 120000)

async function fullyAnnotated(): Promise<Shape> {
  const res = await rt.execute(FULLY_ANNOTATED)
  expect(res.failedAt).toBeUndefined()
  return res.outputs.get('part1' as never) as unknown as Shape
}

// ── 文字的占位矩形估算（与 pmi-layer#charW 同一套字宽近似）──

interface TextBox {
  tag: string
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

function textBoxes(svg: string): TextBox[] {
  const out: TextBox[] = []
  const re = /<text([^>]*)>([^<]*)<\/text>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const attrs = m[1]
    const text = m[2]
    const attr = (name: string): string | undefined =>
      new RegExp(`${name}="([-0-9.]+)"`).exec(attrs)?.[1]
    const x = Number(attr('x') ?? '0')
    const y = Number(attr('y') ?? '0')
    const fs = Number(attr('font-size') ?? '0')
    const anchor = /text-anchor="(\w+)"/.exec(attrs)?.[1] ?? 'start'
    const tag = /data-pmi="([^"]+)"/.exec(attrs)?.[1] ?? '(label)'
    let w = 0
    for (const ch of text) w += (ch.codePointAt(0) ?? 0) > 0x2e80 ? fs : fs * 0.56
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
    out.push({ tag, text, x0, y0: y - fs * 0.85, x1: x0 + w, y1: y + fs * 0.25 })
  }
  return out
}

function overlaps(a: TextBox, b: TextBox): boolean {
  return a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6
}

describe('版面不变量：文字互不重叠', () => {
  it.each(['front', 'top', 'right', 'iso'] as const)('%s 视图里所有标注文字两两不相交', async (view) => {
    const p = await fullyAnnotated()
    const out = projectViewSvg(p, view)
    // 视图名标签由 projectSheet 加，图层里没有——这里只看 PMI 文本
    const boxes = textBoxes(out.pmi?.markup ?? '')
    expect(boxes.length).toBeGreaterThan(0)
    const bad: string[] = []
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (overlaps(boxes[i], boxes[j])) {
          bad.push(`${boxes[i].tag}"${boxes[i].text}" × ${boxes[j].tag}"${boxes[j].text}"`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('尺寸文字与引线文字至少隔开一个字高（曾经只差 0.7 < 字号 1.52）', async () => {
    const p = await fullyAnnotated()
    const markup = projectViewSvg(p, 'front').pmi?.markup ?? ''
    const yOf = (tag: string): number =>
      Number(new RegExp(`<text[^>]*data-pmi="${tag}"[^>]*y="([-\\d.]+)"`).exec(markup)?.[1] ?? 'NaN')
    const fs = Number(/<text[^>]*data-pmi="dim-text"[^>]*font-size="([-\d.]+)"/.exec(markup)?.[1] ?? 'NaN')
    const dimY = yOf('dim-text')
    const noteY = yOf('note-text')
    expect(Number.isFinite(dimY)).toBe(true)
    expect(Number.isFinite(noteY)).toBe(true)
    expect(Number.isFinite(fs)).toBe(true)
    // 两者都在零件下方、同一侧，深度按 band 单调外推 → 至少隔一个字高
    expect(Math.abs(noteY - dimY)).toBeGreaterThan(fs)
  })
})

describe('全局 PMI：整张图纸只出现一次', () => {
  it('四视图图纸里 global-note 只有一条，且落在图纸右下角', async () => {
    const p = await fullyAnnotated()
    const sheet = projectSheet(p, ['front', 'top', 'right', 'iso'], { cols: 2 })
    const notes = sheet.match(/data-pmi="global-note"/g) ?? []
    expect(notes).toHaveLength(1)
    // 该块是独立的图纸级图层
    expect(sheet).toContain('id="pmi-global"')
    const size = /width="([-\d.]+)" height="([-\d.]+)"/.exec(sheet)
    expect(size).not.toBeNull()
    const w = Number(size![1])
    const h = Number(size![2])
    const at = /<text[^>]*data-pmi="global-note"[^>]*x="([-\d.]+)" y="([-\d.]+)"/.exec(sheet)
    expect(at).not.toBeNull()
    const [x, y] = [Number(at![1]), Number(at![2])]
    expect(x).toBeGreaterThan(w / 2)
    expect(y).toBeGreaterThan(h * 0.75)
  })

  it('单视图仍各画一次（视图自己的右下角）', async () => {
    const p = await fullyAnnotated()
    expect((projectViewSvg(p, 'front').pmi?.markup.match(/data-pmi="global-note"/g) ?? [])).toHaveLength(1)
  })

  it('globalNotes:false 时一处都不画（视图与图纸）', async () => {
    const p = await fullyAnnotated()
    const single = projectViewSvg(p, 'front', { pmi: { globalNotes: false } })
    expect(single.pmi?.markup ?? '').not.toContain('global-note')
    const sheet = projectSheet(p, ['front', 'top'], { pmi: { globalNotes: false } })
    expect(sheet).not.toContain('global-note')
    expect(sheet).not.toContain('id="pmi-global"')
  })

  it('pmi:false 时图纸里没有任何 PMI 图层', async () => {
    const p = await fullyAnnotated()
    const sheet = projectSheet(p, ['front', 'top'], { pmi: false })
    expect(sheet).not.toContain('data-layer="pmi"')
  })
})

// ── 每条标注只出现一次（视图归属）──

/** 按嵌套 `<svg x="…">` 切出各视图格子（顺序与 views 参数一致；无标注的视图也在）。 */
function sheetCells(sheet: string, count: number): string[] {
  const marks = [...sheet.matchAll(/\n {2}<svg x="/g)].map((m) => m.index ?? 0)
  const global = sheet.search(/\n {2}<g id="pmi-global"/)
  const tail = global < 0 ? sheet.length : global
  return marks.slice(0, count).map((start, i) => {
    const end = i + 1 < marks.length ? marks[i + 1] : tail
    return sheet.slice(start, end)
  })
}

/** 统计 `data-pmi` 语义标记的出现次数。 */
function tallyOf(markup: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of markup.matchAll(/data-pmi="([^"]+)"/g)) out[m[1]] = (out[m[1]] ?? 0) + 1
  return out
}

describe('多视图图纸：每条标注只出现一次，且落在最看得清它的视图', () => {
  it('六条标注各出现一次（尺寸 ×2 / 基准 / 公差 / 粗糙度 / 螺纹孔）', async () => {
    const p = await fullyAnnotated()
    const t = tallyOf(projectSheet(p, ['front', 'top', 'right', 'iso'], { cols: 2 }))
    expect(t['dim-text']).toBe(2) // linearX + linearZ
    expect(t['datum-box']).toBe(1)
    expect(t['finish-text']).toBe(1)
    expect(t['note-text']).toBe(1) // 螺纹孔（全局注释是 global-note）
    expect(t['gdt-leader']).toBe(1) // 一个特征控制框 = 一条 gdt（框内两格）
    expect(t['global-note']).toBe(1) // 技术要求：整张图纸仍然只一条
  })

  it('螺纹孔（轴向 z）进 top 视图：那里正对着孔看，front 里孔退化成两条虚线', async () => {
    const p = await fullyAnnotated()
    const sheet = projectSheet(p, ['front', 'top', 'right', 'iso'], { cols: 2 })
    const [front, top] = sheetCells(sheet, 4)
    expect(tallyOf(top)['note-text']).toBe(1)
    expect(tallyOf(front)['note-text'] ?? 0).toBe(0)
  })

  it('尺寸进 front 视图：x/z 跨度在那里都不缩短（平局按视图顺序取先者）', async () => {
    const p = await fullyAnnotated()
    const [front, top] = sheetCells(projectSheet(p, ['front', 'top', 'right', 'iso'], { cols: 2 }), 4)
    expect(tallyOf(front)['dim-text']).toBe(2)
    expect(tallyOf(top)['dim-text'] ?? 0).toBe(0)
  })

  it('没分到标注的视图不产生空图层', async () => {
    const p = await fullyAnnotated()
    const sheet = projectSheet(p, ['front', 'top', 'right', 'iso'], { cols: 2 })
    // right 视图这一份零件上没有任何标注落点（两条尺寸进 front、基准/公差进 top）
    expect(sheet).not.toContain('id="pmi-right"')
  })

  it('单视图图纸仍是全量（没有跨视图可挑，行为与 projectView 一致）', async () => {
    const p = await fullyAnnotated()
    const t = tallyOf(projectSheet(p, ['front']))
    expect(t['dim-text']).toBe(2)
    expect(t['datum-box']).toBe(1)
    expect(t['finish-text']).toBe(1)
    expect(t['note-text']).toBe(1)
  })

  it('归属是确定性的：同一份零件出两次图逐字节相同', async () => {
    const p = await fullyAnnotated()
    const views = ['front', 'top', 'right', 'iso'] as const
    expect(projectSheet(p, [...views], { cols: 2 })).toBe(projectSheet(p, [...views], { cols: 2 }))
  })
})
