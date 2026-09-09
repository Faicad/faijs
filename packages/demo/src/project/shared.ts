/**
 * shared — 两通道（folder / zip）共享的常量与纯函数。
 *
 * 无 DOM、无包依赖，Node 单测可直接使用。
 */

/** 项目模块扩展名（`.fai.js` 结尾即命中）。 */
export const FAI_SUFFIX = '.fai.js'

/** 枚举时跳过的目录（依赖 / 产物 / 版本控制，与 node fs 版一致）。 */
export const DEFAULT_SKIP_DIRS = ['node_modules', 'dist', 'out', '.git', '.workbuddy']

/** 越界 key 的统一报错（两通道必须逐字一致）。
 * @param key - 被拒绝读取的 moduleKey。
 * @returns the error object. */
export function escapeError(key: string): Error {
  return new Error(`module "${key}" escapes the project (not in enumeration)`)
}

/** 目录/文件段是否应被跳过：以 `.` 开头，或在 skipDirs 中。
 * @param name - the directory/file segment name.
 * @param skipDirs - the active skip set.
 * @returns true when the segment should be skipped.
 */
export function isSkippedDir(name: string, skipDirs: Set<string>): boolean {
  return name.startsWith('.') || skipDirs.has(name)
}

/**
 * 入口启发式（§5.5-C）。keys 必须已排序；返回 null 表示清单为空。
 *
 * 1) 精确 === 'src/assembly.fai.js'
 * 2) 后缀 '/src/assembly.fai.js'（zip 带顶层包裹目录时命中）
 * 3) 精确或后缀 'assembly.fai.js'
 * 4) keys[0]
 * 5) keys 为空 → null
 *
 * keys 已排序，`find` 返回字典序第一个 → 结果确定。
 * folder 通道现有行为不变：OPFS 根 = mini_lathe 根时 key 恰为 `src/assembly.fai.js`，命中第 1 条。
 * @param keys - the sorted module keys (may be empty).
 * @returns the chosen entry key, or null when keys is empty.
 */
export function pickEntryKey(keys: string[]): string | null {
  if (keys.length === 0) return null
  return (
    keys.find((k) => k === 'src/assembly.fai.js') ??
    keys.find((k) => k.endsWith('/src/assembly.fai.js')) ??
    keys.find((k) => k === 'assembly.fai.js') ??
    keys.find((k) => k.endsWith('/assembly.fai.js')) ??
    keys[0]
  )
}

/** 任意异常 → 可读消息（多处与 `{ cause }` 包裹共用）。
 * @param err - the thrown value (may be any type).
 * @returns a printable message.
 */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}