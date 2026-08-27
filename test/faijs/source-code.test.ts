/**
 * faijs source code tests — parse and execute .faijs files end-to-end.
 *
 * Tests error handling and args validation.
 * Individual category tests are in subdirectories (primitives/, transforms/, etc.).
 *
 * Run: npx vitest run test/faijs/source-code.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseScript, ParseError } from '../../src/lang/parser'
import { validateScriptArgs } from '../../src/lang/args-schema'
import { SCHEMAS } from '../../src/stdlib/schemas'

describe('faijs source code: parse error handling', () => {
  it('rejects JavaScript syntax errors', () => {
    const code = `let part0 = cad.box({ size: 20`
    expect(() => parseScript(code)).toThrow()
  })

  it('rejects non-arrow-function export (old format)', () => {
    const code = `export default function(cad) {
  let part0 = cad.box({ size: 20 })
  return { shape: part0 }
}`
    expect(() => parseScript(code)).toThrow(ParseError)
  })

  it('rejects non-cad expression statements', () => {
    const code = `let part0 = cad.box({ size: 20 })
console.log(part0)`
    expect(() => parseScript(code)).toThrow(ParseError)
  })
})

describe('faijs source code: args-schema validation', () => {
  it('rejects missing required args via args validation', () => {
    const code = `let part0 = cad.box({})`
    const { script } = parseScript(code)
    const errors = validateScriptArgs(script.statements, SCHEMAS)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('accepts unknown op (validation is done at execution time)', () => {
    const code = `let part0 = cad.bogusOp({ size: 20 })`
    const { script } = parseScript(code)
    const errors = validateScriptArgs(script.statements, SCHEMAS)
    expect(errors.length).toBe(0)  // No schema = no validation errors
  })
})
