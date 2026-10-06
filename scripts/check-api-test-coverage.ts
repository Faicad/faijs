#!/usr/bin/env tsx
/**
 * check-api-test-coverage — source-based API test coverage gate
 *
 * Source-level export surface + parameter manifest extractor + L1/L2 coverage gate.
 * Reads package.json exports → maps to source files → builds ts.Program →
 * extracts exported symbols + their parameters → checks test/ files for coverage.
 *
 * Usage: npx tsx scripts/check-api-test-coverage.ts --package=<dir> [options]
 *   --package=<dir>        package directory under packages/ (e.g. "core", "sheetmetal")
 *   --report-only          produce manifest only, do not fail
 *   --generate-baseline    write current gaps to api-coverage-baseline.json and exit
 *
 * Baseline: known gaps in api-coverage-baseline.json are suppressed (prevents
 * regression while P4 closes gaps incrementally). Only NEW gaps fail the gate.
 */

import * as ts from 'typescript'
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, extname, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ── CLI args ──
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)

const pkgDir = args.package
if (!pkgDir) {
  console.error('Usage: npx tsx scripts/check-api-test-coverage.ts --package=<dir>')
  process.exit(1)
}

const pkgRoot = resolve(ROOT, 'packages', pkgDir)
const pkgJsonPath = join(pkgRoot, 'package.json')
if (!existsSync(pkgJsonPath)) {
  console.error(`package.json not found: ${pkgJsonPath}`)
  process.exit(1)
}

const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
const reportOnly = args['report-only'] === 'true'
const generateBaseline = args['generate-baseline'] === 'true'

// Baseline file: known gaps that are temporarily allowed (P4 incremental cleanup).
// The gate only fails on gaps NOT in the baseline — this prevents regression
// while allowing the existing gap to be closed incrementally.
const baselinePath = join(pkgRoot, 'api-coverage-baseline.json')
interface Baseline {
  l1Missing: string[]
  l2Missing: Array<{ name: string; missing: string[] }>
}
let baseline: Baseline | null = null
if (!generateBaseline && existsSync(baselinePath)) {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'))
}

// ── 1. Map exports to source files ──

interface ExportEntry {
  /** The export key from package.json (e.g. ".", "./api"). */
  key: string
  /** The resolved source .ts file path (absolute). */
  sourceFile: string
}

function exportsToSourceFiles(exports: Record<string, { types?: string }>): ExportEntry[] {
  const entries: ExportEntry[] = []
  for (const [key, val] of Object.entries(exports)) {
    // Skip wildcard keys (they are patterns, not concrete entries)
    if (key.includes('*')) continue
    if (!val?.types) continue
    // dist/ mirrors src/: strip .d.ts, replace dist/ with src/, add .ts
    let typesPath = val.types.replace(/\.d\.ts$/, '')
    typesPath = typesPath.replace(/^\.\/dist\//, './src/')
    // Try .ts, then .tsx
    const tsPath = join(pkgRoot, typesPath + '.ts')
    const tsxPath = join(pkgRoot, typesPath + '.tsx')
    if (existsSync(tsPath)) {
      entries.push({ key, sourceFile: tsPath })
    } else if (existsSync(tsxPath)) {
      entries.push({ key, sourceFile: tsxPath })
    } else {
      console.warn(`  WARN: source not found for "${key}": ${typesPath}.ts(.tsx)`)
    }
  }
  return entries
}

const exportEntries = exportsToSourceFiles(pkgJson.exports)
if (exportEntries.length === 0) {
  console.error(`No concrete export entries found for ${pkgJson.name}`)
  process.exit(0)
}

console.log(`\nPackage: ${pkgJson.name} (${pkgDir})`)
console.log(`Export entries: ${exportEntries.length}`)
for (const e of exportEntries) {
  console.log(`  ${e.key} → ${relative(pkgRoot, e.sourceFile)}`)
}

// ── 2. Build ts.Program from source files ──

// Collect all source files reachable from the entry points
const rootFiles = exportEntries.map((e) => e.sourceFile)

// Read tsconfig for compiler options
const tsconfigPath = join(pkgRoot, 'tsconfig.json')
let compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
}

