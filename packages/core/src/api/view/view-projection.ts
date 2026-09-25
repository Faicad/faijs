/**
 * view-projection — 单视图投影 → SVG 线稿（faijs 视图投影能力，路径 A）
 *
 * 设计文档：docs/plans/2026-09-10-faijs-view-projection-and-screenshot.md §3.2
 *
 * projectView(shape, view, opts?) 返回**纯数据 SVG 字符串**（非 Shape）：
 *   - 直连 core 引擎的 HLR 投影（`BrepEngineApi.projectEdges`，OCCT
 *     HLRBRep 隐线消除）：可见 / 隐藏两组边（sharp/smooth/outline compound）；
 *   - 每组边 → 3D 曲线采样折线（`curveParameters` + `curvePointAtParam`）→
 *     投影到相机平面（正交投影，坐标 = 相对 camera.origin 在 xAxis/yAxis 上的分量）；
 *   - 序列化为一个完整 SVG：可见轮廓实线 + 隐藏线虚线（stroke-dasharray）。
 *
 * 返回字符串绕开 arg-spec 对 projectEdges/makeProjectedEdges 的 skip 障碍
 * （Edge 句柄数组 + compound 生命周期无法静态收养——本 op 只在内部消费，
 *   产物是 2D 纯文本，无收养问题）。
 *
 * 2026-09-25 core-decouple wrapup（§3.1 A 案）：不再依赖 brepjs 的 HLR+2D
 * drawing 链——HLR 由 core 引擎原生提供（occt-wasm projectEdges），2D SVG
 * 序列化为本地实现（曲线边以采样折线近似）。
 */

import type { Shape } from '../../mesh/types'
import { brepOf } from '../../shape'
import { getBrepApi } from '../../brep/handle-bridge'
import type { BrepHandle } from '../../brep/engine/types'
import { resolveCamera, type ViewSpec } from './view-camera'

/** 投影相机（与 view-camera 输出同构）。 */
interface Camera {
  readonly position: [number, number, number]
  readonly direction: [number, number, number]
  readonly xAxis: [number, number, number]
  readonly yAxis: [number, number, number]
}

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
  /** 各 path d 串：可见实线 / 隐藏虚线。 */
  paths: { visible: string[]; hidden: string[] }
  /** 输出宽度/高度。 */
  width: number
  height: number
}

/** 每条边的 3D 采样点数（直线 2 点；曲线分段近似）。 */
const EDGE_SAMPLES = 5

type Vec3 = readonly [number, number, number]

/** 3D 点 → 相机平面 2D 坐标。
 *
 * GOTCHA: occt-wasm 的 HLR projectEdges 已把边投影到相机平面，输出坐标 =
 * （沿 xAxis 的水平分量, 沿 cross(direction, xAxis) 的垂直分量, 沿 direction
 * 的深度分量≈0）——不是世界坐标。因此 2D 坐标直接取输出的前两分量，不再做
 * dot 二次投影（否则会把垂直信息读丢——垂直在 p.y 而非 p.z）。
 */
function projectTo2D(p: Vec3, _cam: Camera): [number, number] {
  return [p[0], p[1]]
}

/** 引擎 projectEdges 的返回结构（occt-wasm：6 组 compound 的 arena id）。 */
interface ProjectEdgesResult {
  visibleSharp: number
  visibleSmooth: number
  visibleOutline: number
  hiddenSharp: number
  hiddenSmooth: number
  hiddenOutline: number
}

const COMPOUND_KEYS = [
  ['visibleSharp', 'visible'],
  ['visibleSmooth', 'visible'],
  ['visibleOutline', 'visible'],
  ['hiddenSharp', 'hidden'],
  ['hiddenSmooth', 'hidden'],
  ['hiddenOutline', 'hidden'],
] as const

/**
 * HLR 投影 shape → 可见/隐藏 2D 折线（SVG d 串）。
 * 全部句柄在本函数内释放（compound + 边；输入 shape 不消费）。
 */
