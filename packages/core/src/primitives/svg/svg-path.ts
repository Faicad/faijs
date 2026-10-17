/**
 * primitives/svg/svg-path — 共享 SVG 语法层与折线化（与 OCCT 无关）。
 *
 * 来源：从 `brep/svg/svg-to-solid.ts` 泛化抽出（一个事实一个家）。
 * brep 链保留自己的 OCCT 曲线装配（makeBezierEdge/makeArcEdge），仅复用本模块的
 * 语法层（元素提取 / d 分词 / transform 解析）；mesh 链消费本模块的折线化
 * `svgPathToContours`（曲线按 curveSegments 采样成折线点）。
 *
 * 坐标约定：
 * - 语法层（extract / tokenize / parsePathToSubpaths）输出 **SVG 原始坐标（Y-down）**
 * - `svgPathToContours` 在返回前统一翻转为 **Y-up**（与 core 世界坐标一致）
 *
 * 与 three `SVGLoader` 的已知差异（登记为设计分歧，见方案 R2/R3）：
 * - arc（A 命令）：本项目沿用 brep 链的 sagitta 三点圆弧近似（与 brepjs
 *   `createStandardArc` 同源）；SVGLoader 是精确椭圆弧 → 三次贝塞尔。
 * - fill-rule：仅按 evenodd 做孔洞判定；SVG 缺省（nonzero）素材若存在嵌套
 *   反向轮廓，以 evenodd 语义解释（与 SVGLoader.createShapes 行为一致）。
 */
import type { Contour, P2 } from '../../mesh/meshdata/contour'
import {
  computeSignedArea as _computeSignedArea,
  pointInPolygon as _pointInPolygon,
  polygonCentroid as _polygonCentroid,
  bboxContains as _bboxContains,
  classifyNested as _classifyNested,
} from '../../geometry2d/nesting'

/** SVG 2D 点（原始坐标系，Y-down）。 */
export interface SvgPoint2 {
  x: number
  y: number
}

/** SVG path 分词单元。 */
export interface PathToken {
  command: string
  args: number[]
}

/** 闭合子路径（折线化后）：顶点 + bbox + 有符号面积（SVG 坐标系，Y-down）。 */
export interface SvgSubpath {
  points: SvgPoint2[]
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  signedArea: number
  closed: boolean
}

/** SVG 2D 仿射变换矩阵 [a, b, c, d, e, f]（matrix(a,b,c,d,e,f)）。 */
export type SvgTransform = [number, number, number, number, number, number]

// ─── SVG 元素提取（将 <rect>/<circle>/… 转为 <path d>） ───

/**
 * 从 SVG 字符串中提取所有图形元素的 path `d` 属性。
 *
 * 支持：<path>, <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>。
 * 使用正则提取，无 DOMParser 依赖（可在 Web Worker / Node 中运行）。
 *
 * @param svgString - the raw SVG markup to extract paths from.
 * @returns an array of path `d` strings.
 */
export function extractSvgPaths(svgString: string): string[] {
  const paths: string[] = []

  extractPathDAttributes(svgString, paths)
  extractRectPaths(svgString, paths)
  extractCirclePaths(svgString, paths)
  extractEllipsePaths(svgString, paths)
  extractLinePaths(svgString, paths)
  extractPolylinePaths(svgString, paths, false)
  extractPolylinePaths(svgString, paths, true)

  return paths
}

function extractPathDAttributes(svg: string, out: string[]): void {
  const re = /<path\b[^>]*\bd\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const d = m[1] ?? m[2]
    if (d) out.push(d)
  }
}

