/**
 * Syntax .fai.js tests — test specific syntax features
 *
 * 用 analyzeCode 验证语句摘要的正确性。
 *
 * For each .fai.js file in test/faijs/syntax/:
 * 1. Analyze with analyzeCode
 * 2. Verify statements are correctly parsed
 *
 * Run: npx vitest run test/faijs/syntax/syntax.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeCode } from '@faicad/faijs-core/lang/statement-summary'

const SYNTAX_DIR = fileURLToPath(new URL('.', import.meta.url))

function listFaijsFiles(): string[] {
  return readdirSync(SYNTAX_DIR)
    .filter(f => f.endsWith('.fai.js'))
    .sort()
}

describe('syntax .fai.js tests', () => {
  const files = listFaijsFiles()

  for (const file of files) {
    const filePath = join(SYNTAX_DIR, file)
    const code = readFileSync(filePath, 'utf-8')

    it(`${file}: parses successfully`, () => {
      const summaries = analyzeCode(code)
      expect(summaries.length).toBeGreaterThan(0)
    })

    it(`${file}: contains cad.* calls`, () => {
      const summaries = analyzeCode(code)
      expect(summaries.length).toBeGreaterThan(0)
      // All .fai.js files should have at least one cad.* call
      expect(summaries.some(s => s.callee !== undefined)).toBe(true)
    })
  }

  it('single mesh flat code: one statement with output', () => {
    const code = `let part0 = cad.box(20, 20, 20, { centered: true })`
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].outputs).toEqual(['part0'])
  })

  it('multi mesh flat code: two independent outputs', () => {
    const code = `let part0 = cad.box(20, 20, 20, { centered: true })
let part1 = cad.sphere({ radius: 10, center: [30, 0, 0] })`
    const summaries = analyzeCode(code)
    expect(summaries.length).toBeGreaterThan(1)
    expect(summaries[0].outputs).toEqual(['part0'])
    expect(summaries[1].outputs).toEqual(['part1'])
  })
})
