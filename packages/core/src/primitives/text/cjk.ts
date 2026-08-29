/**
 * CJK (Chinese/Japanese/Korean) text geometry generation.
 *
 * Uses the Local Font Access API (window.queryLocalFonts) to load system CJK
 * fonts, then parses glyph paths with opentype.js to create THREE.Shape →
 * ExtrudeGeometry.
 *
 * When a CJK font is available, it is used for ALL characters (including Latin).
 * When no CJK font is available, the default OpenSans Regular font (from
 * fontRegistry) is used for all characters via opentype.js.
 */
import * as THREE from 'three'
import * as opentype from 'opentype.js'
import type { Font } from 'opentype.js'
import { mergeBufferGeometries } from '../../primitives/mesh-primitives'
import { getOpentypeFont } from '../text-geometry'

/** Check if a character is CJK (CJK Unified Ideographs + extensions). */
export function isCjkChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||    // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4DBF) ||    // CJK Extension A
    (code >= 0x2F800 && code <= 0x2FA1F) ||  // CJK Compatibility Ideographs Supplement
    (code >= 0x3000 && code <= 0x303F) ||    // CJK Symbols and Punctuation
    (code >= 0xFF00 && code <= 0xFFEF)       // Fullwidth Forms
  )
}

/** Check if text contains any CJK characters. */
export function containsCjk(text: string): boolean {
  for (const ch of text) {
    if (isCjkChar(ch)) return true
  }
  return false
}

/** Result of loading a system CJK font. */
export interface CjkFontResult {
  font: opentype.Font
  family: string
}

/**
 * Load a CJK font from the system using the Local Font Access API.
 * Returns null if unavailable (no permission, unsupported browser, or no CJK font found).
 */
export async function loadSystemCjkFont(): Promise<CjkFontResult | null> {
  const w = typeof window !== 'undefined' ? (window as any) : undefined
  if (!w || typeof w.queryLocalFonts !== 'function') {
    return null
  }

  try {
    const fonts: Array<{ family: string; fullName: string; style: string; postscriptName: string; blob: () => Promise<Blob> }> = await w.queryLocalFonts()

    // Find a font that supports CJK
    const cjkFont = fonts.find((f) =>
      f.family.includes('Microsoft YaHei') ||
      f.family.includes('SimSun') ||
      f.family.includes('Noto Sans') ||
      f.family.includes('Noto Serif') ||
      f.fullName.includes('CJK') ||
      f.fullName.includes('SC') ||
      f.fullName.includes('CN') ||
      f.fullName.includes('JP') ||
      f.fullName.includes('KR') ||
      f.family.includes('Source Han') ||
      f.family.includes('思源') ||
      f.family.includes('微软雅黑') ||
      f.family.includes('宋体') ||
      f.family.includes('黑体') ||
      f.family.includes('楷体') ||
      f.family.includes('仿宋')
    )

    if (!cjkFont) return null

    const fontData = await cjkFont.blob()
    const buf = await fontData.arrayBuffer()
    const font = opentype.parse(buf)

    return { font, family: cjkFont.family }
  } catch {
    // User denied permission or other error
    return null
  }
}

/**
 * Generate geometry for a single character using opentype.js.
 * Uses the shared opentypePathToGeometry() from text-geometry.ts.
 */
function charGeometry(
  char: string,
  size: number,
  depth: number,
  font: Font,
  xOffset: number,
): THREE.BufferGeometry | null {
  const glyph = font.charToGlyph(char)
  if (!glyph || !glyph.path) return null

  const path = glyph.getPath(xOffset, 0, size)
  if (!path || !path.commands || path.commands.length === 0) return null

  // Use the shared opentypePathToGeometry, but without centering (we handle offset manually)
  const commands = path.commands as opentype.PathCommand[]
  if (commands.length === 0) return null

  const shapes: THREE.Shape[] = []
  let currentShape: THREE.Shape | null = null

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        // Implicit closure: opentype.js doesn't always emit 'Z' before a new 'M'.
        if (currentShape) {
          shapes.push(currentShape)
        }
        currentShape = new THREE.Shape()
        currentShape.moveTo(cmd.x!, cmd.y!)
        break
      case 'L':
        currentShape?.lineTo(cmd.x!, cmd.y!)
        break
      case 'C':
        currentShape?.bezierCurveTo(cmd.x1!, cmd.y1!, cmd.x2!, cmd.y2!, cmd.x!, cmd.y!)
        break
      case 'Q':
        currentShape?.quadraticCurveTo(cmd.x1!, cmd.y1!, cmd.x!, cmd.y!)
        break
      case 'Z':
        if (currentShape) {
          shapes.push(currentShape)
          currentShape = null
        }
        break
    }
  }

  // Handle final unclosed subpath (opentype.js doesn't always emit 'Z')
  if (currentShape) {
    shapes.push(currentShape)
  }

  if (shapes.length === 0) return null

  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments: 6,
  })
  return geo
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
 */
export async function createMixedTextGeometry(
  text: string,
  size: number,
  depth: number,
  cjkFont: Font | null,
  defaultFont?: Font,
): Promise<THREE.BufferGeometry> {
  // Use CJK font for all chars if available, otherwise use default font
  const font = cjkFont ?? defaultFont ?? (await getOpentypeFont())

  // All characters individually
  const charGeos: { geo: THREE.BufferGeometry; advance: number }[] = []
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

    const geo = charGeometry(char, size, depth, font, cursorX)
    if (geo) {
      geo.computeBoundingBox()
      const bb = geo.boundingBox!
      const charWidth = bb.max.x - bb.min.x
      const adv = (glyph.advanceWidth ?? 0) * (size / font.unitsPerEm)
      // Use advance width for cursor, but ensure minimum advance
      const effectiveAdv = adv > 0 ? adv : charWidth + size * 0.1
      charGeos.push({ geo, advance: effectiveAdv })
      cursorX += effectiveAdv
    }
  }

  // Merge all character geometries into one
  if (charGeos.length === 0) {
    // Fallback: create a minimal geometry from a question mark
    const geo = charGeometry('?', size, depth, font, 0)
    if (geo) return geo
    return new THREE.BufferGeometry()
  }

  // Merge via BufferGeometryUtils or manual merge
  const merged = mergeBufferGeometries(charGeos.map((cg) => cg.geo))

  // Center the whole text in X/Z
  merged.computeBoundingBox()
  if (merged.boundingBox) {
    const cx = (merged.boundingBox.max.x + merged.boundingBox.min.x) / 2
    const cz = (merged.boundingBox.max.z + merged.boundingBox.min.z) / 2
    merged.translate(-cx, -merged.boundingBox.min.y, -cz)
  }

  // Dispose individual geometries
  for (const cg of charGeos) {
    cg.geo.dispose()
  }

  return merged
}
