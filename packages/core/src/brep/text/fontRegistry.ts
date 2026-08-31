/**
 * 字体加载与注册 — 单一真源
 *
 * 设计原则：
 * - loadFont 只接受 ArrayBuffer（纯函数，无 fs/fetch 环境依赖）
 * - 字体二进制的获取方式由 FontLoader 接口注入（依赖反转）
 * - 浏览器：browserFontLoader.ts 通过 vite ?url + fetch 加载
 * - Node 测试：fontTestHelper.ts 通过 fs.readFileSync 加载
 * - 字体文件唯一真源：src/assets/fonts/OpenSans-Regular.ttf
 */

import * as opentype from 'opentype.js'
import type { Font } from 'opentype.js'

const FONT_REGISTER: Record<string, Font> = {}

// ─── FontLoader 依赖注入 ───

/**
 * 字体二进制加载器接口。
 *
 * 生产代码（text.ts / engrave.ts）不自己决定字体来源，
 * 而是通过 ensureDefaultFont() 使用注入的 FontLoader。
 */
export interface FontLoader {
  /** 返回默认字体的二进制数据 */
  loadDefaultFont(): Promise<ArrayBuffer>
}

let activeFontLoader: FontLoader | null = null

/**
 * 设置当前环境的字体加载器。
 *
 * 浏览器：由 browserFontLoader.ts 在应用启动时自动调用。
 * 测试：由 fontTestHelper.ts 在 beforeAll 中调用。
 *
 * @param loader - the font loader to install, or null to clear the active one.
 */
export function setFontLoader(loader: FontLoader | null): void {
  activeFontLoader = loader
}

/**
 * Get the currently-installed font loader (may be null).
 * @returns the active font loader, or null when none is set.
 */
export function getFontLoader(): FontLoader | null {
  return activeFontLoader
}

// ─── 核心 API ───

/**
 * 加载并注册一个 OpenType/TrueType 字体。
 *
 * 纯函数：只接受 ArrayBuffer，不处理 fs/fetch。
 * 环境差异由 FontLoader 接口在外部处理。
 *
 * @param fontData 字体文件二进制数据
 * @param fontFamily 注册名（默认 'default'）
 * @param force 是否覆盖已注册的同名字体
 * @returns 解析后的 opentype.js Font 对象
 */
export async function loadFont(
  fontData: ArrayBuffer,
  fontFamily = 'default',
  force = false,
): Promise<Font> {
  if (!force && FONT_REGISTER[fontFamily]) {
    return FONT_REGISTER[fontFamily]
  }

  let font: Font
  try {
    font = opentype.parse(fontData)
  } catch (e) {
    throw new Error(`Failed to parse font data: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }

  FONT_REGISTER[fontFamily] = font
  if (!FONT_REGISTER['default']) {
    FONT_REGISTER['default'] = font
  }

  return font
}

/**
 * 确保默认字体已加载（惰性加载）。
 *
 * 使用注入的 FontLoader 获取字体二进制，然后调用 loadFont 解析注册。
 * 如果字体已加载（getFont('default') 返回非 undefined），直接返回。
 *
 * @throws 如果没有设置 FontLoader 且字体尚未加载
 */
export async function ensureDefaultFont(): Promise<void> {
  if (getFont('default')) return

  if (!activeFontLoader) {
    throw new Error(
      '[fontRegistry] No font loader set. ' +
      'Call setFontLoader() before using text functions. ' +
      'Browser: import browserFontLoader.ts; Node tests: use fontTestHelper.ts.',
    )
  }

  const data = await activeFontLoader.loadDefaultFont()
  await loadFont(data, 'default', true)
}

/**
 * 获取已注册的字体。
 *
 * @param fontFamily 注册名（默认 'default'）
 * @returns opentype.js Font 对象，如果未加载则返回 undefined
 */
export function getFont(fontFamily = 'default'): Font | undefined {
  return FONT_REGISTER[fontFamily]
}

/**
 * 清除所有已注册的字体。
 *
 * 主要用于测试：在注入失败 loader 前，先清除已加载的字体，
 * 确保 ensureDefaultFont() 会重新调用 loader。
 */
export function clearFonts(): void {
  for (const key of Object.keys(FONT_REGISTER)) {
    delete FONT_REGISTER[key]
  }
}
