/**
 * 文字 → OCCT wire/face 转换
 *
 * 适配自 brepjs `src/text/textBlueprints.ts`。
 * 保留文件名和核心算法，适配本项目的 occt-wasm API。
 *
 * 与 brepjs 的差异：
 * - brepjs 用 BlueprintSketcher 构造 wire → 本项目直接用 kernel.makeLineEdge / makeBezierEdge
 * - brepjs 用 organiseBlueprints 处理孔洞 → 本项目用 makeFace 直接构建（OCCT 自动处理内孔）
 * - brepjs 用 sketchOnPlane → 本项目直接在 XY 平面构造然后按需变换
 *
 * opentype.js 路径命令 → OCCT edge 映射：
 * - M (moveTo) → 开始新子路径
 * - L (lineTo) → kernel.makeLineEdge(prev, curr)
 * - C (cubicBezier) → kernel.makeBezierEdge([p0, cp1, cp2, p1])
 * - Q (quadraticBezier) → 转换为三次贝塞尔后用 makeBezierEdge
 * - Z (closePath) → 闭合 wire
 */

import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { Font } from 'opentype.js'
import type { PathCommand } from 'opentype.js'
import { getFont } from './fontRegistry'

/** 点坐标（OCCT 格式） */
interface Pt { x: number; y: number; z: number }

/** 将 opentype.js 坐标转为 OCCT 点（XY 平面，Z=0） */
function toPt(x: number, y: number): Pt {
  // 与 mesh 路径一致：不翻转 X 轴，文字从左到右
  return { x, y, z: 0 }
}

/**
 * 将 opentype.js 二次贝塞尔转换为三次贝塞尔的控制点。
 *
 * Q: P0 → P1 (cp) → P2
 * C: P0 → C1 → C2 → P2
 * C1 = P0 + 2/3 * (P1 - P0) = (2*P1 + P0) / 3
 * C2 = P2 + 2/3 * (P1 - P2) = (2*P1 + P2) / 3
 */
function quadToCubic(
  p0: Pt, cp: Pt, p2: Pt,
): [Pt, Pt] {
  const c1 = {
    x: (2 * cp.x + p0.x) / 3,
    y: (2 * cp.y + p0.y) / 3,
    z: 0,
  }
  const c2 = {
    x: (2 * cp.x + p2.x) / 3,
    y: (2 * cp.y + p2.y) / 3,
    z: 0,
  }
  return [c1, c2]
}

/**
 * 用 OCCT 贝塞尔边构造一段三次贝塞尔曲线。
 *
 * 三次贝塞尔曲线有 4 个控制点：P0, C1, C2, P1。
 * occt-wasm 的 makeBezierEdge 接受 Vec3[] 控制点数组。
 */
function makeBezierFromPoints(
  kernel: OcctKernel,
  p0: Pt, c1: Pt, c2: Pt, p1: Pt,
): ShapeHandle {
  return kernel.makeBezierEdge([p0, c1, c2, p1])
}

/**
 * 将文字转换为 OCCT wire 数组（每个闭合轮廓一个 wire）。
 *
 * @param kernel OCCT 内核
 * @param text 文字字符串
 * @param options 配置选项
 * @returns ShapeHandle 数组（每个是一个闭合 wire）
 */
