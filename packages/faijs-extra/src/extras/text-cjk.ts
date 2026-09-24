/**
 * text-cjk — mixed CJK + Latin text geometry (editor extension library).
 *
 * Uses the Local Font Access API (window.queryLocalFonts) to load system CJK
 * fonts, then parses glyph paths with opentype.js to create THREE.Shape →
 * ExtrudeGeometry.
 *
 * When a CJK font is available, it is used for ALL characters (including Latin).
 * When no CJK font is available, the default OpenSans Regular font (from
 * fontRegistry) is used for all characters via opentype.js.
 *
 * The character classification / system-font loading half lives in core
 * (`@faicad/faijs/primitives/text/cjk-font`) and is deliberately three-free.
 */
import * as THREE from 'three'
// Type-only: glyph parsing itself lives in core's fontRegistry; the extension
// library never calls opentype at runtime (keeps it out of the A-group closure).
import type * as opentype from 'opentype.js'
import type { Font } from 'opentype.js'
import { mergeBufferGeometries } from '@faicad/faijs/primitives/mesh-primitives'
import { getOpentypeFont } from './text-geometry'

/**
 * Generate geometry for a single character using opentype.js.
 * Uses the same shape/extrude chain as opentypePathToGeometry().
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

  // Build shapes without centering (the per-character offset is handled here).
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
 * @returns a promise resolving to the merged, centred geometry for the whole text.
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