if (existsSync(tsconfigPath)) {
  const tsconfigRaw = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (tsconfigRaw.config) {
    // Use parseJsonConfigFileContent to properly parse string-valued options
    const parsed = ts.parseJsonConfigFileContent(
      tsconfigRaw.config,
      ts.sys,
      pkgRoot,
    )
    compilerOptions = {
      ...parsed.options,
      noEmit: true,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
    }
  }
}

const program = ts.createProgram(rootFiles, compilerOptions)
const checker = program.getTypeChecker()

// ── 3. Extract exported symbols + parameters ──

interface ApiParam {
  name: string
  /** Whether this parameter is an options object (has named properties). */
  isObject: boolean
  /** If isObject, the property names extracted from the type. */
  properties?: string[]
  /** Whether the parameter is optional. */
  optional: boolean
}

interface ApiEntry {
  name: string
  /** The export key this symbol comes from. */
  exportKey: string
  /** Parameter list (positional). */
  params: ApiParam[]
  /** Whether this is a function (vs class/const/type). */
  kind: 'function' | 'class' | 'const' | 'type'
  /** Whether this function is a dual-op (defineOp/compatOp). */
  isOp?: boolean
  /** If isOp, the schema-declared parameter names (from DualOpMeta.schema). */
  schemaParams?: string[]
}

/** Known option-container parameter names whose properties are testable parameters. */
const OPTION_PARAM_NAMES = new Set([
  'options', 'opts', 'config', 'params', 'args', 'settings', 'props',
])

/** Well-known Array/Object prototype methods — not testable parameters. */
const ARRAY_METHODS = new Set([
  'length', 'toString', 'toLocaleString', 'valueOf', 'pop', 'push',
  'concat', 'join', 'reverse', 'shift', 'slice', 'sort', 'splice',
  'unshift', 'indexOf', 'lastIndexOf', 'every', 'some', 'forEach',
  'map', 'filter', 'reduce', 'reduceRight', 'find', 'findIndex',
  'fill', 'copyWithin', 'entries', 'keys', 'values', 'includes',
  'flatMap', 'flat', 'at', 'findLast', 'findLastIndex', 'toReversed',
  'toSorted', 'toSpliced', 'with', 'constructor', 'hasOwnProperty',
  'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
  '__@iterator@93', '__@unscopables@95', '__@iterator@166',
  '__@unscopables@168',
])

/** Extract parameter info from a function declaration's signature. */
function extractParams(sig: ts.Signature): ApiParam[] {
  const params: ApiParam[] = []
  for (const decl of sig.getParameters()) {
    const sym = decl
    const name = sym.getName()
    if (name === 'this') continue

    const decls = sym.getDeclarations()
    if (!decls || decls.length === 0) continue

    const paramDecl = decls[0] as ts.ParameterDeclaration
    const optional = !!paramDecl.questionToken || !!paramDecl.initializer

    // Check if the type is an object type
    const type = checker.getTypeOfSymbolAtLocation(sym, paramDecl)
    const isObjectType = type && (type.flags & ts.TypeFlags.Object)

    // Only extract properties for option-container params or anonymous object
    // types (inline `{ foo: number, bar: string }`). Named types like `Shape`
    // are positional geometry inputs, not option bags — their properties are
    // not testable parameters.
    let properties: string[] | undefined
    if (isObjectType) {
      const isOptionName = OPTION_PARAM_NAMES.has(name)
      // Check if the type is anonymous (inline object literal type) vs named
      // type.symbol !== undefined means it's a named type (interface/class)
      const isNamedType = type.symbol && type.symbol.name !== '__type' && type.symbol.name !== 'Object'
      const shouldExtractProps = isOptionName || !isNamedType
      if (shouldExtractProps) {
        const props = checker.getPropertiesOfType(type)
        if (props.length > 0) {
          // Filter out numeric indices, array methods, and Object.prototype
          // methods — these are not testable parameters.
          const filtered = props
            .map((p) => p.getName())
            .filter((p) => {
              // Skip numeric indices (e.g. "0", "1", "2")
              if (/^\d+$/.test(p)) return false
              // Skip well-known array/Object methods
              if (ARRAY_METHODS.has(p)) return false
              // Skip Symbol-well-known properties (e.g. __@iterator@335)
              if (p.startsWith('__@')) return false
              return true
            })
          if (filtered.length > 0) {
            properties = filtered
          }
        }
      }
    }

    params.push({
      name,
      isObject: !!properties,
      properties,
      optional,
    })
  }
  return params
}

