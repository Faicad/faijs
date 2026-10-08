/**
 * check-facade — 门面与子路径守卫（facade-refactor 2026-10-08 §3.5）
 *
 * 三项检查：
 * 1. 门面文件（index.ts / browser.ts / weapp.ts）只允许 re-export
 *    （`export *` / `export { } from` / `export type { } from`），
 *    禁止定义新签名（`export function` / `export class` / `export const` 等）。
 * 2. package.json exports 不允许新增 wildcard `./<x>/*`（`./api/*` 例外）。
 * 3. 不存在同名 `createRuntime` 在不同文件中定义（签名分叉检测）。
 *
 * 用法：node scripts/check-facade.mjs
 * 退出码：0 = 通过；1 = 发现违规
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const coreSrc = join(repoRoot, 'packages/core/src')
let failed = false

function fail(msg) {
  console.error(`[check-facade] FAIL: ${msg}`)
  failed = true
}

// ── 1. 门面文件只允许 re-export ──

const FACADE_FILES = ['index.ts', 'browser.ts', 'weapp.ts']
// Patterns that indicate new signature definitions (not re-exports)
const FORBIDDEN_EXPORT_PATTERNS = [
  /^\s*export\s+function\s/m,
  /^\s*export\s+class\s/m,
  /^\s*export\s+const\s/m,
  /^\s*export\s+let\s/m,
  /^\s*export\s+enum\s/m,
  /^\s*export\s+interface\s/m,
  /^\s*export\s+abstract\s/m,
]

for (const file of FACADE_FILES) {
  const filePath = join(coreSrc, file)
  if (!existsSync(filePath)) continue
  const src = readFileSync(filePath, 'utf-8')
  for (const pattern of FORBIDDEN_EXPORT_PATTERNS) {
    const match = src.match(pattern)
    if (match) {
      const lineNum = src.substring(0, match.index).split('\n').length
      fail(`${file}:${lineNum} — facade file defines a new signature (${match[0].trim()}). Facade files must only re-export.`)
    }
  }
}

// ── 2. package.json 不允许新增 wildcard ──

const pkgPath = join(coreSrc, '../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const exports = pkg.exports || {}

// Allowed wildcards (api/ grows frequently, explicitly permitted)
const ALLOWED_WILDCARDS = new Set(['./api/*'])

for (const key of Object.keys(exports)) {
  if (key.includes('*') && !ALLOWED_WILDCARDS.has(key)) {
    fail(`package.json exports has wildcard "${key}" — use explicit enumeration instead (only ${[...ALLOWED_WILDCARDS].join(', ')} are permitted).`)
  }
}

// ── 3. 同名 createRuntime 签名分叉检测 ──

/** Collect all .ts files under a directory (excluding node_modules/dist) */
function collectTs(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectTs(full, out)
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

const tsFiles = collectTs(coreSrc)
const createRuntimeFiles = []

for (const file of tsFiles) {
  const src = readFileSync(file, 'utf-8')
  // Match `export function createRuntime` (not re-export)
  if (/^\s*export\s+function\s+createRuntime\s*\(/m.test(src)) {
    const rel = file.replace(coreSrc + '/', '').replace(/\\/g, '/')
    createRuntimeFiles.push(rel)
  }
}

if (createRuntimeFiles.length > 1) {
  fail(`Multiple files define \`export function createRuntime\` — same-name export must have a single implementation: ${createRuntimeFiles.join(', ')}`)
}

// Also check for createRuntimeWithCad pattern (deleted file name should not reappear)
for (const file of tsFiles) {
  const src = readFileSync(file, 'utf-8')
  if (/createRuntimeWithCad/.test(src) && !file.endsWith('.test.ts')) {
    const rel = file.replace(coreSrc + '/', '').replace(/\\/g, '/')
    // Allow references in comments (check if it's in a comment line)
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Skip comment lines
      if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) continue
      if (/createRuntimeWithCad/.test(line)) {
        fail(`${rel}:${i + 1} — reference to \`createRuntimeWithCad\` found (deleted in facade-refactor). Use \`createRuntime\` from \`cad-runtime/runtime\` instead.`)
      }
    }
  }
}

if (failed) {
  console.error('[check-facade] Violations found. See above.')
  process.exit(1)
} else {
  console.log('[check-facade] All checks passed.')
  process.exit(0)
}
