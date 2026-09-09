/**
 * directory-project-loader — 浏览器版 ProjectLoader（browser-host）
 *
 * 与 `node-host/fs-project-loader.ts` 对称的多文件（§4.5）宿主实现：把**一个目录
 * 句柄**当作 faijs 项目，递归枚举其中的 `.fai.js` 作为可装载模块。差异只在
 * 「文件系统」：
 * - node fs 版：同步 `readdirSync`，创建时枚举一次；
 * - 本实现：File System Access API 的目录句柄（`showDirectoryPicker`）或 OPFS
 *   句柄（`navigator.storage.getDirectory()`）——两者接口同构（`kind` /
 *   `entries()` / `getDirectoryHandle` / `getFileHandle` / `getFile`）。
 *   浏览器枚举是异步的，模块清单必须**挂载时预枚举缓存**（与 fs 版「创建时枚举
 *   一次」行为一致），`refresh()` 供 UI 在 Run 前重新枚举。
 *
 * moduleKey 约定（与 `cad-runtime/ports.ts` 的 ProjectLoader 契约一致）：
 * - key = 相对项目根的 POSIX 路径，如 `src/parts/bottom_plate.fai.js`；
 * - 无反斜杠、无 `./` 前缀——`ModuleRegistry.normalizeModuleKey` 只做最小归一后
 *   按 `listModules()` **精确匹配**，所以这里产出的 key 必须是最终形态。
 *
 * 递归枚举目录下全部 `.fai.js`；跳过 `node_modules` / `dist` / `out` / `.git` /
 * `.workbuddy` 及 `.` 开头的目录（与 fs 版一致）。
 */

import type { ProjectLoader } from '../cad-runtime/ports'

/** 项目模块扩展名（`.fai.js` 结尾即命中）。 */
const FAI_SUFFIX = '.fai.js'

/** 枚举时跳过的目录（依赖 / 产物 / 版本控制，与 fs 版一致）。 */
const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git', '.workbuddy'])

/**
 * 可枚举/可下钻的目录句柄最小接口（structurally 兼容 FileSystemDirectoryHandle
 * 与 OPFS directory handle）。不依赖 DOM 类型——Node 单测可用纯对象构造。
 */
export type FsDirectoryHandleLike = {
  kind?: string
  entries?: () => AsyncIterable<[string, FsEntryHandleLike]>
  getDirectoryHandle?: (name: string, opts?: { create?: boolean }) => Promise<FsDirectoryHandleLike>
  getFileHandle?: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandleLike>
}

/** 文件句柄最小接口（`getFile()` 返回类 File 对象，只需 `.text()`）。 */
export type FsFileHandleLike = {
  kind?: string
  getFile?: () => Promise<{ text(): Promise<string> }>
}

/** 条目句柄（浏览器 `entries()` 产出的元素类型）。 */
export type FsEntryHandleLike = FsDirectoryHandleLike | FsFileHandleLike

/** createDirectoryProjectLoader 构造选项。 */
export interface DirectoryProjectLoaderOptions {
  /** 覆盖默认跳过目录集合（`node_modules`/`dist`/`out`/`.git`/`.workbuddy`）。 */
  skipDirs?: string[]
}

/**
 * 浏览器版 ProjectLoader，额外提供 `refresh()`。
 *
 * `listModules()` 是同步签名（ProjectLoader 契约），浏览器枚举是异步操作，
 * 故清单必须预枚举缓存；`refresh()` 重新枚举并更新缓存（demo 的 Run 前调用，
 * 外部编辑器改了文件后可看到新增/删除的模块）。`readSource` 每次实时下钻读取。
 */
export interface DirectoryProjectLoader extends ProjectLoader {
  /** 重新枚举模块清单（挂载时枚举一次；目录被外部改动后由 UI 刷新）。 */
  refresh(): Promise<void>
}