/** Follow re-export chains to find the ultimate value declaration. */
function resolveSymbol(sym: ts.Symbol): ts.Symbol {
  let current = sym
  let depth = 0
  while (depth < 20) {
    // If the symbol has no value declaration, it might be a re-export
    if (current.flags & ts.SymbolFlags.Alias) {
      const aliased = checker.getAliasedSymbol(current)
      if (aliased && aliased !== current) {
        current = aliased
        depth++
        continue
      }
    }
    break
  }
  return current
}

/**
 * Extract parameter names from JSDoc @param tags.
 * Handles dotted params like `@param params.depth` by extracting
 * the object property name (`.depth` → `depth`).
 *
 * JSDoc @param tags for ops are typically attached to the
 * VariableDeclaration / FirstStatement (the `export const xxx = defineOp(...)`
 * node), not to the defineOp call itself. The tag's `.name` is an AST node
 * (QualifiedName for dotted names, Identifier for simple names), so we use
 * `getText()` to get the full name string.
 */
function extractJsdocParams(decl: ts.Node): string[] | undefined {
  // JSDoc tags may be on the VariableStatement, FirstStatement, or other
  // ancestor nodes. Walk up the parent chain to find JSDoc tags.
  let jsdocTags: readonly ts.JSDocTag[] | undefined
  let current: ts.Node | undefined = decl
  while (current) {
    const tags = ts.getJSDocTags(current)
    if (tags && tags.length > 0) {
      jsdocTags = tags
      break
    }
    current = current.parent
  }
  if (!jsdocTags || jsdocTags.length === 0) return undefined

  const params: string[] = []
  for (const tag of jsdocTags) {
    if (tag.tagName.text !== 'param') continue
    // ts.JSDocParameterTag has a .name property which is an AST node
    // (QualifiedName for dotted names like "params.depth", Identifier for
    // simple names like "input").
    const paramTag = tag as unknown as { name?: ts.Node }
    const nameNode = paramTag.name
    if (!nameNode) continue
    // Use getText() to get the full name string from the AST node
    const name = nameNode.getText ? nameNode.getText() : ''
    if (!name) continue
    // For dotted names like "params.depth", extract the property name
    if (name.includes('.')) {
      const parts = name.split('.')
      // Use the last part (the property name)
      params.push(parts[parts.length - 1])
    } else {
      // Simple names — keep for now, filter wrappers below
      params.push(name)
    }
  }

  // Filter out positional wrapper param names (the Shape input / params container)
  const wrapperNames = new Set([
    'inputOrParams', 'maybeParams', 'args', 'params', 'options',
    'input', 'shape', 'shapes', 'solid', 'part',
  ])
  const filtered = params.filter((p) => !wrapperNames.has(p))
  return filtered.length > 0 ? filtered : undefined
}

/** Extract schema params from a defineOp/compatOp call expression. */
function extractSchemaParams(node: ts.Node): string[] | undefined {
  if (!ts.isCallExpression(node)) return undefined
  const fn = node.expression
  let fnName = ''
  if (ts.isIdentifier(fn)) fnName = fn.text
  else if (ts.isPropertyAccessExpression(fn)) fnName = fn.name.text

  if (fnName !== 'defineOp' && fnName !== 'compatOp') return undefined

  // First argument is the declaration object
  const arg = node.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined

  // Find the "schema" property
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const propName = prop.name
    if (!ts.isIdentifier(propName) || propName.text !== 'schema') continue

    const schemaInit = prop.initializer
    if (!ts.isObjectLiteralExpression(schemaInit)) return undefined

    const schemaKeys: string[] = []
    for (const sProp of schemaInit.properties) {
      if (ts.isPropertyAssignment(sProp) && ts.isIdentifier(sProp.name)) {
        schemaKeys.push(sProp.name.text)
      } else if (ts.isShorthandPropertyAssignment(sProp)) {
        schemaKeys.push(sProp.name.text)
      }
    }
    return schemaKeys
  }
  return undefined
}

