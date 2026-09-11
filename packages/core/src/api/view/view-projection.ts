/**
 * view-projection — 单视图投影 → SVG 线稿（faijs 视图投影能力，路径 A）
 *
 * 设计文档：docs/plans/2026-09-10-faijs-view-projection-and-screenshot.md §3.2
 *
 * projectView(shape, view, opts?) 返回**纯数据 SVG 字符串**（非 Shape）：
 *   - 借入 faijs Shape 的 brep 句柄（borrowBrepjsShape，零拷贝，不转移所有权）；
 *   - 经 vendored brepjs drawProjection（OCCT HLR 隐线消除）得到 visible/hidden
 *     两组 2D Drawing；
 *   - 序列化为一个完整 SVG：可见轮廓实线 + 隐藏线虚线（stroke-dasharray）。
 *
 * 返回字符串绕开 arg-spec 对 projectEdges/makeProjectedEdges 的 skip 障碍
 * （Edge 句柄数组 + compound 生命周期无法静态收养——本 op 只在内部消费，
 *   产物是 2D 纯文本，无收养问题）。
 *
 * projectViewSvg 返回结构化数据（viewBox/paths/尺寸），供 projectSheet 网格组合。
 */

import type { Shape } from '../../mesh/types'
import { borrowBrepjsShape } from '../internal/l3-bridge'
import { drawProjection } from '../../vendored/brepjs/sketching/draw3d.js'
import type { Drawing } from '../../vendored/brepjs/sketching/drawing.js'
import type { AnyShape } from '../../vendored/brepjs/core/shapeTypes.js'
import { resolveCamera, type ViewSpec } from './view-camera'

/** projectView 的序列化选项。 */
export interface ProjectViewOptions {
  /** viewBox 四周留白（单位 = 投影平面坐标单位；缺省 1）。 */
  margin?: number
  /** 可见/隐藏线 stroke-width（像素；缺省 1）。 */
  strokeWidth?: number
  /** 隐藏线虚线样式（SVG stroke-dasharray；缺省 '4,4'）。 */
  dash?: string
  /** 隐藏线透明度（缺省 0.6）。 */
  hiddenOpacity?: number
  /** 输出 SVG 宽度（缺省 = viewBox 宽度）。 */
  width?: number
  /** 输出 SVG 高度（缺省 = viewBox 高度）。 */
  height?: number
}

/** 单视图投影的结构化结果（projectSheet 复用）。 */
export interface ProjectionSvg {
  /** 完整 SVG 字符串。 */
  svg: string
  /** viewBox 属性值（'minX minY w h'；可见 ∪ 隐藏线并集 + margin）。 */
  viewBox: string
  /** 各路径 d 串：可见实线 / 隐藏虚线。 */
  paths: { visible: string[]; hidden: string[] }
  /** 输出宽度/高度。 */
  width: number
  height: number
}

