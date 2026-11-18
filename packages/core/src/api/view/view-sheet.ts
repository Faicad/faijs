/**
 * view-sheet — 多视图投影图纸（三视图 + 等轴测组合 SVG，faijs 路径 A）
 *
 * projectSheet(shape, views, opts?) 把多个单视图投影按网格排布为一个 SVG：
 *   - 每个视图用嵌套 `<svg>`（绝对定位 + 各自 viewBox，preserveAspectRatio 保比例）；
 *   - 每个视图可带标签（默认用视图名，如 'front' / 'iso'）；
 *   - 布局参数（列数/间距/留白）可调，缺省按 sqrt 自动分列；
 *   - 间距/留白/标签字号缺省按**视图高度比例**推导（图纸坐标系 = 模型单位，
 *     固定像素值在大零件上会被压没、在小零件上会盖住图）。
 *
 * 典型用法：三视图 + 等轴测工程图纸。
 *   const sheet = projectSheet(part, ['front', 'top', 'right', 'iso'])
 *
 * PMI（2026-10-31）：每个视图各自带一份 PMI 图层（`<g id="pmi-xxx">`，标注按该
 * 视图的相机自动摆放），与其他图层同样叠在线稿之上；`opts.pmi === false` 可整体关闭。
 *
 * **一条标注只出现一次**（与顶层"全局 PMI 只出现一次"同理，但范围是逐条）：
 * 一张多视图图纸里，同一条尺寸/公差/基准/粗糙度/孔标注如果在四个视图各画一遍，
 * 图纸上就有四份同样的信息，而且每份都占用视图外空间、彼此还会挤压摆位。所以
 * `assignPmiToViews()` 先给每条标注挑一个**最能看清它那个特征**的视图（正对程度 /
 * 轴向对齐 / 投影张开度三项打分，背面强扣分），各视图图层再用 `only` 只画自己
 * 负责的那几条。单视图（`projectView`）没有跨视图可挑，行为不变。
 *
 * 全局 PMI（无目标的 note，即"技术要求"）**整张图纸只画一次**：它属于零件级信息、
 * 与视图无关，四个视图各画一遍等于把同一段文字印四遍，还各自挤占视图外空间。
 * 各视图图层据此关掉全局块（`globalNotes: false`），由本函数在图纸右下角画一次。
 */

import type { Shape } from '../../mesh/types'
import { projectViewSvg, type ProjectViewOptions } from './view-projection'
import {
  assignPmiToViews,
  buildGlobalPmiBlock,
  generalNoteTexts,
  type PmiLayerOptions,
} from './pmi-layer'
import { resolveCamera, type ViewSpec } from './view-camera'

/** 单个图纸视图：视图规格 + 可选标签。 */
export interface SheetView {
  view: ViewSpec
  /** 视图标签（缺省取视图名/方向描述）。 */
  label?: string
}

/** projectSheet 布局选项。 */
export interface ProjectSheetOptions extends ProjectViewOptions {
  /** 网格列数（缺省 ceil(sqrt(n))）。 */
  cols?: number
  /** 相邻单元格间距（缺省 = 最大视图高度 × 0.12，模型单位）。 */
  gap?: number
  /** 图纸外留白（缺省 = 最大视图高度 × 0.12，模型单位）。 */
  padding?: number
  /** 是否渲染视图标签（缺省 true）。 */
  labels?: boolean
  /** 标签字号（缺省 = 最大视图高度 × 0.07，模型单位）。 */
  labelFontSize?: number
}

function labelOf(item: SheetView): string {
  if (item.label !== undefined) return item.label
  if (typeof item.view === 'string') return item.view
  const [x, y, z] = item.view.dir
  return `${x},${y},${z}`
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string)
}

