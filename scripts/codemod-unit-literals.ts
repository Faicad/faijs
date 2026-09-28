/**
 * codemod-unit-literals.ts — P5: wrap dimensioned args in existing .fai.js files
 * with unit literals `( <expr> ) * mm`.
 *
 * Design (docs/plans/2026-09-28-unit-system-design.md §6 P5):
 * - Parse each .fai.js with acorn (same parser as metadata-extractor).
 * - Find `cad.<opName>(...)` CallExpressions.
 * - For each argument that maps to a parameter with a declared `paramDims` entry,
 *   wrap the expression text as `( <original> ) * mm` via AST start/end offsets.
 * - Idempotent: if the expression is already `X * <unitConst>`, skip.
 * - Semantic safety: `x ≡ x * mm` (mm = 1), so wrapping changes no geometry.
 *
 * Usage:
 *   npx tsx scripts/codemod-unit-literals.ts           # apply to all .fai.js
 *   npx tsx scripts/codemod-unit-literals.ts --check    # dry-run, exit 1 if changes needed
 */
import { parse as acornParse } from 'acorn'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, resolve, relative } from 'node:path'
import { SCRIPT_UNIT_NAMES } from '../packages/core/src/units'

// ── Op dimension declarations (mirrors defineOp paramDims + slotMap) ──────────
// Only ops that have declared paramDims need wrapping. Currently:
//   cad.box: paramDims { width, depth, height } = length, slotMap keys [width, depth, height]
//   cad.fai_extrude: paramDims { length, planeDistance } = length, no slotMap (object-form only)

interface OpDimDecl {
  paramDims: Record<string, string>
  slotMap?: { keys: string[]; vec3Keys?: string[]; shapeArity?: number }
}

const OP_DIMS: Record<string, OpDimDecl> = {
  'cad.box': {
    paramDims: { width: 'length', depth: 'length', height: 'length' },
    slotMap: { keys: ['width', 'depth', 'height'] },
  },
  'cad.fai_extrude': {
    paramDims: { length: 'length', planeDistance: 'length' },
  },
}

// Unit constant names from units.ts (SCRIPT_UNIT_NAMES). If an expression is
// already `X * <unitName>`, it's already a unit literal and should not be wrapped.
const UNIT_NAMES = SCRIPT_UNIT_NAMES

// ── AST helpers ───────────────────────────────────────────────────────────────

interface AcornNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

interface AcornCallExpression {
  type: 'CallExpression'
  callee: AcornNode
  arguments: AcornNode[]
  start: number
  end: number
}

interface AcornMemberExpression {
  type: 'MemberExpression'
  object: AcornNode
  property: AcornNode
  computed: boolean
  start: number
  end: number
}

interface AcornIdentifier {
  type: 'Identifier'
  name: string
  start: number
  end: number
}

interface AcornObjectExpression {
  type: 'ObjectExpression'
  properties: AcornProperty[]
  start: number
  end: number
}

interface AcornProperty {
  type: 'Property'
  key: AcornNode
  value: AcornNode
  shorthand: boolean
  computed: boolean
  start: number
  end: number
}

interface AcornArrayExpression {
  type: 'ArrayExpression'
  elements: (AcornNode | null)[]
  start: number
  end: number
}

interface AcornBinaryExpression {
  type: 'BinaryExpression'
  operator: string
  left: AcornNode
  right: AcornNode
  start: number
  end: number
}

interface AcornLiteral {
  type: 'Literal'
  value: unknown
  raw: string
  start: number
  end: number
}

function isIdentifier(node: AcornNode): node is AcornIdentifier {
  return node.type === 'Identifier'
}

function isMemberExpression(node: AcornNode): node is AcornMemberExpression {
  return node.type === 'MemberExpression'
}

function isCallExpression(node: AcornNode): node is AcornCallExpression {
  return node.type === 'CallExpression'
}

function isObjectExpression(node: AcornNode): node is AcornObjectExpression {
  return node.type === 'ObjectExpression'
}

function isArrayExpression(node: AcornNode): node is AcornArrayExpression {
  return node.type === 'ArrayExpression'
}

function isBinaryExpression(node: AcornNode): node is AcornBinaryExpression {
  return node.type === 'BinaryExpression'
}

function isLiteral(node: AcornNode): node is AcornLiteral {
  return node.type === 'Literal'
}

/**
 * Check if an expression node is already a unit literal: `X * unitConst`.
 * We look for BinaryExpression with operator `*` and right side being an
 * Identifier whose name is in UNIT_NAMES.
 */
function isAlreadyUnitLiteral(node: AcornNode): boolean {
  if (!isBinaryExpression(node)) return false
  if (node.operator !== '*') return false
  if (isIdentifier(node.right) && UNIT_NAMES.has(node.right.name)) return true
  // Also handle `(X * unitConst)` — parenthesized, but acorn strips parens
  // so the inner BinaryExpression is what we see.
  return false
}

/**
 * Get the callee full name for `cad.opName` pattern.
 * Returns 'cad.opName' or null.
 */
