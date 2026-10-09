/**
 * verify-script-face-jsdoc.ts
 *
 * JSDoc completeness gate for the script face (doc-sync member, CI gate).
 *
 * Every script-face API must carry complete JSDoc, otherwise the generated
 * skill docs (gen-skill-docs.ts) would silently omit parameter tables or
 * examples. Required per entry:
 *   - non-empty description
 *   - @param for every parameter (ops: schema keys when present; otherwise
 *     declaration params; shape methods / domain exports: declaration params)
 *   - @returns (or an explicit no-value return: void / this / Promise<void>)
 *   - at least one @example
 *
 * Scope (mirrors gen-skill-docs.ts data sources):
 *   1. core cad.* ops (defineOp call sites in packages/core/src/api/*.ts)
 *   2. cad.sketch (packages/sketch/src/op.ts)
 *   3. editor ops (packages/faijs-extra/src)
 *   4. Shape instance methods (ShapeAppearanceMethods / ShapeMetaMethods)
 *   5. domain library exports (sheetmetal / gears / fasteners index.ts)
 *
 * Usage: npx tsx scripts/verify-script-face-jsdoc.ts
 * Exit 0 = all entries complete; exit 1 = violations listed (file:line).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import {
  collectSkillDocData,
  parseOpJSDoc,
} from './gen-skill-docs.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const coreSrcDir = join(root, 'packages/core/src')
const extraSrcDir = join(root, 'packages/faijs-extra/src')

interface Violation {
  api: string
  file: string
  line: number
  problems: string[]
}

function rel(fp: string): string {
  return relative(root, fp).replace(/\\/g, '/')
}

/** Parse a TS source file into an AST + raw text pair. */
function parse(fp: string): { sf: ts.SourceFile; text: string } {
  const text = readFileSync(fp, 'utf8')
  const sf = ts.createSourceFile(fp, text, ts.ScriptTarget.Latest, true)
  return { sf, text }
}

/** The `/** … *​/` block immediately preceding a node, or null. */
function jsdocBefore(node: ts.Node, text: string): string | null {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
  const jsdoc = ranges.filter(r => text.slice(r.pos, r.pos + 3) === '/**').at(-1)
  return jsdoc ? text.slice(jsdoc.pos, jsdoc.end) : null
}

/** Position (1-based line) of a node's start within its source file. */
function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