/**
 * Extract paramDims keys from a defineOp/compatOp call expression.
 * `paramDims` declares per-parameter dimension names (e.g.
 * `{ diameter: 'length', depth: 'length' }`), so its keys are a
 * reliable source of parameter names for ops without `schema`.
 */
function extractParamDimsKeys(node: ts.Node): string[] | undefined {
  if (!ts.isCallExpression(node)) return undefined
  const fn = node.expression
  let fnName = ''
  if (ts.isIdentifier(fn)) fnName = fn.text
  else if (ts.isPropertyAccessExpression(fn)) fnName = fn.name.text

  if (fnName !== 'defineOp' && fnName !== 'compatOp') return undefined

  const arg = node.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined

  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const propName = prop.name
    if (!ts.isIdentifier(propName) || propName.text !== 'paramDims') continue

    const dimsInit = prop.initializer
    if (!ts.isObjectLiteralExpression(dimsInit)) return undefined

    const keys: string[] = []
    for (const dProp of dimsInit.properties) {
      if (ts.isPropertyAssignment(dProp) && ts.isIdentifier(dProp.name)) {
        keys.push(dProp.name.text)
      } else if (ts.isShorthandPropertyAssignment(dProp)) {
        keys.push(dProp.name.text)
      }
    }
    return keys.length > 0 ? keys : undefined
  }
  return undefined
}

/** Find all defineOp/compatOp call expressions in a source file. */
function findOpCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const fn = node.expression
      let fnName = ''
      if (ts.isIdentifier(fn)) fnName = fn.text
      else if (ts.isPropertyAccessExpression(fn)) fnName = fn.name.text
      if (fnName === 'defineOp' || fnName === 'compatOp') {
        calls.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return calls
}

const apiEntries: ApiEntry[] = []
const seenSymbols = new Set<string>()

