/**
 * text-geometry — 文字几何创建（mesh 路径）
 *
 * 使用 opentype.js + OpenSans Regular 字体（与 BREP 路径统一）。
 * 字体来源：fontRegistry（通过依赖注入的 FontLoader 加载）。
 *
 * 过渡期仍用 THREE.Shape/ExtrudeGeometry，R6 时再替换为 manifold。
 */

import * as THREE from 'three'
import type { Font, Path, PathCommand } from 'opentype.js'
import { ensureDefaultFont, getFont as getRegisteredFont } from '../brep/text/fontRegistry'

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

// ── Text geometry ──

/**
 * Create text geometry centered in X/Z, extruded along +Z.
 *
 * Uses opentype.js font.getPath() → THREE.Shape → ExtrudeGeometry.
 * This is the same font source as the BREP path (text-to-solid),
 * ensuring glyph consistency between mesh and BREP paths.
 *
 * @param text  Text string to render
 * @param size  Font size in mm
 * @param depth Extrusion depth in mm
 * @param font  opentype.js Font object (from fontRegistry)
 * @returns a promise resolving to the extruded text geometry.
 */
export async function createTextGeometry(
  text: string,
  size: number,
  depth: number,
  font: Font,
): Promise<THREE.BufferGeometry> {
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
  const geo = opentypePathToGeometry(path, depth)
  if (!geo) {
    throw new Error(`[text-geometry] Failed to create geometry from text: "${text}"`)
  }
  return geo
}

// ── opentype path → THREE geometry ──

/**
 * Convert an opentype.js Path to THREE.BufferGeometry.
 *
 * Path commands → THREE.Shape → ExtrudeGeometry.
 * The result is centered in X and Z (bounding box center → origin).
 *
 * Exported for reuse by the CJK text path and 3d_editor preview layer.
 *
 * @param path - the opentype.js path to convert.
 * @param depth - extrusion depth in mm.
 * @returns the resulting BufferGeometry, or null when the path is empty.
 */
export function opentypePathToGeometry(
  path: Path,
  depth: number,
): THREE.BufferGeometry | null {
  const commands = path.commands as PathCommand[]
  if (commands.length === 0) return null

  const shapes: THREE.Shape[] = []
  let currentShape: THREE.Shape | null = null

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        // Implicit closure: opentype.js doesn't always emit 'Z' before a new 'M'.
        // Push the current shape before starting a new subpath.
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
  geo.computeBoundingBox()
  if (geo.boundingBox) {
    const cx = (geo.boundingBox.max.x + geo.boundingBox.min.x) / 2
    const cz = (geo.boundingBox.max.z + geo.boundingBox.min.z) / 2
    geo.translate(-cx, -geo.boundingBox.min.y, -cz)
  }
  return geo
}
