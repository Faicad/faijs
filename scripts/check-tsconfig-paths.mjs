#!/usr/bin/env node
/**
 * check-tsconfig-paths — tsconfig paths 完整性守卫
 *
 * 背景：packages/cq-compat-compare 的源码 import `@faicad/faijs-sketch`，
 * 但其 tsconfig 的 paths 没有该包名映射。本地 tsc 静默退回 node_modules →
 * workspace 链接 → packages/sketch/dist（本地已构建的旧产物）所以通过；
 * CI 的 fresh checkout 无 dist，typecheck 报 TS2307（GitHub run 37125314076）。
 *
 * 规则：每个 workspace 包的 src/ 里出现的每个 `@faicad/<name>`（裸名或子路径）
 * import，其包名（`@faicad/<name>` 前缀）必须满足其一：
 *   1. 该包 tsconfig.json paths 有对应映射键（精确键或 `@faicad/<name>/*` 通配键）
 *   2. 该 tsconfig 显式 extends 了覆盖该键的父配置（沿 extends 链逐层检查）
 *   3. 该包名是自引用（本包 name）
 * 只检查 @faicad/* 内部包名——npm 外部依赖由 check-ghost-deps.mjs 负责。
 *
 * Run: node scripts/check-tsconfig-paths.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SKIP_DIRS = new Set([
  'node_modules', 'node_modules.bak', 'dist', '.git', 'coverage',
  '_test-kernels', 'test-results', 'playwright-report',
])
const IMPORT_RE = /from\s+['"](@faicad\/[^'"]+)['"]|import\(\s*['"](@faicad\/[^'"]+)['"]\s*\)|import\s+['"](@faicad\/[^'"]+)['"]/g

const violations = []

// 全部 workspace 包名（用于区分真实内部依赖与运行时虚拟库/外部包）
const workspaceNames = new Set()

function collectWorkspaceNames() {
  const wsRoot = join(ROOT, 'packages')
  for (const name of readdirSync(wsRoot)) {
    const pkgJsonPath = join(wsRoot, name, 'package.json')
    if (!existsSync(pkgJsonPath)) continue
    try {
      const n = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).name
      if (n) workspaceNames.add(n)
    } catch { /* skip */ }
  }
}
collectWorkspaceNames()

// 解析 tsconfig extends 链，收集全部 paths 键（子配置覆盖父配置）。
// 用 ts.readConfigFile——原生处理 JSONC（注释/尾逗号），手写剥离正则会误伤。
function loadPathsKeys(tsconfigPath, seen = new Set()) {
  if (seen.has(tsconfigPath) || !existsSync(tsconfigPath)) return new Set()
  seen.add(tsconfigPath)
  const keys = new Set()
  const parsed = ts.readConfigFile(tsconfigPath, (p) => readFileSync(p, 'utf-8'))
  if (parsed.error) {
    console.error(`check-tsconfig-paths: cannot parse ${relative(ROOT, tsconfigPath)}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`)
    process.exit(1)
  }
  const cfg = parsed.config
  if (cfg.compilerOptions?.paths) {
    for (const k of Object.keys(cfg.compilerOptions.paths)) keys.add(k)
  }
  if (cfg.extends) {
    const parent = resolve(tsconfigPath, '..', cfg.extends)
    for (const k of loadPathsKeys(parent, seen)) keys.add(k)
  }
  return keys
}

// 包名前缀提取：'@faicad/faijs/io/zip' → '@faicad/faijs'（scope 内两段）
function packageName(specifier) {
  const parts = specifier.split('/')
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]
}

// '@faicad/faijs/io/zip' 是否被 paths 键集合覆盖：精确匹配，或通配键前缀匹配
function coveredByKeys(specifier, keys) {
  if (keys.has(specifier)) return true
  const pkg = packageName(specifier)
  if (keys.has(pkg)) return true
  // 'pkg/sub' 也可能被 'pkg/*' 覆盖（bundler 解析的常见形态）
  if (keys.has(`${pkg}/*`)) return true
  // 子路径也可能有独立通配：'@faicad/faijs/io/*' 等
  for (const k of keys) {
    if (k.endsWith('/*')) {
      const base = k.slice(0, -2)
      if (specifier === base || specifier.startsWith(base + '/')) return true
    }
  }
  return false
}

function walkSrc(srcDir, pkgName, keys, pkgRel) {
  let entries
  try {
    entries = readdirSync(srcDir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(srcDir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walkSrc(full, pkgName, keys, pkgRel)
    } else if (/\.(ts|tsx|mts|cts)$/.test(name)) {
      let src
      try {
        src = readFileSync(full, 'utf-8')
      } catch {
        continue
      }
      const lines = src.split('\n')
      for (const rawLine of lines) {
        const trimmed = rawLine.trim()
        // 注释行是叙述不是依赖（含 JSDoc 体 * 行与 // 行）
        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
        for (const m of rawLine.matchAll(IMPORT_RE)) {
          const specifier = m[1] || m[2] || m[3]
          const pkg = packageName(specifier)
          // 非 workspace 包名（运行时虚拟库如 gear-demo、外部包）不归本守卫管
          if (!workspaceNames.has(pkg)) continue
          // 自引用与已覆盖者放行
          if (pkg === pkgName) continue
          if (coveredByKeys(specifier, keys)) continue
          const rel = relative(ROOT, full)
          violations.push(
            `${rel}: imports '${specifier}' but ${pkgRel}/tsconfig.json paths has no mapping for '${pkg}'` +
            ` (tsc silently falls back to node_modules dist — passes locally with a stale build, fails TS2307 on CI)`,
          )
        }
      }
    }
  }
}

// 遍历每个 workspace 包（有自己 tsconfig.json + src/ 的目录）
for (const name of readdirSync(join(ROOT, 'packages'))) {
  const pkgDir = join(ROOT, 'packages', name)
  const tsconfigPath = join(pkgDir, 'tsconfig.json')
  if (!statSync(pkgDir).isDirectory() || SKIP_DIRS.has(name)) continue
  if (!existsSync(tsconfigPath)) continue
  let pkgName = name
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (existsSync(pkgJsonPath)) {
    try {
      pkgName = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).name || name
    } catch { /* keep dir name */ }
  }
  const keys = loadPathsKeys(tsconfigPath)
  walkSrc(join(pkgDir, 'src'), pkgName, keys, `packages/${name}`)
}

if (violations.length > 0) {
  console.error(`check-tsconfig-paths: ${violations.length} violation(s)`)
  for (const v of violations) console.error('  ' + v)
  console.error('')
  console.error('Rule: every @faicad/* import in a package must have an explicit')
  console.error('tsconfig paths mapping to live source (or extends a config that does).')
  console.error('Without it tsc resolves through node_modules -> dist, which hides')
  console.error('breakage locally and fails TS2307 on a fresh CI checkout.')
  process.exit(1)
}
console.log('check-tsconfig-paths: OK (all @faicad/* imports have tsconfig paths mappings)')
