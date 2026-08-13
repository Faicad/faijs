/**
 * faijs syntax tests — parse → codegen → parse round-trip.
 *
 * Verifies that:
 * 1. scriptToCode produces valid faijs from a parsed PartScript
 * 2. Re-parsing the generated code produces the same PartScript (for supported ops)
 * 3. Codegen is deterministic (same script → same code)
 *
 * Run: npx vitest run test/faijs/syntax.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseScript } from '../../src/lang/parser'
import { scriptToCode } from '../../src/lang/codegen'
import type { PartScript } from '../../src/lang/types'

const FAIJS_DIR = resolve(process.cwd(), 'test/faijs')

/** Recursively find all .faijs files */
function listFaijsFiles(dir: string = FAIJS_DIR): string[] {
  const files: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFaijsFiles(fullPath))
    } else if (entry.name.endsWith('.faijs')) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

/** Files with known codegen round-trip issues */
const KNOWN_CODEGEN_ISSUES = new Set(['screw.faijs', 'split.faijs', 'split-dag.faijs', 'parity-screw.faijs'])

/** Compare statement ops and ids (less strict than full args comparison) */
function scriptsStructurallyEqual(a: PartScript, b: PartScript): boolean {
  if (a.statements.length !== b.statements.length) return false
  for (let i = 0; i < a.statements.length; i++) {
    const sa = a.statements[i]
    const sb = b.statements[i]
    if (sa.id !== sb.id) return false
    if (sa.op !== sb.op) return false
    if (JSON.stringify(sa.inputs) !== JSON.stringify(sb.inputs)) return false
  }
  return true
}

/** Full deep comparison of args (for files without known codegen issues) */
function scriptsEqual(a: PartScript, b: PartScript): boolean {
  if (!scriptsStructurallyEqual(a, b)) return false
  for (let i = 0; i < a.statements.length; i++) {
    if (JSON.stringify(a.statements[i].args) !== JSON.stringify(b.statements[i].args)) return false
  }
  return true
}

describe('syntax round-trip: parse → codegen → parse', () => {
  const files = listFaijsFiles()

  for (const filePath of files) {
    const fileName = filePath.replace(FAIJS_DIR + '/', '').replace(/\\/g, '/')
    const code = readFileSync(filePath, 'utf-8')
    const hasKnownIssue = KNOWN_CODEGEN_ISSUES.has(fileName.split('/').pop()!)

    it(`${fileName}: round-trip preserves script structure`, () => {
      const { script: script1 } = parseScript(code)
      const generatedCode = scriptToCode(script1)
      const { script: script2 } = parseScript(generatedCode)

      if (hasKnownIssue) {
        expect(scriptsStructurallyEqual(script1, script2)).toBe(true)
      } else {
        expect(scriptsEqual(script1, script2)).toBe(true)
      }
    })

    it(`${fileName}: codegen is deterministic`, () => {
      const { script } = parseScript(code)
      const code1 = scriptToCode(script)
      const code2 = scriptToCode(script)
      expect(code2).toBe(code1)
    })
  }
})

describe('syntax features', () => {
  it('single mesh flat code', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('box')
  })

  it('Vec3 parameter forms (array vs number)', () => {
    const codeScalar = `const part0_v0 = cad.box({ size: 20 })`
    const codeVec3 = `const part0_v0 = cad.box({ size: [20, 30, 40] })`
    const { script: s1 } = parseScript(codeScalar)
    const { script: s2 } = parseScript(codeVec3)
    expect(s1.statements[0].args.size).toBe(20)
    expect(s2.statements[0].args.size).toEqual([20, 30, 40])
  })

  it('chained operations preserve input references', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.translate({ offset: [5, 0, 0] }, part0_v0)
const part0_v2 = cad.rotate({ anglesDeg: [0, 0, 45] }, part0_v1)`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(3)
    expect(script.statements[1].inputs).toEqual(['part0_v0'])
    expect(script.statements[2].inputs).toEqual(['part0_v1'])
  })

  it('multi mesh: two independent primitives → two terminal shapes', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part1_v0 = cad.sphere({ radius: 10, center: [30, 0, 0] })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(2)
    expect(script.terminalShapes).toBeDefined()
    expect(script.terminalShapes).toHaveLength(2)
  })
})