for (const entry of exportEntries) {
  const sourceFile = program.getSourceFile(entry.sourceFile)
  if (!sourceFile) {
    console.warn(`  WARN: could not get source file for ${entry.sourceFile}`)
    continue
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) {
    console.warn(`  WARN: no module symbol for ${entry.sourceFile}`)
    continue
  }

  const exports = checker.getExportsOfModule(moduleSymbol)

  // Also find op calls in this file (for schema/paramDims extraction)
  const opCalls = findOpCalls(sourceFile)
  const opSchemaMap = new Map<string, string[]>() // var name → schema params
  const opParamDimsMap = new Map<string, string[]>() // var name → paramDims keys

  // Map export declarations to their initializer call expressions
  // to detect defineOp/compatOp and extract schema + paramDims
  for (const opCall of opCalls) {
    const schemaParams = extractSchemaParams(opCall)
    const paramDimsKeys = extractParamDimsKeys(opCall)
    // Find which variable this call is assigned to
    let parent = opCall.parent
    while (parent) {
      if (ts.isVariableDeclaration(parent)) {
        const varName = (parent.name as ts.Identifier).text
        if (schemaParams) opSchemaMap.set(varName, schemaParams)
        if (paramDimsKeys) opParamDimsMap.set(varName, paramDimsKeys)
        break
      }
      if (ts.isExportAssignment(parent)) {
        // Anonymous export — skip
        break
      }
      parent = parent.parent
    }
  }

  for (const exp of exports) {
    const name = exp.getName()
    if (seenSymbols.has(name)) continue
    seenSymbols.add(name)

    // Follow re-export chains to find the ultimate definition
    const resolved = resolveSymbol(exp)
    const symValueDecl = resolved.valueDeclaration ?? exp.valueDeclaration
    let kind: ApiEntry['kind'] = 'const'
    let params: ApiParam[] = []
    let isOp = false
    let schemaParams: string[] | undefined

    if (symValueDecl) {
      if (ts.isFunctionDeclaration(symValueDecl) || ts.isFunctionExpression(symValueDecl)) {
        kind = 'function'
        const sig = checker.getSignatureFromDeclaration(symValueDecl as ts.SignatureDeclaration)
        if (sig) {
          params = extractParams(sig)
        }
      } else if (ts.isClassDeclaration(symValueDecl)) {
        kind = 'class'
        const ctor = (symValueDecl as ts.ClassDeclaration).members.find(
          (m) => m.kind === ts.SyntaxKind.Constructor,
        ) as ts.ConstructorDeclaration | undefined
        if (ctor) {
          const sig = checker.getSignatureFromDeclaration(ctor)
          if (sig) params = extractParams(sig)
        }
      } else if (ts.isVariableDeclaration(symValueDecl)) {
        const init = symValueDecl.initializer
        if (init) {
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            kind = 'function'
            const sig = checker.getSignatureFromDeclaration(init)
            if (sig) params = extractParams(sig)
          } else if (ts.isCallExpression(init)) {
            kind = 'function'
            const fn = init.expression
            let fnName = ''
            if (ts.isIdentifier(fn)) fnName = fn.text
            else if (ts.isPropertyAccessExpression(fn)) fnName = fn.name.text
            if (fnName === 'defineOp' || fnName === 'compatOp') {
              isOp = true
              schemaParams = extractSchemaParams(init)
              const type = checker.getTypeAtLocation(symValueDecl)
              const sigs = type.getCallSignatures()
              if (sigs.length > 0) {
                params = extractParams(sigs[0])
              }
            } else {
              const type = checker.getTypeAtLocation(symValueDecl)
              const sigs = type.getCallSignatures()
              if (sigs.length > 0) {
                kind = 'function'
                params = extractParams(sigs[0])
              }
            }
          }
        }
      }
    }

    // Also check opSchemaMap for this name (ops defined in the same file)
    if (!schemaParams && opSchemaMap.has(name)) {
      isOp = true
      schemaParams = opSchemaMap.get(name)
    }

    // For ops without schema, try JSDoc @param tags first (most complete),
    // then fall back to paramDims keys (partial but reliable).
    if (isOp && !schemaParams) {
      // Try all declarations (re-exported symbols may have JSDoc on original)
      const allDecls = resolved.declarations ?? exp.declarations ?? []
      for (const d of allDecls) {
        const jsdocParams = extractJsdocParams(d)
        if (jsdocParams) {
          schemaParams = jsdocParams
          break
        }
      }
    }
    if (isOp && !schemaParams && opParamDimsMap.has(name)) {
      schemaParams = opParamDimsMap.get(name)
    }

    // Skip type-only exports (interfaces, type aliases) with no value declaration
    if (!symValueDecl && !resolved.declarations?.length && !exp.declarations?.length) continue
    if (!symValueDecl && (exp.flags & ts.SymbolFlags.Type || resolved.flags & ts.SymbolFlags.Type)) {
      apiEntries.push({
        name,
        exportKey: entry.key,
        params: [],
        kind: 'type',
      })
      continue
    }

    apiEntries.push({
      name,
      exportKey: entry.key,
      params,
      kind,
      isOp,
      schemaParams,
    })
  }
}

// ── 4. Produce api-manifest.json ──

interface ManifestEntry {
  name: string
  exportKey: string
  kind: string
  isOp: boolean
  params: Array<{
    name: string
    isObject: boolean
    properties?: string[]
    optional: boolean
  }>
  /** Op schema-declared parameter names (when isOp=true). */
  schemaParams?: string[]
  /** Unified parameter list: for ops, schemaParams takes precedence; for functions, signature params. */
  unifiedParams?: string[]
  /**
   * L2-testable parameters: for ops, the schema/JSDoc params (passed as
   * object literal at call site); for non-op functions, only the properties
   * of option-container params (not positional params like `shape`, `part`).
   */
  l2Params?: string[]
}