function projectPolylines(shape: Shape, view: ViewSpec): { visible: string[]; hidden: string[] } {
  const solid = brepOf(shape) as BrepHandle | undefined
  if (solid === undefined) {
    throw new Error(
      '[faijs/view-projection] E_BREP_ONLY_INPUT: operation requires a BREP-backed shape ' +
        '(mesh-only input cannot be projected)',
    )
  }
  const api = getBrepApi()
  const cam = resolveCamera(view) as unknown as Camera
  const r = api.projectEdges(
    solid,
    { x: cam.position[0], y: cam.position[1], z: cam.position[2] },
    { x: cam.direction[0], y: cam.direction[1], z: cam.direction[2] },
    { x: cam.xAxis[0], y: cam.xAxis[1], z: cam.xAxis[2] },
    true,
    0.1,
  ) as ProjectEdgesResult

  const out: { visible: string[]; hidden: string[] } = { visible: [], hidden: [] }
  const toHandle = (id: number): BrepHandle => id as BrepHandle
  try {
    for (const [key, group] of COMPOUND_KEYS) {
      const compoundId = r[key]
      if (typeof compoundId !== 'number' || compoundId === 0) continue
      const edges = api.getSubShapes(toHandle(compoundId), 'edge')
      for (const edge of edges) {
        const d = edgeToPath(api, edge, cam)
        if (d !== null) out[group].push(d)
      }
      // 释放 compound slot（幂等）
      try {
        api.release(toHandle(compoundId))
      } catch {
        // already released
      }
    }
  } finally {
    void 0
  }
  return out
}

/** 单条边 → SVG path d 串（3D 曲线采样折线投影到相机平面）。 */
function edgeToPath(api: ReturnType<typeof getBrepApi>, edge: BrepHandle, cam: Camera): string | null {
  let cp
  try {
    cp = api.curveParameters(edge)
  } catch {
    return null // 退化边（如孤立顶点线）无曲线参数
  }
  const { first, last } = cp
  const span = last - first
  const pts: [number, number][] = []
  for (let i = 0; i < EDGE_SAMPLES; i += 1) {
    const t = first + (span * i) / (EDGE_SAMPLES - 1)
    const p = api.curvePointAtParam(edge, t)
    pts.push(projectTo2D([p.x, p.y, p.z], cam))
  }
  if (pts.length < 2) return null
  let d = `M ${pts[0][0].toFixed(4)} ${pts[0][1].toFixed(4)}`
  for (let i = 1; i < pts.length; i += 1) {
    d += ` L ${pts[i][0].toFixed(4)} ${pts[i][1].toFixed(4)}`
  }
  return d
}

/** 解析 'minX minY w h' 为数值数组。 */
function parseViewBox(vb: string): [number, number, number, number] | undefined {
  const parts = vb.trim().split(/\s+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined
  return [parts[0], parts[1], parts[2], parts[3]]
}

/** 折线点集 bbox → viewBox（统一坐标系；margin 再外扩）。 */
function viewBoxOfPaths(paths: string[], margin: number): string {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of paths) {
    const nums = d.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i])
      const y = Number(nums[i + 1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (!Number.isFinite(minX)) return '0 0 0 0' // 空投影（如空 shape）
  return `${minX - margin} ${minY - margin} ${maxX - minX + 2 * margin} ${maxY - minY + 2 * margin}`
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
  const { visible: visiblePaths, hidden: hiddenPaths } = projectPolylines(shape, view)
  const margin = opts.margin ?? 1
  const viewBox = viewBoxOfPaths([...visiblePaths, ...hiddenPaths], margin)
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
 * @param opts.margin - viewBox 外扩边距。type:number 默认 1
 * @param opts.width - 输出宽度（缺省 = viewBox 宽度）。type:number
 * @param opts.height - 输出高度（缺省 = viewBox 高度）。type:number
 * @example
 * const svg = cad.projectView(part0, 'front')
 * const svg = cad.projectView(part0, 'iso', { strokeWidth: 1, dash: '4,4', hiddenOpacity: 0.6 })
  */
export function projectView(shape: Shape, view: ViewSpec, opts?: ProjectViewOptions): string {
  return projectViewSvg(shape, view, opts).svg
}
