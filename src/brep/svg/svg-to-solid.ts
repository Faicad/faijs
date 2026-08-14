/**
 * SVG → OCCT wire/face/solid 转换
 *
 * 适配自 brepjs `src/io/svgImportFns.ts`，保留核心算法和命名。
 * 与 brepjs 的差异：
 * - brepjs 用 Curve2D / Blueprint / sketchOnPlane → 本项目直接用 3D edge / makeWire / makeFace
 * - brepjs 不处理孔洞 → 本项目用 kernel.addHolesInFace 处理外轮廓+内孔
 * - brepjs 仅解析 <path> → 本项目额外转换 <rect>/<circle>/<ellipse>/<line>/<polyline>/<polygon>
 *
 * 与 text-to-solid.ts 的差异：
 * - text 的 glyph 互不嵌套，各自 makeFace→extrude→fuse
 * - SVG 路径常有外轮廓+内孔，需 addHolesInFace 挖孔后再 extrude
 *
 * SVG path 命令 → OCCT edge 映射：
 * - M (moveTo) → 开始新子路径
 * - L (lineTo) → kernel.makeLineEdge
 * - H/V → 转 makeLineEdge
 * - C (cubicBezier) → kernel.makeBezierEdge
 * - S (smoothCubicBezier) → 反射控制点 → makeBezierEdge
 * - Q (quadraticBezier) → 转三次贝塞尔 → makeBezierEdge
 * - T (smoothQuadraticBezier) → 反射控制点 → 转三次 → makeBezierEdge
 * - A (arc) → 计算 sagitta 中点 → kernel.makeArcEdge(start, mid, end)
 * - Z (closePath) → 闭合 wire
 */

import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { getSolidBoundingBox } from '../brep-utils'
import { parseSvgNaturalSize } from '../../primitives/parse-svg-size'

export { parseSvgNaturalSize }

// ─── 类型定义 ───

/** 3D 点（OCCT Vec3 格式） */
interface Pt { x: number; y: number; z: number }

/** SVG path token */
interface PathToken {
  command: string
  args: number[]
}

/** 闭合子路径信息（用于孔洞检测） */
interface ClosedSubpath {
  /** 顶点列表（XY 平面，Z=0） */
  points: Pt[]
  /** 包围盒 */
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  /** 有符号面积（Shoelace，正=CCW，负=CW） */
  signedArea: number
  /** 对应的 OCCT wire */
  wire: ShapeHandle
}

// ─── SVG 元素提取（将 <rect>/<circle>/… 转为 <path d>） ───

/**
 * 从 SVG 字符串中提取所有图形元素的 path `d` 属性。
 *
 * 支持：<path>, <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>。
 * 使用正则提取，无 DOMParser 依赖（可在 Web Worker / Node 中运行）。
 */
export function extractSvgPaths(svgString: string): string[] {
  const paths: string[] = []

  // <path d="...">
  extractPathDAttributes(svgString, paths)

  // <rect>
  extractRectPaths(svgString, paths)

  // <circle>
  extractCirclePaths(svgString, paths)

  // <ellipse>
  extractEllipsePaths(svgString, paths)

  // <line>
  extractLinePaths(svgString, paths)

  // <polyline>
  extractPolylinePaths(svgString, paths, false)

  // <polygon>
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

    // 如果 rect 有 transform 属性，将变换应用到四个角点后输出为 path d
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
    // 两个半圆弧组成完整圆
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
    const nums = pointsStr.split(/[\s,]+/).filter(s => s.length > 0).map(Number)
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

// ─── SVG transform 处理 ───

/** SVG 2D 仿射变换矩阵 [a, b, c, d, e, f]（matrix(a,b,c,d,e,f)） */
type SvgTransform = [number, number, number, number, number, number]

/** 解析 SVG transform 字符串（仅支持 matrix 形式） */
function parseSvgTransform(transformStr: string): SvgTransform | undefined {
  const m = transformStr.match(/matrix\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/)
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])]
  }
  return undefined
}