function getCadCalleeName(callee: AcornNode): string | null {
  if (!isMemberExpression(callee)) return null
  if (callee.computed) return null
  const obj = callee.object
  const prop = callee.property
  if (!isIdentifier(obj) || !isIdentifier(prop)) return null
  if (obj.name !== 'cad') return null
  return `cad.${prop.name}`
}

// ── Core wrapping logic ───────────────────────────────────────────────────────

interface TextEdit {
  start: number
  end: number
  replacement: string
}

/**
 * Check if an expression node is "simple" — a literal or identifier.
 * Simple expressions don't need parentheses when wrapped as `expr * mm`.
 * E.g. `10 * mm` instead of `( 10 ) * mm`, `size * mm` instead of `( size ) * mm`.
 */
function isSimpleExpr(node: AcornNode): boolean {
  return isLiteral(node) || isIdentifier(node)
}

/**
 * Generate a text edit to wrap an expression as a unit literal.
 * Simple expressions (literals, identifiers): `10 * mm`, `size * mm`.
 * Complex expressions: `( 10 + 5 ) * mm`.
 *
 * Also normalizes existing wrapped simple forms: `( 10 ) * mm` → `10 * mm`.
 * Returns null if the expression is already a unit literal in canonical form.
 */
function makeUnitEdit(exprNode: AcornNode, source: string): TextEdit | null {
  // Check if already a unit literal: `X * unitConst`
  if (isAlreadyUnitLiteral(exprNode)) {
    // The right side is a unit constant. Check if left is a simple expr
    // but the source text has parentheses around it — if so, normalize.
    const leftNode = (exprNode as AcornBinaryExpression).left
    if (isSimpleExpr(leftNode)) {
      const leftText = source.slice(leftNode.start, leftNode.end)
      const fullText = source.slice(exprNode.start, exprNode.end)
      const canonical = `${leftText} * mm`
      // Check if the source uses a different unit or has parens
      const rightName = (exprNode as AcornBinaryExpression).right as AcornIdentifier
      const unitName = rightName.name
      const canonicalWithUnit = `${leftText} * ${unitName}`
      if (fullText !== canonicalWithUnit) {
        return {
          start: exprNode.start,
          end: exprNode.end,
          replacement: canonicalWithUnit,
        }
      }
    }
    return null
  }

  const text = source.slice(exprNode.start, exprNode.end)
  if (isSimpleExpr(exprNode)) {
    return {
      start: exprNode.start,
      end: exprNode.end,
      replacement: `${text} * mm`,
    }
  }
  return {
    start: exprNode.start,
    end: exprNode.end,
    replacement: `( ${text} ) * mm`,
  }
}

/**
 * Process a single CallExpression node and return text edits to apply.
 */
function processCall(callNode: AcornCallExpression, source: string): TextEdit[] {
  const calleeName = getCadCalleeName(callNode.callee)
  if (!calleeName) return []

  const decl = OP_DIMS[calleeName]
  if (!decl) return []

  const edits: TextEdit[] = []
  const args = callNode.arguments
  if (args.length === 0) return []

  // Determine if this is positional form or object form.
  // Positional form: cad.box(20, 20, 20, { centered: true })
  // Object form: cad.box({ width: 20, depth: 20, height: 20, centered: true })
  // For fai_extrude: cad.fai_extrude(part0, { length: 5 }) — shapeArity = 1 implicitly

  const slotMap = decl.slotMap
  const shapeArity = slotMap?.shapeArity ?? 0

  // Check if the first non-shape arg is an ObjectExpression (object form)
  // or if all args are positional (positional form).
  // For ops with no slotMap (like fai_extrude), it's always object form
  // (first arg is shape, rest is options object).

  if (slotMap) {
    // Could be positional or object form
    // In positional form: shapeArity shapes, then positional scalar/vec3 values,
    // then an optional options object at the end.
    // In object form: shapeArity shapes, then one options object.

    const firstNonShape = args[shapeArity]
    if (firstNonShape && isObjectExpression(firstNonShape)) {
      // Object form — check if this is a pure options object or if it contains
      // dimensioned params. We need to distinguish between:
      //   cad.box({ width: 20, depth: 20, height: 20 })  — object form with dims
      //   cad.box(20, 20, 20, { centered: true })         — positional, last is options
      //
      // Heuristic: if the object has any key that's in paramDims, it's the object form.
      // If it only has non-paramDims keys (like centered, at), it's the options object
      // for positional form.
      const hasDimKeys = firstNonShape.properties.some(
        (p) => {
          if (p.type !== 'Property') return false
          const keyNode = p.key
          if (isIdentifier(keyNode)) {
            return keyNode.name in decl.paramDims
          }
          return false
        },
      )

      if (hasDimKeys) {
        // True object form — wrap dimensioned properties
        for (const prop of firstNonShape.properties) {
          if (prop.type !== 'Property') continue
          const keyNode = prop.key
          if (!isIdentifier(keyNode)) continue
          const paramName = keyNode.name
          const dim = decl.paramDims[paramName]
          if (!dim) continue

          // Wrap the value expression
          const edit = makeUnitEdit(prop.value, source)
          if (edit) {
            edits.push(edit)
          }

          // Handle vec3 keys — if this param is a vec3Key, wrap each element
          if (slotMap.vec3Keys?.includes(paramName) && isArrayExpression(prop.value)) {
            for (const el of prop.value.elements) {
              if (!el) continue
              const elEdit = makeUnitEdit(el, source)
              if (elEdit) {
                edits.push(elEdit)
              }
            }
          }
        }
      }
      // else: positional form with trailing options object — handled below
    }

    // Check for positional form (non-object first non-shape arg, or
    // object was just options and we have positional args before it)
    if (!firstNonShape || !isObjectExpression(firstNonShape) || !firstNonShape.properties.some(
      (p) => p.type === 'Property' && isIdentifier(p.key) && p.key.name in decl.paramDims,
    )) {
      // Positional form
      const keys = slotMap.keys
      const vec3Keys = new Set(slotMap.vec3Keys ?? [])
      let keyIdx = 0
      for (let i = shapeArity; i < args.length && keyIdx < keys.length; i++) {
        const arg = args[i]
        if (isObjectExpression(arg)) break // options object — stop

        const paramName = keys[keyIdx]
        const dim = decl.paramDims[paramName]
        keyIdx++

        if (!dim) continue

        if (vec3Keys.has(paramName) && isArrayExpression(arg)) {
          // vec3 positional — each element wrapped
          for (const el of arg.elements) {
            if (!el) continue
            const elEdit = makeUnitEdit(el, source)
            if (elEdit) {
              edits.push(elEdit)
            }
          }
        } else {
          // Scalar positional
          const edit = makeUnitEdit(arg, source)
          if (edit) {
            edits.push(edit)
          }
        }
      }
    }
  } else {
    // No slotMap — object form only (shapeArity shapes + options object)
    // e.g. cad.fai_extrude(part0, { length: 5 })
    for (let i = shapeArity; i < args.length; i++) {
      const arg = args[i]
      if (!isObjectExpression(arg)) continue

      for (const prop of arg.properties) {
        if (prop.type !== 'Property') continue
        const keyNode = prop.key
        if (!isIdentifier(keyNode)) continue
        const paramName = keyNode.name
        const dim = decl.paramDims[paramName]
        if (!dim) continue

        const edit = makeUnitEdit(prop.value, source)
        if (edit) {
          edits.push(edit)
        }
      }
    }
  }

  return edits
}