function extractRectPaths(svg: string, out: string[]): void {
  const re = /<rect\b([^>]*)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const attrs = parseAttrs(m[1] ?? '')
    const x = parseFloat(attrs.x ?? '0')
    const y = parseFloat(attrs.y ?? '0')
    const w = parseFloat(attrs.width ?? '0')
    const h = parseFloat(attrs.height ?? '0')
    const rx = parseFloat(attrs.rx ?? '0')
    const ry = parseFloat(attrs.ry ?? '0')
    if (w <= 0 || h <= 0) continue

    const rectTransform = attrs.transform ? parseSvgTransform(attrs.transform) : undefined
    if (rectTransform) {
      const corners: [number, number][] = [
        [x, y], [x + w, y], [x + w, y + h], [x, y + h],
      ]
      const tc = corners.map(([cx, cy]) => [
        rectTransform[0] * cx + rectTransform[2] * cy + rectTransform[4],
        rectTransform[1] * cx + rectTransform[3] * cy + rectTransform[5],
      ])
      let d = `M ${tc[0][0]},${tc[0][1]}`
      for (let i = 1; i < tc.length; i++) d += ` L ${tc[i][0]},${tc[i][1]}`
      out.push(d + ' Z')
    } else if (rx > 0 || ry > 0) {
      const r = Math.min(rx || ry, w / 2, h / 2)
      out.push(rectToPathRounded(x, y, w, h, r))
    } else {
      out.push(`M ${x},${y} h ${w} v ${h} h ${-w} Z`)
    }
  }
}

function rectToPathRounded(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M ${x + r},${y}`,
    `h ${w - 2 * r}`,
    `A ${r},${r} 0 0 1 ${x + w},${y + r}`,
    `v ${h - 2 * r}`,
    `A ${r},${r} 0 0 1 ${x + w - r},${y + h}`,
    `h ${-(w - 2 * r)}`,
    `A ${r},${r} 0 0 1 ${x},${y + h - r}`,
    `v ${-(h - 2 * r)}`,
    `A ${r},${r} 0 0 1 ${x + r},${y}`,
    'Z',
  ].join(' ')
}

function extractCirclePaths(svg: string, out: string[]): void {
  const re = /<circle\b([^>]*)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const attrs = parseAttrs(m[1] ?? '')
    const cx = parseFloat(attrs.cx ?? '0')
    const cy = parseFloat(attrs.cy ?? '0')
    const r = parseFloat(attrs.r ?? '0')
    if (r <= 0) continue
    out.push(`M ${cx - r},${cy} A ${r},${r} 0 1 0 ${cx + r},${cy} A ${r},${r} 0 1 0 ${cx - r},${cy} Z`)
  }
}

function extractEllipsePaths(svg: string, out: string[]): void {
  const re = /<ellipse\b([^>]*)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const attrs = parseAttrs(m[1] ?? '')
    const cx = parseFloat(attrs.cx ?? '0')
    const cy = parseFloat(attrs.cy ?? '0')
    const rx = parseFloat(attrs.rx ?? '0')
    const ry = parseFloat(attrs.ry ?? '0')
    if (rx <= 0 || ry <= 0) continue
    out.push(`M ${cx - rx},${cy} A ${rx},${ry} 0 1 0 ${cx + rx},${cy} A ${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`)
  }
}

function extractLinePaths(svg: string, out: string[]): void {
  const re = /<line\b([^>]*)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const attrs = parseAttrs(m[1] ?? '')
    const x1 = parseFloat(attrs.x1 ?? '0')
    const y1 = parseFloat(attrs.y1 ?? '0')
    const x2 = parseFloat(attrs.x2 ?? '0')
    const y2 = parseFloat(attrs.y2 ?? '0')
    out.push(`M ${x1},${y1} L ${x2},${y2}`)
  }
}

function extractPolylinePaths(svg: string, out: string[], closed: boolean): void {
  const tag = closed ? 'polygon' : 'polyline'
  const re = new RegExp(`<${tag}\\b([^>]*)\\/??>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const attrs = parseAttrs(m[1] ?? '')
    const pointsStr = attrs.points ?? ''
    const nums = pointsStr.split(/[\s,]+/).filter((s) => s.length > 0).map(Number)
    if (nums.length < 4) continue
    let d = `M ${nums[0]},${nums[1]}`
    for (let i = 2; i + 1 < nums.length; i += 2) {
      d += ` L ${nums[i]},${nums[i + 1]}`
    }
    if (closed) d += ' Z'
    out.push(d)
  }
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  }
  return attrs
}

// ─── SVG path 分词（d 属性 → 命令序列） ───

/**
 * 将 SVG path `d` 属性拆分为命令序列。
 *
 * 支持完整命令集：M/L/H/V/C/S/Q/T/A/Z（含相对形式小写）。
 * 每个 token 保留命令字与已解析的数值参数（多参数组由消费方按命令语义切分）。
 *
 * @param d - the SVG path `d` attribute value.
 * @returns the token list.
 */
