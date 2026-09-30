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

const FONT_REGISTER: Record<string, Font> = {}

// ─── FontLoader 依赖注入 ───

/**
 * 字体二进制加载器接口。
 *
 * 生产代码（text.ts / engrave.ts）不自己决定字体来源，
 * 而是通过 ensureDefaultFont() / ensureFont() 使用注入的 FontLoader。
 */
export interface FontLoader {
  /** 返回默认字体的二进制数据 */
  loadDefaultFont(): Promise<ArrayBuffer>
  /**
   * 可选：按**字体族名**或**文件路径**取字体二进制。
   *
   * 宿主实现（Node 读磁盘/系统字体目录、浏览器按 URL 映射）决定来源；引擎核心
   * 不碰 fs/fetch。返回 `null` 表示宿主无法解析该名字——调用方回退到默认字体
   * （与 CadQuery/OCC `Font_FontMgr::FindFont` 找不到名字时回退默认字体的语义一致）。
   *
   * 未实现该方法的宿主（如浏览器）会让 `ensureFont(name)` 直接回退默认字体。
   *
   * @param nameOrPath - 字体族名（如 `"Arial"`）或字体文件路径
   * @returns 字体字节，或 null（无法解析）
   */
  resolveFont?(nameOrPath: string): Promise<ArrayBuffer | null>
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
 * 确保某个**具名字体**可用，并返回它。
 *
 * 语义对齐 CadQuery 的 `font=`/`fontPath=`：
 *
 * - 名字已注册过（含 `loadFont(data, name)` 直接注册）⇒ 直接返回；
 * - `fontPath`（已存在的文件路径）或字体族名 ⇒ 交给 `FontLoader.resolveFont` 解析，
 *   解析成功后**以该名字注册**，后续同名调用命中缓存；
 * - 宿主没有 `resolveFont`、或解析失败（名字不是本机已安装字体）⇒ **回退到默认字体**
 *   （OCC `Font_FontMgr::FindFont` 找不到字体时同样回退默认字体，不会抛错）。
 *
 * `null`/`undefined`/空串等价于「不指定」⇒ 默认字体。
 *
 * @param nameOrPath - 字体族名、字体文件路径，或 null/undefined 表示默认字体
 * @returns 解析到的字体（解析不到时是默认字体）
 * @throws 没有安装 FontLoader 且默认字体也未加载时
 */
export async function ensureFont(nameOrPath?: string | null): Promise<Font> {
  if (!nameOrPath) {
    await ensureDefaultFont()
    return getFont()!
  }

  const already = getFont(nameOrPath)
  if (already) return already

  if (nameOrPath === 'default') {
    await ensureDefaultFont()
    return getFont()!
  }

  const resolver = activeFontLoader?.resolveFont
  if (resolver) {
    const data = await activeFontLoader!.resolveFont!(nameOrPath)
    if (data) return loadFont(data, nameOrPath, true)
  }

  await ensureDefaultFont()
  return getFont()!
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