/** 从 SVG 字符串中提取 <g transform="matrix(...)"> 的变换矩阵 */
function extractGroupTransform(svgString: string): SvgTransform | undefined {
  const m = svgString.match(/<g\b[^>]*\btransform\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/i)
  if (m) {
    return parseSvgTransform(m[1] ?? m[2] ?? '')
  }
  return undefined
}

/** 将 SVG 2D 变换转为 OCCT 3x4 row-major 仿射矩阵（考虑 Y 翻转） */
function svgTransformToOcctMatrix(gt: SvgTransform): number[] {
  // SVG: x' = a*x + c*y + e, y' = b*x + d*y + f
  // OCCT 点的 Y 已翻转 (y_occt = -y_svg)，所以：
  // x'_occt = a*x_occt - c*y_occt + e
  // y'_occt = -b*x_occt + d*y_occt - f
  // OCCT transform 数组格式: [r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]
  return [
    gt[0], -gt[2], 0, gt[4],
    -gt[1], gt[3], 0, -gt[5],
    0, 0, 1, 0,
  ]
}

/** 对 OCCT 空间点应用 SVG 2D 变换 */
function applySvgTransformToOcctPoint(p: Pt, gt: SvgTransform): Pt {
  // p 在 OCCT 空间 (Y-up)，先转回 SVG 空间 (Y-down)
  const svgX = p.x
  const svgY = -p.y
  const tx = gt[0] * svgX + gt[2] * svgY + gt[4]
  const ty = gt[1] * svgX + gt[3] * svgY + gt[5]
  return { x: tx, y: -ty, z: 0 }
}

// ─── SVG path tokenizer ───

