/**
 * check-workspaces-order — workspaces 数组顺序断言（§2.4）。
 *
 * npm 的 `npm run --workspaces` 严格按根 package.json 的 workspaces 数组顺序执行，
 * 不做拓扑排序——数组顺序即构建顺序。本脚本断言：若包 A 的依赖声明引用了包 B
 * （B 是 workspace 成员），则 A 必须排在 B 之后。
 *
 * 用法：node scripts/check-workspaces-order.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'))
const workspaces = rootPkg.workspaces ?? []

// workspace 目录 → 包名
const nameByDir = new Map()
for (const ws of workspaces) {
  const pkgFile = join(repoRoot, ws, 'package.json')
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'))
    nameByDir.set(ws, pkg.name)
  }
}

// 包名 → 数组下标
const indexByName = new Map([...nameByDir.values()].map((n, i) => [n, i]))

const violations = []
for (let i = 0; i < workspaces.length; i++) {
  const ws = workspaces[i]
  const pkgFile = join(repoRoot, ws, 'package.json')
  if (!existsSync(pkgFile)) continue
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
  for (const dep of Object.keys(deps)) {
    const depIdx = indexByName.get(dep)
    if (depIdx !== undefined && depIdx > i) {
      violations.push(`${pkg.name} (index ${i}) depends on ${dep} (index ${depIdx}) — reorder workspaces array`)
    }
  }
}

if (violations.length > 0) {
  console.error(`[check-workspaces-order] ${violations.length} ordering violation(s):`)
  for (const v of violations) console.error('  ' + v)
  process.exitCode = 1
} else {
  console.log(`[check-workspaces-order] OK — ${workspaces.length} workspaces in dependency order`)
}
