/**
 * view-sheet — 多视图投影图纸（三视图 + 等轴测组合 SVG，faijs 路径 A）
 *
 * 设计文档：docs/plans/2026-09-10-faijs-view-projection-and-screenshot.md §3.2
 *
 * projectSheet(shape, views, opts?) 把多个单视图投影按网格排布为一个 SVG：
 *   - 每个视图用嵌套 `<svg>`（绝对定位 + 各自 viewBox，preserveAspectRatio 保比例）；
 *   - 每个视图可带标签（默认用视图名，如 'front' / 'iso'）；
 *   - 布局参数（列数/间距/留白）可调，缺省按 sqrt 自动分列。
 *
 * 典型用法：三视图 + 等轴测工程图纸。
 *   const sheet = projectSheet(part, ['front', 'top', 'right', 'iso'])
 */

import type { Shape } from '../../mesh/types'
import { projectViewSvg, type ProjectViewOptions } from './view-projection'
import type { ViewSpec } from './view-camera'

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
  /** 相邻单元格间距（缺省 24）。 */
  gap?: number
  /** 图纸外留白（缺省 24）。 */
  padding?: number
  /** 是否渲染视图标签（缺省 true）。 */
  labels?: boolean
  /** 标签字号（缺省 12）。 */
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
 * @param opts.gap - 格间距（px）。type:number 默认 30
 * @param opts.labels - 是否渲染 <text> 标签。type:boolean 默认 true
 * @param opts.cellWidth - 每格画布宽度。type:number 默认 400
 * @param opts.cellHeight - 每格画布高度。type:number 默认 300
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
  const gap = opts.gap ?? 24
  const padding = opts.padding ?? 24
  const labels = opts.labels !== false
  const labelFontSize = opts.labelFontSize ?? 12

  const projections = items.map((it) => ({ ...projectViewSvg(shape, it.view, opts), label: labelOf(it) }))
  const labelPadY = labels ? labelFontSize + 10 : 0
  const cellW = Math.max(...projections.map((p) => p.width))
  const cellH = Math.max(...projections.map((p) => p.height)) + labelPadY
  const rows = Math.ceil(n / cols)
  const totalW = cols * cellW + (cols - 1) * gap + 2 * padding
  const totalH = rows * cellH + (rows - 1) * gap + 2 * padding

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
    inner.push('  </g>', `</svg>`)
    if (labels) {
      inner.push(
        `<text x="${x + cellW / 2}" y="${y + p.height + labelFontSize}" text-anchor="middle" font-size="${labelFontSize}" fill="#000">${escapeXml(p.label)}</text>`,
      )
    }
    cells.push(inner.join('\n'))
  })

  return [
    `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" fill="none" stroke="black" stroke-width="0.6%" vector-effect="non-scaling-stroke">`,
    cells.map((c) => `  ${c}`).join('\n'),
    `</svg>`,
  ].join('\n')
}
