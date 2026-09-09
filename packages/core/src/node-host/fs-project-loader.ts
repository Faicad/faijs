/**
 * fs-project-loader — 本地文件系统版 ProjectLoader（node-host）
 *
 * 多文件（§4.5）的宿主实现：把**一个目录**当作 faijs 项目，递归枚举其中的
 * `.fai.js` 作为可装载模块。
 *
 * moduleKey 约定（与 `cad-runtime/ports.ts` 的 ProjectLoader 契约一致）：
 * - key = 相对项目根的 POSIX 路径，如 `src/parts/bottom_plate.fai.js`；
 * - `ModuleRegistry.normalizeModuleKey` 只做最小归一后按 `listModules()` **精确匹配**，
 *   所以这里产出的 key 必须是最终形态（反斜杠一律转 `/`，无 `./` 前缀）。
 *
 * 项目根的判定（`findProjectRoot`）：从入口文件向上找最近的 `package.json`。
 * 与 faijs 的包布局一致（mini_lathe 等示例项目的根就是包根）。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ProjectLoader } from '../cad-runtime/ports'

/** 项目模块扩展名（`.fai.js`；`.fai.js` 结尾即命中，不额外匹配 `.js`）。 */
const FAI_SUFFIX = '.fai.js'

/** 枚举时跳过的目录（依赖 / 产物 / 版本控制）。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git', '.workbuddy'])

/**
 * 递归收集项目根下的全部 `.fai.js`，产出 POSIX 相对路径 key。
 * @param rootDir - 项目根（绝对路径）。
 * @param dir - 当前递归目录（绝对路径）；外部调用省略。
 * @returns moduleKey 数组（相对 rootDir，POSIX 斜杠）。
 */
function collectModules(rootDir: string, dir: string = rootDir): string[] {
  const keys: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return keys // 不可读目录（权限等）视为空
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      keys.push(...collectModules(rootDir, full))
      continue
    }
    if (!entry.isFile()) continue
    if (!entry.name.endsWith(FAI_SUFFIX)) continue
    keys.push(toPosix(relative(rootDir, full)))
  }
  return keys
}

/** 路径 → POSIX 斜杠（Windows 的 `a\b` → `a/b`）。 */
function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/**
 * 构造基于本地文件系统的 ProjectLoader。
 *
 * 模块清单在创建时枚举一次（CLI 是一次性执行，无需监听文件变更）；
 * `readSource` 每次实时读盘。key 越界（含 `..` 逃出项目根）拒绝读取。
 * @param rootDir - 项目根目录（绝对或相对 cwd，内部会 resolve）。
 * @returns ProjectLoader 实例。
 */
export function createFsProjectLoader(rootDir: string): ProjectLoader {
  const root = resolve(rootDir)
  const modules = collectModules(root).sort()
  return {
    listModules: () => [...modules],
    readSource: async (key: string) => {
      const abs = resolve(root, key)
      // 越界防护：key 经 `..` 逃出项目根 → 拒绝（与 MODULE_NOT_FOUND 区分）
      if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`module "${key}" escapes the project root`)
      }
      return readFileSync(abs, 'utf-8')
    },
  }
}

/**
 * 从入口文件向上找项目根：最近的含 `package.json` 的祖先目录。
 * 找不到（如临时目录里的裸脚本）时回退到入口文件所在目录。
 * @param entryFile - 入口 `.fai.js` 路径。
 * @returns 项目根绝对路径。
 */
export function findProjectRoot(entryFile: string): string {
  const abs = resolve(entryFile)
  let dir = statSync(abs).isDirectory() ? abs : dirname(abs)
  for (;;) {
    try {
      if (statSync(join(dir, 'package.json')).isFile()) return dir
    } catch {
      // 不存在 → 继续向上
    }
    const parent = dirname(dir)
    if (parent === dir) return statSync(abs).isDirectory() ? abs : dirname(abs)
    dir = parent
  }
}

/**
 * 入口文件的 moduleKey：相对项目根的 POSIX 路径。
 * 主模块也需要 key——否则它的 `./parts/x.fai.js` 会以项目根而非自身目录为基准解析。
 * @param rootDir - 项目根。
 * @param entryFile - 入口 `.fai.js` 路径。
 * @returns moduleKey（如 `src/assembly.fai.js`）。
 */
export function projectKeyOf(rootDir: string, entryFile: string): string {
  return toPosix(relative(resolve(rootDir), resolve(entryFile)))
}
