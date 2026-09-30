/**
 * NodeFontProvider — Node 端字体加载（fs 读取）
 *
 *
 * 实现 FontProvider 接口（ports.ts）+ FontLoader 接口（fontRegistry.ts）。
 *
 * - FontProvider.loadFont(key): 按 key 加载字体 ArrayBuffer
 * - FontLoader.loadDefaultFont(): 返回默认字体
 *
 * 字体文件唯一真源：src/assets/fonts/OpenSans-Regular.ttf
 * 额外字体可通过 --fonts <dir> 注册。
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FontProvider } from '../cad-runtime/ports'
import type { FontLoader } from '../brep/text/fontRegistry'
import {
  buildFontFamilyIndex,
  defaultSystemFontDirs,
  normalizeFontName,
  splitDirList,
  type FontFamilyIndex,
} from './font-family-index'

// 默认字体路径（项目唯一真源）——模块相对（P6：与 cwd 无关；发布态由宿主注入覆盖）
const DEFAULT_FONT_PATH = fileURLToPath(new URL('../assets/fonts/OpenSans-Regular.ttf', import.meta.url))

/** 字体文件扩展名 */
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2'])

/** Options for constructing a NodeFontProvider. */
export interface NodeFontProviderOptions {
  /** Default font path (falls back to the project single source of truth when omitted). */
  defaultFontPath?: string
  /** Extra fonts directory: all .ttf/.otf files are registered by file name (without extension) as keys. */
  fontsDir?: string
  /**
   * Enable name-based lookup against the OS font directories (default `true`).
   *
   * Needed to honour a font *family name* (`resolveFont('Arial')`) the way
   * CadQuery's `font=` does through OCC's system font manager. Only consulted
   * when a caller names a font that is not already registered, so the bundled
   * default font path is unaffected. Set `false` to keep the host fully
   * hermetic (name lookups then always miss and fall back to the default).
   */
  systemFonts?: boolean
  /** Override the system font directories to scan (PATH-separated string or array). */
  systemFontDirs?: string[] | string
}

/**
 * Node-side font provider (fs loading).
 *
 * Implements the FontProvider interface (ports.ts) + FontLoader interface (fontRegistry.ts).
 *
 * - FontProvider.loadFont(key): load a font ArrayBuffer by key
 * - FontLoader.loadDefaultFont(): return the default font
 *
 * Single source of truth for the default font file: src/assets/fonts/OpenSans-Regular.ttf.
 * Extra fonts can be registered via the --fonts <dir> option.
 */
export class NodeFontProvider implements FontProvider, FontLoader {
  private defaultFontPath: string
  private fontsDir: string | undefined
  /** key → 文件路径 映射（包含 'default' → 默认字体） */
  private keyToPath = new Map<string, string>()
  /** 缓存的 ArrayBuffer（避免重复读磁盘） */
  private cache = new Map<string, ArrayBuffer>()
  /** System font dirs to scan for a font *family name* (empty ⇒ disabled). */
  private systemFontDirs: string[]
  /** Lazily built normalized-family → path index (null until first name miss). */
  private familyIndex: FontFamilyIndex | null = null

  constructor(opts?: NodeFontProviderOptions) {
    this.defaultFontPath = opts?.defaultFontPath ?? DEFAULT_FONT_PATH
    this.fontsDir = opts?.fontsDir
    this.systemFontDirs =
      opts?.systemFonts === false
        ? []
        : opts?.systemFontDirs
          ? Array.isArray(opts.systemFontDirs)
            ? opts.systemFontDirs
            : splitDirList(opts.systemFontDirs)
          : defaultSystemFontDirs()

    // 注册默认字体
    this.keyToPath.set('default', this.defaultFontPath)
    this.keyToPath.set('OpenSans', this.defaultFontPath)
    this.keyToPath.set('OpenSans-Regular', this.defaultFontPath)

    // 扫描额外字体目录
    if (this.fontsDir && existsSync(this.fontsDir)) {
      const files = readdirSync(this.fontsDir)
      for (const file of files) {
        const ext = extname(file).toLowerCase()
        if (FONT_EXTENSIONS.has(ext)) {
          const key = basename(file, ext)
          this.keyToPath.set(key, resolve(this.fontsDir, file))
        }
      }
    }
  }

  /** FontProvider.loadFont: load font bytes by key. */
  async loadFont(key: string): Promise<ArrayBuffer> {
    const path = this.keyToPath.get(key)
    if (!path) {
      throw new Error(`[NodeFontProvider] font key "${key}" not found. Available: ${this.listFonts().join(', ')}`)
    }
    return this.loadFile(path)
  }

  /** FontLoader.loadDefaultFont: return the default font bytes. */
  async loadDefaultFont(): Promise<ArrayBuffer> {
    return this.loadFile(this.defaultFontPath)
  }

  /** FontProvider.listFonts: list the available font keys. */
  listFonts(): string[] {
    return Array.from(this.keyToPath.keys())
  }

  /**
   * FontLoader.resolveFont: resolve a font family name or a file path.
   *
   * Order: an existing file path wins, then a registered key (exact, then
   * normalised so `"Arial"` matches the `arial.ttf` stem), then the OS font
   * family index. Returns `null` — never throws — when nothing matches, so the
   * caller can fall back to the default font the way OCC does.
   *
   * @param nameOrPath - font family name or font file path
   * @returns the font bytes, or null when the name cannot be resolved here
   */
  async resolveFont(nameOrPath: string): Promise<ArrayBuffer | null> {
    const asPath = resolve(nameOrPath)
    if (existsSync(asPath) && FONT_EXTENSIONS.has(extname(asPath).toLowerCase())) {
      return this.loadFile(asPath)
    }

    const direct = this.keyToPath.get(nameOrPath)
    if (direct) return this.loadFile(direct)

    const wanted = normalizeFontName(nameOrPath)
    // Compare on the file-stem form too, so a caller may name a font either by
    // family ("Arial") or by the file it ships as ("arial.ttf").
    const wantedStem = normalizeFontName(nameOrPath.replace(/\.[a-z0-9]+$/i, ''))
    for (const [key, path] of this.keyToPath) {
      const k = normalizeFontName(key)
      if (k === wanted || k === wantedStem) return this.loadFile(path)
    }

    if (this.systemFontDirs.length > 0) {
      this.familyIndex ??= buildFontFamilyIndex(this.systemFontDirs)
      const hit = this.familyIndex.get(wanted) ?? this.familyIndex.get(wantedStem)
      if (hit) return this.loadFile(hit)
    }

    return null
  }

  /** 读取文件并缓存 */
  private loadFile(path: string): ArrayBuffer {
    const cached = this.cache.get(path)
    if (cached) return cached

    if (!existsSync(path)) {
      throw new Error(`[NodeFontProvider] font file not found: ${path}`)
    }

    const buf = readFileSync(path)
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    this.cache.set(path, arrayBuffer)
    return arrayBuffer
  }
}