const manifest: ManifestEntry[] = apiEntries.map((e) => {
  const entry: ManifestEntry = {
    name: e.name,
    exportKey: e.exportKey,
    kind: e.kind,
    isOp: !!e.isOp,
    params: e.params.map((p) => ({
      name: p.name,
      isObject: p.isObject,
      properties: p.properties,
      optional: p.optional,
    })),
  }

  if (e.isOp) {
    // For ops, schemaParams (from schema, JSDoc, or paramDims) is the
    // authoritative parameter list. Signature params (input Shape, params
    // Record) are positional containers, not testable parameters.
    if (e.schemaParams) {
      entry.schemaParams = e.schemaParams
      entry.unifiedParams = e.schemaParams
      // L2: all schema params are testable (passed as object literal at call site)
      entry.l2Params = e.schemaParams
    } else {
      // Op with no extractable params (e.g. copy only takes a Shape input)
      entry.schemaParams = []
      entry.unifiedParams = []
      entry.l2Params = []
    }
  } else if (e.params.length > 0) {
    // For non-ops, flatten positional params + object properties
    const unified: string[] = []
    const l2: string[] = []
    for (const p of e.params) {
      if (p.isObject && p.properties) {
        unified.push(...p.properties)
        // L2: only option-container properties are testable at call sites
        l2.push(...p.properties)
      } else {
        unified.push(p.name)
        // L2: positional params (shape, part, etc.) are not checked as
        // object literal properties — they're just passed positionally.
      }
    }
    entry.unifiedParams = unified
    entry.l2Params = l2
  }

  return entry
})

const manifestPath = join(pkgRoot, 'api-manifest.json')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`\nManifest written: ${relative(pkgRoot, manifestPath)} (${manifest.length} entries)`)

// Summary
const ops = manifest.filter((e) => e.isOp)
const functions = manifest.filter((e) => !e.isOp && e.kind === 'function')
const classes = manifest.filter((e) => e.kind === 'class')
const types = manifest.filter((e) => e.kind === 'type')
const consts = manifest.filter((e) => e.kind === 'const')

console.log(`  Ops: ${ops.length}, Functions: ${functions.length}, Classes: ${classes.length}, Types: ${types.length}, Consts: ${consts.length}`)

// List ops with their schema params
if (ops.length > 0) {
  console.log(`\n  Op schema parameters:`)
  for (const op of ops) {
    console.log(`    ${op.name}: [${op.schemaParams?.join(', ') ?? ''}]`)
  }
}

// List functions with params
if (functions.length > 0) {
  console.log(`\n  Function parameters:`)
  for (const fn of functions) {
    const params = fn.params.map((p) =>
      p.isObject ? `${p.name}: { ${p.properties?.join(', ')} }` : p.name,
    )
    console.log(`    ${fn.name}: (${params.join(', ')})`)
  }
}

if (reportOnly) {
  console.log('\n[report-only mode — no failure]')
  process.exit(0)
}

// ── 5. P3: L1/L2 coverage gate ──

/**
 * Collect all test files in the package's test directory.
 * Scans test dir for .test.ts and .test.tsx files.
 */
function collectTestFiles(testDir: string): string[] {
  if (!existsSync(testDir)) return []
  const results: string[] = []
  function scan(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        scan(full)
      } else if (st.isFile()) {
        if (full.endsWith('.test.ts') || full.endsWith('.test.tsx')) {
          results.push(full)
        }
      }
    }
  }
  scan(testDir)
  return results
}

/**
 * Collect .fai.js fixture files used by tests.
 * Scans packages/tests/faijs/ for .fai.js files that exercise this package's ops.
 */
function collectFaiJsFixtures(pkgName: string): string[] {
  const fixturesDir = join(ROOT, 'packages', 'tests', 'faijs')
  if (!existsSync(fixturesDir)) return []
  const results: string[] = []
  function scan(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        scan(full)
      } else if (st.isFile() && full.endsWith('.fai.js')) {
        results.push(full)
      }
    }
  }
  scan(fixturesDir)
  return results
}

const testDir = join(pkgRoot, 'test')
const testFiles = collectTestFiles(testDir)

// Also collect .fai.js fixtures (they exercise ops via cad.* calls)
const faiJsFiles = collectFaiJsFixtures(pkgDir)