/**
 * 构造基于目录句柄的 ProjectLoader（浏览器多文件）。
 *
 * 创建时异步枚举一次模块清单并缓存；`readSource` 每次按 key 下钻读取；
 * 越界 key（不在清单中）拒绝读取（防逃逸兜底——引擎侧归一已消解 `..` 逃逸，
 * 这里二次校验）。
 * @param rootHandle - 项目根目录句柄（`showDirectoryPicker` 返回或 OPFS 根）。
 * @param opts - 可选参数（跳过目录集合）。
 * @returns promise resolving to the assembled DirectoryProjectLoader.
 */
export async function createDirectoryProjectLoader(
  rootHandle: FsDirectoryHandleLike,
  opts?: DirectoryProjectLoaderOptions,
): Promise<DirectoryProjectLoader> {
  const skipDirs = new Set(opts?.skipDirs ?? DEFAULT_SKIP_DIRS)

  /** 递归枚举：收集目录下全部 `.fai.js`（POSIX 相对根 key）。与 BREP.io 的
   *  `walkMountedDirectoryTree` 同构。 */
  async function walk(dir: FsDirectoryHandleLike, basePath: string, out: string[]): Promise<void> {
    if (!dir.entries) return
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind === 'directory') {
        if (name.startsWith('.') || skipDirs.has(name)) continue
        await walk(entry as FsDirectoryHandleLike, basePath ? `${basePath}/${name}` : name, out)
        continue
      }
      // 文件（或 kind 缺省的宽松句柄，如测试桩）：仅收集 `.fai.js`
      if (!name.endsWith(FAI_SUFFIX)) continue
      out.push(basePath ? `${basePath}/${name}` : name)
    }
  }

  let modules: string[] = []

  /** 重新枚举模块清单并更新缓存（挂载后由 UI 在 Run 前刷新）。 */
  async function refresh(): Promise<void> {
    const out: string[] = []
    await walk(rootHandle, '', out)
    modules = out.sort()
  }

  /**
   * 按 key 逐段下钻到文件句柄：前 N-1 段 `getDirectoryHandle`，末段 `getFileHandle`。
   * 任一步失败（目录/文件不存在）→ 抛带 key 的错误（与 MODULE_NOT_FOUND 区分上下文）。
   */
  async function descendToFile(key: string): Promise<FsFileHandleLike> {
    const segs = key.split('/')
    const filename = segs[segs.length - 1]
    const dirSegs = segs.slice(0, -1)
    let dir: FsDirectoryHandleLike = rootHandle
    for (const seg of dirSegs) {
      if (!dir.getDirectoryHandle) {
        throw new Error(`project loader: cannot descend into directory "${seg}" of module "${key}" (root handle lacks getDirectoryHandle)`)
      }
      try {
        dir = await dir.getDirectoryHandle(seg)
      } catch (err) {
        throw new Error(
          `project loader: directory "${seg}" of module "${key}" not found: ${errMessage(err)}`,
          { cause: err },
        )
      }
    }
    if (!dir.getFileHandle) {
      throw new Error(`project loader: cannot resolve file "${filename}" of module "${key}" (directory handle lacks getFileHandle)`)
    }
    try {
      return await dir.getFileHandle(filename)
    } catch (err) {
      throw new Error(`project loader: file "${key}" not found: ${errMessage(err)}`, { cause: err })
    }
  }

  await refresh()

  return {
    listModules: () => [...modules],
    readSource: async (key: string) => {
      // 越界防御：归一后的 `..` 逃逸在引擎侧已被 normalizeModuleKey 消解，这里二次校验
      if (!modules.includes(key)) {
        throw new Error(`module "${key}" escapes the project (not in enumeration)`)
      }
      const handle = await descendToFile(key)
      if (!handle.getFile) {
        throw new Error(`project loader: file handle for "${key}" lacks getFile()`)
      }
      const file = await handle.getFile()
      return file.text()
    },
    refresh,
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}