/**
 * check-dep-lockstep — @faicad/* 依赖 lockstep 守卫。
 *
 * 背景（2026-09 bug）：fai_cq_gears 自身已 bump 到 0.16.x，但其 dependencies 里
 * "@faicad/cq-compat": "^0.14.0" 漏改，导致 CDN 构建解析出旧 cq-compat@0.14.1，
 * 其内部 pin 的旧 @faicad/faijs 使包图断裂。publish-all 的版本一致性检查只看
 * 各包自身 version，不看互相的依赖 range，漏网。
 *
 * 规则：对所有可发布（非 private）的 @faicad/* 包，凡以 registry semver range
 * （dependencies / peerDependencies）声明的 @faicad/* 依赖：
 *   - `file:` / `workspace:` 协议的本地引用跳过（不经 registry）；
 *   - 目标包在本仓库内且可发布时，range 必须等于 `^<目标 major.minor>.0`
 *     （如目标 0.16.1 → 只允许 "^0.16.0"）。任何指向旧版本线的 range 都判失败。
 *
 * 用法：node scripts/check-dep-lockstep.mjs
 * 退出码：0 = 通过；1 = 发现违反 lockstep 的依赖声明
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(repoRoot, 'packages')

// 与 gen-importmap.mjs 的排除口径一致：不发布 / 非引擎包。
const EXCLUDE = new Set([
  '@faicad/faijs-fixtures',
  '@faicad/faijs-tests',
  '@faicad/faijs-demo',
])

// 收集可发布的 @faicad/* 包：name → { version, dir }
const publishable = new Map()
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pjPath = join(packagesDir, entry.name, 'package.json')
  if (!existsSync(pjPath)) continue
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'))
  if (!pj.name || !pj.name.startsWith('@faicad/')) continue
  if (pj.private === true) continue
  if (EXCLUDE.has(pj.name)) continue
  publishable.set(pj.name, { version: String(pj.version ?? ''), dir: entry.name })
}

if (publishable.size === 0) {
  console.error('[check-dep-lockstep] no publishable @faicad/* packages found')
  process.exit(1)
}

/** 目标包版本 → 允许的唯一 range，如 0.16.1 → "^0.16.0" */
function expectedRange(depVersion) {
  const m = depVersion.match(/^(\d+)\.(\d+)\./)
  if (!m) return null
  return `^${m[1]}.${m[2]}.0`
}

// 本地路径协议：不经 registry，lockstep 不适用
const LOCAL_PROTOCOLS = ['file:', 'workspace:', 'link:']

const violations = []
for (const [name, info] of publishable) {
  const pj = JSON.parse(readFileSync(join(packagesDir, info.dir, 'package.json'), 'utf8'))
  for (const section of ['dependencies', 'peerDependencies']) {
    const deps = pj[section] ?? {}
    for (const [dep, range] of Object.entries(deps)) {
      if (!dep.startsWith('@faicad/')) continue
      if (typeof range !== 'string') continue
      if (LOCAL_PROTOCOLS.some((p) => range.startsWith(p))) continue
      const target = publishable.get(dep)
      if (!target) continue // 目标不在可发布集内（或外部包），不约束
      const expected = expectedRange(target.version)
      if (!expected) {
        violations.push(`${name} -> ${dep} (${section}): cannot derive expected range from target version "${target.version}"`)
        continue
      }
      if (range !== expected) {
        violations.push(
          `${name} (${info.version}) -> ${dep} (${section}): "${range}" but ${dep} is ${target.version}; expected "${expected}"` +
            ` — bump the dep range when bumping ${dep} (CDN build would resolve a stale ${dep})`
        )
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`[check-dep-lockstep] ${violations.length} violation(s):`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log(`[check-dep-lockstep] OK — ${publishable.size} publishable packages, all @faicad/* dep ranges on current lockstep line`)
