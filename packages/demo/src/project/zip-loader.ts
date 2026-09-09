/**
 * zip-loader — zip 字节 → DemoProjectLoader（P2 新增通道，纯内存，可单测）。
 *
 * 与 folder 通道行为可互换：moduleKey 约定、越界报错文案、`pickEntryKey` 入口
 * 启发式完全一致；差异只在「文件从哪来」。
 *
 * 约定（与 5.5-A/B）：
 * - 入参只接受字节（ArrayBuffer 或 Uint8Array），不接受 File/Blob——单测零 DOM
 *   依赖；调用方负责 `await file.arrayBuffer()`。
 * - **不做顶层目录剥离**：moduleKey 与脚本里的相对 import 都以同一个根为基准，
 *   剥不剥离都不影响解析正确性；但「全部文件都在 `src/` 下」的 zip 在「公共首段」
 *   规则下会被误剥成 `assembly.fai.js`，反而让 `src/` 这一层语义丢失。保持
 *   「zip 内路径 = moduleKey」这一条无例外的规则，正确性由入口启发式兜住。
 * - key 要最终形态：无反斜杠、无 `./` 前缀（ModuleRegistry.normalizeModuleKey
 *   只做最小归一半按 listModules() 精确匹配）。
 */
import { unzipSync } from 'fflate'
import type { DemoProjectLoader } from './types'
import { FAI_SUFFIX, DEFAULT_SKIP_DIRS, escapeError, errMessage, isSkippedDir } from './shared'

/** createZipProjectLoader 构造选项。 */
export interface ZipProjectOptions {
  /** 覆盖默认跳过目录集合（`node_modules`/`dist`/`out`/`.git`/`.workbuddy`）。 */
  skipDirs?: string[]
}

/** 解压后条目数量 / 总字节上限（R9：防 `unzipSync` 同步解压卡死主线程）。 */
const MAX_ENTRIES = 5000
const MAX_TOTAL_BYTES = 64 * 1024 * 1024

/**
 * 构造基于 zip 字节的 ProjectLoader（浏览器多文件，zip 通道）。
 *
 * 入参只接受字节——单测零 DOM 依赖（调用方负责 `await file.arrayBuffer()`）。
 * @param data - 已解压的 zip 字节（`file.arrayBuffer()` 结果或已为 Uint8Array）。
 * @param opts - 可选参数（跳过目录集合）。
 * @returns promise resolving to the assembled DemoProjectLoader.
 */
export async function createZipProjectLoader(
  data: ArrayBuffer | Uint8Array,
  opts?: ZipProjectOptions,
): Promise<DemoProjectLoader> {
  // A1. 复制一份，避免共享 buffer 的 byteOffset 语义（Uint8Array 视图共享底层）
  const bytes = new Uint8Array(data)

  // A2. 解压；非 zip 字节 → 包成上下文错误抛出（由 main.ts 的 catch 显示）。
  // 实测（fflate 0.8.3）：非 zip 字节抛 `Error('invalid zip data')`；断言外层文案。
  let rawEntries: Record<string, Uint8Array>
  try {
    rawEntries = unzipSync(bytes)
  } catch (err) {
    throw new Error(`zip 解析失败: ${errMessage(err)}`, { cause: err })
  }

  const skipDirs = new Set(opts?.skipDirs ?? DEFAULT_SKIP_DIRS)

  // A3. 遍历条目（fflate 的 zipSync/unzipSync 都不产出目录条目，故「以 / 结尾」
  // 的跳过是防御性保留，正常路径不会命中）。
  const source = new Map<string, Uint8Array>()
  let totalBytes = 0
  let entryCount = 0
  for (const [rawKey, value] of Object.entries(rawEntries)) {
    entryCount++
    totalBytes += value.byteLength
    if (rawKey.endsWith('/')) continue // 目录条目（防御性）
    // 路径归一化：`\` → `/`；去掉前导 `./`
    const key = rawKey.replace(/\\/g, '/').replace(/^\.\//, '')
    // 任一段命中跳过集（点目录或 skipDirs）→ 跳过
    if (key.split('/').some((seg) => isSkippedDir(seg, skipDirs))) continue
    if (!key.endsWith(FAI_SUFFIX)) continue
    source.set(key, value)
  }

  // A4. 上限判定在解析后立刻打一枪，防巨包（R9）。
  if (entryCount > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`zip 内容超出上限（64MB / ${MAX_ENTRIES} 条目）`)
  }

  // A5. 清单排序（与 folder 通道排序一致）。
  const modules = [...source.keys()].sort()

  return {
    // B1. 同步返回缓存副本（引擎同步调用它）
    listModules: () => [...modules],
    // B2. 越界文案与 folder 通道逐字一致（「两通道行为可互换」的判据）
    readSource: async (moduleKey: string) => {
      if (!modules.includes(moduleKey)) {
        throw escapeError(moduleKey)
      }
      return new TextDecoder('utf-8').decode(source.get(moduleKey))
    },
    // B4. zip 为内存快照，重枚举无意义；实现它是为了主线程 Run 前对两通道统一调用
    refresh: () => Promise.resolve(),
  }
}