export function tokenizeSvgPath(d: string): PathToken[] {
  const tokens: PathToken[] = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(d)) !== null) {
    const command = match[1] ?? ''
    const argStr = (match[2] ?? '').trim()
    const args: number[] = []
    if (argStr) {
      const numRe = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
      let numMatch: RegExpExecArray | null
      while ((numMatch = numRe.exec(argStr)) !== null) {
        args.push(parseFloat(numMatch[0]))
      }
    }
    tokens.push({ command, args })
  }
  return tokens
}

// ─── SVG transform 处理 ───

/**
 * 解析 SVG transform 字符串（仅支持 matrix 形式）。
 * @param transformStr - 形如 `matrix(a,b,c,d,e,f)` 的变换字符串。
 * @returns 六元仿射矩阵 [a,b,c,d,e,f]，非 matrix 形式返回 undefined。
 */
export function parseSvgTransform(transformStr: string): SvgTransform | undefined {
  const m = transformStr.match(
    /matrix\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/,
  )
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])]
  }
  return undefined
}

/**
 * 从 SVG 字符串中提取 `<g transform="matrix(...)">` 的变换矩阵。
 * @param svgString - SVG 文档字符串。
 * @returns 首个 `<g>` 的 matrix 变换（六元数组），无匹配返回 undefined。
 */
export function extractGroupTransform(svgString: string): SvgTransform | undefined {
  const m = svgString.match(/<g\b[^>]*\btransform\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/i)
  if (m) {
    return parseSvgTransform(m[1] ?? m[2] ?? '')
  }
  return undefined
}

/** 对 SVG 坐标点（Y-down）应用 2D 仿射矩阵。 */
function applySvgTransform(p: SvgPoint2, gt: SvgTransform): SvgPoint2 {
  return {
    x: gt[0] * p.x + gt[2] * p.y + gt[4],
    y: gt[1] * p.x + gt[3] * p.y + gt[5],
  }
}

// ─── 曲线几何（折线化用） ───

/** 三次贝塞尔采样（与 three `CubicBezierCurve.getPoint` 同公式）。 */
function cubicAt(p0: SvgPoint2, p1: SvgPoint2, p2: SvgPoint2, p3: SvgPoint2, t: number): SvgPoint2 {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** 二次贝塞尔采样。 */
function quadAt(p0: SvgPoint2, p1: SvgPoint2, p2: SvgPoint2, t: number): SvgPoint2 {
  const mt = 1 - t
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  }
}

/** 三点外接圆（p0/p1/p2 共线时返回 null）。 */
function circumcircle(
  p0: SvgPoint2, p1: SvgPoint2, p2: SvgPoint2,
): { cx: number; cy: number; r: number } | null {
  const d = 2 * (
    p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y)
  )
  if (Math.abs(d) < 1e-12) return null
  const p0sq = p0.x * p0.x + p0.y * p0.y
  const p1sq = p1.x * p1.x + p1.y * p1.y
  const p2sq = p2.x * p2.x + p2.y * p2.y
  const cx = (p0sq * (p1.y - p2.y) + p1sq * (p2.y - p0.y) + p2sq * (p0.y - p1.y)) / d
  // 注意 cy 取 x 差分（与 cx 取 y 差分对称）。标准外接圆圆心公式的 y 分量为
  // (p0sq·(p2.x−p1.x) + p1sq·(p0.x−p2.x) + p2sq·(p1.x−p0.x)) / D；
  // 旧写法把三项整体取了相反数（得 −uy），导致圆心纵坐标翻转、采样弧绕错心、
  // 闭合多边形有向面积自相抵消≈0，进而 svgPathToContours 把所有圆弧 SVG（圆/环/
  // 圆角矩形）误判为“无闭合轮廓”而丢弃。
  const cy = (p0sq * (p2.x - p1.x) + p1sq * (p0.x - p2.x) + p2sq * (p1.x - p0.x)) / d
  return { cx, cy, r: Math.hypot(p0.x - cx, p0.y - cy) }
}

/** 角度归一化到 (-π, π]。 */
function normAngle(a: number): number {
  let x = a
  while (x > Math.PI) x -= Math.PI * 2
  while (x <= -Math.PI) x += Math.PI * 2
  return x
}

