/**
 * gen-skill-docs.ts
 *
 * faijs 基础提示词生成 API —— 生成 .fai.js 脚本 API 手册（提示词原始材料）。
 * 本文件只提供「生成能力」，不落任何提示词成品文件（保密要求：提示词的
 * 组装与存放由 ai-gateway 项目掌控；faijs 仓库不提交 skills/*.md）。
 *
 * 数据源（零手写清单）：
 *   1. Runtime: assemble the full cad namespace via
 *      mergeEditorNamespace(mergeSketchNamespace(createApiNamespace()))
 *      → enumerate op names + engine buckets via DUAL_OP_META.
 *   2. TS Compiler API: scan api/*.ts for defineOp call-site JSDoc
 *      (@group/@param/@returns/@example/@async), scan shape interfaces
 *      (ShapeAppearanceMethods/ShapeMetaMethods), scan domain library
 *      index.ts exports.
 *   3. SCRIPT_FACE_OPS manifest for generated op engines.
 *
 * API:
 *   generateApiManual('brepkit' | 'occt')  → 完整 API 手册 markdown（字符串）
 *   generateSkillOverview()                → SKILL.md 概述（字符串）
 *   collectSkillDocData()                  → 结构化采集层（verify-script-face-jsdoc 复用）
 *
 * CLI:
 *   npx tsx scripts/gen-skill-docs.ts --emit <brepkit|occt|all>   # 手册 → stdout
 *   npx tsx scripts/gen-skill-docs.ts --print                     # bucket 报告
 *   npx tsx scripts/gen-skill-docs.ts                              # 默认 = --print
 *
 * 消费方（ai-gateway sync:faijs）以 `--emit <kernel>` 子进程方式取手册。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import ts from 'typescript'

import { createApiNamespace } from '../packages/core/src/api/api-namespace'
import { dualOpMetaOf } from '../packages/core/src/define-op'
import { SCRIPT_FACE_OPS } from '../packages/core/src/api/generated/script-face-manifest'
import { ALL_EDITOR_OPS } from '../packages/core/src/extra/op-names'
import { SKETCH_OP_NAME } from '../packages/core/src/sketch/op'

// ── paths ───────────────────────────────────────────────────────────────────

const root = resolve(import.meta.dirname, '..')
const apiSrcDir = join(root, 'packages/core/src/api')
const coreSrcDir = join(root, 'packages/core/src')
const extraSrcDir = join(root, 'packages/core/src/extra')
const sketchSrcDir = join(root, 'packages/core/src/sketch')
const sheetmetalSrcDir = join(root, 'packages/sheetmetal/src')
const gearsSrcDir = join(root, 'packages/faijs-gears/src')
const fastenersSrcDir = join(root, 'packages/faijs-fasteners/src')

/**
 * The op names the sketch library contributes to the `cad` namespace.
 *
 * 2026-10-13 merge: `packages/sketch` was folded into core and its
 * `namespace.ts` (which exported `SKETCH_OPS`) was removed — the cad namespace
 * is now assembled inside `createApiNamespace()`. The sketch library carries
 * exactly one op, so the list is derived from that op's own name constant
 * (`packages/core/src/sketch/op.ts`) instead of a hand-maintained list.
 */
const SKETCH_OPS = [SKETCH_OP_NAME] as const

// ── 1. Engine bucket classification (reused from gen-engine-skill-docs) ────

type Bucket = 'common' | 'occt-only' | 'brepkit-only'

