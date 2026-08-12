/**
 * text-geometry — Headless 文字几何创建
 *
 * 从 EngravingCore.ts 提取的纯几何函数，不依赖 browser stores/workers。
 *
 * - getFont(): 加载 helvetiker_bold 字体（从 three.js 包直接读取 JSON）
 * - createTextGeometry(): 创建文字几何体
 * - createMixedTextGeometry(): 混合 CJK + Latin 文字几何体
 */

import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js'
import * as opentype from 'opentype.js'
import { mergeBufferGeometries } from './geometry'

// ── Font cache ──

const fontCache = new Map<string, Font>()

/**
 * 加载 helvetiker_bold 字体。
 * Node 环境：从 three.js 包的 JSON 文件直接读取。
 * 浏览器环境：同样从 three.js 包读取（不需要 ?url）。
 */
export async function getFont(): Promise<Font> {
  if (fontCache.has('helvetiker_bold')) return fontCache.get('helvetiker_bold')!

  // 直接 import JSON（Node 和 Vite 都支持）
  const fontData = (await import('three/examples/fonts/helvetiker_bold.typeface.json')) as unknown
  const font = new FontLoader().parse(fontData as unknown as Parameters<FontLoader['parse']>[0])
  fontCache.set('helvetiker_bold', font)
  return font
}

// ── Text geometry ──

/**
 * Create text geometry centered in X/Z, extruded along +Z.
 */
export async function createTextGeometry(
  text: string,
  size: number,
  depth: number,
  font: Font,
): Promise<THREE.BufferGeometry> {
  const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js')
  const geo = new TextGeometry(text, {
    font,
    size,
    depth,
    curveSegments: 6,
    bevelEnabled: false,
  })
  geo.computeBoundingBox()
  if (geo.boundingBox) {
    const cx = (geo.boundingBox.max.x + geo.boundingBox.min.x) / 2
    const cz = (geo.boundingBox.max.z + geo.boundingBox.min.z) / 2
    geo.translate(-cx, -geo.boundingBox.min.y, -cz)
  }
  return geo
}

// ── CJK support ──

export function isCjkChar(ch: string): boolean {
  const code = ch.codePointAt(0)!
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3300 && code <= 0x33ff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0x3000 && code <= 0x303f)
  )
}

export function containsCjk(text: string): boolean {
  for (const ch of text) {
    if (isCjkChar(ch)) return true
  }
  return false
}

export interface CjkFontResult {
  font: opentype.Font
  buffer: ArrayBuffer
}

let _cjkFont: CjkFontResult | null = null

/**
 * 加载系统 CJK 字体。
 * Node 环境：从系统字体目录查找。
 * 浏览器环境：由 browser host 通过 FontProvider 注入。
 *
 * 在 faijs 引擎中，如果未注入 FontProvider，返回 null（回退到拉丁字体）。
 */
export async function loadSystemCjkFont(): Promise<CjkFontResult | null> {
  if (_cjkFont) return _cjkFont

  // 尝试从系统字体目录加载（Node 环境）
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const os = await import('node:os')

      const candidates = [
        // Windows
        'C:/Windows/Fonts/msyh.ttc',
        'C:/Windows/Fonts/simhei.ttf',
        'C:/Windows/Fonts/simsun.ttc',
        // macOS
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/STHeiti Light.ttc',
        // Linux
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
      ]

      for (const candidate of candidates) {
        try {
          const buf = await fs.readFile(candidate)
          const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
          const font = opentype.parse(arrayBuffer)
          _cjkFont = { font, buffer: arrayBuffer }
          return _cjkFont
        } catch {
          // 尝试下一个候选
        }
      }
    } catch {
      // fs 不可用
    }
  }

  return null
}

/**
 * 创建混合 CJK + Latin 文字几何体。
 * 使用 opentype.js 将文字路径转为 THREE.Shape，然后 ExtrudeGeometry。
 */
export async function createMixedTextGeometry(
  text: string,
  size: number,
  depth: number,
  cjkFont: opentype.Font,
  latinFont?: Font,
): Promise<THREE.BufferGeometry> {
  const geometries: THREE.BufferGeometry[] = []

  let xOffset = 0

  for (const ch of text) {
    if (isCjkChar(ch)) {
      // CJK 字符用 opentype.js
      const glyph = cjkFont.charToGlyph(ch)
      const path = glyph.getPath(xOffset, 0, size)
      const geo = opentypePathToGeometry(path, depth, size)
      if (geo) geometries.push(geo)
      xOffset += (glyph.advanceWidth ?? 0) * (size / cjkFont.unitsPerEm)
    } else {
      // Latin 字符用 FontLoader 字体（如果可用）
      if (latinFont) {
        const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js')
        const geo = new TextGeometry(ch, {
          font: latinFont,
          size,
          depth,
          curveSegments: 6,
          bevelEnabled: false,
        })
        geo.computeBoundingBox()
        if (geo.boundingBox) {
          geo.translate(xOffset, 0, 0)
          xOffset += geo.boundingBox.max.x - geo.boundingBox.min.x
        }
        geometries.push(geo)
      } else {
        // 无 Latin 字体，用 opentype.js
        const glyph = cjkFont.charToGlyph(ch)
        const path = glyph.getPath(xOffset, 0, size)
        const geo = opentypePathToGeometry(path, depth, size)
        if (geo) geometries.push(geo)
        xOffset += (glyph.advanceWidth ?? 0) * (size / cjkFont.unitsPerEm)
      }
    }
  }

  if (geometries.length === 0) {
    return new THREE.BufferGeometry()
  }
  if (geometries.length === 1) {
    return geometries[0]
  }
  return mergeBufferGeometries(geometries)
}

// ── opentype path → THREE geometry ──

function opentypePathToGeometry(
  path: opentype.Path,
  depth: number,
  size: number,
): THREE.BufferGeometry | null {
  const commands = path.commands
  if (commands.length === 0) return null

  const shapes: THREE.Shape[] = []
  let currentShape: THREE.Shape | null = null

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        currentShape = new THREE.Shape()
        currentShape.moveTo(cmd.x, cmd.y)
        break
      case 'L':
        currentShape?.lineTo(cmd.x, cmd.y)
        break
      case 'C':
        currentShape?.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y)
        break
      case 'Q':
        currentShape?.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y)
        break
      case 'Z':
        if (currentShape) {
          shapes.push(currentShape)
          currentShape = null
        }
        break
    }
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
