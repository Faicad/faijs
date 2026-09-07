/**
 * Auto-generate complete JSDoc for exported functions using TypeScript compiler API.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const files = [
  'packages/cq-compat/src/workplane.ts',
  'packages/cq-compat/src/assembly.ts',
  'packages/cq-compat/src/transpile.ts',
]

function getParamName(p: ts.ParameterDeclaration): string {
  if (ts.isIdentifier(p.name)) return p.name.text
  if (ts.isObjectBindingPattern(p.name)) return 'opts'
  if (ts.isArrayBindingPattern(p.name)) return 'args'
  return 'arg'
}

function getParamType(p: ts.ParameterDeclaration, checker: ts.TypeChecker): string {
  if (p.type) return p.type.getText()
  const t = checker.getTypeAtLocation(p)
  return checker.typeToString(t)
}

function getReturnType(fn: ts.FunctionDeclaration, checker: ts.TypeChecker): string {
  if (fn.type) return fn.type.getText()
  const sig = checker.getSignatureFromDeclaration(fn)
  if (sig) return checker.typeToString(checker.getReturnTypeOfSignature(sig))
  return 'void'
}

for (const rel of files) {
  const path = resolve(import.meta.dirname, '..', rel)
  const text = readFileSync(path, 'utf8')
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true)
  const program = ts.createProgram([path], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  const checker = program.getTypeChecker()

  const replacements: { start: number; end: number; jsdoc: string }[] = []

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
      const isExported = mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
      if (isExported) {
        const fnName = node.name.text
        const params = node.parameters.filter(p => !ts.isIdentifier(p.name) || p.name.text !== 'this')
        const retType = getReturnType(node, checker)

        const lines: string[] = []
        lines.push('/**')
        lines.push(` * ${fnName}`)
        for (const p of params) {
          const pname = getParamName(p)
          const ptype = getParamType(p, checker)
          lines.push(` * @param ${pname} - ${ptype}`)
        }
        if (retType !== 'void' && retType !== 'Promise<void>') {
          lines.push(` * @returns ${retType}`)
        }
        lines.push(' */')
        const jsdoc = lines.join('\n')

        // Find existing JSDoc range (if any) or insert before function
        const jsdocRanges = ts.getJSDocCommentRanges(node, text)
        if (jsdocRanges && jsdocRanges.length > 0) {
          // Replace existing JSDoc
          const range = jsdocRanges[jsdocRanges.length - 1]
          replacements.push({ start: range.pos, end: range.end, jsdoc })
        } else {
          // Insert before function (use full start including leading trivia)
          const start = node.getStart(sf)
          replacements.push({ start, end: start, jsdoc: jsdoc + '\n' })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (replacements.length === 0) {
    console.log(`${rel}: no exported functions`)
    continue
  }

  // Apply replacements in reverse order
  replacements.sort((a, b) => b.start - a.start)
  let result = text
  for (const r of replacements) {
    result = result.slice(0, r.start) + r.jsdoc + result.slice(r.end)
  }
  writeFileSync(path, result, 'utf8')
  console.log(`${rel}: replaced ${replacements.length} JSDoc blocks`)
}