// ── AST walker ────────────────────────────────────────────────────────────────

function walkAst(node: AcornNode, visit: (node: AcornNode) => void): void {
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue
    const child = (node as Record<string, unknown>)[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && 'type' in item) {
          walkAst(item as AcornNode, visit)
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      walkAst(child as AcornNode, visit)
    }
  }
}

// ── File processing ───────────────────────────────────────────────────────────

interface ProcessResult {
  file: string
  changed: boolean
  editCount: number
}

function processFile(filePath: string, dryRun: boolean): ProcessResult {
  const source = readFileSync(filePath, 'utf8')
  let ast: AcornNode

  try {
    ast = acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      ranges: true,
    }) as unknown as AcornNode
  } catch {
    // Parse error — skip this file (might be non-JS or have syntax issues)
    return { file: filePath, changed: false, editCount: 0 }
  }

  const allEdits: TextEdit[] = []

  walkAst(ast, (node) => {
    if (isCallExpression(node)) {
      const edits = processCall(node, source)
      allEdits.push(...edits)
    }
  })

  if (allEdits.length === 0) {
    return { file: filePath, changed: false, editCount: 0 }
  }

  // Sort edits by start position descending (apply from end to start to not
  // mess up offsets)
  allEdits.sort((a, b) => b.start - a.start)

  // Apply edits
  let result = source
  for (const edit of allEdits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }

  if (!dryRun) {
    writeFileSync(filePath, result, 'utf8')
  }

  return { file: filePath, changed: true, editCount: allEdits.length }
}

// ── Directory walker ──────────────────────────────────────────────────────────

function findFaiJsFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      // Skip node_modules and dist
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
      results.push(...findFaiJsFiles(fullPath))
    } else if (entry.endsWith('.fai.js')) {
      results.push(fullPath)
    }
  }
  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const dryRun = process.argv.includes('--check')
  const root = resolve(import.meta.dirname, '..')
  const searchDirs = [
    join(root, 'packages'),
    join(root, 'docs'),
  ]

  const files: string[] = []
  for (const dir of searchDirs) {
    files.push(...findFaiJsFiles(dir))
  }

  console.log(`Found ${files.length} .fai.js files`)

  let totalChanged = 0
  let totalEdits = 0
  const changedFiles: string[] = []

  for (const file of files) {
    const result = processFile(file, dryRun)
    if (result.changed) {
      totalChanged++
      totalEdits += result.editCount
      const relPath = relative(root, file)
      changedFiles.push(relPath)
      if (dryRun) {
        console.log(`  [DRY RUN] ${relPath}: ${result.editCount} edit(s)`)
      }
    }
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Changed ${totalChanged} files, ${totalEdits} total edits`)

  if (dryRun && totalChanged > 0) {
    process.exit(1)
  }
}

main()