/**
 * SVG arc 参数 → sagitta 中点 → 三点圆弧（与 brep 链 `arcMidPoint` 同算法）。
 * @returns 三点圆弧的中间点（SVG 坐标，Y-down）。
 */
function arcMidPoint(
  fromX: number, fromY: number,
  toX: number, toY: number,
  rx: number, ry: number,
  largeArc: boolean, sweepFlag: boolean,
): SvgPoint2 {
  const r = Math.max(rx, ry)
  const dx = toX - fromX
  const dy = toY - fromY
  const dist = Math.sqrt(dx * dx + dy * dy)
  const halfChord = dist / 2
  const sagitta = halfChord < r ? r - Math.sqrt(r * r - halfChord * halfChord) : r

  const sign = (largeArc !== sweepFlag ? 1 : -1) * (sweepFlag ? 1 : -1)
  const nx = -dy / dist
  const ny = dx / dist
  const midX = (fromX + toX) / 2 + sign * sagitta * nx
  const midY = (fromY + toY) / 2 + sign * sagitta * ny

  return { x: midX, y: midY }
}

/** 三点圆弧按圆心角线性采样（从 start 经 mid 到 end，方向自动判定）。 */
function sampleArcThrough(
  start: SvgPoint2, mid: SvgPoint2, end: SvgPoint2, segments: number,
): SvgPoint2[] {
  const c = circumcircle(start, mid, end)
  if (!c) {
    // 退化（共线）：直接取终点
    return [end]
  }
  const a0 = Math.atan2(start.y - c.cy, start.x - c.cx)
  const a1 = Math.atan2(mid.y - c.cy, mid.x - c.cx)
  const a2 = Math.atan2(end.y - c.cy, end.x - c.cx)
  const d1 = normAngle(a1 - a0)
  const d2 = normAngle(a2 - a1)
  let span: number
  if (d1 * d2 >= 0) {
    span = d1 + d2
  } else {
    // 跨 ±π 边界：把中点的角度展开到与起点同侧后再算
    span = d1 + d2 + (d1 > 0 ? Math.PI * 2 : -Math.PI * 2)
  }
  const out: SvgPoint2[] = []
  for (let i = 1; i <= segments; i++) {
    const t = i / segments
    const a = a0 + span * t
    out.push({ x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) })
  }
  return out
}

// ─── 子路径折线化（d → 采样点集） ───

/**
 * 将 SVG path `d` 折线化为闭合/开放子路径的点集。
 *
 * - 直线（M/L/H/V）直接取点；
 * - 三次（C/S）与二次（Q/T）贝塞尔按 `curveSegments` 段采样（与 three
 *   `Shape.getPoints(curveSegments)` 的段数语义一致）；
 * - 弧（A）用 sagitta 三点圆弧近似后按 `curveSegments` 段采样；
 * - `M` 前隐式闭合（opentype/常见导出器不写 `Z` 的情形）、`Z` 显式闭合。
 *
 * 输出为 **SVG 原始坐标（Y-down）**；不翻转。未闭合子路径 `closed=false`。
 *
 * @param d - the SVG path `d` attribute.
 * @param curveSegments - per-curve sampling segments (default 6, aligned with the editor text path).
 * @returns the flattened subpaths.
 */
