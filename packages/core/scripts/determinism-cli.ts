/**
 * determinism-cli — standalone determinism scanner for .fai.js sources and the
 * libraries they import.
 *
 *   npx tsx packages/core/scripts/determinism-cli.ts <file.fai.js | dir> [--json]
 *
 * Scans each `.fai.js` (and `.fai.js` modules reachable via relative import),
 * plus the source of every `@faicad/*` library it imports, and reports any
 * non-deterministic value flowing into geometry (B-tier conservative taint).
 * The engine package `@faicad/faijs` itself is excluded — its internal
 * non-determinism is owned by the engine responsibility list, not user code.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve, join, extname } from 'node:path'
import { parse as acornParse } from 'acorn'
import { transform as sucraseTransform } from 'sucrase'
import { scanDeterminism, type DeterminismViolation } from '../src/lang/determinism-scanner.ts'

// ── shared types ──

interface ImportInfo {
  specifier: string
  namespaceName: string | null
  namedNames: string[]
  defaultName: string | null
}

interface FileFinding {
  file: string
  violations: DeterminismViolation[]
}

/** Library packages whose import must not be scanned (engine internals). */
const ENGINE_PACKAGES = new Set<string>(['@faicad/faijs'])

// ── import extraction ──

/** Extract top-level imports from JS source (bindings + namespace + specifier). */
function extractImports(code: string): ImportInfo[] {
  let ast
  try {
    ast = acornParse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as any
  } catch {
    return []
  }
  const out: ImportInfo[] = []
  for (const node of ast.body ?? []) {
    if (node.type !== 'ImportDeclaration') continue
    const info: ImportInfo = {
      specifier: String(node.source?.value ?? ''),
      namespaceName: null,
      namedNames: [],
      defaultName: null,
    }
    for (const spec of node.specifiers ?? []) {
      if (spec.type === 'ImportNamespaceSpecifier') info.namespaceName = spec.local?.name ?? null
      else if (spec.type === 'ImportDefaultSpecifier') info.defaultName = spec.local?.name ?? null
      else if (spec.type === 'ImportSpecifier') info.namedNames.push(spec.local?.name ?? spec.imported?.name ?? '')
    }
    out.push(info)
  }
  return out
}

// ── library source resolution ──

/** Normalize a short name to a scoped `@faicad/*` name when unambiguous. */
function normalizeSpecifier(specifier: string): string {
  if (specifier.startsWith('@')) return specifier
  if (specifier.startsWith('.')) return specifier
  // Bare short name → try the faicad scope.
  return `@faicad/${specifier}`
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')
}

function isEnginePackage(specifier: string): boolean {
  for (const pkg of ENGINE_PACKAGES) {
    if (specifier === pkg || specifier.startsWith(pkg + '/')) return true
  }
  return false
}

/** Locate a library's source entry (prefer `src/*.ts`, fall back to `dist/*.js`). */
function resolveLibraryEntry(specifier: string, fromPath: string): { path: string; isTs: boolean } | null {
  const req = createRequire(fromPath)
  let pjPath: string
  try {
    pjPath = req.resolve(`${specifier}/package.json`)
  } catch {
    return null
  }
  const pkgDir = dirname(pjPath)
  let pj: any
  try {
    pj = JSON.parse(readFileSync(pjPath, 'utf8'))
  } catch {
    return null
  }
  const entryRel: string = pj.exports?.['.']?.default ?? pj.main ?? 'dist/index.js'
  // Prefer source: dist/index.js → src/index.ts.
  const srcRel = entryRel.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts')
  const srcPath = join(pkgDir, srcRel)
  if (existsSync(srcPath)) return { path: srcPath, isTs: true }
  const distPath = join(pkgDir, entryRel)
  if (existsSync(distPath)) return { path: distPath, isTs: false }
  return null
}

// ── directory walk ──

function walkDirectory(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const p = join(dir, entry)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
      walkDirectory(p, out)
    } else if (entry.endsWith('.fai.js')) {
      out.push(p)
    }
  }
}

// ── scanning ──

interface ScanContext {
  findings: FileFinding[]
  visited: Set<string>
  depth: number
}

