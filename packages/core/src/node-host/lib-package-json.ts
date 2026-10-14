/**
 * lib-package-json — 库自身 `package.json` 的读盘通道（唯一归属）。
 *
 * 两个消费方读同一份文件里的不同字段，解析方式只应有这一处：
 *   - Node host（`node-host/cli.ts`）：`faijs.autoLift` + `faijs.lib` + `peerDependencies`
 *     ——即库的**两级引擎声明**与提升开关；
 *   - 确定性扫描器（`scripts/determinism-cli.ts`）：库的源码入口（`exports['.']` / `main`）。
 *
 * ⚠️ **不能**用 `createRequire().resolve(`${pkg}/package.json`)` 来定位：Node 的 `exports`
 * 映射是硬门禁——包若没在 `exports` 里列出 `./package.json`（本仓全部库都没列），这一步
 * 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。2026-10-14 实测：旧实现把该异常吞成 `undefined`，
 * 于是 `faijs.autoLift` 与 `faijs.lib` **一条都读不到**——声明静默失效，正是内核取用面
 * 收敛（2026-10-14）要消灭的那类 bug。
 *
 * 改为按 Node 自己的模块搜索路径（`resolve.paths`，与 `exports` 无关）逐级找盘上的
 * `<base>/<pkg>/package.json`：只要求包装在盘上，不要求它可 import。命中前的
 * `require.resolve` 作为兜底，覆盖包只能经 `imports` / 条件导出到达的情形。
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const requireNode = createRequire(import.meta.url)

/**
 * 定位 `pkg` 的 `package.json` 路径。
 *
 * @param pkg - 已归一化的（scoped）包名，如 `@faicad/faijs-gears`。
 * @returns `package.json` 的绝对路径，或 `undefined`（包不在盘上）。
 */
export function resolveLibPackageJsonPath(pkg: string): string | undefined {
  for (const base of requireNode.resolve.paths(pkg) ?? []) {
    const candidate = join(base, pkg, 'package.json')
    if (existsSync(candidate)) return candidate
  }
  try {
    return requireNode.resolve(`${pkg}/package.json`)
  } catch {
    return undefined
  }
}

/**
 * 包名 → `package.json` 内容的会话级缓存。
 *
 * 同一进程内包内容不会变，而 `autoLiftFor` / `libMetaFor` / 内置 `cad` 的注册各读一次
 * 同一份文件，重复 `readFileSync` 只是白花 I/O。用 `has` 而不是 `??` 判缓存，
 * 因为「包不在盘上」也是要记住的结论（`undefined`）。
 */
const cache = new Map<string, unknown>()

/**
 * 读库自身的 `package.json`（原始 JSON，未校验）。
 *
 * `T` 只是消费方的**投影**：磁盘 JSON 不可信，字段校验归调用方（如内核取用面声明的
 * 归一化在 `assertLibDecl`）。
 *
 * @param pkg - 已归一化的（scoped）包名。
 * @returns 解析后的 JSON；包不在盘上或 JSON 非法 → `undefined`。
 */
export function readLibPackageJson<T = Record<string, unknown>>(pkg: string): T | undefined {
  if (cache.has(pkg)) return cache.get(pkg) as T | undefined
  let out: unknown
  const pjPath = resolveLibPackageJsonPath(pkg)
  try {
    out = pjPath === undefined ? undefined : JSON.parse(readFileSync(pjPath, 'utf8'))
  } catch {
    out = undefined
  }
  cache.set(pkg, out)
  return out as T | undefined
}