/**
 * 多视图投影图纸 → 组合 SVG 字符串（纯数据，不消费/修改 shape）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name projectSheet
 * @returns SVG 字符串（嵌套 <svg x y width height viewBox preserveAspectRatio> + <text> 标签）。空列表返回空 SVG 不抛错。
 * @param shape - 目标几何（必须有 BREP 槽；mesh-only 抛 E_BREP_ONLY_INPUT）。type:Shape required:true
 * @param views - 视图列表：视图规格字符串，或 { view, label? } 对象（方向对象自动生成 x,y,z 标签）。type:(string|{view,label?})[] required:true
 * @param opts.cols - 网格列数。type:number 默认 2
 * @param opts.gap - 格间距（模型单位；缺省 = 最大视图高度 × 0.12）。type:number
 * @param opts.padding - 图纸外留白（模型单位；缺省 = 最大视图高度 × 0.12）。type:number
 * @param opts.labels - 是否渲染 <text> 标签。type:boolean 默认 true
 * @param opts.labelFontSize - 标签字号（模型单位；缺省 = 最大视图高度 × 0.07）。type:number
 * @param opts.pmi - PMI 图层：每条标注**只在一个视图里出现**（自动挑最看得清该特征的视图，见 assignPmiToViews），各视图独立 <g> 图层、自动摆放；全局注释块整张图纸只画一次、位于右下角。true/缺省自动渲染，false 关闭。type:boolean|object 默认 true
 * @example
 * const sheet = cad.projectSheet(part0, ['front', 'top', 'right', 'iso'])
 * const sheet = cad.projectSheet(part0, [{ view: 'front', label: '主视图' }], { cols: 2, gap: 40, labels: true })
  */