/** Scan JS source text (already TS-stripped when needed). */
function scanSource(code: string, file: string, ctx: ScanContext): void {
  if (ctx.depth > 12) return
  const imports = extractImports(code)
  const namespaces = imports.filter((i) => i.namespaceName).map((i) => i.namespaceName as string)
  const callees = imports.flatMap((i) => i.namedNames).concat(imports.filter((i) => i.defaultName).map((i) => i.defaultName as string))
  const result = scanDeterminism(code, { extraNamespaces: namespaces, extraCallees: callees })
  if (result.violations.length > 0) {
    ctx.findings.push({ file, violations: result.violations })
  }

  // Recurse into imports (relative .fai.js modules and @faicad/* libraries).
  for (const imp of imports) {
    const spec = imp.specifier
    const normalized = normalizeSpecifier(spec)

    if (isRelativeSpecifier(spec)) {
      const abs = resolve(dirname(file), spec)
      const target = existsSync(abs) && extname(abs) === '.fai.js' ? abs : null
      if (target && !ctx.visited.has(target)) {
        ctx.visited.add(target)
        ctx.depth++
        try {
          scanSource(readFileSync(target, 'utf8'), target, ctx)
        } catch {
          /* unreadable module — skip */
        }
        ctx.depth--
      }
      continue
    }

    // Bare library specifier.
    if (isEnginePackage(normalized)) continue
    if (ctx.visited.has(normalized)) continue
    ctx.visited.add(normalized)

    const entry = resolveLibraryEntry(normalized, file)
    if (!entry) continue
    let libCode: string
    try {
      libCode = readFileSync(entry.path, 'utf8')
    } catch {
      continue
    }
    let jsCode: string
    if (entry.isTs) {
      try {
        jsCode = sucraseTransform(libCode, { transforms: ['typescript'] }).code
      } catch {
        continue // sucrase cannot strip this library — skip rather than crash
      }
    } else {
      jsCode = libCode
    }
    ctx.depth++
    scanSource(jsCode, entry.path, ctx)
    ctx.depth--
  }
}

// ── CLI ──

function collectInputs(input: string): string[] {
  const abs = resolve(input)
  if (!existsSync(abs)) {
    console.error(`determinism-cli: input not found: ${input}`)
    process.exit(2)
  }
  const st = statSync(abs)
  if (st.isDirectory()) {
    const files: string[] = []
    walkDirectory(abs, files)
    return files.sort()
  }
  return [abs]
}

function main(argv: string[]): number {
  const args = argv.filter((a) => a !== '--json')
  const asJson = argv.includes('--json')
  if (args.length !== 1) {
    console.error('usage: determinism-cli <file.fai.js | directory> [--json]')
    return 2
  }

  const inputs = collectInputs(args[0])
  if (inputs.length === 0) {
    console.error('determinism-cli: no .fai.js files found')
    return 0
  }

  const ctx: ScanContext = { findings: [], visited: new Set(), depth: 0 }
  for (const file of inputs) {
    if (ctx.visited.has(file)) continue
    ctx.visited.add(file)
    try {
      scanSource(readFileSync(file, 'utf8'), file, ctx)
    } catch (err) {
      console.error(`determinism-cli: failed to scan ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const totalViolations = ctx.findings.reduce((n, f) => n + f.violations.length, 0)

  if (asJson) {
    console.log(JSON.stringify({ files: inputs.length, findings: ctx.findings }, null, 2))
  } else {
    if (ctx.findings.length === 0) {
      console.log(`determinism-cli: ${inputs.length} file(s) scanned, no violations.`)
    } else {
      for (const f of ctx.findings) {
        console.log(`${f.file}: ${f.violations.length} violation(s)`)
        for (const v of f.violations) {
          console.log(`  line ${v.lineNo} [${v.source}]: ${v.message.replace(/^\[determinism\] /, '')}`)
        }
      }
      console.log(`determinism-cli: ${inputs.length} file(s) scanned, ${totalViolations} violation(s) in ${ctx.findings.length} file(s).`)
    }
  }

  return totalViolations > 0 ? 1 : 0
}

process.exit(main(process.argv.slice(2)))