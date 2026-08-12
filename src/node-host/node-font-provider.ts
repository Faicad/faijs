/**
 * NodeFontProvider — Node 端字体加载（fs 读取）
 *
 * 设计文档：docs/faijs-engine-refactor-design.md §5.2
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
import type { FontProvider } from '../cad-runtime/ports'
import type { FontLoader } from '../brep/text/fontRegistry'

/** 默认字体路径（项目唯一真源） */
const DEFAULT_FONT_PATH = resolve(process.cwd(), 'src/assets/fonts/OpenSans-Regular.ttf')

/** 字体文件扩展名 */
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2'])

export interface NodeFontProviderOptions {
  /** 默认字体路径（不传则用项目唯一真源） */
  defaultFontPath?: string
  /** 额外字体目录：目录下所有 .ttf/.otf 文件按文件名（不含扩展名）注册为 key */
  fontsDir?: string
}

export class NodeFontProvider implements FontProvider, FontLoader {
  private defaultFontPath: string
  private fontsDir: string | undefined
  /** key → 文件路径 映射（包含 'default' → 默认字体） */
  private keyToPath = new Map<string, string>()
  /** 缓存的 ArrayBuffer（避免重复读磁盘） */
  private cache = new Map<string, ArrayBuffer>()

  constructor(opts?: NodeFontProviderOptions) {
    this.defaultFontPath = opts?.defaultFontPath ?? DEFAULT_FONT_PATH
    this.fontsDir = opts?.fontsDir

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

  /** FontProvider.loadFont: 按 key 加载字体字节 */
  async loadFont(key: string): Promise<ArrayBuffer> {
    const path = this.keyToPath.get(key)
    if (!path) {
      throw new Error(`[NodeFontProvider] font key "${key}" not found. Available: ${this.listFonts().join(', ')}`)
    }
    return this.loadFile(path)
  }

  /** FontLoader.loadDefaultFont: 返回默认字体字节 */
  async loadDefaultFont(): Promise<ArrayBuffer> {
    return this.loadFile(this.defaultFontPath)
  }

  /** FontProvider.listFonts: 列出可用字体 key */
  listFonts(): string[] {
    return Array.from(this.keyToPath.keys())
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
