/**
 * check-op-dims — op dimension declaration exhaustiveness guard (D8+).
 *
 * Every `defineOp(…)` / `compatOp(…)` call site in the scanned source tree
 * must declare `paramDims` (or `spec`). The guard enforces:
 *
 *   1. **Presence** — a defineOp/compatOp call without `paramDims` AND without
 *      `spec` is a violation. This is the primary gate: forgetting to declare
 *      dims on a new op fails CI.
 *   2. **JSDoc cross-check (heuristic)** — when a JSDoc `@param params.X`
 *      annotation carries a unit marker like `(mm)`, `(degree)`, `(rad)`,
 *      `(kg)`, the parameter `X` should appear in `paramDims` with a matching
 *      dimension. This catches silent omissions where the author wrote the
 *      JSDoc unit but forgot the dim declaration.
 *
 * The guard uses TypeScript AST (already a dependency via check-ghost-deps).
 * It does NOT execute any code — pure static analysis.
 *
 * Usage: node scripts/check-op-dims.mjs
 * Exit code: 0 = pass; 1 = violations found.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories to scan for defineOp/compatOp call sites. */
const SCAN_DIRS = [
  join(repoRoot, 'packages/core/src/api'),
  join(repoRoot, 'packages/faijs-extra/src/ops'),
  join(repoRoot, 'packages/sketch/src'),
  join(repoRoot, 'packages/sheetmetal/src'),
  join(repoRoot, 'packages/draw/src'),
  join(repoRoot, 'packages/faijs-gears/src'),
  join(repoRoot, 'packages/faijs-fasteners/src'),
]

/** Legal DimName values + 'plain'. */
const LEGAL_DIM_VALUES = new Set([
  'length', 'angle', 'mass', 'temperature', 'time', 'current', 'plain',
])

/**
 * Collect all .ts files under a directory (excluding node_modules/dist).
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function collectTs(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectTs(full, out)
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Extract all defineOp/compatOp call expressions from a source file.
 * Returns an array of { node, kind: 'defineOp'|'compatOp', sourceFile }.
 *
 * @param {ts.SourceFile} sf
 * @returns {{node: ts.CallExpression, kind: string, sf: ts.SourceFile}[]}
 */
function findOpCalls(sf) {
  const results = []

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'defineOp' || node.expression.text === 'compatOp')
    ) {
      results.push({ node, kind: node.expression.text, sf })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return results
}

/**
 * Check if a property in an object literal is named 'paramDims' or 'spec'.
 * @param {ts.ObjectLiteralElementLike} prop
 * @returns {string|null} 'paramDims' | 'spec' | null
 */
function dimPropertyName(prop) {
  if (!ts.isPropertyAssignment(prop)) return null
  const name = prop.name
  if (ts.isIdentifier(name)) {
    if (name.text === 'paramDims') return 'paramDims'
    if (name.text === 'spec') return 'spec'
  }
  return null
}

/**
 * Unwrap `as` type assertions and parenthesized expressions to get the
 * underlying object literal. defineOp/compatOp calls often look like:
 *   defineOp({ ... } as SomeType)
 * The `as` makes the argument a BinaryExpression (TS < 5) or AsExpression.
 * @param {ts.Node} node
 * @returns {ts.ObjectLiteralExpression | null}
 */
function unwrapToObjectLiteral(node) {
  let current = node
  // Unwrap parentheses and `as` expressions
  while (current) {
    if (ts.isObjectLiteralExpression(current)) return current
    if (ts.isAsExpression(current)) { current = current.expression; continue }
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue }
    // TS < 5 uses BinaryExpression for `as`
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.AsKeyword) {
      current = current.left
      continue
    }
    break
  }
  return null
}

/**
 * Extract the paramDims object keys from a defineOp/compatOp call's argument.
 * Returns { hasParamDims: boolean, hasSpec: boolean, keys: string[], values: Map<string, string> }
 *
 * @param {ts.CallExpression} callNode
 * @returns {{hasParamDims: boolean, hasSpec: boolean, keys: string[], values: Map<string,string>}}
 */