function tokenizeSVGPath(d: string): PathToken[] {
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

// ─── SVG path → OCCT edges ───

/** Y 轴翻转：SVG Y-down → OCCT Y-up */
function flipY(x: number, y: number): Pt {
  return { x, y: -y, z: 0 }
}

/** 将二次贝塞尔转为三次贝塞尔的控制点 */
function quadToCubic(p0: Pt, cp: Pt, p2: Pt): [Pt, Pt] {
  return [
    { x: (2 * cp.x + p0.x) / 3, y: (2 * cp.y + p0.y) / 3, z: 0 },
    { x: (2 * cp.x + p2.x) / 3, y: (2 * cp.y + p2.y) / 3, z: 0 },
  ]
}

/** cursor 状态 */
interface PathCursor {
  cx: number; cy: number
  sx: number; sy: number
  prevControlX: number; prevControlY: number
  lastCmd: string
}

/**
 * SVG arc 参数 → sagitta 中点 → 三点圆弧。
 *
 * 算法与 brepjs createStandardArc（`:296`）一致：
 * 1. 弦中点 = (from + to) / 2
 * 2. 弦长 = dist(from, to)
 * 3. sagitta = r - sqrt(r² - (chord/2)²)
 * 4. 中点 = 弦中点 + sagitta * 法线方向
 */
function arcMidPoint(
  fromX: number, fromY: number,
  toX: number, toY: number,
  rx: number, ry: number,
  largeArc: boolean, sweepFlag: boolean,
): Pt {
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

  return flipY(midX, midY)
}

/**
 * 解析 SVG path `d` 字符串，构建 OCCT wire 列表。
 *
 * 每个 M...Z 闭合段（或 M...M 隐式闭合段）对应一个 wire。
 * 未闭合的段（无 Z，后接 M 或结束）也会生成 wire（但标记为未闭合）。
 *
 * @param kernel OCCT 内核
 * @param pathD SVG path `d` 属性字符串
 * @returns 闭合子路径列表（含 wire + 几何信息）
 */
export function parseSVGPathToWires(
  kernel: OcctKernel,
  pathD: string,
): ClosedSubpath[] {
  const tokens = tokenizeSVGPath(pathD)
  const subpaths: ClosedSubpath[] = []

  const cursor: PathCursor = {
    cx: 0, cy: 0, sx: 0, sy: 0,
    prevControlX: 0, prevControlY: 0, lastCmd: '',
  }

  let currentEdges: ShapeHandle[] = []
  let currentPoints: Pt[] = []
  let lastPt: Pt | null = null
  let subpathStart: Pt | null = null

  function flushWire(closed: boolean): void {
    if (currentEdges.length === 0) {
      currentPoints = []
      return
    }
    // 如果闭合且终点≠起点，补一条闭合边
    if (closed && subpathStart && lastPt &&
        (Math.abs(subpathStart.x - lastPt.x) > 1e-9 ||
         Math.abs(subpathStart.y - lastPt.y) > 1e-9)) {
      const edge = kernel.makeLineEdge(lastPt, subpathStart)
      currentEdges.push(edge)
      currentPoints.push(subpathStart)
    }

    try {
      const wire = kernel.makeWire(currentEdges)
      // 释放 edges（wire 已共享 TShape）
      for (const e of currentEdges) kernel.release(e)

      const pts = closed ? currentPoints : [...currentPoints]
      // 如果未闭合但有点，尝试闭合以计算 bbox/area
      if (!closed && pts.length >= 2) {
        pts.push(pts[0])
      }

      if (pts.length >= 3) {
        const bbox = computeBBox(pts)
        const signedArea = computeSignedArea(pts)
        subpaths.push({ points: currentPoints, bbox, signedArea, wire })
      } else {
        subpaths.push({
          points: currentPoints,
          bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          signedArea: 0,
          wire,
        })
      }
    } catch {
      // makeWire 失败 → 释放 edges
      for (const e of currentEdges) kernel.release(e)
    }

    currentEdges = []
    currentPoints = []
  }

  for (const { command, args } of tokens) {
    const isRelative = command === command.toLowerCase()
    const cmd = command.toUpperCase()

    switch (cmd) {
      case 'M': {
        // 如果有当前 edges，先 flush（隐式闭合不补线）
        if (currentEdges.length > 0) flushWire(false)

        let i = 0
        while (i + 1 < args.length) {
          const x = (isRelative ? cursor.cx : 0) + (args[i] ?? 0)
          const y = (isRelative ? cursor.cy : 0) + (args[i + 1] ?? 0)
          if (i === 0) {
            cursor.sx = x
            cursor.sy = y
            lastPt = flipY(x, y)
            subpathStart = lastPt
            currentPoints.push(lastPt)
          } else {
            // 隐式 L
            const curr = flipY(x, y)
            if (lastPt && (Math.abs(curr.x - lastPt.x) > 1e-9 || Math.abs(curr.y - lastPt.y) > 1e-9)) {
              const edge = kernel.makeLineEdge(lastPt, curr)
              currentEdges.push(edge)
              currentPoints.push(curr)
            }
            lastPt = curr
          }
          cursor.cx = x
          cursor.cy = y
          i += 2
        }
        break
      }
      case 'L': {
        let i = 0
        while (i + 1 < args.length) {
          const x = (isRelative ? cursor.cx : 0) + (args[i] ?? 0)
          const y = (isRelative ? cursor.cy : 0) + (args[i + 1] ?? 0)
          const curr = flipY(x, y)
          if (lastPt && (Math.abs(curr.x - lastPt.x) > 1e-9 || Math.abs(curr.y - lastPt.y) > 1e-9)) {
            const edge = kernel.makeLineEdge(lastPt, curr)
            currentEdges.push(edge)
            currentPoints.push(curr)
          }
          lastPt = curr
          cursor.cx = x
          cursor.cy = y
          i += 2
        }
        break
      }
      case 'H': {
        for (const arg of args) {
          const x = isRelative ? cursor.cx + arg : arg
          const curr = flipY(x, cursor.cy)
          if (lastPt && (Math.abs(curr.x - lastPt.x) > 1e-9 || Math.abs(curr.y - lastPt.y) > 1e-9)) {
            const edge = kernel.makeLineEdge(lastPt, curr)
            currentEdges.push(edge)
            currentPoints.push(curr)
          }
          lastPt = curr
          cursor.cx = x
        }
        break
      }
      case 'V': {
        for (const arg of args) {
          const y = isRelative ? cursor.cy + arg : arg
          const curr = flipY(cursor.cx, y)
          if (lastPt && (Math.abs(curr.x - lastPt.x) > 1e-9 || Math.abs(curr.y - lastPt.y) > 1e-9)) {
            const edge = kernel.makeLineEdge(lastPt, curr)
            currentEdges.push(edge)
            currentPoints.push(curr)
          }
          lastPt = curr
          cursor.cy = y
        }
        break
      }
      case 'C': {
        let i = 0
        while (i + 5 < args.length) {
          const ox = isRelative ? cursor.cx : 0
          const oy = isRelative ? cursor.cy : 0
          const cp1 = flipY(ox + (args[i] ?? 0), oy + (args[i + 1] ?? 0))
          const cp2 = flipY(ox + (args[i + 2] ?? 0), oy + (args[i + 3] ?? 0))
          const endPt = flipY(ox + (args[i + 4] ?? 0), oy + (args[i + 5] ?? 0))
          if (lastPt) {
            const edge = kernel.makeBezierEdge([lastPt, cp1, cp2, endPt])
            currentEdges.push(edge)
            currentPoints.push(endPt)
          }
          cursor.prevControlX = ox + (args[i + 2] ?? 0)
          cursor.prevControlY = oy + (args[i + 3] ?? 0)
          lastPt = endPt
          cursor.cx = ox + (args[i + 4] ?? 0)
          cursor.cy = oy + (args[i + 5] ?? 0)
          i += 6
        }
        break
      }
      case 'S': {
        let i = 0
        while (i + 3 < args.length) {
          const ox = isRelative ? cursor.cx : 0
          const oy = isRelative ? cursor.cy : 0
          const prev = cursor.lastCmd
          const cp1x = prev === 'C' || prev === 'S' ? 2 * cursor.cx - cursor.prevControlX : cursor.cx
          const cp1y = prev === 'C' || prev === 'S' ? 2 * cursor.cy - cursor.prevControlY : cursor.cy
          const cp2 = flipY(ox + (args[i] ?? 0), oy + (args[i + 1] ?? 0))
          const endPt = flipY(ox + (args[i + 2] ?? 0), oy + (args[i + 3] ?? 0))
          if (lastPt) {
            const cp1 = flipY(cp1x, cp1y)
            const edge = kernel.makeBezierEdge([lastPt, cp1, cp2, endPt])
            currentEdges.push(edge)
            currentPoints.push(endPt)
          }
          cursor.prevControlX = ox + (args[i] ?? 0)
          cursor.prevControlY = oy + (args[i + 1] ?? 0)
          lastPt = endPt
          cursor.cx = ox + (args[i + 2] ?? 0)
          cursor.cy = oy + (args[i + 3] ?? 0)
          cursor.lastCmd = 'S'
          i += 4
        }
        break
      }
      case 'Q': {
        let i = 0
        while (i + 3 < args.length) {
          const ox = isRelative ? cursor.cx : 0
          const oy = isRelative ? cursor.cy : 0
          const cp = flipY(ox + (args[i] ?? 0), oy + (args[i + 1] ?? 0))
          const endPt = flipY(ox + (args[i + 2] ?? 0), oy + (args[i + 3] ?? 0))
          if (lastPt) {
            const [c1, c2] = quadToCubic(lastPt, cp, endPt)
            const edge = kernel.makeBezierEdge([lastPt, c1, c2, endPt])
            currentEdges.push(edge)
            currentPoints.push(endPt)
          }
          cursor.prevControlX = ox + (args[i] ?? 0)
          cursor.prevControlY = oy + (args[i + 1] ?? 0)
          lastPt = endPt
          cursor.cx = ox + (args[i + 2] ?? 0)
          cursor.cy = oy + (args[i + 3] ?? 0)
          i += 4
        }
        break
      }
      case 'T': {
        let i = 0
        while (i + 1 < args.length) {
          const ox = isRelative ? cursor.cx : 0
          const oy = isRelative ? cursor.cy : 0
          const prev = cursor.lastCmd
          const cpx = prev === 'Q' || prev === 'T' ? 2 * cursor.cx - cursor.prevControlX : cursor.cx
          const cpy = prev === 'Q' || prev === 'T' ? 2 * cursor.cy - cursor.prevControlY : cursor.cy
          const endPt = flipY(ox + (args[i] ?? 0), oy + (args[i + 1] ?? 0))
          if (lastPt) {
            const cp = flipY(cpx, cpy)
            const [c1, c2] = quadToCubic(lastPt, cp, endPt)
            const edge = kernel.makeBezierEdge([lastPt, c1, c2, endPt])
            currentEdges.push(edge)
            currentPoints.push(endPt)
          }
          cursor.prevControlX = cpx
          cursor.prevControlY = cpy
          lastPt = endPt
          cursor.cx = ox + (args[i] ?? 0)
          cursor.cy = oy + (args[i + 1] ?? 0)
          cursor.lastCmd = 'T'
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
          const x = (isRelative ? cursor.cx : 0) + (args[i + 5] ?? 0)
          const y = (isRelative ? cursor.cy : 0) + (args[i + 6] ?? 0)

          if (rx === 0 || ry === 0) {
            // 退化为直线
            const curr = flipY(x, y)
            if (lastPt) {
              const edge = kernel.makeLineEdge(lastPt, curr)
              currentEdges.push(edge)
              currentPoints.push(curr)
            }
            lastPt = curr
          } else {
            const dx = x - cursor.cx
            const dy = y - cursor.cy
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 1e-10) {
              // 完整圆 → 两段半圆
              const r = Math.max(rx, ry)
              const sweep = sweepFlag ? 1 : -1
              const mid1 = flipY(cursor.cx - sweep * r, cursor.cy + sweep * r)
              const opposite = flipY(cursor.cx, cursor.cy + 2 * sweep * r)
              const mid2 = flipY(cursor.cx + sweep * r, cursor.cy + sweep * r)
              if (lastPt) {
                const e1 = kernel.makeArcEdge(lastPt, mid1, opposite)
                const e2 = kernel.makeArcEdge(opposite, mid2, lastPt)
                currentEdges.push(e1, e2)
                currentPoints.push(opposite, lastPt)
              }
            } else {
              // 标准圆弧 → sagitta 中点
              const mid = arcMidPoint(cursor.cx, cursor.cy, x, y, rx, ry, largeArc, sweepFlag)
              const endPt = flipY(x, y)
              if (lastPt) {
                const edge = kernel.makeArcEdge(lastPt, mid, endPt)
                currentEdges.push(edge)
                currentPoints.push(endPt)
              }
              lastPt = endPt
            }
          }
          cursor.cx = x
          cursor.cy = y
          i += 7
        }
        break
      }
      case 'Z': {
        // 闭合
        if (subpathStart && lastPt &&
            (Math.abs(subpathStart.x - lastPt.x) > 1e-9 ||
             Math.abs(subpathStart.y - lastPt.y) > 1e-9)) {
          const edge = kernel.makeLineEdge(lastPt, subpathStart)
          currentEdges.push(edge)
          currentPoints.push(subpathStart)
        }
        flushWire(true)
        lastPt = subpathStart
        cursor.cx = cursor.sx
        cursor.cy = cursor.sy
        break
      }
    }

    if (cmd !== 'S' && cmd !== 'T') {
      cursor.lastCmd = cmd
    }
  }

  // 处理最后一个未闭合的子路径
  if (currentEdges.length > 0) {
    flushWire(false)
  }

  return subpaths
}

