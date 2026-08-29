/**
 * 测试环境字体加载器 — Node/vitest 专用
 *
 * 通过 fs.readFileSync 读取字体文件，注入到 fontRegistry。
 *
 * 用法（在测试 beforeAll 中）：
 *   await setupTestFont()  // 设置 loader + 加载字体
 *
 * 或仅设置 loader（字体由 executeText → ensureDefaultFont 惰性加载）：
 *   ensureTestFontLoader()
 *
 * 字体文件唯一真源：src/assets/fonts/OpenSans-Regular.ttf
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setFontLoader, ensureDefaultFont, type FontLoader } from './fontRegistry'

let fontBuffer: ArrayBuffer | null = null

function getFontBuffer(): ArrayBuffer {
  if (fontBuffer) return fontBuffer
  // 模块相对（P6：与 cwd 无关）
  const fontPath = fileURLToPath(new URL('../../assets/fonts/OpenSans-Regular.ttf', import.meta.url))
  const buf = readFileSync(fontPath)
  fontBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return fontBuffer
}

const fsFontLoader: FontLoader = {
  async loadDefaultFont(): Promise<ArrayBuffer> {
    return getFontBuffer()
  },
}

let loaderSet = false

/**
 * 设置 fs 字体加载器（幂等，多次调用安全）。
 *
 * 设置后，ensureDefaultFont() 会用此 loader 读取字体文件。
 */
export function ensureTestFontLoader(): void {
  if (loaderSet) return
  loaderSet = true
  setFontLoader(fsFontLoader)
}

/**
 * 设置 fs 字体加载器并立即加载字体。
 *
 * 适用于直接调用 text-to-solid（不经 executeText）的测试：
 * text-to-solid 内部调用 getFont()，需要字体已注册。
 *
 * 对于经 executeText 的测试，只需 ensureTestFontLoader() 即可，
 * 因为 executeTextBrep 会调用 ensureDefaultFont() 惰性加载。
 */
export async function setupTestFont(): Promise<void> {
  ensureTestFontLoader()
  await ensureDefaultFont()
}