export function projectSheet(
  shape: Shape,
  views: (ViewSpec | SheetView)[],
  opts: ProjectSheetOptions = {},
): string {
  const items: SheetView[] = views.map((v) =>
    typeof v === 'string' ? { view: v, label: v } : 'view' in v ? v : { view: v },
  )
  if (items.length === 0) {
    return '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="0" height="0" />'
  }
  const n = items.length
  const cols = opts.cols ?? Math.ceil(Math.sqrt(n))
  const labels = opts.labels !== false

  // 全局 PMI 与视图无关：三视图里同一段"技术要求"不该印三遍。各视图图层统一关掉
  // 全局块，改由本函数在图纸右下角画一次（`buildGlobalPmiBlock` 两处共用同一实现）。
  const pmiOpt = opts.pmi
  const pmiLayerOpt: PmiLayerOptions = typeof pmiOpt === 'object' ? pmiOpt : {}
  const pmiEnabled = pmiOpt !== false
  const globalTexts = pmiEnabled && pmiLayerOpt.globalNotes !== false ? generalNoteTexts(shape) : []

  // 视图归属：同一条标注在多视图图纸里只画一次，落在"最能看清它那个特征"的视图。
  // 单视图没有跨视图可挑，跳过（省掉一遍锚点解析，行为也与 projectView 一致）。
  const assignment =
    pmiEnabled && items.length > 1
      ? assignPmiToViews(shape, items.map((it) => resolveCamera(it.view)))
      : undefined

  /** 第 `vi` 个视图的图层选项：关掉全局块 + 只留下分派给它的那几条。 */
  const pmiForView = (vi: number): boolean | PmiLayerOptions => {
    if (!pmiEnabled) return false
    const base: PmiLayerOptions =
      globalTexts.length > 0 ? { ...pmiLayerOpt, globalNotes: false } : { ...pmiLayerOpt }
    if (assignment === undefined) return base
    const only = new Set<number>()
    for (let i = 0; i < assignment.length; i += 1) if (assignment[i] === vi) only.add(i)
    return { ...base, only }
  }

  const projections = items.map((it, i) => ({
    ...projectViewSvg(shape, it.view, { ...opts, pmi: pmiForView(i) }),
    label: labelOf(it),
  }))
  // 标签字号、格间距、页边距一律按视图高度比例推导：图纸坐标系是**模型单位**
  // （viewBox 宽高 = 零件尺寸），固定数值会让 60mm 的零件印出 4 倍大的视图名、
  // 600mm 的零件把间距压到看不见。
  const baseH = Math.max(...projections.map((p) => p.height))
  const labelFontSize = opts.labelFontSize ?? Math.max(baseH * 0.07, 1e-6)
  const gap = opts.gap ?? baseH * 0.12
  const padding = opts.padding ?? baseH * 0.12
  const labelPadY = labels ? labelFontSize * 1.8 : 0
  const cellW = Math.max(...projections.map((p) => p.width))
  const cellH = baseH + labelPadY
  const rows = Math.ceil(n / cols)
  let totalW = cols * cellW + (cols - 1) * gap + 2 * padding
  const layoutH = rows * cellH + (rows - 1) * gap + 2 * padding

  // 图纸级全局注释块：在网格下方留出一条带，右对齐到图纸右边距。
  // 字号与视图内标注同一口径（零件包围盒对角线 × 0.025，见 pmi-layer#resolveCfg），
  // 这样图纸级的字和视图里的字看起来一样大。
  let totalH = layoutH
  let globalGroup = ''
  if (globalTexts.length > 0) {
    const diag = Math.max(
      ...projections.map((p) => {
        const e = p.partExtent
        return e === undefined ? 0 : Math.hypot(e.maxX - e.minX, e.maxY - e.minY)
      }),
      1e-6,
    )
    const fontSize = pmiLayerOpt.fontSize ?? diag * 0.025
    const top = layoutH + gap * 0.4
    const optsOf = { fontSize, color: pmiLayerOpt.color, right: 0, top }
    const probe = buildGlobalPmiBlock(globalTexts, optsOf)
    // 文本比图纸还宽时把图纸加宽（否则会被裁到负坐标）
    if (probe.width + 2 * padding > totalW) totalW = probe.width + 2 * padding
    const block = buildGlobalPmiBlock(globalTexts, { ...optsOf, right: totalW - padding })
    totalH = top + block.height + padding
    globalGroup = [
      `<g id="pmi-global" data-layer="pmi" font-family="${escapeXml(pmiLayerOpt.fontFamily ?? 'sans-serif')}">`,
      indentBlock(block.markup, '  '),
      `</g>`,
    ].join('\n')
  }

  const cells: string[] = []
  projections.forEach((p, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = padding + col * (cellW + gap)
    const y = padding + row * (cellH + gap)
    const inner = [
      `<svg x="${x}" y="${y}" width="${cellW}" height="${p.height}" viewBox="${p.viewBox}" preserveAspectRatio="xMidYMid meet" fill="none" stroke="black" stroke-width="0.6%" vector-effect="non-scaling-stroke">`,
      `  <g stroke="#000" fill="none">`,
    ]
    for (const d of p.paths.visible) {
      inner.push(`    <path d="${d}" fill="none" stroke="#000" stroke-width="${opts.strokeWidth ?? 1}" />`)
    }
    for (const d of p.paths.hidden) {
      inner.push(
        `    <path d="${d}" fill="none" stroke="#000" stroke-width="${opts.strokeWidth ?? 1}" stroke-dasharray="${opts.dash ?? '4,4'}" opacity="${opts.hiddenOpacity ?? 0.6}" />`,
      )
    }
    inner.push('  </g>')
    if (hasPmi(p)) inner.push(indentBlock(p.pmi.markup, '  '))
    inner.push(`</svg>`)
    if (labels) {
      inner.push(
        // stroke="none"：根 <svg> 的 stroke-width="0.6%" 会被文字继承并糊成黑块
        `<text x="${x + cellW / 2}" y="${y + p.height + labelFontSize}" text-anchor="middle" font-size="${labelFontSize}" fill="#000" stroke="none">${escapeXml(p.label)}</text>`,
      )
    }
    cells.push(inner.join('\n'))
  })

  const anyPmi = projections.some(hasPmi) || globalGroup !== ''
  const rootAttrs = anyPmi
    ? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'
    : ''
  return [
    `<svg version="1.1" xmlns="http://www.w3.org/2000/svg"${rootAttrs} width="${totalW}" height="${totalH}" fill="none" stroke="black" stroke-width="0.6%" vector-effect="non-scaling-stroke">`,
    cells.map((c) => `  ${c}`).join('\n'),
    ...(globalGroup === '' ? [] : [`  ${globalGroup}`]),
    `</svg>`,
  ].join('\n')
}

/** 单元格是否带 PMI 图层。 */
function hasPmi(p: { pmi?: { markup: string } }): p is { pmi: { markup: string } } {
  return p.pmi !== undefined && p.pmi.markup !== ''
}

/** 把多行标记整体缩进（保持嵌套清晰，便于人工检查产物）。 */
function indentBlock(block: string, pad: string): string {
  return block
    .split('\n')
    .map((l) => `${pad}${l}`)
    .join('\n')
}