/** Declaration parameter names, as written in source. */
function declaredParamNames(node: ts.Node): string[] {
  let body: ts.Node | undefined
  if (ts.isFunctionDeclaration(node) || ts.isMethodSignature(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    body = node
  } else if (ts.isVariableDeclaration(node) && node.initializer) {
    const init = node.initializer
    if (ts.isFunctionExpression(init) || ts.isArrowFunction(init)) body = init
  }
  if (!body) return []
  return body.parameters
    .map(p => (ts.isIdentifier(p.name) ? p.name.text : null))
    .filter((n): n is string => n !== null && n !== 'params')
}

/**
 * Params that must be documented. Ops with a `schema:` object document the
 * schema keys (the projected script-face form); everything else documents
 * the declared parameters.
 */
function requiredParams(entry: {
  schema?: Record<string, string>
  declaredParams?: string[]
}): string[] {
  if (entry.schema && Object.keys(entry.schema).length > 0) {
    return Object.keys(entry.schema).filter(k => !k.endsWith('?'))
  }
  return (entry.declaredParams ?? []).filter(n => !n.startsWith('_'))
}

const RETURNS_OK_NO_VALUE = /^\s*(void|this|Promise<void>)\b/

/** Whether a documented @returns is mandatory for this signature. */
function returnsMandatory(returnTypeText: string): boolean {
  const t = returnTypeText.trim()
  if (!t || RETURNS_OK_NO_VALUE.test(t)) return false
  return true
}

/** Check one documented entry; returns violation problems (empty = ok). */
function checkEntry(entry: {
  name: string
  description: string
  params: Map<string, string>
  returns: string | null
  examples: string[]
  requiredParamNames: string[]
  needsReturns: boolean
}, api: string, file: string, line: number): Violation | null {
  const problems: string[] = []
  // JSDoc may write `@param params.width` (op object form); normalize keys so
  // bare parameter names match either spelling.
  const docParams = new Map<string, string>()
  for (const [k, v] of entry.params) {
    docParams.set(k, v)
    const dot = k.lastIndexOf('.')
    if (dot >= 0) docParams.set(k.slice(dot + 1), v)
  }
  if (!entry.description.trim()) problems.push('missing description')
  for (const p of entry.requiredParamNames) {
    if (!docParams.has(p)) problems.push(`missing @param ${p}`)
    else if (!docParams.get(p)!.trim()) problems.push(`empty @param ${p}`)
  }
  if (entry.needsReturns && !entry.returns?.trim()) problems.push('missing @returns')
  if (entry.examples.length === 0) problems.push('missing @example')
  if (!problems.length) return null
  return { api, file, line, problems }
}

// ── collect script-face entries ─────────────────────────────────────────────

const data = collectSkillDocData()
const violations: Violation[] = []

// 1. core cad.* ops — locate defineOp sites for precise file:line.
{
  const apiDir = join(coreSrcDir, 'api')
  const files: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts') && !ent.name.endsWith('.d.ts')) files.push(p)
    }
  }
  walk(apiDir)

  // Generated projection files (gen-l3-surface.ts output) are machine-written:
  // their doc completeness is owned by the arg-spec source, not this gate.
  const isGenerated = (fp: string) => /[/\\]generated[/\\]/.test(fp)

  const docs = data.opDocs
  for (const fp of files) {
    if (isGenerated(fp)) continue
    const { sf, text } = parse(fp)
    const visit = (node: ts.Node) => {
      if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue
          const name = decl.name.text
          const doc = docs.get(name)
          if (!doc || doc.source !== rel(fp)) continue

          const raw = jsdocBefore(node, text)
          if (!raw) {
            violations.push({ api: `cad.${name}`, file: rel(fp), line: lineOf(sf, node), problems: ['missing JSDoc block'] })
            continue
          }
          const parsed = parseOpJSDoc(raw)
          // schema from the defineOp literal, if present
          let schema: Record<string, string> | undefined
          if (decl.initializer && ts.isCallExpression(decl.initializer) && decl.initializer.arguments[0] && ts.isObjectLiteralExpression(decl.initializer.arguments[0])) {
            for (const prop of decl.initializer.arguments[0].properties) {
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'schema' && ts.isObjectLiteralExpression(prop.initializer)) {
                schema = {}
                for (const sp of prop.initializer.properties) {
                  if (ts.isPropertyAssignment(sp) && ts.isIdentifier(sp.name)) {
                    schema[sp.name.text] = sp.initializer.getText(sf)
                  }
                }
              }
            }
          }
          const declared = declaredParamNames(decl)
          const v = checkEntry(
            {
              name,
              description: parsed.description,
              params: parsed.params,
              returns: parsed.returns,
              examples: parsed.examples,
              requiredParamNames: requiredParams({ schema, declaredParams: declared }),
              needsReturns: true,
            },
            `cad.${name}`, rel(fp), lineOf(sf, node),
          )
          if (v) violations.push(v)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  // Ops in the runtime namespace but absent from opDocs entirely.
  const { createApiNamespace } = await import('../packages/core/src/api/api-namespace.ts')
  const ns = createApiNamespace() as Record<string, unknown>
  for (const k of Object.keys(ns)) {
    if (k === 'contractVersion' || typeof ns[k] !== 'function') continue
    if (!docs.has(k) && !data.buckets.has(k)) {
      violations.push({ api: `cad.${k}`, file: '(runtime namespace)', line: 0, problems: ['no JSDoc entry found by generator'] })
    }
  }
}

// 2 + 3. sketch / editor ops — reuse extracted docs; find source location via op.ts scan.
for (const [label, doc, file] of [
  ['cad.sketch', data.sketchDoc, join(root, 'packages/sketch/src/op.ts')],
] as const) {
  if (!doc) continue
  const { sf, text } = parse(file)
  let found = false
  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) {
      const decl = ts.isVariableStatement(node) ? node.declarationList.declarations[0] : null
      const name = decl && ts.isIdentifier(decl.name) ? decl.name.text : (ts.isFunctionDeclaration(node) && node.name ? node.name.text : null)
      if (name === doc.name) {
        found = true
        const raw = jsdocBefore(node, text)
        const parsed = raw ? parseOpJSDoc(raw) : null
        const v = checkEntry(
          {
            name: doc.name,
            description: parsed?.description ?? '',
            params: parsed?.params ?? new Map(),
            returns: parsed?.returns ?? null,
            examples: parsed?.examples ?? [],
            requiredParamNames: [],
            needsReturns: true,
          },
          label, rel(file), lineOf(sf, node),
        )
        if (v) violations.push(v)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!found) {
    const v = checkEntry(
      { name: doc.name, description: doc.description, params: doc.params, returns: doc.returns, examples: doc.examples, requiredParamNames: [], needsReturns: true },
      label, rel(file), 0,
    )
    if (v) violations.push(v)
  }
}
for (const [name, doc] of data.editorDocs) {
  const v = checkEntry(
    {
      name, description: doc.description, params: doc.params, returns: doc.returns,
      examples: doc.examples,
      requiredParamNames: requiredParams({ schema: doc.schema, declaredParams: [] }),
      needsReturns: true,
    },
    `cad.${name}`, doc.source, 0,
  )
  if (v) violations.push(v)
}