/** Recursively collect every api source .ts file. */
function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) walkTsFiles(p, out)
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts') && !ent.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** Scan api/ sources for assertEngineFor / shapePredicate calls. */
function scanPlainOcctNames(): Set<string> {
  const names = new Set<string>()
  for (const file of walkTsFiles(apiSrcDir)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/assertEngineFor\(\s*['"](\w+)['"]/g)) names.add(m[1])
    for (const m of text.matchAll(/shapePredicate\(\s*['"](\w+)['"]/g)) names.add(m[1])
  }
  return names
}

/** op name -> bucket, derived from runtime metadata + source scan. */
function buildEngineBuckets(): Map<string, Bucket> {
  const ns = createApiNamespace()
  const plainOcct = scanPlainOcctNames()

  const manifestEngines = new Map<string, readonly string[]>()
  for (const op of SCRIPT_FACE_OPS) {
    if (op.engines?.length) manifestEngines.set(op.name, op.engines)
  }

  // Editor + sketch ops are common (engine-neutral) by default
  const editorSketchOps = new Set<string>([...ALL_EDITOR_OPS, ...SKETCH_OPS])

  const buckets = new Map<string, Bucket>()
  for (const [name, value] of Object.entries(ns)) {
    if (name === 'contractVersion' || typeof value !== 'function') continue

    let engines: readonly string[] | undefined
    const meta = dualOpMetaOf(value)
    if (meta?.engines?.length) {
      engines = meta.engines
    } else if (!meta) {
      engines = manifestEngines.get(name) ?? (plainOcct.has(name) ? ['occt'] : undefined)
    }

    // Editor/sketch ops: always common (they are engine-neutral or mesh-only)
    if (editorSketchOps.has(name) && !engines) {
      buckets.set(name, 'common')
      continue
    }

    const hasOcct = !!engines?.includes('occt')
    const hasBrepkit = !!engines?.includes('brepkit')
    if (hasOcct && hasBrepkit) buckets.set(name, 'common')
    else if (hasOcct) buckets.set(name, 'occt-only')
    else if (hasBrepkit) buckets.set(name, 'brepkit-only')
    else buckets.set(name, 'common')
  }
  return buckets
}

// ── 2. JSDoc extraction via TS Compiler API ────────────────────────────────

interface ParsedJSDoc {
  description: string
  group: string
  params: Map<string, string>
  returns: string | null
  examples: string[]
  isAsync: boolean
  qual: string | null
  name: string | null
  inputs: string | null
}

/** Parse a raw JSDoc block into structured fields. */
function parseOpJSDoc(raw: string): ParsedJSDoc {
  const inner = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))

  let description = ''
  const params = new Map<string, string>()
  let returns: string | null = null
  const examples: string[] = []
  let group = ''
  let isAsync = false
  let qual: string | null = null
  let name: string | null = null
  let inputs: string | null = null

  let sink: ((text: string) => void) | null = null
  let currentExample: string[] = []

  const flushExample = () => {
    if (currentExample.length) {
      examples.push(currentExample.join('\n').trim())
      currentExample = []
    }
  }

  for (const line of inner) {
    const trimmed = line.trimStart()

    // @group
    const groupMatch = /^@group\s+(.*)$/.exec(trimmed)
    if (groupMatch) { group = groupMatch[1].trim(); sink = null; flushExample(); continue }

    // @param
    const paramMatch = /^@param\s+(?:\[?([\w.$]+)\]?)\s*(?:[-—–]\s*)?(.*)$/.exec(trimmed)
    if (paramMatch) {
      flushExample()
      const pname = paramMatch[1] ?? ''
      let pacc = paramMatch[2] ?? ''
      params.set(pname, pacc)
      sink = (t) => { pacc = pacc ? `${pacc} ${t}` : t; params.set(pname, pacc) }
      continue
    }

    // @returns
    const retMatch = /^@returns?(?:\s+[-—–]?\s*(.*))?$/.exec(trimmed)
    if (retMatch) {
      flushExample()
      let racc = retMatch[1] ?? ''
      returns = racc
      sink = (t) => { racc = racc ? `${racc} ${t}` : t; returns = racc }
      continue
    }

    // @example
    if (/^@example\s*$/.test(trimmed) || /^@example\s+/.test(trimmed)) {
      flushExample()
      const rest = trimmed.replace(/^@example\s*/, '').trim()
      if (rest) currentExample.push(rest)
      sink = (t) => currentExample.push(t)
      continue
    }

    // @async
    const asyncMatch = /^@async\s+(.*)$/.exec(trimmed)
    if (asyncMatch) { isAsync = asyncMatch[1].trim() === 'true'; sink = null; flushExample(); continue }

    // @qual
    const qualMatch = /^@qual\s+(.*)$/.exec(trimmed)
    if (qualMatch) { qual = qualMatch[1].trim(); sink = null; flushExample(); continue }

    // @name
    const nameMatch = /^@name\s+(.*)$/.exec(trimmed)
    if (nameMatch) { name = nameMatch[1].trim(); sink = null; flushExample(); continue }

    // @inputs
    const inputsMatch = /^@inputs\s+(.*)$/.exec(trimmed)
    if (inputsMatch) { inputs = inputsMatch[1].trim(); sink = null; flushExample(); continue }

    // Other @ tags — stop prose accumulation
    if (trimmed.startsWith('@')) { sink = null; flushExample(); continue }

    // Empty line
    if (trimmed === '') { if (sink !== null) { /* keep collecting */ } flushExample(); continue }

    // Prose or continuation
    if (sink) {
      sink(line.trim())
    } else if (!currentExample.length) {
      description = description ? `${description} ${line.trim()}` : line.trim()
    }
  }
  flushExample()

  return { description, group, params, returns, examples, isAsync, qual, name, inputs }
}

/** Find the JSDoc comment immediately preceding a node. */
function getJSDocBefore(node: ts.Node, sf: ts.SourceFile, text: string): string | null {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
  const jsdoc = ranges.filter(r => text.slice(r.pos, r.pos + 3) === '/**').at(-1)
  return jsdoc ? text.slice(jsdoc.pos, jsdoc.end) : null
}

/** Create a TS program for a set of source files and return source file objects. */
function parseSourceFiles(filePaths: string[]): Map<string, { sf: ts.SourceFile; text: string }> {
  const result = new Map<string, { sf: ts.SourceFile; text: string }>()
  for (const fp of filePaths) {
    const text = readFileSync(fp, 'utf8')
    const sf = ts.createSourceFile(fp, text, ts.ScriptTarget.Latest, true)
    result.set(fp, { sf, text })
  }
  return result
}

// ── 3. Op JSDoc extraction from api/*.ts ────────────────────────────────────

interface OpDocEntry {
  name: string
  group: string
  description: string
  params: Map<string, string>
  returns: string | null
  examples: string[]
  isAsync: boolean
  schema?: Record<string, string>
  source: string
}

/** Scan api/*.ts for defineOp call sites and extract preceding JSDoc. */
function extractOpDocs(): Map<string, OpDocEntry> {
  const docs = new Map<string, OpDocEntry>()
  const files = walkTsFiles(apiSrcDir)
  const parsed = parseSourceFiles(files)

  for (const [fp, { sf, text }] of parsed) {
    const relFile = relative(root, fp).replace(/\\/g, '/')

    function visit(node: ts.Node) {
      // Look for `export const <name> = defineOp({ ... })`
      if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue
          const initializer = decl.initializer
          if (!initializer) continue

          // Check if it's a defineOp / compatOp call
          const call = getCallExpression(initializer)
          if (!call || !ts.isIdentifier(call.expression)) continue
          const fnName = call.expression.text
          if (fnName !== 'defineOp' && fnName !== 'compatOp') continue

          const opName = decl.name.text
          const raw = getJSDocBefore(node, sf, text)
          if (!raw) continue

          const parsed = parseOpJSDoc(raw)
          // Extract schema from defineOp options
          let schema: Record<string, string> | undefined
          if (call.arguments.length > 0 && ts.isObjectLiteralExpression(call.arguments[0])) {
            const obj = call.arguments[0] as ts.ObjectLiteralExpression
            for (const prop of obj.properties) {
              if (ts.isPropertyAssignment(prop) && prop.name && ts.isIdentifier(prop.name) && prop.name.text === 'schema') {
                if (ts.isObjectLiteralExpression(prop.initializer)) {
                  schema = {}
                  for (const sp of prop.initializer.properties) {
                    if (ts.isPropertyAssignment(sp) && sp.name) {
                      const key = ts.isIdentifier(sp.name) ? sp.name.text : sp.name.getText(sf)
                      const val = sp.initializer.getText(sf).replace(/['"]/g, '')
                      schema[key] = val
                    }
                  }
                }
              }
            }
          }

          const docName = parsed.name ?? opName
          docs.set(docName, {
            name: docName,
            group: parsed.group || 'Other',
            description: parsed.description,
            params: parsed.params,
            returns: parsed.returns,
            examples: parsed.examples,
            isAsync: parsed.isAsync,
            schema,
            source: relFile,
          })
        }
      }

      // Also look for `export function <name>(...)` (plain function ops like exportStl, faceNormal, etc.)
      if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const opName = node.name?.text
        if (!opName) { ts.forEachChild(node, visit); return }

        const raw = getJSDocBefore(node, sf, text)
        if (!raw) { ts.forEachChild(node, visit); return }

        // Only include if this function is in the cad namespace
        // (We'll filter later by comparing with runtime namespace keys)
        const parsed = parseOpJSDoc(raw)
        const docName = parsed.name ?? opName

        // Extract parameter types from the function signature
        const sigParams = new Map<string, string>()
        for (const param of node.parameters) {
          if (ts.isIdentifier(param.name)) {
            const pname = param.name.text
            const ptype = param.type?.getText(sf) ?? 'unknown'
            const pdoc = parsed.params.get(pname) ?? parsed.params.get(`params.${pname}`) ?? ''
            sigParams.set(pname, `${ptype}${pdoc ? ' — ' + pdoc : ''}`)
          }
        }
        // Merge any @param tags that use dotted notation (params.xxx)
        for (const [key, val] of parsed.params) {
          if (!sigParams.has(key) && !key.includes('.')) {
            sigParams.set(key, val)
          }
        }

        docs.set(docName, {
          name: docName,
          group: parsed.group || 'Other',
          description: parsed.description,
          params: sigParams,
          returns: parsed.returns,
          examples: parsed.examples,
          isAsync: parsed.isAsync,
          source: relFile,
        })
      }

      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  return docs
}

/** Unwrap wrapper expressions to find a call expression. */
function getCallExpression(expr: ts.Expression): ts.CallExpression | null {
  let inner = expr
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) {
    inner = inner.expression
  }
  return ts.isCallExpression(inner) ? inner : null
}

// ── 4. Shape instance method extraction ─────────────────────────────────────

interface ShapeMethodEntry {
  name: string
  signature: string
  description: string
  params: Map<string, string>
  returns: string | null
  examples: string[]
  interfaceName: string
}

/** Extract Shape instance methods from interface declarations. */
function extractShapeMethods(): ShapeMethodEntry[] {
  const entries: ShapeMethodEntry[] = []
  const targetFiles = [
    join(coreSrcDir, 'api/appearance.ts'),
    join(coreSrcDir, 'api/meta.ts'),
  ]

  const parsed = parseSourceFiles(targetFiles)
  const targetInterfaces = new Set(['ShapeAppearanceMethods', 'ShapeMetaMethods'])

  for (const [fp, { sf, text }] of parsed) {
    function visit(node: ts.Node) {
      if (ts.isInterfaceDeclaration(node) && targetInterfaces.has(node.name.text)) {
        const ifaceName = node.name.text
        for (const member of node.members) {
          if (!ts.isMethodSignature(member)) continue
          if (!member.name || !ts.isIdentifier(member.name)) continue

          const methodName = member.name.text
          const raw = getJSDocBefore(member, sf, text)
          const parsed = raw ? parseOpJSDoc(raw) : null

          // Build signature
          const sigParams: string[] = []
          for (const param of member.parameters) {
            const pname = param.name.getText(sf)
            const ptype = param.type?.getText(sf) ?? 'any'
            const optional = param.questionToken ? '?' : ''
            sigParams.push(`${pname}${optional}: ${ptype}`)
          }
          const retType = member.type?.getText(sf) ?? 'void'
          const signature = `${methodName}(${sigParams.join(', ')}): ${retType}`

          entries.push({
            name: methodName,
            signature,
            description: parsed?.description ?? '',
            params: parsed?.params ?? new Map(),
            returns: parsed?.returns ?? null,
            examples: parsed?.examples ?? [],
            interfaceName: ifaceName,
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  return entries
}

// ── 5. Domain library export extraction ─────────────────────────────────────

interface DomainLibExport {
  name: string
  signature: string
  description: string
  params: Map<string, string>
  returns: string | null
  examples: string[]
  packageName: string
  importSpecifier: string
  group: string
}

/** Extract exported functions from a library's index.ts. */
function extractDomainLibExports(
  libDir: string,
  packageName: string,
  importSpecifier: string,
): DomainLibExport[] {
  const entries: DomainLibExport[] = []
  const indexPath = join(libDir, 'index.ts')
  if (!existsSync(indexPath)) return entries

  const text = readFileSync(indexPath, 'utf8')
  const sf = ts.createSourceFile(indexPath, text, ts.ScriptTarget.Latest, true)

  // First: collect all named exports (from export { a, b, c } from './xxx')
  // and track which source file they come from
  const exportToSource = new Map<string, string>()

  function visitExports(node: ts.Node) {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      const moduleSpec = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : ''
      // Normalize module specifier: remove .js/.ts extension, then add .ts
      const baseSpec = moduleSpec.replace(/\.(js|ts)$/, '')
      for (const el of node.exportClause.elements) {
        const exportName = el.propertyName?.text ?? el.name.text
        const sourceFile = baseSpec ? join(libDir, baseSpec + '.ts') : ''
        exportToSource.set(exportName, sourceFile)
      }
    }
    ts.forEachChild(node, visitExports)
  }
  visitExports(sf)

  // Collect local function declarations with JSDoc in index.ts
  const localFuncs = new Map<string, { jsdoc: string | null; node: ts.FunctionDeclaration }>()
  function visitLocal(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.name) {
        const raw = getJSDocBefore(node, sf, text)
        localFuncs.set(node.name.text, { jsdoc: raw, node })
      }
    }
    ts.forEachChild(node, visitLocal)
  }
  visitLocal(sf)

  // Also collect const arrow functions
  function visitLocalConsts(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            const raw = getJSDocBefore(node, sf, text)
            localFuncs.set(decl.name.text, { jsdoc: raw, node: undefined as unknown as ts.FunctionDeclaration })
          }
        }
      }
    }
    ts.forEachChild(node, visitLocalConsts)
  }
  visitLocalConsts(sf)

  // For each exported name, try to find JSDoc from the source file
  const allExportNames = new Set<string>([...exportToSource.keys(), ...localFuncs.keys()])

  for (const exportName of allExportNames) {
    // Skip type-only exports and constants
    if (exportName === 'contractVersion') continue
    if (exportName.startsWith('DEFAULT_') || exportName.startsWith('STEEL_') || exportName.startsWith('ALUMINUM_')) continue
    if (exportName === 'MATERIALS' || exportName === 'INCH' || exportName === 'ACME_PITCH') continue
    if (exportName.endsWith('_TABLES') || exportName === 'SCREW_CLASSES' || exportName === 'BEARING_CLASSES') continue
    if (exportName === 'DRILL_TIP_ANGLE') continue
    if (exportName === 'ROOT_FLAT_ID') continue

    // Try local first
    const local = localFuncs.get(exportName)
    let raw: string | null = null
    let signature = `${exportName}(...)`

    if (local) {
      raw = local.jsdoc
      // Build signature from function declaration
      if (local.node) {
        const sigParams: string[] = []
        for (const param of local.node.parameters) {
          const pname = param.name.getText(sf)
          const ptype = param.type?.getText(sf) ?? 'any'
          const optional = param.questionToken ? '?' : ''
          sigParams.push(`${pname}${optional}: ${ptype}`)
        }
        const retType = local.node.type?.getText(sf) ?? 'any'
        signature = `${exportName}(${sigParams.join(', ')}): ${retType}`
      }
    } else {
      // Try to find in the source file
      const sourceFile = exportToSource.get(exportName)
      if (sourceFile && existsSync(sourceFile)) {
        const srcText = readFileSync(sourceFile, 'utf8')
        const srcSf = ts.createSourceFile(sourceFile, srcText, ts.ScriptTarget.Latest, true)
        const found = findExportInFile(exportName, srcSf, srcText)
        if (found) {
          raw = found.jsdoc
          signature = found.signature
        }
      }
    }

    if (!raw) continue // Skip exports without JSDoc (types, constants, etc.)

    const parsed = parseOpJSDoc(raw)
    entries.push({
      name: exportName,
      signature,
      description: parsed.description,
      params: parsed.params,
      returns: parsed.returns,
      examples: parsed.examples,
      packageName,
      importSpecifier,
      group: parsed.group || 'Other',
    })
  }

  return entries
}

/** Find a specific exported function/const in a source file and extract its JSDoc + signature. */
function findExportInFile(
  name: string,
  sf: ts.SourceFile,
  text: string,
): { jsdoc: string | null; signature: string } | null {
  let result: { jsdoc: string | null; signature: string } | null = null

  function visit(node: ts.Node) {
    if (result) return

    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      const raw = getJSDocBefore(node, sf, text)
      const sigParams: string[] = []
      for (const param of node.parameters) {
        const pname = param.name.getText(sf)
        const ptype = param.type?.getText(sf) ?? 'any'
        const optional = param.questionToken ? '?' : ''
        sigParams.push(`${pname}${optional}: ${ptype}`)
      }
      const retType = node.type?.getText(sf) ?? 'any'
      result = { jsdoc: raw, signature: `${name}(${sigParams.join(', ')}): ${retType}` }
      return
    }

    // export const name = (params) => { ... }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            const raw = getJSDocBefore(node, sf, text)
            const sigParams: string[] = []
            for (const param of decl.initializer.parameters) {
              const pname = param.name.getText(sf)
              const ptype = param.type?.getText(sf) ?? 'any'
              const optional = param.questionToken ? '?' : ''
              sigParams.push(`${pname}${optional}: ${ptype}`)
            }
            const retType = decl.initializer.type?.getText(sf) ?? 'any'
            result = { jsdoc: raw, signature: `${name}(${sigParams.join(', ')}): ${retType}` }
            return
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(sf)

  return result
}

// ── 6. Sketch op extraction ─────────────────────────────────────────────────

/** Extract the `cad.sketch` op JSDoc from the sketch library. */
function extractSketchOpDoc(): OpDocEntry | null {
  const opFile = join(sketchSrcDir, 'op.ts')
  if (!existsSync(opFile)) return null

  const text = readFileSync(opFile, 'utf8')
  const sf = ts.createSourceFile(opFile, text, ts.ScriptTarget.Latest, true)

  let result: OpDocEntry | null = null

  function visit(node: ts.Node) {
    if (result) return
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== 'sketch') continue
        if (!decl.initializer) continue
        const call = getCallExpression(decl.initializer)
        if (!call || !ts.isIdentifier(call.expression) || call.expression.text !== 'defineOp') continue

        const raw = getJSDocBefore(node, sf, text)
        if (!raw) continue

        const parsed = parseOpJSDoc(raw)
        // Extract schema
        let schema: Record<string, string> | undefined
        if (call.arguments.length > 0 && ts.isObjectLiteralExpression(call.arguments[0])) {
          const obj = call.arguments[0] as ts.ObjectLiteralExpression
          for (const prop of obj.properties) {
            if (ts.isPropertyAssignment(prop) && prop.name && ts.isIdentifier(prop.name) && prop.name.text === 'schema') {
              if (ts.isObjectLiteralExpression(prop.initializer)) {
                schema = {}
                for (const sp of prop.initializer.properties) {
                  if (ts.isPropertyAssignment(sp) && sp.name) {
                    const key = ts.isIdentifier(sp.name) ? sp.name.text : sp.name.getText(sf)
                    const val = sp.initializer.getText(sf).replace(/['"]/g, '')
                    schema[key] = val
                  }
                }
              }
            }
          }
        }

        result = {
          name: 'sketch',
          group: parsed.group || 'Sketch',
          description: parsed.description,
          params: parsed.params,
          returns: parsed.returns,
          examples: parsed.examples,
          isAsync: parsed.isAsync,
          schema,
          source: relative(root, opFile).replace(/\\/g, '/'),
        }
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return result
}

// ── 7. Editor op extraction ─────────────────────────────────────────────────

/** Extract editor op JSDoc from the merged core extra ops (`packages/core/src/extra/ops`). */
function extractEditorOpDocs(): Map<string, OpDocEntry> {
  const docs = new Map<string, OpDocEntry>()
  const opFiles = [
    join(extraSrcDir, 'ops/fai_drill.ts'),
    join(extraSrcDir, 'ops/fai_extrude.ts'),
    join(extraSrcDir, 'ops/fai_split.ts'),
    join(extraSrcDir, 'ops/compound.ts'),
    join(extraSrcDir, 'ops/copy.ts'),
    join(extraSrcDir, 'ops/load.ts'),
    join(extraSrcDir, 'ops/text.ts'),
    join(extraSrcDir, 'ops/svg-extrude.ts'),
  ]

  for (const fp of opFiles) {
    if (!existsSync(fp)) continue
    const text = readFileSync(fp, 'utf8')
    const sf = ts.createSourceFile(fp, text, ts.ScriptTarget.Latest, true)
    const relFile = relative(root, fp).replace(/\\/g, '/')

    function visit(node: ts.Node) {
      if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue
          const opName = decl.name.text
          // Skip non-op exports (types, helpers, etc.)
          if (!ALL_EDITOR_OPS.includes(opName as never)) continue

          const raw = getJSDocBefore(node, sf, text)
          if (!raw) continue

          const parsed = parseOpJSDoc(raw)
          docs.set(opName, {
            name: opName,
            group: parsed.group || 'Editor Ops',
            description: parsed.description,
            params: parsed.params,
            returns: parsed.returns,
            examples: parsed.examples,
            isAsync: parsed.isAsync,
            source: relFile,
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  return docs
}

// ── 8. Render ───────────────────────────────────────────────────────────────

const stripTrailingWs = (s: string): string => s.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n')

const BANNER = (target: 'occt' | 'brepkit', commonCount: number, occtOnly: string[], brepkitOnly: string[]): string => {
  const lines = [
    `> **Engine-specific skill doc — auto-generated** by \`scripts/gen-skill-docs.ts\` (do not edit by hand; regenerate via \`npm run gen:skill-docs -- --emit <kernel>\`).`,
    '>',
    `> This doc lists the APIs available when the runtime BREP engine is **${target}**.`,
    `> It contains the **${commonCount} engine-neutral (common) ops**${target === 'occt'
      ? ` plus the **${occtOnly.length} OCCT-only ops**.`
      : ` plus the **${brepkitOnly.length} brepkit-only ops** (currently none).`}`,
    `> OCCT-only ops (${occtOnly.length}: ${occtOnly.join(', ')}) are **excluded** from the brepkit doc;`,
    `> brepkit-only ops (${brepkitOnly.length}: ${brepkitOnly.join(', ') || 'none'}) are excluded from the OCCT doc.`,
    '',
  ]
  return lines.join('\n')
}

const OVERVIEW_TEXT = `# faijs — .fai.js Scripting API Skill

> **Purpose**: This skill file tells AI agents what APIs are available when writing \`.fai.js\` scripts for 3D CAD modeling with the faijs engine.

## What is faijs?

faijs is a CAD execution engine: a JavaScript-based language (\`.fai.js\`) for parametric 3D modeling with dual BREP (OCCT) and mesh (manifold) geometry backends. Scripts use a \`cad.*\` namespace for platform operations, and can \`import\` additional libraries for domain-specific capabilities (sheet metal, gears, fasteners, etc.).

## Script Structure

A \`.fai.js\` file is valid JavaScript with specific conventions:
- **Variable names must be descriptive and meaningful** (e.g., \`bottom_leg\`, \`gear_hub\`, \`mounting_plate\`). The \`part0\`, \`part1\`, ... pattern is only a UI-layer auto-generation convention — AI agents writing scripts must choose names that reflect the part's role in the design.
- The \`cad\` namespace is the default library, always available.
- Additional libraries are imported via \`import * as <binding> from '<specifier>'\`.
- **Units must be explicitly provided** using unit literal expressions. +Z is up. See the Unit System section below.

\`\`\`js
// A simple .fai.js script — note explicit unit literals
let base_plate = cad.box(100 * MM, 80 * MM, 10 * MM)
let shaft = cad.cylinder(5 * MM, 40 * MM)
let assembled = cad.union(base_plate, shaft)
\`\`\`

## Key Concepts

### Dual-Channel Execution
Every op supports the **mesh** path (default, manifold-3d). Some also support the **BREP** path (OCCT, exact geometry). Whether BREP is available is determined by **static rules** before execution — there is no runtime fallback. When a BREP-unsupported op is encountered, the chain switches to mesh for that operation onward.

### Result System
APIs use a \`Result<T>\` type (\`ok\`/\`err\`/\`isErr\`). In \`.fai.js\` scripts, statement boundaries automatically unwrap results — an \`err\` becomes a statement failure. Third-party library functions return \`Result\` natively; the boundary unwraps at the statement level.

### Topology References
Topology parameters (\`fillet.edges\`, \`chamfer.edges\`, \`shell.openFaces\`, \`draft.faces\`, \`defeature.faces\`, \`extrude.upTo\`, ...) are referenced by **portable topology identity** — \`EdgeTopoRef\` / \`FaceTopoRef\` — each recording the statement it was born from (\`origin\`) and its role within that statement (\`role\`), so the reference stays valid across parametric changes and across kernels.

**In generated scripts, topology parameters take the TopoRef literal the UI picker emits** (\`{ kind:'edge'|'face', origin, role, hint }\`). Pass it through unchanged; never hand-write \`origin\`/\`role\` values — they are assigned by the naming layer at runtime.

**⚠️ Never use ordinal references in generated scripts** — the \`cad.edgeRef\` / \`cad.faceRef\` query bridges or bare numbers. Ordinals are the kernel's enumeration order and drift across kernels and features (the same box enumerates edge[0] = length 5 under occt but length 20 under brepkit). \`edgeRef\` / \`faceRef\` are **query bridges only**, for FCStd import porting and mesh-chain parts that have no role layer; mesh-chain bare ordinals (\`openFaces: [4]\`) are likewise current-kernel-only.

### Selector Strings (precision chain)

When a script must pick topology without a UI-picked literal, use **CadQuery selector strings** on the BREP (precision) chain. The following ops accept them (as the top-level value or as array elements, in place of TopoRef literals):

| Op | Parameter accepting a selector string |
|---|---|
| \`fillet\` / \`chamfer\` | \`edges\` (edge selector) |
| \`filletVariable\` | \`edge\` (single edge; multi-match fails) |
| \`shell\` | \`openFaces\` (face selector) |
| \`draft\` / \`defeature\` | \`faces\` (face selector) |
| \`extrude\` | \`upTo\` (face selector, resolved on \`baseFeature\`; single face) |
| \`sketchOnFace\` / \`sketchOnSurface\` / \`punchHole\` | \`face\` (face selector on the target solid) |

Selector syntax follows CadQuery (compatible subset): \`">Z"\` = the face/edge at the Z extreme, \`"<Z"\` = Z minimum, \`"|Z"\` = parallel to Z (face normal / edge tangent), \`"#Z"\` = perpendicular to Z, \`"+Z"\`/\`"-Z"\` = facing +Z/-Z, \`"%LINE"\` = by type, \`">Z,|X"\`-style set expressions. Selectors are evaluated against the current kernel at runtime, so they are **portable across kernels** (unlike ordinals). A selector matching nothing, or matching more than one entity for a single-entity parameter, fails loudly — never silently picks one.

Selector strings are **precision-chain only**: the mesh chain has no role layer, so mesh solids must keep using 1-based ordinals (current-kernel-only, see above).

### Unit System
- **+Z is up.**
- **Units must be explicitly provided** using unit literal expressions. The following uppercase constants are available as read-only globals in \`.fai.js\` scripts:

| Constant | Value (base-unit scale) | Dimension |
|----------|------------------------|-----------|
| \`MM\` | 1 | length (base unit) |
| \`CM\` | 10 | length |
| \`METER\` | 1000 | length |
| \`MICRON\` | 0.001 | length |
| \`INCH\` | 25.4 | length |
| \`FOOT\` | 304.8 | length |
| \`YARD\` | 914.4 | length |
| \`DEGREE\` | 1 | angle (base unit) |
| \`RADIAN\` | 180/π | angle |
| \`GRAM\` | 1 | mass (base unit) |
| \`KILOGRAM\` | 1000 | mass |
| \`SECOND\` | 1 | time (base unit) |

- **Usage**: Multiply a number by a unit constant, e.g., \`10 * MM\`, \`2 * INCH\`, \`45 * DEGREE\`. The expression evaluates to a plain number in the base unit (mm for length, degree for angle).
- **Bare numbers on dimensioned parameters are rejected** by the dimension checker (\`E_DIM_BARE_NUMBER\`). You must always write \`10 * MM\`, not just \`10\`.
- Compound expressions are supported: \`10 * MM + 2 * MM\` evaluates to \`12\`.
- Unit constants are reserved — you cannot shadow them with \`let INCH = ...\` or use them as parameter names.`

/** Render an op entry as markdown. */
function renderOpEntry(op: OpDocEntry, bucket: Bucket): string {
  const lines: string[] = []
  const badge = bucket === 'occt-only' ? ' `[OCCT only]`' : bucket === 'brepkit-only' ? ' `[brepkit only]`' : ''
  const asyncTag = op.isAsync ? ' **Async**.' : ' **Sync**.'
  lines.push(`### \`${op.name}(...)\`${badge}`)
  lines.push(op.description)

  // Parameters
  if (op.params.size > 0) {
    lines.push('')
    lines.push('**Parameters**:')
    for (const [pname, pdesc] of op.params) {
      lines.push(`- \`${pname}\`: ${pdesc}`)
    }
  }

  // Schema (if available)
  if (op.schema && Object.keys(op.schema).length > 0) {
    lines.push('')
    lines.push('**Schema**: ' + Object.entries(op.schema).map(([k, v]) => `\`${k}: ${v}\``).join(', '))
  }

  // Returns
  if (op.returns) {
    lines.push('')
    lines.push(`**Returns**: ${op.returns}`)
  }

  lines.push('')
  lines.push(asyncTag)

  // Examples
  if (op.examples.length > 0) {
    lines.push('')
    lines.push('**Examples**:')
    for (const ex of op.examples) {
      lines.push('```js')
      lines.push(ex)
      lines.push('```')
    }
  }

  return lines.join('\n')
}

/** Render Shape instance methods section. */
function renderShapeMethods(methods: ShapeMethodEntry[]): string {
  const lines: string[] = []
  lines.push('## Shape Instance Methods')
  lines.push('')
  lines.push('Shape instances returned by `cad.*` ops carry instance methods for appearance and metadata control. These are **not** `cad.*` ops — they are called directly on shape variables (e.g., `box1.setColor(...)`).')
  lines.push('')

  // Group by interface
  const byInterface = new Map<string, ShapeMethodEntry[]>()
  for (const m of methods) {
    const arr = byInterface.get(m.interfaceName) ?? []
    arr.push(m)
    byInterface.set(m.interfaceName, arr)
  }

  const groupTitles: Record<string, string> = {
    ShapeAppearanceMethods: 'Appearance Methods (Color / Material / Opacity)',
    ShapeMetaMethods: 'Metadata Methods (Name / Description / Part Number)',
  }

  for (const [ifaceName, entries] of byInterface) {
    lines.push(`### ${groupTitles[ifaceName] ?? ifaceName}`)
    lines.push('')
    for (const m of entries) {
      lines.push(`#### \`${m.signature}\``)
      if (m.description) lines.push(m.description)

      if (m.params.size > 0) {
        lines.push('')
        lines.push('**Parameters**:')
        for (const [pname, pdesc] of m.params) {
          lines.push(`- \`${pname}\`: ${pdesc}`)
        }
      }

      if (m.returns) {
        lines.push('')
        lines.push(`**Returns**: ${m.returns}`)
      }

      if (m.examples.length > 0) {
        lines.push('')
        lines.push('**Examples**:')
        for (const ex of m.examples) {
          lines.push('```js')
          lines.push(ex)
          lines.push('```')
        }
      }
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd()
}

/** Render domain library section. */
function renderDomainLib(exports: DomainLibExport[], packageName: string, importSpecifier: string, title: string): string {
  const lines: string[] = []
  lines.push(`## ${title}`)
  lines.push('')
  lines.push(`Import in \`.fai.js\`:`)
  lines.push('```js')
  lines.push(`import * as lib from '${importSpecifier}'`)
  lines.push('```')
  lines.push('')

  // Group by @group tag
  const byGroup = new Map<string, DomainLibExport[]>()
  for (const e of exports) {
    const arr = byGroup.get(e.group) ?? []
    arr.push(e)
    byGroup.set(e.group, arr)
  }

  for (const [group, entries] of byGroup) {
    lines.push(`### ${group}`)
    lines.push('')
    for (const e of entries) {
      lines.push(`#### \`${e.signature}\``)
      if (e.description) lines.push(e.description)

      if (e.params.size > 0) {
        lines.push('')
        lines.push('**Parameters**:')
        for (const [pname, pdesc] of e.params) {
          lines.push(`- \`${pname}\`: ${pdesc}`)
        }
      }

      if (e.returns) {
        lines.push('')
        lines.push(`**Returns**: ${e.returns}`)
      }

      if (e.examples.length > 0) {
        lines.push('')
        lines.push('**Examples**:')
        for (const ex of e.examples) {
          lines.push('```js')
          lines.push(ex)
          lines.push('```')
        }
      }
      lines.push('')
    }
  }

  lines.push('**Notes**:')
  lines.push(`- Functions from ${packageName} return \`Promise<Result<T>>\`. In \`.fai.js\` scripts, \`err\` is unwrapped at the statement boundary.`)
  lines.push('- `BrepHandle` results are automatically adopted into faijs `Shape` at the library boundary.')
  lines.push('')

  return lines.join('\n').trimEnd()
}

/** Render the library directory table for SKILL.md. */
function renderLibraryTable(): string {
  return `## Available Libraries

The following packages provide capabilities usable in \`.fai.js\` scripts.

### Platform (built-in \`cad\` namespace)

| Package | Description |
|---------|-------------|
| **@faicad/faijs** (core) | The platform \`cad.*\` namespace: primitives (box, sphere, cylinder, cone, wedge), boolean ops (union, subtract, intersect, cut), feature ops (extrude, fillet, chamfer, shell, draft, sweep, loft, revolve, etc.), pattern ops, transform ops, query ops, Shape instance methods (appearance, metadata), and more. Always available — no import needed. |

### Editor Ops (built into \`cad\` namespace)

Editor ops are built into core (\`@faicad/faijs\`) and available via \`cad.*\`: \`fai_drill\`, \`fai_extrude\`, \`fai_split\`, \`group\`, \`assembly\`, \`copy\`, \`load\`, \`text\`, \`svgExtrude\`.

### Sketch Op (built into \`cad\` namespace)

\`cad.sketch\` — constraint-based sketching with planegcs solver. Built into core (\`@faicad/faijs\`).

### Domain Libraries (imported via \`import * as <binding> from '<specifier>'\`)

| Package | Import Specifier | Description |
|---------|------------------|-------------|
| **@faicad/sheetmetal** | \`@faicad/sheetmetal\` or short name \`sheetmetal\` | Sheet-metal authoring, unfold, flat patterns, bend relief, cutouts, nesting, DXF export. |
| **@faicad/faijs-gears** | \`@faicad/faijs-gears\` or short name \`faijs-gears\` | Gear generation: spur, herringbone, ring, bevel, worm, rack, planetary gearsets. |
| **@faicad/faijs-fasteners** | \`@faicad/faijs-fasteners\` or short name \`faijs-fasteners\` | Fasteners: threads, nuts, screws, washers, bearings, sprockets, chain, holes. |`
}

/** Render the full all_*.md doc for a given engine target. */
function renderAllDoc(
  target: 'occt' | 'brepkit',
  buckets: Map<string, Bucket>,
  opDocs: Map<string, OpDocEntry>,
  sketchDoc: OpDocEntry | null,
  editorDocs: Map<string, OpDocEntry>,
  shapeMethods: ShapeMethodEntry[],
  domainLibs: { exports: DomainLibExport[]; packageName: string; importSpecifier: string; title: string }[],
): string {
  const parts: string[] = []

  // Overview (reuse OVERVIEW_TEXT but change title)
  const overview = OVERVIEW_TEXT.replace(
    '# faijs — .fai.js Scripting API Skill',
    `# faijs (${target === 'occt' ? 'OCCT engine' : 'brepkit engine'} skill) — .fai.js Scripting API Skill`,
  )
  parts.push(overview)

  // Banner
  const occtOnly = [...buckets].filter(([, b]) => b === 'occt-only').map(([n]) => n).sort()
  const brepkitOnly = [...buckets].filter(([, b]) => b === 'brepkit-only').map(([n]) => n).sort()
  const commonCount = [...buckets.values()].filter(b => b === 'common').length
  parts.push(BANNER(target, commonCount, occtOnly, brepkitOnly))

  // Cad.* platform ops — grouped by @group
  const ns = createApiNamespace()
  const namespaceKeys = new Set<string>(Object.keys(ns).filter(k => k !== 'contractVersion' && typeof (ns as Record<string, unknown>)[k] === 'function'))
  const editorSketchKeys = new Set<string>([...ALL_EDITOR_OPS, ...SKETCH_OPS])

  // Separate ops into groups
  const platformOps: Array<{ doc: OpDocEntry; bucket: Bucket }> = []
  const scriptFaceOps: Array<{ doc: OpDocEntry; bucket: Bucket }> = []
  const scriptFaceNames = new Set(SCRIPT_FACE_OPS.map(o => o.name))

  for (const [name, bucket] of buckets) {
    if (!namespaceKeys.has(name)) continue
    const doc = opDocs.get(name)
    if (!doc) continue

    if (editorSketchKeys.has(name)) continue // handle separately
    if (scriptFaceNames.has(name)) {
      scriptFaceOps.push({ doc, bucket })
    } else {
      platformOps.push({ doc, bucket })
    }
  }

  // Render platform ops by group
  const groups = new Map<string, Array<{ doc: OpDocEntry; bucket: Bucket }>>()
  for (const entry of platformOps) {
    const g = entry.doc.group
    const arr = groups.get(g) ?? []
    arr.push(entry)
    groups.set(g, arr)
  }

  // Group ordering
  const groupOrder = [
    '创建', 'Primitives', 'Import', 'Boolean', 'Feature', 'Pattern',
    'Split', 'Transform', 'Repair', 'Structure', 'Assembly', 'Query',
    'Sketch', 'Surface', 'Measurement', 'Topology', 'View', 'Export', 'Other',
  ]

  const renderedGroups = new Set<string>()
  for (const g of groupOrder) {
    const entries = groups.get(g)
    if (!entries || entries.length === 0) continue
    renderedGroups.add(g)
    const lines: string[] = []
    lines.push(`## ${g}`)
    lines.push('')
    for (const { doc, bucket } of entries) {
      const keep = bucket === 'common' ||
        (target === 'occt' && bucket === 'occt-only') ||
        (target === 'brepkit' && bucket === 'brepkit-only')
      if (!keep) continue
      lines.push(renderOpEntry(doc, bucket))
      lines.push('')
    }
    if (lines.filter(l => l.startsWith('###')).length > 0) {
      parts.push(lines.join('\n').trimEnd())
    }
  }
  // Render any remaining groups
  for (const [g, entries] of groups) {
    if (renderedGroups.has(g)) continue
    const lines: string[] = []
    lines.push(`## ${g}`)
    lines.push('')
    for (const { doc, bucket } of entries) {
      const keep = bucket === 'common' ||
        (target === 'occt' && bucket === 'occt-only') ||
        (target === 'brepkit' && bucket === 'brepkit-only')
      if (!keep) continue
      lines.push(renderOpEntry(doc, bucket))
      lines.push('')
    }
    if (lines.filter(l => l.startsWith('###')).length > 0) {
      parts.push(lines.join('\n').trimEnd())
    }
  }

  // Script-face generated ops
  if (scriptFaceOps.length > 0) {
    const lines: string[] = []
    lines.push('## Generated Script-Face Ops')
    lines.push('')
    lines.push('These ops are generated from the L3 surface specification and merged into the `cad` namespace.')
    lines.push('')
    const sfGroups = new Map<string, Array<{ doc: OpDocEntry; bucket: Bucket }>>()
    for (const entry of scriptFaceOps) {
      const g = entry.doc.group
      const arr = sfGroups.get(g) ?? []
      arr.push(entry)
      sfGroups.set(g, arr)
    }
    for (const [g, entries] of sfGroups) {
      const subLines: string[] = [`### ${g}`, '']
      for (const { doc, bucket } of entries) {
        const keep = bucket === 'common' ||
          (target === 'occt' && bucket === 'occt-only') ||
          (target === 'brepkit' && bucket === 'brepkit-only')
        if (!keep) continue
        subLines.push(renderOpEntry(doc, bucket))
        subLines.push('')
      }
      if (subLines.filter(l => l.startsWith('####')).length > 0) {
        lines.push(subLines.join('\n').trimEnd())
      }
    }
    parts.push(lines.join('\n').trimEnd())
  }

  // Sketch op
  if (sketchDoc) {
    const lines: string[] = []
    lines.push('## Sketch')
    lines.push('')
    lines.push('The `cad.sketch` op is built into core (`@faicad/faijs`) and available in the `cad` namespace.')
    lines.push('')
    lines.push(renderOpEntry(sketchDoc, 'common'))
    parts.push(lines.join('\n').trimEnd())
  }

  // Editor ops
  if (editorDocs.size > 0) {
    const lines: string[] = []
    lines.push('## Editor Extension Ops')
    lines.push('')
    lines.push('These ops are built into core (`@faicad/faijs`) and available in the `cad` namespace.')
    lines.push('')
    // Group: A group (editor ops) and B group (creators)
    const groupA = ['fai_drill', 'fai_extrude', 'fai_split', 'group', 'assembly', 'copy', 'load']
    const groupB = ['text', 'svgExtrude']

    lines.push('### Editor Ops')
    lines.push('')
    for (const name of groupA) {
      const doc = editorDocs.get(name)
      if (!doc) continue
      lines.push(renderOpEntry(doc, 'common'))
      lines.push('')
    }

    lines.push('### SVG / 3D Text Creators')
    lines.push('')
    for (const name of groupB) {
      const doc = editorDocs.get(name)
      if (!doc) continue
      lines.push(renderOpEntry(doc, 'common'))
      lines.push('')
    }
    parts.push(lines.join('\n').trimEnd())
  }

  // Shape instance methods
  if (shapeMethods.length > 0) {
    parts.push(renderShapeMethods(shapeMethods))
  }

  // Domain libraries
  for (const lib of domainLibs) {
    if (lib.exports.length === 0) continue
    parts.push(renderDomainLib(lib.exports, lib.packageName, lib.importSpecifier, lib.title))
  }

  return stripTrailingWs(parts.join('\n\n---\n\n') + '\n')
}

// ── shared collection layer (imported by verify-script-face-jsdoc.ts) ──────

export {
  buildEngineBuckets, extractOpDocs, extractSketchOpDoc, extractEditorOpDocs,
  extractShapeMethods, extractDomainLibExports, parseOpJSDoc,
}
export type { Bucket, OpDocEntry, ShapeMethodEntry, DomainLibExport, ParsedJSDoc }

export interface SkillDocData {
  buckets: Map<string, Bucket>
  opDocs: Map<string, OpDocEntry>
  sketchDoc: OpDocEntry | null
  editorDocs: Map<string, OpDocEntry>
  shapeMethods: ShapeMethodEntry[]
  domainLibs: Array<{ exports: DomainLibExport[]; packageName: string; importSpecifier: string; title: string }>
}

/** Collect every script-face API doc entry (ops + shape methods + domain libs). */
export function collectSkillDocData(): SkillDocData {
  const sheetmetalExports = extractDomainLibExports(sheetmetalSrcDir, '@faicad/sheetmetal', '@faicad/sheetmetal', '@faicad/sheetmetal — Sheet-Metal CAD Domain')
  const gearsExports = extractDomainLibExports(gearsSrcDir, '@faicad/faijs-gears', '@faicad/faijs-gears', '@faicad/faijs-gears — Gear Generation Library')
  const fastenersExports = extractDomainLibExports(fastenersSrcDir, '@faicad/faijs-fasteners', '@faicad/faijs-fasteners', '@faicad/faijs-fasteners — Fastener Generation Library')
  return {
    buckets: buildEngineBuckets(),
    opDocs: extractOpDocs(),
    sketchDoc: extractSketchOpDoc(),
    editorDocs: extractEditorOpDocs(),
    shapeMethods: extractShapeMethods(),
    domainLibs: [
      { exports: sheetmetalExports, packageName: '@faicad/sheetmetal', importSpecifier: '@faicad/sheetmetal', title: '@faicad/sheetmetal — Sheet-Metal CAD Domain' },
      { exports: gearsExports, packageName: '@faicad/faijs-gears', importSpecifier: '@faicad/faijs-gears', title: '@faicad/faijs-gears — Gear Generation Library' },
      { exports: fastenersExports, packageName: '@faicad/faijs-fasteners', importSpecifier: '@faicad/faijs-fasteners', title: '@faicad/faijs-fasteners — Fastener Generation Library' },
    ],
  }
}

// ── main ────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  main()
}

/**
 * 生成 SKILL.md 概述（概述 + 单位制 + 脚本结构 + 库目录表）。
 * faijs 内部/调试用；ai-gateway 消费的是 `generateApiManual`。
 */
export function generateSkillOverview(): string {
  return stripTrailingWs(OVERVIEW_TEXT + '\n\n---\n\n' + renderLibraryTable() + '\n')
}

/**
 * 生成指定内核视角的完整 API 手册（基础提示词生成 API）。
 * - 输出即 ai-gateway `prompts/partials/all_<kernel>_<version>.md` 的内容来源；
 * - 保留 `(brepkit engine skill)` / `(OCCT engine skill)` 标题标记（sync 守卫依赖）；
 * - 内容守卫（无 `{{`、无 `cad.edgeRef(`/`cad.faceRef(` 调用形态）由
 *   `packages/tests/faijs/promptgen/gen-skill-docs.test.ts` 锁定。
 */
export function generateApiManual(kernel: 'brepkit' | 'occt'): string {
  const data = collectSkillDocData()
  return stripTrailingWs(renderAllDoc(kernel, data.buckets, data.opDocs, data.sketchDoc, data.editorDocs, data.shapeMethods, data.domainLibs))
}

function printBucketReport(data: SkillDocData): void {
  const buckets = data.buckets
  const groups: Record<string, string[]> = { 'common': [], 'occt-only': [], 'brepkit-only': [] }
  for (const [n, b] of buckets) groups[b].push(n)
  for (const k of Object.keys(groups)) groups[k].sort()
  console.log(`total ops: ${buckets.size}`)
  for (const k of Object.keys(groups)) console.log(`\n=== ${k} [${groups[k].length}] ===\n${groups[k].join(', ')}`)

  console.log(`\nshape methods: ${data.shapeMethods.length}`)
  console.log(`domain exports: sheetmetal=${data.domainLibs[0].exports.length}, gears=${data.domainLibs[1].exports.length}, fasteners=${data.domainLibs[2].exports.length}`)

  // Op coverage check
  const ns = createApiNamespace()
  const nsKeys = new Set(Object.keys(ns).filter(k => k !== 'contractVersion' && typeof (ns as Record<string, unknown>)[k] === 'function'))
  const documentedOps = new Set<string>([...data.opDocs.keys(), ...data.editorDocs.keys(), ...(data.sketchDoc ? [data.sketchDoc.name] : [])])
  const missing = [...nsKeys].filter(k => !documentedOps.has(k) && !buckets.has(k))
  if (missing.length) console.log(`\nWARNING: ops in namespace but no JSDoc: ${missing.join(', ')}`)
}

function main(): void {
  const args = process.argv.slice(2)

  if (args.includes('--print') || args.length === 0) {
    printBucketReport(collectSkillDocData())
    process.exit(0)
  }

  const emitIdx = args.indexOf('--emit')
  if (emitIdx !== -1) {
    const target = args[emitIdx + 1]
    if (target === 'brepkit') {
      console.log(generateApiManual('brepkit'))
      process.exit(0)
    }
    if (target === 'occt') {
      console.log(generateApiManual('occt'))
      process.exit(0)
    }
    if (target === 'all') {
      // 人工查看用：两份手册连续输出（消费方必须用单内核 --emit，勿解析 all）。
      console.log(generateApiManual('brepkit'))
      console.log('')
      console.log(generateApiManual('occt'))
      process.exit(0)
    }
    console.error('gen-skill-docs: unknown --emit target (expected brepkit | occt | all)')
    process.exit(1)
  }

  console.error(`gen-skill-docs: unknown option(s): ${args.join(' ')} (use --emit <brepkit|occt|all> or --print)`)
  process.exit(1)
}