/** 解析 'minX minY w h' 为数值数组。 */
function parseViewBox(vb: string): [number, number, number, number] | undefined {
  const parts = vb.trim().split(/\s+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined
  return [parts[0], parts[1], parts[2], parts[3]]
}

/** 空 Drawing 的 viewBox 是空串（innerShape 为 null）；返回 false 表示无内容。 */
function viewBoxOf(d: Drawing): [number, number, number, number] | undefined {
  const vb = d.toSVGViewBox(0)
  if (vb === '') return undefined
  return parseViewBox(vb)
}

/**
 * 可见 ∪ 隐藏两组 Drawing 的并集 viewBox（统一坐标系；margin 再外扩）。
 */
function mergedViewBox(visible: Drawing, hidden: Drawing, margin: number): string {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of [visible, hidden]) {
    const box = viewBoxOf(d)
    if (!box) continue
    const [x, y, w, h] = box
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  if (!Number.isFinite(minX)) return '0 0 0 0' // 空投影（如空 shape）
  return `${minX - margin} ${minY - margin} ${maxX - minX + 2 * margin} ${maxY - minY + 2 * margin}`
}

function flattenPaths(d: Drawing): string[] {
  const paths = d.toSVGPaths()
  return Array.isArray(paths[0]) ? (paths as string[][]).flat() : (paths as string[])
}

/**
 * 单视图投影（结构化结果）。
 *
 * @param shape - 待投影的 faijs Shape（必须带 BREP 槽；mesh-only 输入抛 E_BREP_ONLY_INPUT）。
 * @param view - 视图规格（标准视图 / iso / 轴对平面 / 方向对象）。
 * @param opts - 序列化选项。
 * @returns 结构化投影结果（svg/viewBox/paths/尺寸）。
 */
export function projectViewSvg(shape: Shape, view: ViewSpec, opts: ProjectViewOptions = {}): ProjectionSvg {
  const borrowed = borrowBrepjsShape(shape)
  const camera = resolveCamera(view)
  const { visible, hidden } = drawProjection(borrowed as unknown as AnyShape, camera)
  try {
    const visiblePaths = flattenPaths(visible)
    const hiddenPaths = flattenPaths(hidden)
    const margin = opts.margin ?? 1
    const viewBox = mergedViewBox(visible, hidden, margin)
    const parsed = parseViewBox(viewBox) ?? [0, 0, 0, 0]
    const width = opts.width ?? parsed[2]
    const height = opts.height ?? parsed[3]
    const strokeWidth = opts.strokeWidth ?? 1
    const dash = opts.dash ?? '4,4'
    const hiddenOpacity = opts.hiddenOpacity ?? 0.6
    const visibleMarkup = visiblePaths
      .map((d) => `<path d="${d}" fill="none" stroke="#000" stroke-width="${strokeWidth}" />`)
      .join('\n    ')
    const hiddenMarkup = hiddenPaths
      .map(
        (d) =>
          `<path d="${d}" fill="none" stroke="#000" stroke-width="${strokeWidth}" stroke-dasharray="${dash}" opacity="${hiddenOpacity}" />`,
      )
      .join('\n    ')
    const svg = [
      `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" fill="none" stroke="black" stroke-width="0.6%" vector-effect="non-scaling-stroke">`,
      `  <g stroke="#000" fill="none">`,
      `    ${visibleMarkup}${hiddenMarkup === '' ? '' : `\n    ${hiddenMarkup}`}`,
      `  </g>`,
      `</svg>`,
    ].join('\n')
    return { svg, viewBox, paths: { visible: visiblePaths, hidden: hiddenPaths }, width, height }
  } finally {
    // Drawing 持有 2D kernel 句柄（Bnd_Box2d/2D 曲线），序列化后释放
    visible[Symbol.dispose]?.()
    hidden[Symbol.dispose]?.()
  }
}

/**
 * 单视图投影 → SVG 线稿字符串（纯数据，不消费/修改 shape；规则 1 下裸调用不消费输入）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name projectView
 * @returns SVG 字符串（<svg viewBox="…"> + 可见实线 <path> + 隐藏虚线 <path>）。裸调用 cad.projectView(part0, 'front') 不消费 part0（规则 1），part 仍留在 canvas。
 * @param shape - 目标几何（必须有 BREP 槽；mesh-only 抛 E_BREP_ONLY_INPUT）。type:Shape required:true
 * @param view - 视图规格（同 viewCamera：标准视图名 / iso / 轴对平面 / 方向对象）。type:string|{dir,xAxis?} required:true
 * @param opts.strokeWidth - 可见线宽（stroke-width）。type:number 默认 1
 * @param opts.dash - 隐藏线虚线样式（stroke-dasharray）。type:string 默认 '4,4'
 * @param opts.hiddenOpacity - 隐藏线透明度。type:number 默认 0.6
 * @param opts.margin - viewBox 外扩边距。type:number 默认 10
 * @param opts.width - 输出宽度（缺省 = viewBox 宽度）。type:number
 * @param opts.height - 输出高度（缺省 = viewBox 高度）。type:number
 * @example
 * const svg = cad.projectView(part0, 'front')
 * const svg = cad.projectView(part0, 'iso', { strokeWidth: 1, dash: '4,4', hiddenOpacity: 0.6 })
  */
export function projectView(shape: Shape, view: ViewSpec, opts?: ProjectViewOptions): string {
  return projectViewSvg(shape, view, opts).svg
}
