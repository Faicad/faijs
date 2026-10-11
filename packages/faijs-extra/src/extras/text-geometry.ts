/**
 * text-geometry — 文字几何创建（mesh 路径）
 *
 * 使用 opentype.js + OpenSans Regular 字体（与 BREP 路径统一）。
 * 字体来源：fontRegistry（通过依赖注入的 FontLoader 加载）。
 *
 * 几何链：opentype Path → Contour[]（共享 SVG 语法层折线化 + evenodd 分类，
 * Y-down → Y-up 翻转）→ `extrudeShape`（core 自有，three-free）。
 * 返回 core `Shape`（positions + indices + normals），由使用方自行转为
 * 自己的渲染几何（如 3d_editor 的 BufferGeometry 适配层）。
 */

import type { Font, Path, PathCommand } from 'opentype.js'
import { ensureDefaultFont, getFont as getRegisteredFont } from '@faicad/faijs/brep/text/fontRegistry'
import {
  parsePathToSubpaths,
  computeBBox,
  computeSignedArea,
  classifyNested,
} from '@faicad/faijs/primitives/svg/svg-path'
import { extrudeShape } from '@faicad/faijs/mesh/meshdata/extrude'
import type { Contour } from '@faicad/faijs/mesh/meshdata/extrude'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { SvgPoint2 } from '@faicad/faijs/primitives/svg/svg-path'

// ── Font loading ──

/**
 * Get the default opentype.js font (OpenSans Regular).
 *
 * Fetched from fontRegistry — the same font used by the BREP path
 * (text-to-solid). The first call triggers a lazy ensureDefaultFont() load.
 *
 * @returns a promise resolving to the default opentype.js Font.
 */
export async function getOpentypeFont(): Promise<Font> {
  await ensureDefaultFont()
  const font = getRegisteredFont('default')
  if (!font) {
    throw new Error(
      '[text-geometry] Default font not loaded. ' +
      'Call setFontLoader() before using text functions.',
    )
  }
  return font
}

// ── opentype Path → Contours ──

/**
 * 将 opentype.js Path 命令序列化为 SVG path `d` 字符串。
 *
 * opentype.js 的 glyph 轮廓可能不显式发出 `Z`（隐式闭合）；SVG 语义中
 * 每个 `M` 都开始新子路径、前一子路径隐式闭合。这里在非首个 `M` 前补 `Z`，
 * 使折线化层获得显式闭合（与 three `Shape` 的隐式闭合语义一致）。
 */
function pathToSvgD(path: Path): string {
  const commands = path.commands as PathCommand[]
  const parts: string[] = []
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (parts.length > 0) parts.push('Z')
        parts.push(`M ${cmd.x},${cmd.y}`)
        break
      case 'L':
        parts.push(`L ${cmd.x},${cmd.y}`)
        break
      case 'C':
        parts.push(`C ${cmd.x1},${cmd.y1} ${cmd.x2},${cmd.y2} ${cmd.x},${cmd.y}`)
        break
      case 'Q':
        parts.push(`Q ${cmd.x1},${cmd.y1} ${cmd.x},${cmd.y}`)
        break
      case 'Z':
        parts.push('Z')
        break
    }
  }
  // opentype.js 的 glyph 轮廓不显式发出 Z（隐式闭合，终点 = 起点）：
  // 末尾未闭合的子路径也必须闭合，否则会被折线化层判为开放轮廓而丢弃。
  if (parts.length > 0 && !/Z$/.test(parts[parts.length - 1])) {
    parts.push('Z')
  }
  return parts.join(' ')
}

/**
 * 将 opentype.js Path 折线化并分类为 Y-up 平面轮廓（供 `extrudeShape` 消费）。
 *
 * opentype 字形坐标是 Y-down（canvas 惯例），与 SVG 一致；输出翻转至 Y-up，
 * 与 BREP 文本路径（`core/brep/text/text-to-solid.ts`）的世界坐标约定一致。
 *
 * @param path - the opentype.js path to flatten.
 * @param curveSegments - per-curve sampling segments (default 6).
 * @returns the classified contours (Y-up).
 */
