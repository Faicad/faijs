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
import ts from 'typescript'

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

/**
 * 提取字符串字面量文本（供 A1 检查）。用 TypeScript AST 而非手写词法：
 *  - 注释天然被排除（A1 白名单的 UPSTREAM 标注在注释里，本来就不该算字面量）；
 *  - 模板字符串的 `${...}` 插值、嵌套反引号、转义由 TS 解析器精确处理，
 *    不会像手写扫描那样把插值表达式/注释误当字符串内容；
 *  - 返回每个字符串字面量解码后的文本（不含引号/反引号）。
 */
function stringLiterals(code) {
  const hits = []
  const sf = ts.createSourceFile('_t.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      hits.push(node.text)
    } else if (ts.isTemplateExpression(node)) {
      // 插值外的文本片段（head + 每段 literal）；插值表达式自身会被 visit 继续遍历
      hits.push(node.head.text)
      for (const span of node.templateSpans) hits.push(span.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

// ── 断言 ──

const errors = []
function fail(msg) { errors.push(msg) }

/**
 * 迁移豁免登记（P15/P16 前过渡态，迁移完成后删除对应条目）：
 *  - sheetmetal/src/compat.ts —— P15（E8）删除 compat.ts 后移除；
 *  - gear-lib-demo/src/brepjs-gear* / c3-brepjs-scenario —— P16（E9）gear-lib-demo 迁 L3 后移除。
 * 守卫对这些文件跳过 A3/A4 检查；文件名本身含 brepjs 属于 P16 重命名范围。
 */
const MIGRATION_EXEMPT = [
  'packages/sheetmetal/src/compat.ts',
  'packages/gear-lib-demo/package.json',
  'packages/gear-lib-demo/src/brepjs-gear.ts',
  'packages/gear-lib-demo/src/brepjs-gear.test.ts',
  'packages/gear-lib-demo/src/c3-brepjs-scenario.test.ts',
]
function isExempt(rel) {
  const norm = rel.split(sep).join('/')
  return MIGRATION_EXEMPT.some((p) => norm === p || norm.startsWith(p + '/'))
}
/** 相对导入说明符（./ ../ 开头）中的 brepjs 是物理目录名（§3.3 目录名保留合法），放行。 */
function isRelativeSpec(spec) {
  return spec.startsWith('./') || spec.startsWith('../')
}

/**
 * Q5-A 品牌名豁免（2026-09-07）：`brepjsCompat` 命名空间与 `brepjs-compat` 子路径
 * 是有意为之的品牌名（方案 §11.2 Q5 裁决 A），不是泄露。守卫放行这些特定形式。
 * 规则：docs/plans/2026-09-07-compat-surface-unified-projection.md §11.2 Q5
 */
const BRAND_WHITELIST = [
  'brepjsCompat',           // 顶层命名空间导出名
  'brepjs-compat',          // 子路径段
  '@faicad/faijs/brepjs-compat', // 完整子路径
  'api/brepjs-compat',      // core exports 键
  './api/brepjs-compat',    // core exports 键（带前缀）
]
function isBrandWhitelisted(s) {
  // Exact match or the string contains the brand name as a path/identifier segment
  return BRAND_WHITELIST.some((w) =>
    s === w ||
    s === `@faicad/faijs/${w}` ||
    s.endsWith(`/${w}`) ||
    s.includes(`brepjs-compat`) || // covers [faijs/brepjs-compat] error prefixes etc.
    s.includes(`brepjsCompat`),    // covers namespace references in generated code
  )
}

// A1：vendored 源码 + core dist 字符串字面量零 brepjs
{
  const roots = [resolve('packages/core/src/vendored/brepjs'), resolve('packages/core/src/api/brepjs-compat')]
  if (existsSync(resolve('packages/core/dist'))) roots.push(resolve('packages/core/dist'))
  const files = []
  for (const r of roots) files.push(...walk(r, /\.(ts|js|mjs|mts)$/))
  const offenders = new Set() // 同文件多字面量合并报告
  for (const f of files) {
    const rel = relative(ROOT, f)
    const code = readFileSync(f, 'utf-8')
    for (const lit of stringLiterals(code)) {
      // 白名单：NOTICE 内容随文件头注释（不含字面量）；UPSTREAM: 注释已剥离。
      // 相对导入路径段（./ ../）是物理目录名，目录名保留合法（§3.3）——放行；
      // Q5-A 品牌名豁免：brepjsCompat / brepjs-compat 是有意为之的品牌名；
      // 其余字符串字面量含 brepjs 即违规。
      if (!lit.includes('brepjs')) continue
      if (isRelativeSpec(lit.trimStart())) continue
      if (isBrandWhitelisted(lit.trim())) continue
      offenders.add(rel)
    }
  }
  if (offenders.size > 0) {
    fail(`A1 字符串字面量含 brepjs（${offenders.size} 个文件）:\n    ${[...offenders].join('\n    ')}`)
  }
}

// A2：core package.json exports 键零 brepjs（Q5-A 品牌豁免：api/brepjs-compat）
{
  const pkg = JSON.parse(readFileSync(resolve('packages/core/package.json'), 'utf-8'))
  const keys = Object.keys(pkg.exports ?? {})
  const bad = keys.filter((k) => k.includes('brepjs') && !isBrandWhitelisted(k))
  if (bad.length > 0) fail(`A2 core exports 键含 brepjs: ${bad.join(', ')}`)
}

// A3：packages/*/package.json 的 name/deps/peerDeps 零 brepjs
{
  const roots = ['packages', 'packages/*']
  const pkgFiles = walk(resolve('packages'), /package\.json$/)
    .filter((f) => relative(resolve('packages'), f).split(sep).length === 2) // 仅一层深
  for (const f of pkgFiles) {
    const rel = relative(ROOT, f)
    if (isExempt(rel)) continue // 迁移豁免登记（P15/P16 后移除）
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
  for (const pkg of ['core', 'gear-lib-demo', 'sheetmetal', 'tests', 'fixtures', 'demo']) {
    const d = resolve(`packages/${pkg}/src`)
    if (existsSync(d)) srcDirs.push(d)
  }
  const re = /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g
  const offenders = new Set()
  for (const dir of srcDirs) {
    for (const f of walk(dir, /\.(ts|mts)$/)) {
      const rel = relative(ROOT, f)
      if (isExempt(rel)) continue // 迁移豁免登记（P15/P16 后移除）
      if (rel.includes(`${sep}vendored${sep}`)) continue // vendored 树内相对导入
      const code = readFileSync(f, 'utf-8')
      let m
      while ((m = re.exec(code)) !== null) {
        const spec = m[1]
        // 相对导入路径段（./ ../）= 物理目录名（§3.3 保留合法，如 api/ 层反向依赖 vendored）——放行
        if (isRelativeSpec(spec)) continue
        if (isBrandWhitelisted(spec)) continue // Q5-A 品牌豁免
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
