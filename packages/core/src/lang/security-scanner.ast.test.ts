/**
 * security-scanner.ast.test.ts — direct scanAst() coverage (the source-level
 * scanSource path is covered in security-scanner.test.ts; this covers reusing a
 * pre-parsed AST as the scanner's entry point).
 */
import { describe, it, expect } from 'vitest'
import { parse } from 'acorn'
import { scanAst } from './security-scanner'
import type { Program } from 'acorn'

function parseAst(code: string): Program {
  return parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) as unknown as Program
}

describe('scanAst', () => {
  it('rejects a pre-parsed AST containing eval', () => {
    const ast = parseAst('function f(){ return eval("6*7") }')
    const r = scanAst(ast, { policy: 'strict', knownNames: ['cad'] })
    expect(r.ok).toBe(false)
    expect(r.violations.length).toBeGreaterThan(0)
    expect(r.violations[0].ruleId).toBe('SEC_IDENT')
  })

  it('returns ok with no violations for a benign AST', () => {
    const ast = parseAst('const box = cad.box({ size: [1,2,3] })')
    const r = scanAst(ast, { policy: 'strict', knownNames: ['cad'] })
    expect(r.ok).toBe(true)
    expect(r.violations).toHaveLength(0)
  })

  it('policy off short-circuits to ok regardless of content', () => {
    const ast = parseAst('eval("1")')
    const r = scanAst(ast, { policy: 'off', knownNames: [] })
    expect(r.ok).toBe(true)
    expect(r.violations).toHaveLength(0)
  })

  it('detects a top-level statement count over the limit', () => {
    // Build a synthetic AST with far more top-level statements than S5_MAX_TOP_STATEMENTS.
    const body = new Array(6000).fill({ type: 'EmptyStatement' })
    const ast = { type: 'Program', body } as unknown as Program
    const r = scanAst(ast, { policy: 'strict', knownNames: ['cad'] })
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.ruleId === 'SEC_LIMIT')).toBe(true)
  })
})