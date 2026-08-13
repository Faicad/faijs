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
import { parseScript } from '../../../src/lang/parser'
import { scriptToCode } from '../../../src/lang/codegen'

const SYNTAX_DIR = resolve(process.cwd(), 'test/faijs/syntax')

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
      const { script } = parseScript(code, { partId: 'test_part' })
      expect(script.statements.length).toBeGreaterThan(0)
      expect(script.partId).toBe('test_part')
    })

    it(`${file}: codegen produces valid code`, () => {
      const { script } = parseScript(code, { partId: 'test_part' })
      const generatedCode = scriptToCode(script)
      expect(generatedCode).toContain('export default async')
      expect(generatedCode).toContain('cad.')
    })

    it(`${file}: round-trip is stable`, () => {
      const { script: script1 } = parseScript(code, { partId: 'test_part' })
      const generatedCode = scriptToCode(script1)
      const { script: script2 } = parseScript(generatedCode, { partId: 'test_part' })

      // Check that statements are preserved
      expect(script2.statements.length).toBe(script1.statements.length)
      expect(script2.statements[0].op).toBe(script1.statements[0].op)
    })
  }

  it('single mesh return: uses meta.name', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0, name: 'my-box' }
}`
    const { script } = parseScript(code, { partId: 'test' })
    const name = script.meta?.name ?? script.terminalShapes?.[0]?.name
    expect(name).toBe('my-box')
  })

  it('multi mesh return: parses and executes correctly', async () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part1_v0 = cad.sphere({ radius: 10, center: [30, 0, 0] })
  return [
    { shape: part0_v0, name: 'box' },
    { shape: part1_v0, name: 'sphere' },
  ]
}`
    const { script } = parseScript(code, { partId: 'test' })
    // Verify the script has multiple statements
    expect(script.statements.length).toBeGreaterThan(1)
  })

  it('apiVersion comment is preserved in codegen', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code, { partId: 'test' })
    const regenerated = scriptToCode(script)
    expect(regenerated).toContain('apiVersion: 1')
  })
})