if (testFiles.length === 0 && faiJsFiles.length === 0) {
  console.error(`\n❌ No test files found in ${relative(ROOT, testDir)} or packages/tests/faijs/`)
  console.error('   Cannot verify API coverage without tests.')
  process.exit(1)
}

console.log(`\nTest files: ${testFiles.length} (.test.ts/.tsx) + ${faiJsFiles.length} (.fai.js fixtures)`)

// ── Parse test files to AST and collect references ──

/**
 * Build a set of all identifiers referenced in test source code (excluding
 * comments and string literals). Used for L1 function-name coverage.
 *
 * Also collects property names in object literals within CallExpressions
 * for L2 parameter coverage.
 */
interface TestCoverage {
  /** All identifiers found in test code (L1: function name presence). */
  identifiers: Set<string>
  /**
   * Map from function name → set of property names used at its call sites.
   * E.g. `box(10, 20, 30, { at: [0,0,0], centered: true })` contributes
   * box → { at, centered }.
   */
  callProps: Map<string, Set<string>>
}

function parseTestCoverage(filePath: string): TestCoverage {
  const content = readFileSync(filePath, 'utf-8')
  const identifiers = new Set<string>()
  const callProps = new Map<string, Set<string>>()

  // .fai.js files are plain JS — parse as JS
  const isJs = filePath.endsWith('.fai.js') || filePath.endsWith('.js')
  const sf = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    isJs ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  )

  function visit(node: ts.Node) {
    // Collect identifiers (L1)
    if (ts.isIdentifier(node)) {
      identifiers.add(node.text)
    }

    // Collect call-site property names (L2)
    if (ts.isCallExpression(node)) {
      // Get the function name being called
      let fnName: string | undefined
      const expr = node.expression
      if (ts.isIdentifier(expr)) {
        fnName = expr.text
      } else if (ts.isPropertyAccessExpression(expr)) {
        // e.g. cad.box(...) — use the property name
        fnName = expr.name.text
      }

      if (fnName) {
        // Collect property names from all object literal arguments
        const propNames = callProps.get(fnName) ?? new Set<string>()
        for (const arg of node.arguments) {
          collectPropertyNames(arg, propNames)
        }
        callProps.set(fnName, propNames)
      }
    }

    ts.forEachChild(node, visit)
  }

  function collectPropertyNames(node: ts.Node, into: Set<string>) {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          into.add(prop.name.text)
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          into.add(prop.name.text)
        }
        // Recurse into nested object literals (e.g. { at: { x: 0 } })
        if (ts.isPropertyAssignment(prop)) {
          collectPropertyNames(prop.initializer, into)
        }
      }
    }
    // Also recurse into array elements that may contain object literals
    if (ts.isArrayLiteralExpression(node)) {
      for (const elem of node.elements) {
        collectPropertyNames(elem, into)
      }
    }
  }

  visit(sf)
  return { identifiers, callProps }
}

// Aggregate coverage from all test files
const allIdentifiers = new Set<string>()
const allCallProps = new Map<string, Set<string>>()

for (const tf of [...testFiles, ...faiJsFiles]) {
  const cov = parseTestCoverage(tf)
  for (const id of cov.identifiers) allIdentifiers.add(id)
  for (const [fn, props] of cov.callProps) {
    const existing = allCallProps.get(fn) ?? new Set<string>()
    for (const p of props) existing.add(p)
    allCallProps.set(fn, existing)
  }
}

// ── L1: Function coverage (hard gate) ──
// Only check value exports (functions, ops, classes, consts) — skip types.
const l1Missing: string[] = []
for (const entry of manifest) {
  if (entry.kind === 'type') continue
  // Skip consts that are simple values (no params, not ops) — they're
  // constants like LENGTH = 'length', not testable API functions.
  if (entry.kind === 'const' && !entry.isOp && (!entry.unifiedParams || entry.unifiedParams.length === 0)) {
    // Still check L1: the name should appear somewhere in tests
  }
  if (!allIdentifiers.has(entry.name)) {
    l1Missing.push(entry.name)
  }
}