export function opentypePathToContours(path: Path, curveSegments = 6): Contour[] {
  const d = pathToSvgD(path)
  const subpaths = parsePathToSubpaths(d, curveSegments)

  const all: { points: SvgPoint2[]; bbox: ReturnType<typeof computeBBox>; signedArea: number }[] = []
  for (const sp of subpaths) {
    if (!sp.closed || Math.abs(sp.signedArea) < 1e-9 || sp.points.length < 3) continue
    const flipped: SvgPoint2[] = sp.points.map((p) => ({ x: p.x, y: -p.y }))
    all.push({
      points: flipped,
      bbox: computeBBox(flipped),
      signedArea: computeSignedArea(flipped),
    })
  }

  const groups = classifyNested(all)
  return groups.map((g) => ({
    outer: all[g.outerIdx].points as unknown as Contour['outer'],
    holes: g.holes.map((h) => all[h].points as unknown as Contour['outer']),
  }))
}

// ── Shape 居中（与既有 three 实现相同的布局语义） ──

/**
 * X 居中、Y 底部对齐到 0、Z 居中（text 链的旧布局语义）。
 * @param shape - 待居中的 Shape（positions 就地复制，不修改输入）。
 * @returns 平移后的新 Shape（索引/法线不变）。
 */
export function centerShapeXZBottom(shape: Shape): Shape {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxZ = -Infinity
  for (let i = 0; i < shape.positions.length; i += 3) {
    const x = shape.positions[i]
    const y = shape.positions[i + 1]
    const z = shape.positions[i + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (z > maxZ) maxZ = z
  }
  const cx = (minX + maxX) / 2
  const cz = maxZ / 2
  const dx = -cx
  const dy = -minY
  const dz = -cz
  const positions = new Float32Array(shape.positions.length)
  for (let i = 0; i < shape.positions.length; i += 3) {
    positions[i] = shape.positions[i] + dx
    positions[i + 1] = shape.positions[i + 1] + dy
    positions[i + 2] = shape.positions[i + 2] + dz
  }
  return { ...shape, positions }
}

// ── Text geometry ──

/**
 * Create text geometry centered in X/Z, extruded along +Z.
 *
 * Uses opentype.js font.getPath() → Contour[] → extrudeShape, flipping
 * the opentype y-down axis to y-up. This is the same font source and the same
 * axis convention as the BREP path (text-to-solid), ensuring both glyph and
 * orientation consistency between the mesh and BREP paths.
 *
 * @param text  Text string to render
 * @param size  Font size in mm
 * @param depth Extrusion depth in mm
 * @param font  opentype.js Font object (from fontRegistry)
 * @returns a promise resolving to the extruded text shape.
 */
export async function createTextGeometry(
  text: string,
  size: number,
  depth: number,
  font: Font,
): Promise<Shape> {
  // Check for notdef glyphs (missing characters)
  for (const ch of text) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue
    const glyph = font.charToGlyph(ch)
    if (glyph.index === 0) {
      throw new Error(
        `[text-geometry] Character "${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase()}) ` +
        `not found in font. If it is a CJK character, a CJK font must be loaded.`,
      )
    }
  }

  const path = font.getPath(text, 0, 0, size)
  const shape = opentypePathToGeometry(path, depth)
  if (!shape) {
    throw new Error(`[text-geometry] Failed to create geometry from text: "${text}"`)
  }
  return shape
}

// ── opentype path → Shape ──

/**
 * Convert an opentype.js Path to a core Shape.
 *
 * Path commands → Contour[] → extrudeShape. The result is centered in X and Z
 * (bounding box center → origin) with Y aligned to its bottom edge.
 *
 * Exported for reuse by the CJK text path and 3d_editor preview layer.
 *
 * @param path - the opentype.js path to convert.
 * @param depth - extrusion depth in mm.
 * @returns the resulting Shape, or null when the path is empty.
 */
export function opentypePathToGeometry(
  path: Path,
  depth: number,
): Shape | null {
  const contours = opentypePathToContours(path, 6)
  if (contours.length === 0) return null
  return centerShapeXZBottom(extrudeShape(contours, depth))
}