export function textBlueprints(
  kernel: OcctKernel,
  text: string,
  options: {
    startX?: number
    startY?: number
    fontSize?: number
    fontFamily?: string
  } = {},
): ShapeHandle[] {
  const { startX = 0, startY = 0, fontSize = 16, fontFamily = 'default' } = options

  let font: Font | undefined = getFont(fontFamily)
  if (!font) font = getFont()
  if (!font) {
    throw new Error('[textBlueprints] No fonts loaded. Call loadFont() before using text functions.')
  }

  // 检查缺字形（CJK 字符在 OpenSans Regular 中没有对应字形）
  for (const ch of text) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue
    const glyph = font.charToGlyph(ch)
    if (glyph.index === 0) {
      throw new Error(
        `[textBlueprints] Character "${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase()}) ` +
        `not found in font. If it is a CJK character, a CJK font must be loaded.`,
      )
    }
  }

  // 获取文字路径
  const path = font.getPath(text, startX, startY, fontSize)
  const commands = path.commands as PathCommand[]

  const wires: ShapeHandle[] = []
  const allEdges: ShapeHandle[] = []

  let currentEdges: ShapeHandle[] = []
  let lastPt: Pt | null = null
  let subpathStart: Pt | null = null

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': {
        // 开始新子路径 — 如果当前有 edges，先构建 wire
        if (currentEdges.length > 0) {
          const wire = kernel.makeWire(currentEdges)
          wires.push(wire)
          allEdges.push(...currentEdges)
          currentEdges = []
        }
        lastPt = toPt(cmd.x!, cmd.y!)
        subpathStart = lastPt
        break
      }
      case 'L': {
        if (!lastPt) {
          lastPt = toPt(cmd.x!, cmd.y!)
          subpathStart = lastPt
          break
        }
        const curr = toPt(cmd.x!, cmd.y!)
        // 跳过零长度边
        if (Math.abs(curr.x - lastPt.x) > 1e-9 || Math.abs(curr.y - lastPt.y) > 1e-9) {
          const edge = kernel.makeLineEdge(lastPt, curr)
          currentEdges.push(edge)
          allEdges.push(edge)
        }
        lastPt = curr
        break
      }
      case 'Q': {
        if (!lastPt) break
        const cp = toPt(cmd.x1!, cmd.y1!)
        const endPt = toPt(cmd.x!, cmd.y!)
        // 转换为三次贝塞尔
        const [c1, c2] = quadToCubic(lastPt, cp, endPt)
        const edge = makeBezierFromPoints(kernel, lastPt, c1, c2, endPt)
        currentEdges.push(edge)
        allEdges.push(edge)
        lastPt = endPt
        break
      }
      case 'C': {
        if (!lastPt) break
        const c1 = toPt(cmd.x1!, cmd.y1!)
        const c2 = toPt(cmd.x2!, cmd.y2!)
        const endPt = toPt(cmd.x!, cmd.y!)
        const edge = makeBezierFromPoints(kernel, lastPt, c1, c2, endPt)
        currentEdges.push(edge)
        allEdges.push(edge)
        lastPt = endPt
        break
      }
      case 'Z': {
        // 闭合 — 如果有起点，添加闭合边
        if (subpathStart && lastPt &&
            (Math.abs(subpathStart.x - lastPt.x) > 1e-9 || Math.abs(subpathStart.y - lastPt.y) > 1e-9)) {
          const edge = kernel.makeLineEdge(lastPt, subpathStart)
          currentEdges.push(edge)
          allEdges.push(edge)
        }
        // 构建 wire
        if (currentEdges.length > 0) {
          const wire = kernel.makeWire(currentEdges)
          wires.push(wire)
          allEdges.push(...currentEdges)
          currentEdges = []
        }
        lastPt = null
        subpathStart = null
        break
      }
    }
  }

  // 处理最后一个未闭合的子路径
  if (currentEdges.length > 0) {
    const wire = kernel.makeWire(currentEdges)
    wires.push(wire)
    allEdges.push(...currentEdges)
  }

  // 释放所有边（wire 已共享 TShape）
  for (const e of allEdges) {
    kernel.release(e)
  }

  return wires
}

/**
 * 将文字转换为 OCCT 3D solid（face → extrude → fuse）。
 *
 * @param kernel OCCT 内核
 * @param text 文字字符串
 * @param options 配置选项
 * @returns ShapeHandle（合并后的 solid）
 */
export function textToSolid(
  kernel: OcctKernel,
  text: string,
  options: {
    fontSize?: number
    fontFamily?: string
    depth: number
  },
): ShapeHandle {
  const { fontSize = 16, fontFamily = 'default', depth } = options

  const wires = textBlueprints(kernel, text, { fontSize, fontFamily })

  if (wires.length === 0) {
    throw new Error('[textToSolid] no wires generated from text')
  }

  // 为每个 wire 创建 face → extrude
  const solids: ShapeHandle[] = []
  for (const wire of wires) {
    try {
      const face = kernel.makeFace(wire)
      const solid = kernel.extrude(face, 0, 0, depth)
      kernel.release(face)
      solids.push(solid)
    } catch {
      // 某些 wire 可能无法构建 face（如开放线框）— 跳过
    }
    kernel.release(wire)
  }

  if (solids.length === 0) {
    throw new Error('[textToSolid] no solids generated from wires')
  }

  // Fuse 所有 solid
  let result = solids[0]
  for (let i = 1; i < solids.length; i++) {
    const prev = result
    result = kernel.fuse(prev, solids[i])
    kernel.release(prev)
    kernel.release(solids[i])
  }

  return result
}