function extractDimInfo(callNode) {
  const result = { hasParamDims: false, hasSpec: false, keys: [], values: new Map() }

  // The first argument should be an object literal (the declaration object),
  // possibly wrapped in `as` type assertions.
  if (callNode.arguments.length === 0) return result
  const arg = unwrapToObjectLiteral(callNode.arguments[0])
  if (!arg) return result

  for (const prop of arg.properties) {
    const dimName = dimPropertyName(prop)
    if (dimName === 'paramDims') {
      result.hasParamDims = true
      // Extract keys from the object literal value
      if (ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const inner of prop.initializer.properties) {
          if (ts.isPropertyAssignment(inner)) {
            const key = inner.name.getText()
            const val = inner.initializer.getText().replace(/['"]/g, '')
            result.keys.push(key)
            result.values.set(key, val)
          }
        }
      }
    } else if (dimName === 'spec') {
      result.hasSpec = true
    }
  }

  return result
}

/**
 * Extract JSDoc @param annotations from the source around a call expression.
 * Looks for @param params.X - description (mm) / (degree) / (rad) / (kg) patterns.
 *
 * @param {ts.SourceFile} sf
 * @param {ts.CallExpression} callNode
 * @returns {Map<string, string>} param name → detected unit hint
 */
function extractJsdocUnitHints(sf, callNode) {
  const hints = new Map()

  // Get the JSDoc from the node's symbol or from preceding comments.
  // TypeScript attaches JSDoc to the node via node.jsDoc (internal) or
  // we can parse the raw text.
  const text = sf.text
  const pos = callNode.getStart(sf)
  const lineStart = text.lastIndexOf('\n', pos) + 1

  // Scan backwards for comment blocks (/** ... */) preceding this call.
  // We look for the comment that ends just before this line (with optional whitespace).
  let searchPos = lineStart - 1
  // Skip whitespace backwards
  while (searchPos > 0 && (text[searchPos] === ' ' || text[searchPos] === '\t' || text[searchPos] === '\r' || text[searchPos] === '\n')) {
    searchPos--
  }
  // Check if there's a */ closing a JSDoc
  if (searchPos < 1 || text.slice(searchPos - 1, searchPos + 1) !== '*/') return hints

  // Find the matching /**
  const commentEnd = searchPos + 1
  const commentStart = text.lastIndexOf('/**', commentEnd)
  if (commentStart === -1) return hints

  const commentText = text.slice(commentStart, commentEnd)

  // Parse @param params.X - description (unit) patterns
  // Also handle @param inputOrParams.X for ops like text
  const paramRegex = /@param\s+(?:params|inputOrParams)\.(\w+)\s*-?\s*([^\n@]*)/g
  let match
  while ((match = paramRegex.exec(commentText)) !== null) {
    const paramName = match[1]
    const description = match[2]
    // Look for (mm), (degree), (rad), (kg), (gram) etc.
    const unitMatch = description.match(/\((mm|cm|m|micron|inch|foot|yard|degree|rad|radian|kg|gram|second)\)/i)
    if (unitMatch) {
      const unit = unitMatch[1].toLowerCase()
      // Map unit to dimension
      const unitToDim = {
        mm: 'length', cm: 'length', m: 'length', micron: 'length',
        inch: 'length', foot: 'length', yard: 'length',
        degree: 'angle', rad: 'angle', radian: 'angle',
        kg: 'mass', gram: 'mass',
        second: 'time',
      }
      const dim = unitToDim[unit]
      if (dim) hints.set(paramName, dim)
    }
  }

  return hints
}

/** @type {string[]} */
const violations = []

// Scan all directories
for (const scanDir of SCAN_DIRS) {
  const files = collectTs(scanDir)
  for (const filePath of files) {
    // Skip the compat-op implementation file — it contains an internal
    // defineOp call that builds the wrapper, not an op declaration.
    if (filePath.replace(/\\/g, '/').endsWith('internal/compat-op.ts')) continue

    const code = readFileSync(filePath, 'utf-8')
    const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.ES2022, true)
    const opCalls = findOpCalls(sf)

    for (const { node, kind, sf: opSf } of opCalls) {
      const dimInfo = extractDimInfo(node)

      // Rule 1: paramDims or spec must be present
      if (!dimInfo.hasParamDims && !dimInfo.hasSpec) {
        const pos = node.getStart(opSf)
        const { line } = opSf.getLineAndCharacterOfPosition(pos)
        const relPath = filePath.replace(repoRoot + '/', '')
        violations.push(
          `${relPath}:${line + 1} — ${kind}() call missing 'paramDims' (and no 'spec'). Every defineOp/compatOp must declare paramDims.`,
        )
        continue // Skip further checks for this call
      }

      // Rule 1b: validate paramDims values are legal
      if (dimInfo.hasParamDims) {
        for (const [key, val] of dimInfo.values) {
          if (!LEGAL_DIM_VALUES.has(val)) {
            const pos = node.getStart(opSf)
            const { line } = opSf.getLineAndCharacterOfPosition(pos)
            const relPath = filePath.replace(repoRoot + '/', '')
            violations.push(
              `${relPath}:${line + 1} — ${kind}() paramDims.${key} has illegal value '${val}'. Legal: ${[...LEGAL_DIM_VALUES].join(', ')}.`,
            )
          }
        }
      }

      // Rule 2: JSDoc cross-check (only for paramDims, not spec)
      if (dimInfo.hasParamDims) {
        const hints = extractJsdocUnitHints(opSf, node)
        for (const [paramName, expectedDim] of hints) {
          const declared = dimInfo.values.get(paramName)
          if (declared === undefined) {
            // JSDoc says (mm) but paramDims doesn't list this param
            const pos = node.getStart(opSf)
            const { line } = opSf.getLineAndCharacterOfPosition(pos)
            const relPath = filePath.replace(repoRoot + '/', '')
            violations.push(
              `${relPath}:${line + 1} — ${kind}() JSDoc says @param params.${paramName} (${expectedDim}) but paramDims doesn't declare it.`,
            )
          } else if (declared !== expectedDim && declared !== 'plain') {
            // Declared dim doesn't match JSDoc hint
            const pos = node.getStart(opSf)
            const { line } = opSf.getLineAndCharacterOfPosition(pos)
            const relPath = filePath.replace(repoRoot + '/', '')
            violations.push(
              `${relPath}:${line + 1} — ${kind}() paramDims.${paramName}='${declared}' but JSDoc says (${expectedDim}).`,
            )
          }
        }
      }
    }
  }
}

// Report
if (violations.length > 0) {
  console.error(`\n❌ check-op-dims: ${violations.length} violation(s) found:\n`)
  for (const v of violations) {
    console.error(`  ${v}`)
  }
  console.error('\nEvery defineOp/compatOp must declare paramDims (or spec) covering all numeric parameters.')
  console.error('See: docs/plans/2026-10-10-op-dims-declaration-guard.md')
  process.exit(1)
} else {
  console.log('✓ check-op-dims: all defineOp/compatOp calls have paramDims/spec declarations.')
  process.exit(0)
}
