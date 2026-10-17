/**
 * SVG → OCCT wire/face/solid 转换
 *
 * 适配自 brepjs `src/io/svgImportFns.ts`，保留核心算法和命名。
 * 与 brepjs 的差异：
 * - brepjs 不处理孔洞 → 本项目用 kernel.addHolesInFace 处理外轮廓+内孔
 * - brepjs 仅解析 <path> → 本项目额外转换 <rect>/<circle>/<ellipse>/<line>/<polyline>/<polygon>
 *
 * 与 text-to-solid.ts 的差异：
 * - text 的 glyph 互不嵌套，各自 makeFace→extrude→fuse
 * - SVG 路径常有外轮廓+内孔，需 addHolesInFace 挖孔后再 extrude
 *
 * SVG path 命令 → Curve2dObj 映射（2026-10-17 起 geometry2d 迁移完成）：
 * - M (moveTo) → 开始新子路径
 * - L/H/V → makeLine2d
 * - C/S/Q/T → makeBezier2d（S/T 反射控制点；Q/T 经 quadToCubic 转三次）
 * - A (arc) → sagitta 中点 → makeArc2dThreePoints（算法与 brepjs createStandardArc 一致）
 * - Z (closePath) → 闭合线段
 * wire 组装统一经 geometry2d 桥 assembleWire（'XY' 平面）——与 sketch/profile/DXF
 * 同一管线；本文件不再直接调用内核建边原语（face/extrude/fuse 仍在内核层）。
 */

import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import { getSolidBoundingBox } from '../brep-utils'
import { parseSvgNaturalSize } from '../../primitives/parse-svg-size'
import {
  extractSvgPaths,
  tokenizeSvgPath,
  extractGroupTransform,
  computeBBox,
  computeSignedArea,
} from '../../primitives/svg/svg-path'
import { classifyNested } from '../../geometry2d/nesting'
import type { SvgTransform } from '../../primitives/svg/svg-path'
import { makeLine2d, makeBezier2d, makeArc2dThreePoints, type Curve2dObj } from '../../geometry2d/curve2d'
import { Blueprint } from '../../geometry2d/blueprint'
import { assembleWire } from '../../geometry2d/bridge/lift-on-plane'

export { parseSvgNaturalSize }

// 兼容导出：语法层共享实现（extractSvgPaths 等的历史入口仍在 brep 面可用）
export { extractSvgPaths }

// ─── 类型定义 ───

/** 3D 点（OCCT Vec3 格式） */
interface Pt { x: number; y: number; z: number }

/** 闭合子路径信息（用于孔洞检测） */
interface ClosedSubpath {
  /** 顶点列表（XY 平面，Z=0） */
  points: Pt[]
  /** 包围盒 */
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  /** 有符号面积（Shoelace，正=CCW，负=CW） */
  signedArea: number
  /** 对应的 OCCT wire */
  wire: BrepHandle
}

// ─── SVG 元素提取 / transform / tokenizer ───
// 与 mesh 链共享同一实现（primitives/svg/svg-path.ts）：
// extractSvgPaths / parseSvgTransform / extractGroupTransform / tokenizeSvgPath。
// brep 链保留精确几何语义（Bezier→OCCT 曲线、Arc→三点圆弧），
// 语法层（元素提取、矩阵解析、tokenizer）不重复实现。

