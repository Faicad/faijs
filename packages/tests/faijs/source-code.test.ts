/**
 * faijs source code tests — parse error handling via analyzeCode.
 *
 * 用 analyzeCode 验证语法错误抛 ParseError。
 *
 * Run: npx vitest run test/faijs/source-code.test.ts
 */

import { describe, it, expect } from 'vitest'
import { extractMetadata } from '@faicad/faijs/lang/metadata-extractor'

/** `analyzeCode` 已迁至宿主层（A4）；旧实现即 extractMetadata(code).lines。 */
const analyzeCode = (code: string) => extractMetadata(code).lines
import { ParseError } from '@faicad/faijs/lang/parse-error'

describe('faijs source code: parse error handling', () => {
  it('rejects JavaScript syntax errors', () => {
    const code = `let part0 = cad.box(20, 20, 20`
    expect(() => analyzeCode(code)).toThrow()
  })

  it('rejects non-cad expression statements with unknown identifiers', () => {
    const code = `let part0 = cad.box(20, 20, 20, { centered: true })
console.log(part0)`
    // extractMetadata checks references: `console` is an unknown identifier → E_REFERENCE
    expect(() => analyzeCode(code)).toThrow(ParseError)
  })
})
