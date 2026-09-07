/**
 * gen-vendored-surface — P0 提取器：扫描 vendored 目录树，产出符号表。
 *
 * 设计文档：docs/plans/2026-09-07-compat-surface-unified-projection.md §5.1 ① / §7 P0
 *
 * 与 v1 的 gen-upstream-surface.ts 不同（v1 读仓库外硬编码路径的 barrel index.ts），
 * 本脚本扫描仓库内 vendored/brepjs 目录树（259 文件），用 TS 编译器 API
 * 提取每个文件的导出符号（含签名、kind、模块归属、JSDoc）。
 *
 * 产物：src/api/surface/vendored-surface.json
 *   - symbols: 完整符号表（含 name / kind / module / file / signature / jsDoc）
 *   - _meta: 统计与口径
 *
 * 运行：npx tsx packages/core/scripts/gen-vendored-surface.ts [--dry]
 */
import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const VENDORED_ROOT = path.resolve(__dirname, '..', 'src', 'vendored', 'brepjs')
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'api', 'surface')

interface VendoredSymbol {
  name: string
  /** 'value' (function/const/class) or 'type' (interface/type alias/enum) */
  kind: 'value' | 'type'
  /** Module = file path relative to vendored root, first segment (e.g. 'topology') */
  module: string
  /** Full file path relative to vendored root (e.g. 'topology/primitiveFns.ts') */
  file: string
  /** TS signature (parameter list + return type), best-effort extraction */
  signature?: string
  /** JSDoc summary (first line of comment block, if any) */
  jsDoc?: string
}

/** Walk all .ts files under a directory recursively. */
function walkTsFiles(dir: string, base: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(base, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full, base))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      // Skip ambient declaration files
      results.push(rel)
    }
  }
  return results
}

/** Extract JSDoc summary from a node's leading trivia. */
function extractJsDoc(node: ts.Node, sf: ts.SourceFile): string | undefined {
  const text = sf.text
  const fullStart = node.getFullStart()
  if (fullStart < 0) return undefined
  // Scan backwards for /** ... */ comment
  const before = text.slice(Math.max(0, fullStart - 500), node.getStart(sf))
  const match = before.match(/\/\*\*[\s\S]*?\*\/\s*$/)
  if (!match) return undefined
  const comment = match[0]
  // Extract first meaningful line
  const lines = comment
    .replace(/\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('@'))
  return lines[0] || undefined
}

/** Extract signature from a function declaration. */
function extractFunctionSignature(node: ts.FunctionDeclaration | ts.VariableDeclaration): string | undefined {
  // We use the printer to get a compact signature
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  const result = printer.printNode(ts.EmitHint.Unspecified, node, undefined as never)
  // Truncate to first line for compactness
  const firstLine = result.split('\n')[0]
  return firstLine.length > 200 ? firstLine.slice(0, 200) + '…' : firstLine
}

/** Collect all exported symbols from a single source file. */
function collectFromFile(relFile: string, vendoredRoot: string): VendoredSymbol[] {
  const absPath = path.join(vendoredRoot, relFile)
  const source = fs.readFileSync(absPath, 'utf-8')
  const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.ES2022, true)
  const module = relFile.split('/')[0]
  const out: VendoredSymbol[] = []

  for (const stmt of sf.statements) {
    // export function foo(...)
    if (ts.isFunctionDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const name = stmt.name?.text
      if (!name) continue
      const isTypeOnly = stmt.modifiers.some((m) => m.kind === ts.SyntaxKind.TypeKeyword)
      if (isTypeOnly) continue
      out.push({
        name,
        kind: 'value',
        module,
        file: relFile,
        signature: extractFunctionSignature(stmt),
        jsDoc: extractJsDoc(stmt, sf),
      })
      continue
    }

    // export const/let/var foo = ...
    if (
      ts.isVariableStatement(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of stmt.declarationList.declarations) {
        const name = decl.name.getText(sf)
        if (!name) continue
        out.push({
          name,
          kind: 'value',
          module,
          file: relFile,
          signature: extractFunctionSignature(decl),
          jsDoc: extractJsDoc(stmt, sf),
        })
      }
      continue
    }

    // export interface Foo / export type Foo
    if (
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const name = stmt.name.text
      const isTypeOnly = stmt.modifiers.some((m) => m.kind === ts.SyntaxKind.TypeKeyword)
      out.push({
        name,
        kind: 'type',
        module,
        file: relFile,
        jsDoc: extractJsDoc(stmt, sf),
      })
      if (isTypeOnly) continue
      continue
    }

    // export enum Foo
    if (
      ts.isEnumDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const name = stmt.name.text
      out.push({
        name,
        kind: 'type',
        module,
        file: relFile,
        jsDoc: extractJsDoc(stmt, sf),
      })
      continue
    }

    // export class Foo
    if (
      ts.isClassDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const name = stmt.name?.text
      if (!name) continue
      out.push({
        name,
        kind: 'value',
        module,
        file: relFile,
        jsDoc: extractJsDoc(stmt, sf),
      })
      continue
    }

    // export { foo, bar } from './module.js'
    // export { foo as bar } from './module.js'
    if (ts.isExportDeclaration(stmt)) {
      const specText = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier.text
        : undefined

      const clause = stmt.exportClause
      if (!clause) continue

      // export * as ns from '...'
      if (ts.isNamespaceExport(clause)) {
        out.push({
          name: clause.name.text,
          kind: 'value',
          module,
          file: relFile,
          jsDoc: 'namespace re-export',
        })
        continue
      }

      if (!ts.isNamedExports(clause)) continue

      for (const el of clause.elements) {
        const name = el.name.text
        const isTypeOnly = el.isTypeOnly || stmt.isTypeOnly
        out.push({
          name,
          kind: isTypeOnly ? 'type' : 'value',
          module,
          file: relFile,
          jsDoc: specText ? `re-export from ${specText}` : 're-export',
        })
      }
      continue
    }
  }

  return out
}