// ── L2: Parameter coverage (hard gate) ──
// Only check l2Params (option-container properties for functions, schema
// params for ops). Positional params (shape, part, etc.) are not checked
// at L2 — they're verified by L1 (function is referenced).
const l2Missing: Array<{ name: string; missing: string[] }> = []
for (const entry of manifest) {
  if (entry.kind === 'type') continue
  if (!entry.l2Params || entry.l2Params.length === 0) continue

  // L1 must pass first — if the function name isn't even referenced, skip
  // (it's already reported in L1)
  if (!allIdentifiers.has(entry.name)) continue

  const props = allCallProps.get(entry.name)
  if (!props) {
    // The function is referenced but never called with an object literal
    // — all l2Params are missing
    l2Missing.push({ name: entry.name, missing: [...entry.l2Params] })
    continue
  }

  const missing = entry.l2Params.filter((p) => !props.has(p))
  if (missing.length > 0) {
    l2Missing.push({ name: entry.name, missing })
  }
}

// ── Baseline filtering ──
// If a baseline exists, filter out known gaps. Only NEW gaps (not in baseline)
// cause the gate to fail. This prevents regression while P4 closes gaps incrementally.
//
// --generate-baseline mode: write the current gaps as the new baseline file.

if (generateBaseline) {
  const bl: Baseline = {
    l1Missing: [...l1Missing].sort(),
    l2Missing: l2Missing
      .map(({ name, missing }) => ({ name, missing: [...missing].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
  writeFileSync(baselinePath, JSON.stringify(bl, null, 2) + '\n', 'utf-8')
  console.log(`Baseline written: ${baselinePath}`)
  console.log(`  L1: ${bl.l1Missing.length} gaps, L2: ${bl.l2Missing.length} gaps`)
  process.exit(0)
}

// Filter against baseline
let l1New = [...l1Missing]
let l2New = [...l2Missing]
if (baseline) {
  const bl1 = new Set(baseline.l1Missing)
  l1New = l1Missing.filter((name) => !bl1.has(name))

  const bl2Map = new Map<string, Set<string>>()
  for (const e of baseline.l2Missing) {
    bl2Map.set(e.name, new Set(e.missing))
  }
  l2New = l2Missing
    .map(({ name, missing }) => ({
      name,
      missing: missing.filter((p) => !bl2Map.get(name)?.has(p)),
    }))
    .filter((e) => e.missing.length > 0)
}

// ── Report ──

const totalL1 = manifest.filter((e) => e.kind !== 'type').length
const totalL2 = manifest.filter((e) => e.l2Params?.length).length

if (l1New.length === 0 && l2New.length === 0) {
  console.log('\n✅ API coverage gate passed')
  console.log(`   L1: ${totalL1} exports checked, ${l1Missing.length} known gaps (baseline)`)
  console.log(`   L2: ${totalL2} APIs with params checked, ${l2Missing.length} known gaps (baseline)`)
  if (baseline && l1Missing.length === 0 && l2Missing.length === 0) {
    console.log('   🎉 All baseline gaps closed — consider deleting the baseline file!')
  }
  process.exit(0)
}

console.error('\n❌ API coverage gate failed')

if (l1New.length > 0) {
  console.error(`\n  L1 — exported APIs not referenced in tests (${l1New.length}):`)
  for (const name of l1New.sort()) {
    console.error(`    ${name}`)
  }
}

if (l2New.length > 0) {
  console.error(`\n  L2 — parameters not covered at call sites (${l2New.length}):`)
  for (const { name, missing } of l2New.sort((a, b) => a.name.localeCompare(b.name))) {
    console.error(`    ${name}: missing [${missing.join(', ')}]`)
  }
}

if (baseline && (l1Missing.length > l1New.length || l2Missing.length > l2New.length)) {
  const suppressedL1 = l1Missing.length - l1New.length
  const suppressedL2 = l2Missing.length - l2New.length
  console.error(`\n  (${suppressedL1} L1 + ${suppressedL2} L2 gaps suppressed by baseline — close them in P4)`)
}

process.exit(1)
