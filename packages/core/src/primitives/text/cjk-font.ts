/**
 * cjk-font — CJK character classification and system font loading.
 *
 * Zero-three module: the geometry half of the former `primitives/text/cjk.ts`
 * (`createMixedTextGeometry`) consumers on the editor extension library, whose
 * `cad.text` BREP path still needs the character test and the Local Font Access
 * API loader. Keeping the font half here means the platform `cad.text` BREP path
 * (and the CJK fallback it shares with the mesh path) no longer drags three's
 * `Shape`/`ExtrudeGeometry` into the platform surface.
 *
 * Uses the Local Font Access API (window.queryLocalFonts) to load system CJK
 * fonts; glyph path parsing lives in the consumer.
 */
import * as opentypeModule from 'opentype.js'
import type { Font } from 'opentype.js'

/**
 * `opentype.js` publishes no `exports` map: it ships a UMD bundle (`main`) plus
 * an ESM build (`module`). Node ESM resolves the UMD `main`, whose CommonJS
 * interop exposes a namespace import as `{ default }` only — so
 * `opentypeModule.parse` is undefined there — whereas bundlers (vite/vitest)
 * resolve the ESM build and expose the named exports directly. Resolve once,
 * here, so glyph parsing works in every host (CLI/tsx = Node ESM,
 * vitest/browser = bundler).
 */
const opentype: typeof opentypeModule =
  typeof (opentypeModule as { parse?: unknown }).parse === 'function'
    ? opentypeModule
    : (opentypeModule as unknown as { default: typeof opentypeModule }).default

/**
 * Check if a character is CJK (CJK Unified Ideographs + extensions).
 *
 * @param ch - the single character to test.
 * @returns true when the character falls in a CJK code point range.
 */
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

/**
 * Check if a text string contains any CJK characters.
 *
 * @param text - the text to scan.
 * @returns true when at least one character is CJK.
 */
export function containsCjk(text: string): boolean {
  for (const ch of text) {
    if (isCjkChar(ch)) return true
  }
  return false
}

/** Result of loading a system CJK font. */
export interface CjkFontResult {
  font: Font
  family: string
}

/**
 * Load a CJK font from the system using the Local Font Access API.
 * Returns null if unavailable (no permission, unsupported browser, or no CJK font found).
 *
 * @returns a promise resolving to the parsed CJK font and its family name,
 *   or null when no usable system CJK font is available.
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
