#!/usr/bin/env node
/**
 * check-core-no-brepjs — core-decouple wrapup §4.1 归零守卫
 *
 * brepjs 剥离收尾后：monorepo 内不得再出现可发布包名 `@faicad/faijs-brepjs`
 * 或物理路径 `packages/brepjs`（依赖即失败）。范围：
 *   - 各包 package.json（name/dependencies/peerDependencies/devDependencies/scripts）
 *   - 各包 src/（import 说明符与字符串字面量）
 *   - scripts/（构建/发布/门禁通道，含 ci.ps1 / ci.sh / publish-all.ps1）
 *   - cdn/（importmap / versions）
 *   - 根 package.json
 * 排除：node_modules / dist / docs / .agents/notes（文档与决策记录的叙述性提及
 * 不构成依赖）。守卫自身以拆分写法引用目标字样，避免自命中。
 *
 * Run: node scripts/check-core-no-brepjs.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'

const TARGET_A = '@faicad/faijs-' + 'brepjs' // 可发布包名
const TARGET_B = 'packages' + sep + 'brepjs' // 物理路径（含反斜杠变体）
const TARGET_C = 'packages/brepjs' // POSIX 路径（Windows 分隔符处理）
const ROOT = resolve('.')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'docs', '.agents', '.git'])
const SKIP_FILES = new Set([
  // 守卫自身（目标字样以拆分写法出现，但跳过最稳妥）
  'check-core-no-brepjs.mjs',
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walk(p, out)
    } else if (isTargetFile(p)) {
      out.push(p)
    }
  }
  return out
}

/** 扫描范围：package.json、各包 src/、scripts/、cdn/ 下的文本文件。 */
function isTargetFile(p) {
  const rel = relative(ROOT, p)
  if (rel.startsWith('packages' + sep)) {
    const parts = rel.split(sep)
    if (parts.length >= 3) {
      const pkgDir = parts[1]
      if (pkgDir === 'brepjs') return false // 目标包本身不在扫描范围（守卫等它被删除）
      const sub = parts[2]
      if (sub === 'src') return true
    }
    return parts[parts.length - 1] === 'package.json'
  }
  if (rel.startsWith('scripts' + sep)) {
    return /\.(mjs|js|ps1|sh|ts)$/.test(p)
  }
  if (rel.startsWith('cdn' + sep)) {
    return /\.(json|mjs)$/.test(p)
  }
  return rel === 'package.json'
}

function check(text, label) {
  // 叙述性提及（// 或 * 注释行）不构成依赖——只扫代码行（import/字符串字面量/配置值）。
  const codeLines = text.split(/\r?\n/).filter((l) => {
    const t = l.trimStart()
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/**')
  })
  const code = codeLines.join('\n')
  if (code.includes(TARGET_A)) return `${label}: 命中包名 ${TARGET_A}`
  if (code.includes(TARGET_C)) return `${label}: 命中路径 ${TARGET_C}`
  if (code.includes(TARGET_B)) return `${label}: 命中路径 ${TARGET_B}`
  return null
}

function main() {
  const files = walk(ROOT)
  const offenders = []
  for (const f of files) {
    const name = f.split(sep).pop()
    if (SKIP_FILES.has(name)) continue
    const text = readFileSync(f, 'utf-8')
    const hit = check(text, relative(ROOT, f))
    if (hit) offenders.push(hit)
  }
  if (offenders.length > 0) {
    console.error('check-core-no-brepjs: brepjs 依赖未归零：')
    for (const o of offenders) console.error(`  ✗ ${o}`)
    console.error('规则：docs/plans/2026-09-25-core-decouple-brepjs-wrapup.md §4.1')
    process.exit(1)
  }
  console.log(`check-core-no-brepjs: 通过（${files.length} 个文件零 brepjs 依赖）。`)
}

main()
