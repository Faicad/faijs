/**
 * check-ghost-deps — 幽灵依赖守卫（替代 eslint-plugin-import，后者 peer 仅支持 eslint ≤9，
 * 与项目 eslint 10 冲突——monorepo-plan §2.5 的偏离，汇报注明）。
 *
 * 对每个 workspace 包：用 TypeScript AST 扫描其 src 下所有 TS 文件的裸导入 specifier
 * （import 语句 / import() 表达式 / export-from，天然排除注释与字符串内的 import 字样），
 * 校验声明在包自己的 dependencies / devDependencies / peerDependencies 中。
 * workspace 内部包（@faicad/*）放行（靠 workspace 链接 + 包图无环守卫，不经 registry）。
 *
 * 用法：node scripts/check-ghost-deps.mjs
 * 退出码：0 = 通过；1 = 发现幽灵依赖
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import * as ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'))
const BUILTIN = new Set(builtinModules)

/** 收集目录下所有 .ts 文件（不含 node_modules/dist） */
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

/** 用 TS AST 提取裸导入 specifier（相对/绝对/node:/http 排除） */
function bareSpecifiers(code) {
  const out = new Set()
  const sf = ts.createSourceFile('probe.ts', code, ts.ScriptTarget.ES2022, true)
  const visit = (node) => {
    let spec
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      spec = node.moduleSpecifier.text
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      spec = node.arguments[0].text
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      spec = node.moduleSpecifier.text
    }
    if (spec) {
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('http')) return
      const parts = spec.split('/')
      const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
      if (BUILTIN.has(name)) return // node 内置模块（fs/path/url/...）
      out.add(name)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const violations = []
let checkedFiles = 0

for (const ws of rootPkg.workspaces ?? []) {
  const pkgDir = join(repoRoot, ws)
  const pkgFile = join(pkgDir, 'package.json')
  if (!existsSync(pkgFile)) continue
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'))
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ])
  const files = collectTs(join(pkgDir, 'src'))
  for (const file of files) {
    checkedFiles++
    const code = readFileSync(file, 'utf-8')
    for (const spec of bareSpecifiers(code)) {
      if (spec.startsWith('@faicad/')) continue // workspace 内部链接
      if (!declared.has(spec)) {
        violations.push(`${file}: imports "${spec}" not declared in ${pkg.name} package.json`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`[check-ghost-deps] ${violations.length} ghost dependency(ies):`)
  for (const v of violations) console.error('  ' + v)
  process.exitCode = 1
} else {
  console.log(`[check-ghost-deps] OK — ${checkedFiles} files checked, no ghost dependencies`)
}
