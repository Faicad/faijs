/**
 * 文字 → OCCT wire/face 转换
 *
 * 适配自 brepjs `src/text/text-to-solid.ts`。
 * 保留文件名和核心算法，适配本项目的 occt-wasm API。
 *
 * 与 brepjs 的差异：
 * - brepjs 用 BlueprintSketcher 构造 wire → 本项目直接用 kernel.makeLineEdge / makeBezierEdge
 * - brepjs 用 organiseBlueprints 处理孔洞 → 本项目用 makeFace + addHolesInFace 构建
 *   （分类复用 `primitives/svg/svg-path.ts` 的共享 classifyNested，与 svg-to-solid 同源）
 * - brepjs 用 sketchOnPlane → 本项目直接在 XY 平面构造然后按需变换
 *
 * opentype.js 路径命令 → OCCT edge 映射：
 * - M (moveTo) → 开始新子路径
 * - L (lineTo) → kernel.makeLineEdge(prev, curr)
 * - C (cubicBezier) → kernel.makeBezierEdge([p0, cp1, cp2, p1])
 * - Q (quadraticBezier) → 转换为三次贝塞尔后用 makeBezierEdge
 * - Z (closePath) → 闭合 wire
 *
 * 孔洞与组合（2026-10-13 修复，见 .agents/notes/ 对应 Agent Note）：
 * - 旧实现把每个闭合轮廓独立 makeFace+extrude 后**逐个 fuse**：带孔字符（如 'o'）
 *   的外轮廓体与内孔体被布尔并成一个实心体，孔被填实（与 mesh 路径的 evenodd
 *   分类不一致）；且 fuse 次数 = 轮廓数，'Hello' ≈ 8-12 次 OCCT 布尔是文字建模
 *   10 秒级耗时的主因。
 * - 新实现：轮廓按包含关系分组（外轮廓 + 其孔，复用 classifyNested）→ 每组
 *   makeFace(outer) + addHolesInFace(holes) 挖孔 → extrude；字符间互不重叠，
 *   **用 makeCompound 组合（零布尔成本）**，不再逐轮廓 fuse。
 */

import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import type { Font } from 'opentype.js'
import type { PathCommand } from 'opentype.js'
import { getFont } from './fontRegistry'
import {
  classifyNested,
  computeBBox,
  computeSignedArea,
  type ClassifiableSubpath,
  type SvgPoint2,
} from '../../primitives/svg/svg-path'

/** 点坐标（OCCT 格式） */
interface Pt { x: number; y: number; z: number }

/** 每条曲线离散化的采样段数（分类用的点集精度：bbox/质心/射线足够）。 */
const CURVE_SAMPLES = 8

/**
 * 将 opentype.js 坐标转为 OCCT 点（XY 平面，Z=0）。
 *
 * opentype.js 的 path 是 **y 向下**（canvas 约定：字形主体在负 y），OCCT 是
 * **y 向上**，故这里翻转 y —— 与 `../svg/svg-to-solid.ts` 的 `flipY`
 * （SVG Y-down → OCCT Y-up）同一约定。X 不翻转，文字从左到右。
 */
function toPt(x: number, y: number): Pt {
  return { x, y: -y, z: 0 }
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
  kernel: BrepEngineApi,
  p0: Pt, c1: Pt, c2: Pt, p1: Pt,
): BrepHandle {
  return kernel.makeBezierEdge([p0, c1, c2, p1])
}

/** 三次贝塞尔在 t 处的采样点（用于轮廓分类点集）。 */
function sampleCubic(
  p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number,
): SvgPoint2 {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  }
}

/**
 * 将文字转换为 OCCT wire 数组（每个闭合轮廓一个 wire），并带各轮廓的
 * 采样点集（供 classifyNested 做外轮廓/孔洞分类）。
 *
 * 采样点：L 端点、Q/C 按 CURVE_SAMPLES 段离散化 —— 与 mesh 路径
 * `opentypePathToContours` 的曲线折线化同一用途（bbox/质心/射线判定精度足够）。
 *
 * @param kernel OCCT 内核
 * @param text 文字字符串
 * @param options 配置选项
 * @returns 每个闭合轮廓的 { wire, points }（points 为 Y-up 采样点）
 */
