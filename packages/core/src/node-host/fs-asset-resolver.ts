/**
 * FsAssetResolver — Node 端资产解析（fs 目录/manifest）
 *
 *
 * 实现 AssetResolver 接口：
 * - resolveByKey(key): 从 --assets 目录/manifest 解析 key → 文件路径 → ArrayBuffer
 * - resolveFile(path): 直接读取本地文件
 * - resolveUrl(url): fetch（Node 18+ 内置 fetch）
 *
 * manifest 格式（JSON）：
 *   {
 *     "file_abc123": { "path": "models/box.step", "format": "step" },
 *     "logo_svg_key": { "path": "assets/logo.svg", "format": "svg" }
 *   }
 *
 * 或简单目录模式（无 manifest）：key = 完整文件名（含扩展名，P8 资产按文件名注册）
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { resolve, extname, basename } from 'node:path'
import type { AssetResolver } from '../cad-runtime/ports'

interface ManifestEntry {
  path: string
  format?: string
}

type Manifest = Record<string, ManifestEntry>

/** 从文件扩展名推断格式 */
function inferFormat(filePath: string): string | undefined {
  if (filePath.toLowerCase().endsWith('.fai.js')) return 'faijs'
  const ext = extname(filePath).toLowerCase().slice(1)
  const formatMap: Record<string, string> = {
    step: 'step',
    stp: 'step',
    '3mf': '3mf',
    stl: 'stl',
    obj: 'obj',
    svg: 'svg',
  }
  return formatMap[ext]
}

/** Options for constructing an FsAssetResolver. */
export interface FsAssetResolverOptions {
  /** Asset root directory. */
  assetsDir?: string
  /** Manifest file path (JSON, key -> {path, format?}). */
  manifestPath?: string
}

/**
 * Node-side asset resolver backed by the filesystem (directory/manifest).
 *
 * Implements the AssetResolver interface:
 * - resolveByKey(key): resolve a key from the --assets directory/manifest to a file path and return its bytes
 * - resolveFile(path): read a local file directly
 * - resolveUrl(url): fetch a URL (Node 18+ built-in fetch)
 *
 * Manifest format (JSON):
 *   {
 *     "file_abc123": { "path": "models/box.step", "format": "step" },
 *     "logo_svg_key": { "path": "assets/logo.svg", "format": "svg" }
 *   }
 *
 * Or a plain directory mode (no manifest): key = full file name (with extension, P8: assets are registered by file name).
 */
export class FsAssetResolver implements AssetResolver {
  private assetsDir: string | undefined
  private manifest: Manifest = {}

  constructor(opts?: FsAssetResolverOptions) {
    this.assetsDir = opts?.assetsDir
    const manifestPath = opts?.manifestPath ?? (this.assetsDir ? resolve(this.assetsDir, 'manifest.json') : undefined)

    if (manifestPath && existsSync(manifestPath)) {
      const raw = readFileSync(manifestPath, 'utf-8')
      this.manifest = JSON.parse(raw) as Manifest
    }

    // 如果没有 manifest 但有 assetsDir，自动扫描目录
    if (Object.keys(this.manifest).length === 0 && this.assetsDir && existsSync(this.assetsDir)) {
      this.scanDirectory(this.assetsDir)
    }
  }

  /**
   * 扫描目录，注册两种 key（同一文件的两个命名空间，非内部逻辑回退）：
   * - 完整文件名（含扩展名）：P8 起 `cad.load({ file })` 的寻址载体；
   * - 无扩展名 basename：`cad.import_brep({ asset })` 的平台 BREP 资产约定
   *   （asset 引用 `<stem>.brp` 的 `<stem>`，容器资产名）。
   */
  private scanDirectory(dir: string): void {
    const files = readdirSync(dir)
    for (const file of files) {
      const fullPath = resolve(dir, file)
      if (statSync(fullPath).isFile()) {
        this.manifest[file] = { path: fullPath, format: inferFormat(fullPath) }
        const stem = basename(file, extname(file))
        if (stem !== file) {
          this.manifest[stem] = { path: fullPath, format: inferFormat(fullPath) }
        }
      }
    }
  }

  async resolveByKey(key: string): Promise<{ bytes: ArrayBuffer; format?: string }> {
    const entry = this.manifest[key]
    if (!entry) {
      throw new Error(`[FsAssetResolver] asset key "${key}" not found in manifest or directory`)
    }

    const fullPath = this.assetsDir
      ? resolve(this.assetsDir, entry.path)
      : entry.path

    if (!existsSync(fullPath)) {
      throw new Error(`[FsAssetResolver] asset file not found: ${fullPath}`)
    }

    const buf = readFileSync(fullPath)
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    return { bytes: arrayBuffer, format: entry.format ?? inferFormat(fullPath) }
  }

  async resolveFile(path: string): Promise<ArrayBuffer> {
    if (!existsSync(path)) {
      throw new Error(`[FsAssetResolver] file not found: ${path}`)
    }
    const buf = readFileSync(path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }

  async resolveUrl(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`[FsAssetResolver] fetch failed: ${url} (${response.status} ${response.statusText})`)
    }
    return response.arrayBuffer()
  }
}
