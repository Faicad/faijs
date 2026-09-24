/**
 * check-platform-imports — 平台 import 隔离守卫（narrowing plan Phase 8 / §1.1）
 *
 * 平台特定代码的约束（硬，§1.1）：
 *   判定「某段代码是不是平台特定代码」的唯一判据：它是否 import 了平台模块
 *   （occt-kernel/* 或 brepkit-kernel/*）。是 → 平台特定；否 → 只能用 L1，能力靠 L3 声明。
 *
 * 本脚本两条规则（Phase 8）：
 *   规则 1（平台隔离）：中立模块集合（不含 @platform 标注的文件）不得 import
 *     `occt-kernel/*` / `brepkit-kernel/*`——保护小程序 bundle（静态 import 平台模块
 *     会 404 / 拖入整个 wasm 加载链）。
 *   规则 2（平台身份自证）：标注 `@platform occt` / `@platform brepkit` 的文件，
 *     若含 defineOp 调用，必须声明对应的 `engines`（D11：import 了平台模块的 op
 *     必须把平台归属写进定义，拦截发生在执行期 dispatchPath，不依赖注册期校验）。
 *
 * 豁免（平台文件集合，不受规则 1 约束）：
 *   - 头注释带 @platform 标注的文件；
 *   - 平台模块自身的实现文件（路径含 occt-kernel/ 或 brepkit-kernel/）；
 *   - 适配器目录 brep/engine/adapters/（occt.ts / brepkit.ts / brep-mock.ts 的
 *     职责就是包装平台实例，接口完整性由 _Assert* 编译期断言兜底）。
 *
 * 用法：node scripts/check-platform-imports.mjs
 * 退出码：0 = 通过；1 = 发现违规
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLATFORM_MODULE_RE = /(?:^|\/)occt-kernel\/|(?:^|\/)brepkit-kernel\//
const PLATFORM_ANNOTATION_RE = /@platform\s+(occt|brepkit)/
const ENGINES_DECL_RE = /engines\s*:\s*\[[^\]]*['"]%ENGINE%['"]/
const DEFINE_OP_RE = /\bdefineOp\s*\(/

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

/** 用 TS AST 提取全部 import specifier（含相对路径；天然排除注释与字符串）。 */
function allImportSpecifiers(code) {
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
    if (spec) out.add(spec)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 文件是否属于豁免的平台文件集合（标注 / 平台实现 / 适配器目录 / 测试 / 平台入口）。 */
function isPlatformFile(relPath, code) {
  if (PLATFORM_ANNOTATION_RE.test(code)) return true
  if (PLATFORM_MODULE_RE.test(relPath)) return true
  if (relPath.includes('brep/engine/adapters/')) return true
  if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) return true
  // 平台装配/桥接入口：引擎聚合入口与 node 宿主（小程序 bundle 从 weapp.ts 进，
  // 不会经过这些装配点；测试替身、CLI 同理不在约束对象内）。
  if (
    [
      'packages/core/src/index.ts',
      'packages/core/src/browser.ts',
      'packages/core/src/node.ts',
      'packages/core/src/weapp.ts',
      'packages/core/src/csg.ts',
      'packages/core/src/sdf.ts',
      'packages/core/src/sdk.ts',
    ].includes(relPath)
  ) return true
  if (relPath.startsWith('packages/core/src/node-host/')) return true
  if (relPath.startsWith('packages/core/src/fcstd/')) return true
  return false
}

const violations = []
let checkedFiles = 0
let platformFiles = 0

const roots = ['packages/core/src', 'packages/faijs-extra/src']
for (const root of roots) {
  const absRoot = join(repoRoot, root)
  for (const file of collectTs(absRoot)) {
    checkedFiles++
    const rel = file
      .replace(repoRoot + '\\', '')
      .replace(repoRoot + '/', '')
      .replace(/\\/g, '/')
    const code = readFileSync(file, 'utf-8')
    const isPlatform = isPlatformFile(rel, code)
    if (isPlatform) platformFiles++

    // 规则 1：中立文件不得静态 import 平台模块。
    if (!isPlatform) {
      for (const spec of allImportSpecifiers(code)) {
        if (PLATFORM_MODULE_RE.test(spec)) {
          violations.push(`[R1] ${rel}: neutral module must not import platform module "${spec}"`)
        }
      }
    }

    // 规则 2：@platform 标注文件若有 defineOp，必须声明对应 engines。
    const ann = code.match(PLATFORM_ANNOTATION_RE)
    if (ann && DEFINE_OP_RE.test(code)) {
      const engine = ann[1]
      const expected = new RegExp(ENGINES_DECL_RE.source.replace('%ENGINE%', engine))
      if (!expected.test(code)) {
        violations.push(
          `[R2] ${rel}: @platform ${engine} file with defineOp must declare engines: ['${engine}']`
        )
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`[check-platform-imports] ${violations.length} violation(s):`)
  for (const v of violations) console.error('  ' + v)
  process.exitCode = 1
} else {
  console.log(
    `[check-platform-imports] OK — ${checkedFiles} files checked (${platformFiles} platform), no platform-import violations`
  )
}
