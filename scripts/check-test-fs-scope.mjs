#!/usr/bin/env node
/**
 * check-test-fs-scope — 测试禁止读取仓库外路径（可运行守卫）
 *
 * 背景：packages/core/src/entry-boundary.test.ts 曾直接 readFileSync 兄弟仓库
 * `../3d_editor/...` 的源码做边界守卫。faijs 与 3d_editor 并排放在开发者本地
 * 工作区时该文件存在，测试通过；CI 只 checkout faijs，文件缺失 → ENOENT，
 * 整个 suite 挂掉（GitHub run 37076464640 等）。教训：任何依赖仓库外文件的
 * 测试在 CI 上必然不可重复。
 *
 * 规则：`*.test.ts` / `*.test.tsx` 内不得出现解析到仓库外的文件路径字面量：
 *   - 相对路径穿越出仓库根（'../' 层数超过文件到仓库根的目录深度）
 *   - 绝对路径（盘符 C:/ 或 POSIX 根 /home/...、/Users/...，测试需可移植）
 * 只有通用规则，无任何具体项目名/路径点名单——点名单暗示「换名可绕」。
 * 守卫仓库内 fixture 的合法用法（import.meta.url + path.resolve 进仓库内）不命中。
 *
 * Run: node scripts/check-test-fs-scope.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SKIP_DIRS = new Set([
  'node_modules', 'node_modules.bak', 'dist', '.git', 'coverage', '_test-kernels',
  'test-results', 'playwright-report', '.atomcode', '.agents',
])
const TEST_RE = /\.test\.(ts|tsx|mts|js|mjs|jsx)$/

const violations = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full)
    } else if (TEST_RE.test(name)) {
      checkFile(full)
    }
  }
}

// src/foo/bar.test.ts → 源文件目录深度（从仓库根算），用于模拟相对路径解析
function srcDepth(file) {
  return relative(ROOT, file).split(sep).length - 1
}

function checkFile(file) {
  const rel = relative(ROOT, file)
  let src
  try {
    src = readFileSync(file, 'utf-8')
  } catch {
    return
  }
  const lines = src.split('\n')
  lines.forEach((rawLine, i) => {
    const n = i + 1
    const trimmed = rawLine.trim()
    // Whole-line comments (// and block-comment body lines) are narrative, not
    // code — provenance notes like "measured with cadquery at C:\..." live
    // there. Scan code lines only.
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return
    }
    // Strip trailing line comments after actual code.
    const line = rawLine.replace(/(^|[^:'"`])\/\/.*$/, '$1')
    // 1) 绝对路径（Windows 盘符 / POSIX 根）——测试必须可移植
    if (/(?:'[^']*'|"[^"]*"|`[^`]*`)/.test(line)) {
      const absWin = line.match(/['"`](?:[A-Za-z]:[\\/][^'"`]*)['"`]/)
      if (absWin) {
        violations.push(`${rel}:${n} absolute Windows path in test: ${absWin[0].trim()}`)
        return
      }
      const absPosix = line.match(/['"`](\/(?:home|Users|root|tmp|var|opt)\/[^'"`]*)['"`]/)
      if (absPosix) {
        violations.push(`${rel}:${n} absolute POSIX path in test: ${absPosix[0].trim()}`)
        return
      }
    }
    // 2) 相对路径字面量里连续 ../ 穿越层数 > 所在文件到仓库根的深度 → 解析出仓库外
    //    （恰好 == 深度是回到仓库根的合法用法，如 import.meta.url 定位 repo root）
    const dots = line.match(/['"`]((?:\.\.\/)+[^'"`]*)['"`]/)
    if (dots) {
      const ups = (dots[1].match(/\.\.\//g) || []).length
      if (ups > srcDepth(file)) {
        violations.push(
          `${rel}:${n} relative path escapes repo root (${ups} ../ from depth ${srcDepth(file)}): '${dots[1]}'`,
        )
      }
    }
  })
}

walk(ROOT)

if (violations.length > 0) {
  console.error(`check-test-fs-scope: ${violations.length} violation(s) — tests must not read paths outside the repo`)
  for (const v of violations) console.error('  ' + v)
  console.error('')
  console.error('Rule: a test that needs a sibling-repo file is unrepeatable on CI')
  console.error('(faijs is checked out alone). Move the guard into the sibling repo,')
  console.error('or copy the fixture into this repo (e.g. packages/fixtures/data/).')
  process.exit(1)
}
console.log('check-test-fs-scope: OK (no test reads outside the repo)')