// ─── 几何工具 ───

function computeBBox(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** Shoelace 公式计算有符号面积（正=CCW，负=CW） */
function computeSignedArea(points: Pt[]): number {
  let area = 0
  const n = points.length
  if (n < 3) return 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }
  return area / 2
}

/** 点在多边形内（ray casting） */
function pointInPolygon(pt: Pt, polygon: Pt[]): boolean {
  const n = polygon.length
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/** 计算多边形质心 */
function polygonCentroid(points: Pt[]): Pt {
  let cx = 0, cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  return { x: cx / points.length, y: cy / points.length, z: 0 }
}

function bboxContains(outer: { minX: number; minY: number; maxX: number; maxY: number },
                      inner: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
         inner.minY >= outer.minY && inner.maxY <= outer.maxY
}

// ─── 孔洞分类 ───

interface ContourGroup {
  /** 外轮廓 wire */
  outer: ShapeHandle
  /** 孔洞 wire 列表 */
  holes: ShapeHandle[]
}

/**
 * 将闭合子路径分类为外轮廓 + 孔洞的分组。
 *
 * 算法：
 * 1. 按有符号面积绝对值降序排（大轮廓优先）
 * 2. 对每条子路径 A，找到直接包含它的最小外轮廓 B
 * 3. A 是 B 的孔洞
 * 4. 没有外轮廓的子路径是独立外轮廓
 */
export function classifyHoles(subpaths: ClosedSubpath[]): ContourGroup[] {
  // 按面积绝对值降序排
  const sorted = [...subpaths].sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea))

  // 为每条子路径找直接外轮廓
  const parentOf = new Array(sorted.length).fill(-1)
  for (let i = 0; i < sorted.length; i++) {
    let bestParent = -1
    let bestParentArea = Infinity
    const centroid = polygonCentroid(sorted[i].points)
    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue
      // j 的面积必须大于 i
      if (Math.abs(sorted[j].signedArea) <= Math.abs(sorted[i].signedArea)) continue
      // j 的 bbox 必须包含 i 的 bbox
      if (!bboxContains(sorted[j].bbox, sorted[i].bbox)) continue
      // i 的质心必须在 j 的多边形内
      if (!pointInPolygon(centroid, sorted[j].points)) continue
      // 选面积最小的外轮廓（直接包含者）
      if (Math.abs(sorted[j].signedArea) < bestParentArea) {
        bestParentArea = Math.abs(sorted[j].signedArea)
        bestParent = j
      }
    }
    parentOf[i] = bestParent
  }

  // 构建分组
  const groups: ContourGroup[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (parentOf[i] === -1) {
      // 外轮廓
      groups.push({ outer: sorted[i].wire, holes: [] })
    }
  }

  // 为每个孔洞找到对应的外轮廓
  for (let i = 0; i < sorted.length; i++) {
    if (parentOf[i] !== -1) {
      // 找到 groups 中对应的外轮廓
      const parentIdx = parentOf[i]
      // parentIdx 是 sorted 中的索引，需要找到对应的 group
      // 外轮廓在 sorted 中的索引 → groups 中的索引
      let groupIdx = -1
      let outerCount = 0
      for (let k = 0; k < sorted.length; k++) {
        if (parentOf[k] === -1) {
          if (k === parentIdx) {
            groupIdx = outerCount
            break
          }
          outerCount++
        }
      }
      if (groupIdx >= 0 && groupIdx < groups.length) {
        groups[groupIdx].holes.push(sorted[i].wire)
      }
    }
  }

  return groups
}

