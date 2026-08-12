﻿/**
 * CJK (Chinese/Japanese/Korean) text geometry generation.
 *
 * Uses the Local Font Access API (window.queryLocalFonts) to load system CJK
 * fonts, then parses glyph paths with opentype.js to create THREE.ShapePath →
 * ExtrudeGeometry.
 *
 * Latin characters fall back to Helvetiker (loaded via FontLoader).
 */
import * as THREE from 'three'
import * as opentype from 'opentype.js'
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import helvBoldJson from 'three/examples/fonts/helvetiker_bold.typeface.json'
import { mergeBufferGeometries } from '../../primitives/geometry'

let _helvFont: Font | null = null
async function getHelvetiker(): Promise<Font> {
  if (_helvFont) return _helvFont
  _helvFont = new FontLoader().parse(helvBoldJson)
  return _helvFont
}

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
 * Convert an opentype.js PathCommand array to a THREE.ShapePath.
 */
function opentypePathToShapePath(commands: opentype.PathCommand[]): THREE.ShapePath {
  const shapePath = new THREE.ShapePath()

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        shapePath.moveTo(cmd.x!, cmd.y!)
        break
      case 'L':
        shapePath.lineTo(cmd.x!, cmd.y!)
        break
      case 'Q':
        shapePath.quadraticCurveTo(cmd.x1!, cmd.y1!, cmd.x!, cmd.y!)
        break
      case 'C':
        shapePath.bezierCurveTo(cmd.x1!, cmd.y1!, cmd.x2!, cmd.y2!, cmd.x!, cmd.y!)
        break
      case 'Z':
        // ShapePath auto-closes when converting to shapes via toShapes()
        break
    }
  }

  return shapePath
}

/**
 * Generate geometry for a single CJK character using opentype.js.
 */
function cjkCharGeometry(
  char: string,
  size: number,
  depth: number,
  font: opentype.Font,
): THREE.BufferGeometry | null {
  const glyph = font.charToGlyph(char)
  if (!glyph || !glyph.path) return null

  const path = glyph.getPath(0, 0, size)
  if (!path || !path.commands || path.commands.length === 0) return null

  const shapePath = opentypePathToShapePath(path.commands)
  const shapes = shapePath.toShapes(true)

  if (shapes.length === 0) return null

  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments: 6,
  })

  // Rotate 180° around X so the front face normal points in -Z (project convention)
  geo.rotateX(Math.PI)

  return geo
}

/**
 * Generate geometry for mixed text (CJK + Latin).
 * CJK characters use opentype.js + ExtrudeGeometry.
 * Latin characters fall back to TextGeometry via Helvetiker.
 */
export async function createMixedTextGeometry(
  text: string,
  size: number,
  depth: number,
  cjkFont: opentype.Font | null,
): Promise<THREE.BufferGeometry> {
  const helvFont = await getHelvetiker()

  // All characters individually
  const charGeos: { geo: THREE.BufferGeometry; advance: number }[] = []
  let cursorX = 0

  for (const char of text) {
    if (cjkFont) {
      // Use CJK font for ALL characters (it contains Latin glyphs too)
      const geo = cjkCharGeometry(char, size, depth, cjkFont)
      if (geo) {
        geo.computeBoundingBox()
        const bb = geo.boundingBox!
        const charWidth = bb.max.x - bb.min.x
        geo.translate(cursorX - bb.min.x, 0, 0)
        charGeos.push({ geo, advance: charWidth + size * 0.15 })
        cursorX += charWidth + size * 0.15
      }
    } else {
      // Latin character via TextGeometry
      const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js')
      const charGeo = new TextGeometry(char, {
        font: helvFont,
        size,
        depth,
        curveSegments: 6,
        bevelEnabled: false,
      })
      if (charGeo) {
        charGeo.computeBoundingBox()
        const bb = charGeo.boundingBox!
        const charWidth = bb.max.x - bb.min.x
        const adv = charWidth > 0 ? charWidth + size * 0.1 : size * 0.5
        charGeo.translate(cursorX, 0, 0)
        charGeos.push({ geo: charGeo, advance: adv })
        cursorX += adv
      }
    }
  }

  // Merge all character geometries into one
  if (charGeos.length === 0) {
    // Fallback: create a minimal geometry
    const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js')
    return new TextGeometry('?', { font: helvFont, size, depth, bevelEnabled: false })
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
