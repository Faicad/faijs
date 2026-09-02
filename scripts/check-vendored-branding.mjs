#!/usr/bin/env node
/**
 * check-vendored-branding — U8 包名零 brepjs 守卫（P10 基线锁定，方案 E6）
 *
 * 目标：用户可见的任何字符串——import 子路径、package.json、运行时报错、
 * 导出产物内容、vendored 源码里的字符串字面量——不得出现 `brepjs`。
 * 物理目录名 `packages/core/src/vendored/brepjs/` 不触犯守卫（只查字符串字面量
 * 与包名，不查路径段）；NOTICE 与 `UPSTREAM:` 注释是升级追踪白名单。
 *
 * 四条断言（E6 表格）：
 *   A1  vendored 源码 + core dist 的字符串字面量零 `brepjs`（白名单见下）；
 *   A2  core 包 package.json 的 exports 键零 `brepjs`；
 *   A3  各包 package.json 的 name/dependencies/peerDependencies 零 `brepjs`；
 *   A4  各包 src 下 import 说明符零 `brepjs`（vendored 树内相对导入除外——
 *       目录名是构建期实现细节，且字符串比较天然放行非 `brepjs` 段）。
 *
 * 白名单（A1）：NOTICE 文件本身；`UPSTREAM:` 开头的注释行（升级追踪标注）。
 *
 * 运行：node scripts/check-vendored-branding.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'

const ROOT = resolve('.')

// ── 工具 ──

function walk(dir, extRe, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, extRe, out)
    else if (extRe.test(name)) out.push(p)
  }
  return out
}

/** 剥离注释（行注释与块注释，字符串内不受影响），再提取字符串字面量。 */
function stringLiterals(code) {
  // 1) 逐字符剥离注释，保留字符串本体
  let cleaned = ''
  let i = 0
  const n = code.length
  while (i < n) {
    const c = code[i]
    const d = code[i + 1]
    if (c === "'" || c === '"' || c === '`') {
      // 拷贝到配对的闭引号（处理转义）
      let j = i + 1
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue }
        if (code[j] === c) break
        j++
      }
      cleaned += code.slice(i, Math.min(j + 1, n))
      i = j + 1
      continue
    }
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++
      cleaned += '\n'
      continue
    }
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++
      i += 2
      cleaned += '  '
      continue
    }
    cleaned += c
    i++
  }
  // 2) 提取含 brepjs 的字符串字面量
  const hits = []
  const re = /(['"`])([^'"`]*brepjs[^'"`]*)\1/g
  let m
  while ((m = re.exec(cleaned)) !== null) hits.push(m[2])
  return hits
}

// ── 断言 ──

const errors = []
function fail(msg) { errors.push(msg) }

// A1：vendored 源码 + core dist 字符串字面量零 brepjs
{
  const roots = [resolve('packages/core/src/vendored/brepjs')]
  if (existsSync(resolve('packages/core/dist'))) roots.push(resolve('packages/core/dist'))
  const files = []
  for (const r of roots) files.push(...walk(r, /\.(ts|js|mjs|mts)$/))
  const offenders = new Set() // 同文件多字面量合并报告
  for (const f of files) {
    const rel = relative(ROOT, f)
    const isVendoredSrc = rel.includes(`${sep}vendored${sep}brepjs${sep}`) && !rel.includes(`${sep}dist${sep}`)
    const code = readFileSync(f, 'utf-8')
    for (const lit of stringLiterals(code)) {
      // 白名单：NOTICE 内容随文件头注释（不含字面量）；UPSTREAM: 注释已剥离。
      // 字符串字面量本身无白名单——出现即违规。
      offenders.add(rel)
    }
  }
  if (offenders.size > 0) {
    fail(`A1 字符串字面量含 brepjs（${offenders.size} 个文件）:\n    ${[...offenders].join('\n    ')}`)
  }
}

// A2：core package.json exports 键零 brepjs
{
  const pkg = JSON.parse(readFileSync(resolve('packages/core/package.json'), 'utf-8'))
  const keys = Object.keys(pkg.exports ?? {})
  const bad = keys.filter((k) => k.includes('brepjs'))
  if (bad.length > 0) fail(`A2 core exports 键含 brepjs: ${bad.join(', ')}`)
}

// A3：packages/*/package.json 的 name/deps/peerDeps 零 brepjs
{
  const roots = ['packages', 'packages/*']
  const pkgFiles = walk(resolve('packages'), /package\.json$/)
    .filter((f) => relative(resolve('packages'), f).split(sep).length === 2) // 仅一层深
  for (const f of pkgFiles) {
    const pkg = JSON.parse(readFileSync(f, 'utf-8'))
    const probe = [
      pkg.name ?? '',
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]
    const bad = probe.filter((s) => s.includes('brepjs'))
    if (bad.length > 0) fail(`A3 ${relative(ROOT, f)} 含 brepjs 依赖/名称: ${bad.join(', ')}`)
  }
}

// A4：packages/*/src/** import 说明符零 brepjs（除 vendored 树内相对导入）
{
  const srcDirs = []
  for (const pkg of ['core', 'mech-lib', 'sheetmetal', 'tests', 'fixtures', 'demo']) {
    const d = resolve(`packages/${pkg}/src`)
    if (existsSync(d)) srcDirs.push(d)
  }
  const re = /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g
  const offenders = new Set()
  for (const dir of srcDirs) {
    for (const f of walk(dir, /\.(ts|mts)$/)) {
      const rel = relative(ROOT, f)
      if (rel.includes(`${sep}vendored${sep}`)) continue // vendored 树内相对导入
      const code = readFileSync(f, 'utf-8')
      let m
      while ((m = re.exec(code)) !== null) {
        const spec = m[1]
        if (spec.includes('brepjs')) offenders.add(`${rel}: ${spec}`)
      }
    }
  }
  if (offenders.size > 0) {
    fail(`A4 import 说明符含 brepjs（${offenders.size} 处）:\n    ${[...offenders].join('\n    ')}`)
  }
}

// ── 出口 ──
if (errors.length > 0) {
  console.error('check-vendored-branding: U8 品牌守卫失败：')
  for (const e of errors) console.error(`  ✗ ${e}`)
  console.error('规则：docs/plans/2026-09-02-faijs-api-surface-completion.md §E6（U8）')
  process.exit(1)
}
console.log('check-vendored-branding: 通过（用户可见面零 brepjs）。')
