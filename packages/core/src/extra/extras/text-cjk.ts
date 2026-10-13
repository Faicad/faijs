/**
 * text-cjk — mixed CJK + Latin text geometry (editor extension library).
 *
 * Uses the Local Font Access API (window.queryLocalFonts) to load system CJK
 * fonts, then parses glyph paths with opentype.js to create Contour[] →
 * extrudeShape (core, three-free).
 *
 * When a CJK font is available, it is used for ALL characters (including Latin).
 * When no CJK font is available, the default OpenSans Regular font (from
 * fontRegistry) is used for all characters via opentype.js.
 *
 * The character classification / system-font loading half lives in core
 * (`@faicad/faijs/primitives/text/cjk-font`) and is deliberately three-free.
 */
import type { Font } from 'opentype.js'
import { extrudeShape } from '../../mesh/meshdata/extrude'
import { mergeShapes } from '../../mesh/meshdata/ops'
import type { Shape } from '../../mesh/types'
import { getOpentypeFont, opentypePathToContours, centerShapeXZBottom } from './text-geometry'

/**
 * Generate geometry for a single character using opentype.js.
 * Uses the same shape/extrude chain as opentypePathToGeometry().
 */
function charShape(
  char: string,
  size: number,
  depth: number,
  font: Font,
  xOffset: number,
): Shape | null {
  const glyph = font.charToGlyph(char)
  if (!glyph || !glyph.path) return null

  const path = glyph.getPath(xOffset, 0, size)
  if (!path || !path.commands || path.commands.length === 0) return null

  const contours = opentypePathToContours(path, 6)
  if (contours.length === 0) return null
  // 不居中：逐字符的 xOffset 布局在此处处理
  return extrudeShape(contours, depth)
}

/**
 * Generate geometry for mixed text (CJK + Latin).
 *
 * When cjkFont is available, it is used for ALL characters (including Latin),
 * since CJK fonts typically contain Latin glyphs.
 *
 * When cjkFont is null, the default OpenSans Regular font (from fontRegistry)
 * is used for all characters via opentype.js — this is the same font used by
 * the BREP path, ensuring glyph consistency.
 *
 * @param text     Text string to render
 * @param size     Font size in mm
 * @param depth    Extrusion depth in mm
 * @param cjkFont  CJK font from system (null = use default font only)
 * @param defaultFont  Default opentype.js Font (OpenSans Regular from fontRegistry).
 *                     If not provided, will be loaded via getOpentypeFont().
 * @returns a promise resolving to the merged, centred shape for the whole text.
 */
export async function createMixedTextGeometry(
  text: string,
  size: number,
  depth: number,
  cjkFont: Font | null,
  defaultFont?: Font,
): Promise<Shape> {
  // Use CJK font for all chars if available, otherwise use default font
  const font = cjkFont ?? defaultFont ?? (await getOpentypeFont())

  // All characters individually
  const charShapes: { shape: Shape; advance: number }[] = []
  let cursorX = 0

  for (const char of text) {
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      // Space: advance by approximate width
      const spaceAdv = font.charToGlyph(' ').advanceWidth ?? size / 3
      cursorX += spaceAdv * (size / font.unitsPerEm)
      continue
    }

    const glyph = font.charToGlyph(char)
    if (glyph.index === 0) {
      // Skip notdef glyphs (should not happen if font check was done upstream)
      continue
    }

    const shape = charShape(char, size, depth, font, cursorX)
    if (shape) {
      let minX = Infinity, maxX = -Infinity
      for (let i = 0; i < shape.positions.length; i += 3) {
        const x = shape.positions[i]
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
      const charWidth = maxX - minX
      const adv = (glyph.advanceWidth ?? 0) * (size / font.unitsPerEm)
      // Use advance width for cursor, but ensure minimum advance
      const effectiveAdv = adv > 0 ? adv : charWidth + size * 0.1
      charShapes.push({ shape, advance: effectiveAdv })
      cursorX += effectiveAdv
    }
  }

  // Merge all character geometries into one
  if (charShapes.length === 0) {
    // Fallback: create a minimal geometry from a question mark
    const shape = charShape('?', size, depth, font, 0)
    if (shape) return centerShapeXZBottom(shape)
    return { positions: new Float32Array(0), indices: new Uint32Array(0) }
  }

  const merged = mergeShapes(charShapes.map((cs) => cs.shape))
  return centerShapeXZBottom(merged)
}