export function parsePathToSubpaths(d: string, curveSegments = 6): SvgSubpath[] {
  const tokens = tokenizeSvgPath(d)
  const subpaths: SvgSubpath[] = []

  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let prevControlX = 0
  let prevControlY = 0
  let lastCmd = ''
  let lastPt: SvgPoint2 | null = null
  let subpathStart: SvgPoint2 | null = null
  let current: SvgPoint2[] = []

  function flush(closed: boolean): void {
    if (current.length === 0) return
    subpaths.push({
      points: current,
      bbox: computeBBox(current),
      signedArea: computeSignedArea(current),
      closed,
    })
    current = []
  }

  for (const { command, args } of tokens) {
    const isRelative = command === command.toLowerCase()
    const cmd = command.toUpperCase()

    switch (cmd) {
      case 'M': {
        if (current.length > 0) flush(false)
        let i = 0
        while (i + 1 < args.length) {
          const x = (isRelative ? cx : 0) + (args[i] ?? 0)
          const y = (isRelative ? cy : 0) + (args[i + 1] ?? 0)
          if (i === 0) {
            sx = x
            sy = y
            subpathStart = { x, y }
            current.push({ x, y })
          } else {
            const curr = { x, y }
            current.push(curr)
          }
          lastPt = { x, y }
          cx = x
          cy = y
          i += 2
        }
        break
      }
      case 'L': {
        let i = 0
        while (i + 1 < args.length) {
          const x = (isRelative ? cx : 0) + (args[i] ?? 0)
          const y = (isRelative ? cy : 0) + (args[i + 1] ?? 0)
          current.push({ x, y })
          lastPt = { x, y }
          cx = x
          cy = y
          i += 2
        }
        break
      }
      case 'H': {
        for (const arg of args) {
          const x = isRelative ? cx + arg : arg
          current.push({ x, y: cy })
          lastPt = { x, y: cy }
          cx = x
        }
        break
      }
      case 'V': {
        for (const arg of args) {
          const y = isRelative ? cy + arg : arg
          current.push({ x: cx, y })
          lastPt = { x: cx, y }
          cy = y
        }
        break
      }
      case 'C': {
        let i = 0
        while (i + 5 < args.length) {
          const ox = isRelative ? cx : 0
          const oy = isRelative ? cy : 0
          const p0 = lastPt ?? { x: ox, y: oy }
          const cp1 = { x: ox + (args[i] ?? 0), y: oy + (args[i + 1] ?? 0) }
          const cp2 = { x: ox + (args[i + 2] ?? 0), y: oy + (args[i + 3] ?? 0) }
          const endPt = { x: ox + (args[i + 4] ?? 0), y: oy + (args[i + 5] ?? 0) }
          for (let s = 1; s <= curveSegments; s++) {
            current.push(cubicAt(p0, cp1, cp2, endPt, s / curveSegments))
          }
          prevControlX = cp2.x
          prevControlY = cp2.y
          lastPt = endPt
          cx = endPt.x
          cy = endPt.y
          i += 6
        }
        break
      }
      case 'S': {
        let i = 0
        while (i + 3 < args.length) {
          const ox = isRelative ? cx : 0
          const oy = isRelative ? cy : 0
          const p0 = lastPt ?? { x: ox, y: oy }
          const cp1x = lastCmd === 'C' || lastCmd === 'S' ? 2 * cx - prevControlX : cx
          const cp1y = lastCmd === 'C' || lastCmd === 'S' ? 2 * cy - prevControlY : cy
          const cp2 = { x: ox + (args[i] ?? 0), y: oy + (args[i + 1] ?? 0) }
          const endPt = { x: ox + (args[i + 2] ?? 0), y: oy + (args[i + 3] ?? 0) }
          for (let s = 1; s <= curveSegments; s++) {
            current.push(cubicAt(p0, { x: cp1x, y: cp1y }, cp2, endPt, s / curveSegments))
          }
          prevControlX = cp2.x
          prevControlY = cp2.y
          lastPt = endPt
          cx = endPt.x
          cy = endPt.y
          lastCmd = 'S'
          i += 4
        }
        break
      }
      case 'Q': {
        let i = 0
        while (i + 3 < args.length) {
          const ox = isRelative ? cx : 0
          const oy = isRelative ? cy : 0
          const p0 = lastPt ?? { x: ox, y: oy }
          const cp = { x: ox + (args[i] ?? 0), y: oy + (args[i + 1] ?? 0) }
          const endPt = { x: ox + (args[i + 2] ?? 0), y: oy + (args[i + 3] ?? 0) }
          for (let s = 1; s <= curveSegments; s++) {
            current.push(quadAt(p0, cp, endPt, s / curveSegments))
          }
          prevControlX = cp.x
          prevControlY = cp.y
          lastPt = endPt
          cx = endPt.x
          cy = endPt.y
          i += 4
        }
        break
      }
      case 'T': {
        let i = 0
        while (i + 1 < args.length) {
          const ox = isRelative ? cx : 0
          const oy = isRelative ? cy : 0
          const p0 = lastPt ?? { x: ox, y: oy }
          const cpx = lastCmd === 'Q' || lastCmd === 'T' ? 2 * cx - prevControlX : cx
          const cpy = lastCmd === 'Q' || lastCmd === 'T' ? 2 * cy - prevControlY : cy
          const endPt = { x: ox + (args[i] ?? 0), y: oy + (args[i + 1] ?? 0) }
          for (let s = 1; s <= curveSegments; s++) {
            current.push(quadAt(p0, { x: cpx, y: cpy }, endPt, s / curveSegments))
          }
          prevControlX = cpx
          prevControlY = cpy
          lastPt = endPt
          cx = endPt.x
          cy = endPt.y
          lastCmd = 'T'
          i += 2
        }
        break
      }
      case 'A': {
        let i = 0
        while (i + 6 < args.length) {
          const rx = Math.abs(args[i] ?? 0)
          const ry = Math.abs(args[i + 1] ?? 0)
          const largeArc = (args[i + 3] ?? 0) !== 0
          const sweepFlag = (args[i + 4] ?? 0) !== 0
          const x = (isRelative ? cx : 0) + (args[i + 5] ?? 0)
          const y = (isRelative ? cy : 0) + (args[i + 6] ?? 0)
          const from = lastPt ?? { x: cx, y: cy }

          if (rx === 0 || ry === 0) {
            // 退化为直线
            const endPt = { x, y }
            current.push(endPt)
            lastPt = endPt
          } else {
            const dx = x - cx
            const dy = y - cy
            const dist = Math.sqrt(dx * dx + dy * dy)
            const endPt = { x, y }
            if (dist < 1e-10) {
              // 完整圆 → 两段半圆（与 brep 链一致）
              const r = Math.max(rx, ry)
              const sweep = sweepFlag ? 1 : -1
              const mid1 = { x: cx - sweep * r, y: cy + sweep * r }
              const opposite = { x: cx, y: cy + 2 * sweep * r }
              const mid2 = { x: cx + sweep * r, y: cy + sweep * r }
              current.push(...sampleArcThrough(from, mid1, opposite, curveSegments))
              current.push(...sampleArcThrough(opposite, mid2, from, curveSegments))
            } else {
              const mid = arcMidPoint(cx, cy, x, y, rx, ry, largeArc, sweepFlag)
              current.push(...sampleArcThrough(from, mid, endPt, curveSegments))
            }
            lastPt = endPt
          }
          cx = x
          cy = y
          i += 7
        }
        break
      }
      case 'Z': {
        // 闭合：若终点 ≠ 起点则补闭合点
        if (subpathStart && lastPt &&
            (Math.abs(subpathStart.x - lastPt.x) > 1e-9 ||
             Math.abs(subpathStart.y - lastPt.y) > 1e-9)) {
          current.push({ x: subpathStart.x, y: subpathStart.y })
        }
        flush(true)
        lastPt = subpathStart
        cx = sx
        cy = sy
        break
      }
    }

    if (cmd !== 'S' && cmd !== 'T') {
      lastCmd = cmd
    }
  }

  if (current.length > 0) flush(false)

  return subpaths
}

