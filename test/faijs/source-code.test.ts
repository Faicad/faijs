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
