/**
 * Syntax .faijs tests — test specific syntax features
 *
 * For each .faijs file in test/faijs/syntax/:
 * 1. Parse with parseScript
 * 2. Verify specific syntax constructs are correctly parsed
 *
 * Run: npx vitest run test/faijs/syntax/syntax.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseScript } from '@faicad/faijs'
import { scriptToCode } from '@faicad/faijs'

const SYNTAX_DIR = fileURLToPath(new URL('.', import.meta.url))

function listFaijsFiles(): string[] {
  return readdirSync(SYNTAX_DIR)
    .filter(f => f.endsWith('.faijs'))
    .sort()
}

describe('syntax .faijs tests', () => {
  const files = listFaijsFiles()

  for (const file of files) {
    const filePath = join(SYNTAX_DIR, file)
    const code = readFileSync(filePath, 'utf-8')

    it(`${file}: parses successfully`, () => {
      const { script } = parseScript(code)
      expect(script.statements.length).toBeGreaterThan(0)
    })

    it(`${file}: codegen produces valid flat code`, () => {
      const { script } = parseScript(code)
      const generatedCode = scriptToCode(script)
      expect(generatedCode).toContain('cad.')
      // Should NOT contain export default
      expect(generatedCode).not.toContain('export default')
    })

    it(`${file}: round-trip is stable`, () => {
      const { script: script1 } = parseScript(code)
      const generatedCode = scriptToCode(script1)
      const { script: script2 } = parseScript(generatedCode)

      // Check that statements are preserved
      expect(script2.statements.length).toBe(script1.statements.length)
      expect(script2.statements[0].callee).toBe(script1.statements[0].callee)
    })
  }

  it('single mesh flat code: no terminalShapes', () => {
    const code = `let part0 = cad.box({ size: 20 })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    // Phase 3: terminalShapes 移入 runtime.collectResult；parser 不再自动计算
    expect(script.terminalShapes).toBeUndefined()
    expect(script.statements[0].outputs).toEqual(['part0'])
  })

  it('multi mesh flat code: two independent outputs (runtime terminals)', () => {
    const code = `let part0 = cad.box({ size: 20 })
let part1 = cad.sphere({ radius: 10, center: [30, 0, 0] })`
    const { script } = parseScript(code)
    expect(script.statements.length).toBeGreaterThan(1)
    // Phase 3: terminalShapes 移入 runtime.collectResult；解析层只产出 outputs（PartName）
    expect(script.terminalShapes).toBeUndefined()
    expect(script.statements[0].outputs).toEqual(['part0'])
    expect(script.statements[1].outputs).toEqual(['part1'])
  })
})