// ─── SVG transform 处理（OCCT 矩阵适配，brep 链特有） ───
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
  kernel: BrepEngineApi,
  pathD: string,
): ClosedSubpath[] {
  const tokens = tokenizeSvgPath(pathD)
  const subpaths: ClosedSubpath[] = []

  const cursor: PathCursor = {
    cx: 0, cy: 0, sx: 0, sy: 0,
    prevControlX: 0, prevControlY: 0, lastCmd: '',
  }

  // geometry2d 迁移（2026-10-17）：各 case 只产出 Curve2dObj（flipY 在构造点时
  // 一次性应用），wire 组装统一经 assembleWire——与 sketch/profile/DXF 同一管线。
  // 曲线→edge 的内核调用全部收敛到 liftCurve2dToPlane，本文件不再直接调内核。
  let currentCurves: Curve2dObj[] = []
  let currentPoints: Pt[] = []
  let lastPt: Pt | null = null
  let subpathStart: Pt | null = null

  function flushWire(closed: boolean): void {
    if (currentCurves.length === 0) {
      currentPoints = []
      return
    }
    // 如果闭合且终点≠起点，补一条闭合线段（Curve2d 层）
    if (closed && subpathStart && lastPt &&
        (Math.abs(subpathStart.x - lastPt.x) > 1e-9 ||
         Math.abs(subpathStart.y - lastPt.y) > 1e-9)) {
      currentCurves.push(makeLine2d(lastPt.x, lastPt.y, subpathStart.x, subpathStart.y))
      currentPoints.push(subpathStart)
    }

    try {
      const wire = assembleWire(kernel, 'XY', new Blueprint(currentCurves))

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
      // Blueprint 组线失败 → 丢弃该子路径（曲线未落成 edge，无需 release）
    }

    currentCurves = []
    currentPoints = []
  }

  for (const { command, args } of tokens) {
    const isRelative = command === command.toLowerCase()
    const cmd = command.toUpperCase()

    switch (cmd) {
      case 'M': {
        // 如果有当前曲线，先 flush（隐式闭合不补线）
        if (currentCurves.length > 0) flushWire(false)

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
              currentCurves.push(makeLine2d(lastPt.x, lastPt.y, curr.x, curr.y))
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
            currentCurves.push(makeLine2d(lastPt.x, lastPt.y, curr.x, curr.y))
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
            currentCurves.push(makeLine2d(lastPt.x, lastPt.y, curr.x, curr.y))
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
            currentCurves.push(makeLine2d(lastPt.x, lastPt.y, curr.x, curr.y))
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
            currentCurves.push(makeBezier2d([
              [lastPt.x, lastPt.y], [cp1.x, cp1.y], [cp2.x, cp2.y], [endPt.x, endPt.y],
            ]))
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
            currentCurves.push(makeBezier2d([
              [lastPt.x, lastPt.y], [cp1.x, cp1.y], [cp2.x, cp2.y], [endPt.x, endPt.y],
            ]))
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
            currentCurves.push(makeBezier2d([
              [lastPt.x, lastPt.y], [c1.x, c1.y], [c2.x, c2.y], [endPt.x, endPt.y],
            ]))
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
            currentCurves.push(makeBezier2d([
              [lastPt.x, lastPt.y], [c1.x, c1.y], [c2.x, c2.y], [endPt.x, endPt.y],
            ]))
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
              currentCurves.push(makeLine2d(lastPt.x, lastPt.y, curr.x, curr.y))
              currentPoints.push(curr)
            }
            lastPt = curr
          } else {
            const dx = x - cursor.cx
            const dy = y - cursor.cy
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 1e-10) {
              // 完整圆 → 两段半圆（三点弧）
              const r = Math.max(rx, ry)
              const sweep = sweepFlag ? 1 : -1
              const mid1 = flipY(cursor.cx - sweep * r, cursor.cy + sweep * r)
              const opposite = flipY(cursor.cx, cursor.cy + 2 * sweep * r)
              const mid2 = flipY(cursor.cx + sweep * r, cursor.cy + sweep * r)
              if (lastPt) {
                currentCurves.push(makeArc2dThreePoints(lastPt.x, lastPt.y, mid1.x, mid1.y, opposite.x, opposite.y))
                currentCurves.push(makeArc2dThreePoints(opposite.x, opposite.y, mid2.x, mid2.y, lastPt.x, lastPt.y))
                currentPoints.push(opposite, lastPt)
              }
            } else {
              // 标准圆弧 → sagitta 中点（算法与 brepjs createStandardArc 一致）
              const mid = arcMidPoint(cursor.cx, cursor.cy, x, y, rx, ry, largeArc, sweepFlag)
              const endPt = flipY(x, y)
              if (lastPt) {
                currentCurves.push(makeArc2dThreePoints(lastPt.x, lastPt.y, mid.x, mid.y, endPt.x, endPt.y))
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
        // 闭合（终点≠起点的闭合线段由 flushWire 统一补——2026-10-17 起 Z 不再
        // 自行补线，修掉旧实现「Z 补一次 + flushWire 再补一次」的双重闭合）
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
  if (currentCurves.length > 0) {
    flushWire(false)
  }

  return subpaths
}

// ─── 孔洞分类 ───
// 几何工具（computeBBox/computeSignedArea/pointInPolygon/polygonCentroid/bboxContains）
// 与嵌套分组算法共享 primitives/svg/svg-path.ts 的 classifyNested 实现，
// 本文件仅组装 wire 句柄（岛/孔中孔的多层嵌套语义已内置于 classifyNested）。

interface ContourGroup {
  /** 外轮廓 wire */
  outer: BrepHandle
  /** 孔洞 wire 列表 */
  holes: BrepHandle[]
}

/**
 * 将闭合子路径分类为外轮廓 + 孔洞的分组（复用共享 classifyNested，支持多层嵌套岛）。
 *
 * @param subpaths - the closed subpaths to classify.
 * @returns the contour groups of outer wires and their hole wires.
 */
export function classifyHoles(subpaths: ClosedSubpath[]): ContourGroup[] {
  const groups = classifyNested(subpaths)
  return groups.map((g) => ({
    outer: subpaths[g.outerIdx].wire,
    holes: g.holes.map((h) => subpaths[h].wire),
  }))
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
 * @returns BrepHandle（合并后的 solid）
 */
export function svgToSolid(
  kernel: BrepEngineApi,
  svgString: string,
  options: {
    depth: number
    targetLongSide?: number
  },
): BrepHandle {
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
      // 变换 wire — use generalTransform because group transform may have non-uniform scale (e.g. d=-0.1 vs a=0.1)
      // kernel.transform only supports uniform scale (gp_Trsf), generalTransform supports non-uniform (gp_GTrsf)
      const newWire = kernel.generalTransform(sp.wire, matrix)
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
  const solids: BrepHandle[] = []
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