function main(): void {
  const dry = process.argv.includes('--dry')

  const files = walkTsFiles(VENDORED_ROOT, VENDORED_ROOT).sort()
  console.log(`[gen-vendored-surface] scanning ${files.length} .ts files under vendored/brepjs/`)

  const allSymbols: VendoredSymbol[] = []
  for (const relFile of files) {
    const symbols = collectFromFile(relFile, VENDORED_ROOT)
    allSymbols.push(...symbols)
  }

  // Deduplicate strategy: prefer definition (non-re-export) entries.
  // For each name, keep only the entry that is a direct definition
  // (interface / function / const / class / enum / type alias),
  // not a barrel re-export. If only re-exports exist, keep the first.
  const byName = new Map<string, VendoredSymbol>()
  const isReExport = (s: VendoredSymbol): boolean =>
    s.jsDoc === undefined ? false : s.jsDoc.startsWith('re-export') || s.jsDoc === 'namespace re-export'
  for (const s of allSymbols) {
    const existing = byName.get(s.name)
    if (!existing) {
      byName.set(s.name, s)
      continue
    }
    // Prefer the definition entry (non-re-export) over a re-export entry
    if (!isReExport(s) && isReExport(existing)) {
      byName.set(s.name, s)
    }
  }
  const deduped: VendoredSymbol[] = [...byName.values()]

  // Sort by module then name
  deduped.sort((a, b) =>
    a.module === b.module ? a.name.localeCompare(b.name) : a.module.localeCompare(b.module),
  )

  const values = deduped.filter((s) => s.kind === 'value')
  const types = deduped.filter((s) => s.kind === 'type')

  // Module distribution
  const moduleDist: Record<string, number> = {}
  for (const s of deduped) moduleDist[s.module] = (moduleDist[s.module] ?? 0) + 1

  console.log(`[gen-vendored-surface] raw symbols: ${deduped.length} (value ${values.length} / type ${types.length})`)
  console.log(`[gen-vendored-surface] module dist:`, JSON.stringify(moduleDist, null, 0))

  if (dry) return

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = {
    _meta: {
      source: 'packages/core/src/vendored/brepjs (all .ts files)',
      doc: 'docs/plans/2026-09-07-compat-surface-unified-projection.md §3.1 / §5.1 ①',
      generated: new Date().toISOString().slice(0, 10),
      fileCount: files.length,
      totalSymbols: deduped.length,
      valueCount: values.length,
      typeCount: types.length,
      moduleDist,
    },
    symbols: deduped,
  }
  const outPath = path.join(OUT_DIR, 'vendored-surface.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8')
  console.log(`[gen-vendored-surface] wrote ${deduped.length} symbols to ${path.relative(process.cwd(), outPath)}`)
}

const directRun = fileURLToPath(import.meta.url) === (process.argv[1] ? path.resolve(process.argv[1]) : '')
if (directRun) {
  main()
}