// 4. Shape instance methods — re-parse the interface files for exact lines.
{
  const targetFiles = [join(coreSrcDir, 'api/appearance.ts'), join(coreSrcDir, 'api/meta.ts')]
  const targetInterfaces = new Set(['ShapeAppearanceMethods', 'ShapeMetaMethods'])
  for (const fp of targetFiles) {
    const { sf, text } = parse(fp)
    const visit = (node: ts.Node) => {
      if (ts.isInterfaceDeclaration(node) && targetInterfaces.has(node.name.text)) {
        for (const member of node.members) {
          if (!ts.isMethodSignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
          const methodName = member.name.text
          const entry = data.shapeMethods.find(m => m.name === methodName)
          if (!entry) {
            violations.push({ api: `shape.${methodName}`, file: rel(fp), line: lineOf(sf, member), problems: ['method not captured by generator'] })
            continue
          }
          const raw = jsdocBefore(member, text)
          const parsed = raw ? parseOpJSDoc(raw) : null
          const retType = member.type ? member.type.getText(sf) : ''
          const v = checkEntry(
            {
              name: methodName,
              description: parsed?.description ?? '',
              params: parsed?.params ?? new Map(),
              returns: parsed?.returns ?? null,
              examples: parsed?.examples ?? [],
              requiredParamNames: declaredParamNames(member),
              needsReturns: returnsMandatory(retType),
            },
            `shape.${methodName}`, rel(fp), lineOf(sf, member),
          )
          if (v) violations.push(v)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

// 5. Domain library exports — re-resolve declarations for exact lines.
{
  const libDirs = [
    { dir: join(root, 'packages/sheetmetal/src'), pkg: '@faicad/sheetmetal' },
    { dir: join(root, 'packages/faijs-gears/src'), pkg: '@faicad/faijs-gears' },
    { dir: join(root, 'packages/faijs-fasteners/src'), pkg: '@faicad/faijs-fasteners' },
  ]
  for (const { dir, pkg } of libDirs) {
    const indexFp = join(dir, 'index.ts')
    if (!existsSync(indexFp)) continue
    const exportsOfLib = new Map<string, { fp: string; node: ts.Node; sf: ts.SourceFile; text: string }>()
    const { sf, text } = parse(indexFp)
    const visit = (node: ts.Node) => {
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        const moduleSpecifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null
        if (moduleSpecifier) {
          const targetFp = join(dir, moduleSpecifier.endsWith('.js') ? moduleSpecifier.replace(/\.js$/, '.ts') : moduleSpecifier)
          if (existsSync(targetFp)) {
            for (const el of node.exportClause.elements) {
              const exported = el.name.text
              const sourceName = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : exported
              // Resolve only when not yet mapped (first wins, mirrors generator).
              if (!exportsOfLib.has(exported)) {
                const { sf: tsf, text: ttext } = parse(targetFp)
                const find = (n: ts.Node): ts.Node | null => {
                  if (ts.isFunctionDeclaration(n) && n.name?.text === sourceName && n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return n
                  if (ts.isVariableStatement(n) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                    for (const d of n.declarationList.declarations) {
                      if (ts.isIdentifier(d.name) && d.name.text === sourceName) return d
                    }
                  }
                  let hit: ts.Node | null = null
                  ts.forEachChild(n, (c) => { if (!hit) hit = find(c) })
                  return hit
                }
                const found = find(tsf)
                if (found) exportsOfLib.set(exported, { fp: targetFp, node: found, sf: tsf, text: ttext })
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)

    const libExports = data.domainLibs.find(l => l.packageName === pkg)?.exports ?? []
    for (const exp of libExports) {
      const loc = exportsOfLib.get(exp.name)
      if (!loc) continue
      const raw = jsdocBefore(loc.node, loc.text)
      const parsed = raw ? parseOpJSDoc(raw) : null
      const declared = declaredParamNames(loc.node)
      const v = checkEntry(
        {
          name: exp.name,
          description: parsed?.description ?? '',
          params: parsed?.params ?? new Map(),
          returns: parsed?.returns ?? null,
          examples: parsed?.examples ?? [],
          requiredParamNames: requiredParams({ declaredParams: declared }),
          needsReturns: true,
        },
        `${pkg}.${exp.name}`, rel(loc.fp), lineOf(loc.sf, loc.node),
      )
      if (v) violations.push(v)
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────

if (violations.length) {
  console.error(`verify-script-face-jsdoc: ${violations.length} violation(s):`)
  for (const v of violations) {
    console.error(`  x ${v.api} (${v.file}:${v.line})`)
    for (const p of v.problems) console.error(`      - ${p}`)
  }
  process.exit(1)
}
console.log('verify-script-face-jsdoc: all script-face API docs complete.')
