/**
 * check-lib-src-language — 库源码语言审计（2026-09-23，M5）
 *
 * 架构红线（docs/plans/2026-09-23-script-js-only-lib-ts-design.md）：
 * - 建模脚本必须纯 JS（经 faijs 执行，运行时不允许 TS 语法/剥离）；
 * - 库代码必须 TS：脚本可 import 的库包，src/ 必须有 .ts 源码，禁止手写 .js。
 *
 * 审计规则：可发布库包（core / cq-compat / fai_cq_gears / fai_cq_warehouse /
 * sheetmetal）的 src/ 下：.ts（含 .d.ts）≥ 1，且 .js/.mjs/.cjs = 0。
 *
 * 用法：node scripts/check-lib-src-language.mjs
 * 退出码：0 = 通过；1 = 发现违规（有包 src/ 缺失、无 .ts、或含 .js）
 */
import { readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const libPackages = ['core', 'faijs-extra', 'cq-compat', 'fai_cq_gears', 'fai_cq_warehouse', 'sheetmetal']
const jsExt = new Set(['.js', '.mjs', '.cjs'])
// vendored 测试内核目录（wasm bindgen 产物，非手写库源码；发布 tarball 白名单
// 已排除 src/，见 publish-all.ps1 的 E2 断言）。
const SKIP_DIRS = new Set(['_test-kernels'])

function walk(dir, counts) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(p, counts)
      continue
    }
    const ext = extname(p)
    if (jsExt.has(ext)) counts.js++
    else if (ext === '.ts') counts.ts++
  }
}

let failed = false
for (const pkg of libPackages) {
  const srcDir = join(repoRoot, 'packages', pkg, 'src')
  if (!statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`[check-lib-src-language] ${pkg}: missing src/ directory`)
    failed = true
    continue
  }
  const counts = { ts: 0, js: 0 }
  walk(srcDir, counts)
  if (counts.ts === 0 || counts.js > 0) {
    console.error(
      `[check-lib-src-language] ${pkg}: FAIL (.ts=${counts.ts}, .js=${counts.js}) — ` +
        'libraries must be 100% TS: at least one .ts and zero .js/.mjs/.cjs in src/',
    )
    failed = true
  } else {
    console.log(`[check-lib-src-language] ${pkg}: OK (.ts=${counts.ts}, .js=0)`)
  }
}

if (failed) {
  console.error('库源码语言审计失败：可发布库包 src/ 必须 100% TS（禁止手写 JS 发布库）')
  process.exit(1)
}
console.log('✅ 库源码语言审计通过（全部可发布库包 src/ 100% TS）')