// ─── SVG → Solid ───

/**
 * 将 SVG 字符串转换为 OCCT 3D solid（face → extrude → fuse）。
 *
 * 流程：
 * 1. 提取所有 SVG 元素的 path `d`
 * 2. 解析每条 path → wires
 * 3. 分类外轮廓/孔洞
 * 4. makeFace(outer) → addHolesInFace(holes) → extrude
 * 5. fuse 所有 solid
 * 6. 缩放 + 居中
 *
 * @param kernel OCCT 内核
 * @param svgString SVG 字符串
 * @param options 配置选项
 * @returns ShapeHandle（合并后的 solid）
 */
export function svgToSolid(
  kernel: OcctKernel,
  svgString: string,
  options: {
    depth: number
    targetLongSide?: number
  },
): ShapeHandle {
  const { depth, targetLongSide = 20 } = options

  // 1. 提取所有 path d
  const pathDs = extractSvgPaths(svgString)
  if (pathDs.length === 0) {
    throw new Error('[svgToSolid] No path elements found in SVG')
  }

  // 2. 解析每条 path → wires
  const allSubpaths: ClosedSubpath[] = []
  for (const d of pathDs) {
    const subpaths = parseSVGPathToWires(kernel, d)
    allSubpaths.push(...subpaths)
  }

  if (allSubpaths.length === 0) {
    throw new Error('[svgToSolid] No closed subpaths generated from SVG paths')
  }

  // 2.5. 应用 <g transform> 变换（如果有）
  const groupTransform = extractGroupTransform(svgString)
  if (groupTransform) {
    const matrix = svgTransformToOcctMatrix(groupTransform)
    for (const sp of allSubpaths) {
      // 变换 wire
      const newWire = kernel.transform(sp.wire, matrix)
      kernel.release(sp.wire)
      sp.wire = newWire
      // 变换 points（用于 bbox/area 计算）
      sp.points = sp.points.map(p => applySvgTransformToOcctPoint(p, groupTransform))
      sp.bbox = computeBBox(sp.points)
      sp.signedArea = computeSignedArea(sp.points)
    }
  }

  // 3. 分类外轮廓/孔洞
  const groups = classifyHoles(allSubpaths)

  // 4. 计算缩放比例（与 mesh 路径 geo.scale(scale, scale, 1) 语义一致：XY 缩放，Z 不变）
  const { naturalWidth, naturalHeight } = parseSvgNaturalSize(svgString)
  let scale = 1
  if (naturalWidth > 0 && naturalHeight > 0) {
    const longSide = Math.max(naturalWidth, naturalHeight)
    scale = longSide > 0 ? targetLongSide / longSide : 1
  }

  // 5. 对每个分组：makeFace → addHolesInFace → 缩放 face → extrude
  //    缩放在 extrude 之前应用（仅 XY），确保 depth 不被缩放
  const solids: ShapeHandle[] = []
  for (const group of groups) {
    try {
      let face = kernel.makeFace(group.outer)
      if (group.holes.length > 0) {
        const newFace = kernel.addHolesInFace(face, group.holes)
        kernel.release(face)
        face = newFace
      }
      // 缩放 face（XY 平面），depth 不受影响
      // face 在 Z=0 平面，kernel.scale 是均匀缩放但 Z=0*scale=0 不变
      if (scale !== 1) {
        const scaledFace = kernel.scale(face, { x: 0, y: 0, z: 0 }, scale)
        kernel.release(face)
        face = scaledFace
      }
      const solid = kernel.extrude(face, 0, 0, depth)
      kernel.release(face)
      solids.push(solid)
    } catch {
      // makeFace/extrude 失败 → 跳过此轮廓
    }
  }

  // 释放所有 wire（face/solid 已共享 TShape）
  for (const sp of allSubpaths) {
    try { kernel.release(sp.wire) } catch { /* 已释放 */ }
  }

  if (solids.length === 0) {
    throw new Error('[svgToSolid] No solids generated from SVG')
  }

  // 6. Fuse 所有 solid
  let result = solids[0]
  for (let i = 1; i < solids.length; i++) {
    const prev = result
    result = kernel.fuse(prev, solids[i])
    kernel.release(prev)
    kernel.release(solids[i])
  }

  // 7. 居中：XY 居中到原点，Z 底部对齐到 0
  const bb = getSolidBoundingBox(kernel, result)
  const cx = (bb.min[0] + bb.max[0]) / 2
  const cy = (bb.min[1] + bb.max[1]) / 2
  const cz = bb.min[2]
  const centered = kernel.translate(result, -cx, -cy, -cz)
  kernel.release(result)

  return centered
}