// ─── 几何工具（折线化输出消费；brep 链 svg-to-solid 复用同一实现） ───

/** 可参与嵌套分类的闭合子路径抽象（points 只要 x/y 结构兼容即可）。 */
export interface ClassifiableSubpath {
  points: SvgPoint2[]
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  signedArea: number
}

/**
 * 计算点集的轴对齐包围盒。
 * @param points - 二维点集（SvgPoint2 结构）。
 * @returns { minX, minY, maxX, maxY } 包围盒。
 */
export function computeBBox(points: SvgPoint2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Shoelace 有符号面积（SVG 坐标系，Y-down；正/负语义与翻转无关紧要，仅比较绝对值）。
 * 2026-10-17 起实现下沉 geometry2d/nesting（DXF 复用），此处保留旧入口。
 */
export const computeSignedArea = _computeSignedArea

/**
 * 射线法判断点是否在多边形内部（含边界视为内部由交点奇偶决定）。
 * 实现已下沉 geometry2d/nesting，此处保留旧入口。
 */
export const pointInPolygon = _pointInPolygon

/**
 * 计算点集的算术平均中心（质心近似，仅用于嵌套分类的层级判断）。
 * 实现已下沉 geometry2d/nesting，此处保留旧入口。
 */
export const polygonCentroid = _polygonCentroid

/**
 * 判断 inner 包围盒是否被 outer 包围盒完全包含（用于子路径嵌套层级预筛）。
 * 实现已下沉 geometry2d/nesting，此处保留旧入口。
 */
export const bboxContains = _bboxContains

// ─── 孔洞分类（共享核心：点集版与 brep 链 wire 版同源） ───

/**
 * 嵌套分类核心：将闭合子路径分组为外轮廓 + 孔洞（evenodd 语义）。
 *
 * 算法：
 * 1. 按有符号面积绝对值降序排（大轮廓优先）
 * 2. 对每条子路径 A，找到直接包含它的最小外轮廓 B（bbox 包含 + 质心射线法）
 * 3. 按嵌套深度奇偶分组：深度 0 为外轮廓、深度 1 为孔、深度 2 为「孔中岛」
 *    （岛是独立的第二层外轮廓，potrace 等导出器会把落在孔洞区域内的装饰子路径
 *    输出为独立闭合子路径，单层模型会将其丢弃导致该区域被错误镂空）、
 *    深度 3 为岛的孔，依此类推。
 *
 * 返回索引分组（sorted 序），由调用方组装为自己的数据结构。
 *
 * 2026-10-17 起实现下沉 geometry2d/nesting（DXF 复用），此处保留旧入口。
 *
 * @param subpaths - the closed subpaths to classify (any type with points/bbox/signedArea).
 * @returns the nested groups referencing indices into the sorted array.
 */
export const classifyNested = _classifyNested

/**
 * 将闭合子路径分类为外轮廓 + 孔洞的分组（点集版，供 mesh 链 `svgPathToContours` 使用）。
 *
 * @param subpaths - the closed subpaths to classify.
 * @returns the outer/hole contour groups.
 */
export function classifyContours(subpaths: SvgSubpath[]): { outer: SvgPoint2[]; holes: SvgPoint2[][] }[] {
  const groups = classifyNested(subpaths)
  return groups.map((g) => ({
    outer: subpaths[g.outerIdx].points,
    holes: g.holes.map((h) => subpaths[h].points),
  }))
}

// ─── 高层：SVG 字符串 → Y-up 轮廓 ───

/**
 * 将 SVG 字符串解析为 Y-up 平面轮廓（供 `extrudeShape` 消费）。
 *
 * 流程：提取元素 → 逐 path 折线化 → 应用 `<g transform>` → Y-down 翻转为 Y-up →
 * evenodd 孔洞分类。退化子路径（开放/面积≈0）被过滤。
 *
 * @param svgText - the raw SVG source text.
 * @param curveSegments - per-curve sampling segments (default 6).
 * @returns the classified contours (Y-up), ready for `extrudeShape`.
 * @throws when the SVG contains no usable closed contour.
 */
export function svgPathToContours(svgText: string, curveSegments = 6): Contour[] {
  const pathDs = extractSvgPaths(svgText)
  if (pathDs.length === 0) {
    throw new Error('[svg-path] No path elements found in SVG')
  }

  const groupTransform = extractGroupTransform(svgText)
  const allSubpaths: SvgSubpath[] = []
  for (const d of pathDs) {
    for (const sp of parsePathToSubpaths(d, curveSegments)) {
      if (!sp.closed || Math.abs(sp.signedArea) < 1e-9 || sp.points.length < 3) continue
      const pts = groupTransform ? sp.points.map((p) => applySvgTransform(p, groupTransform)) : sp.points
      // 翻转为 Y-up（与 core 世界坐标一致）
      const flipped: SvgPoint2[] = pts.map((p) => ({ x: p.x, y: -p.y }))
      allSubpaths.push({
        points: flipped,
        bbox: computeBBox(flipped),
        signedArea: computeSignedArea(flipped),
        closed: true,
      })
    }
  }

  if (allSubpaths.length === 0) {
    throw new Error('[svg-path] No closed contours generated from SVG paths')
  }

  const groups = classifyContours(allSubpaths)
  const contours: Contour[] = groups.map((g) => ({
    outer: g.outer as unknown as P2[],
    holes: g.holes.map((h) => h as unknown as P2[]),
  }))
  return contours
}