export function textBlueprintsDetailed(
  kernel: BrepEngineApi,
  text: string,
  options: {
    startX?: number
    startY?: number
    fontSize?: number
    fontFamily?: string
  } = {},
): { wire: BrepHandle; points: SvgPoint2[] }[] {
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

  const wires: { wire: BrepHandle; points: SvgPoint2[] }[] = []
  const allEdges: BrepHandle[] = []

  let currentEdges: BrepHandle[] = []
  let currentPoints: SvgPoint2[] = []
  let lastPt: Pt | null = null
  let subpathStart: Pt | null = null

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': {
        // 开始新子路径 — 如果当前有 edges，先构建 wire
        if (currentEdges.length > 0) {
          const wire = kernel.makeWire(currentEdges)
          wires.push({ wire, points: currentPoints })
          allEdges.push(...currentEdges)
          currentEdges = []
          currentPoints = []
        }
        lastPt = toPt(cmd.x!, cmd.y!)
        subpathStart = lastPt
        currentPoints.push({ x: lastPt.x, y: lastPt.y })
        break
      }
      case 'L': {
        if (!lastPt) {
          lastPt = toPt(cmd.x!, cmd.y!)
          subpathStart = lastPt
          currentPoints.push({ x: lastPt.x, y: lastPt.y })
          break
        }
        const curr = toPt(cmd.x!, cmd.y!)
        // 跳过零长度边
        if (Math.abs(curr.x - lastPt.x) > 1e-9 || Math.abs(curr.y - lastPt.y) > 1e-9) {
          const edge = kernel.makeLineEdge(lastPt, curr)
          currentEdges.push(edge)
          allEdges.push(edge)
          currentPoints.push({ x: curr.x, y: curr.y })
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
        // 采样曲线点（端点已含）——与 makeBezierEdge 同一组控制点
        for (let s = 1; s <= CURVE_SAMPLES; s++) {
          currentPoints.push(sampleCubic(lastPt, c1, c2, endPt, s / CURVE_SAMPLES))
        }
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
        for (let s = 1; s <= CURVE_SAMPLES; s++) {
          currentPoints.push(sampleCubic(lastPt, c1, c2, endPt, s / CURVE_SAMPLES))
        }
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
        // 闭合点回归起点（pointInPolygon 的射线判定要求多边形闭合）
        if (subpathStart && currentPoints.length > 0) {
          const s = currentPoints[0]
          const l = currentPoints[currentPoints.length - 1]
          if (Math.abs(s.x - l.x) > 1e-9 || Math.abs(s.y - l.y) > 1e-9) {
            currentPoints.push(s)
          }
        }
        // 构建 wire
        if (currentEdges.length > 0) {
          const wire = kernel.makeWire(currentEdges)
          wires.push({ wire, points: currentPoints })
          allEdges.push(...currentEdges)
          currentEdges = []
          currentPoints = []
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
    wires.push({ wire, points: currentPoints })
    allEdges.push(...currentEdges)
  }

  // 释放所有边（wire 已共享 TShape）
  for (const e of allEdges) {
    kernel.release(e)
  }

  return wires
}

/**
 * 将文字转换为 OCCT wire 数组（每个闭合轮廓一个 wire）。
 *
 * @param kernel OCCT 内核
 * @param text 文字字符串
 * @param options 配置选项
 * @returns BrepHandle 数组（每个是一个闭合 wire）
 */
export function textBlueprints(
  kernel: BrepEngineApi,
  text: string,
  options: {
    startX?: number
    startY?: number
    fontSize?: number
    fontFamily?: string
  } = {},
): BrepHandle[] {
  return textBlueprintsDetailed(kernel, text, options).map((d) => d.wire)
}

/**
 * 将文字转换为 OCCT 3D solid（face → 挖孔 → extrude → compound）。
 *
 * 每个「外轮廓 + 其孔」分组生成一个空心 solid（makeFace + addHolesInFace）；
 * 分组之间（字符 / 互不重叠的独立轮廓，如 'i' 的点）**用 makeCompound 组合**，
 * 不做布尔融合 —— 字符水平排列互不重叠，compound 语义正确且零布尔成本
 * （旧实现逐个 fuse 是文字建模慢的根因，也是 'o' 孔被填实的成因）。
 *
 * @param kernel OCCT 内核
 * @param text 文字字符串
 * @param options 配置选项
 * @returns BrepHandle（单组时为 solid，多组时为 compound）
 */
export function textToSolid(
  kernel: BrepEngineApi,
  text: string,
  options: {
    fontSize?: number
    fontFamily?: string
    depth: number
  },
): BrepHandle {
  const { fontSize = 16, fontFamily = 'default', depth } = options

  const detailed = textBlueprintsDetailed(kernel, text, { fontSize, fontFamily })

  if (detailed.length === 0) {
    throw new Error('[textToSolid] no wires generated from text')
  }

  // 轮廓分类：外轮廓 + 孔（复用 svg 共享 classifyNested；text 字符水平排布、字形
  // 直立，bbox 预筛 + 质心射线足够，与 mesh 路径的 evenodd 分类同源）。
  const subpaths: ClassifiableSubpath[] = detailed.map((d) => ({
    points: d.points,
    bbox: computeBBox(d.points),
    signedArea: computeSignedArea(d.points),
  }))
  const groups = classifyNested(subpaths)

  // 为每个分组创建 face（挖孔）→ extrude
  const solids: BrepHandle[] = []
  for (const g of groups) {
    try {
      let face = kernel.makeFace(detailed[g.outerIdx].wire)
      if (g.holes.length > 0) {
        const holed = kernel.addHolesInFace(face, g.holes.map((h) => detailed[h].wire))
        kernel.release(face)
        face = holed
      }
      const solid = kernel.extrude(face, 0, 0, depth)
      kernel.release(face)
      solids.push(solid)
    } catch {
      // 某些 wire 可能无法构建 face（如开放线框）— 跳过
    }
  }

  // 释放所有 wire（face/solid 已共享 TShape）
  for (const d of detailed) {
    kernel.release(d.wire)
  }

  if (solids.length === 0) {
    throw new Error('[textToSolid] no solids generated from wires')
  }

  if (solids.length === 1) return solids[0]

  // 多组：compound 组合（不 fuse —— 组间互不重叠，布尔是多余且昂贵的操作）。
  const compound = kernel.makeCompound(solids)
  for (const s of solids) kernel.release(s)
  return compound
}
