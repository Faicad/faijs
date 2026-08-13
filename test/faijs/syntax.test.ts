/**
 * faijs syntax tests — parse → codegen → parse round-trip.
 *
 * Verifies that:
 * 1. scriptToCode produces valid faijs from a parsed PartScript
 * 2. Re-parsing the generated code produces the same PartScript (for supported ops)
 * 3. Codegen is deterministic (same script → same code)
 *
 * Known codegen limitations (not covered by round-trip):
 * - screw: optional nRad param dropped by codegen
 * - split: args dropped by codegen (separate inputs not preserved)
 * - shorthand property syntax ({ size } vs { size: size }) not supported by parser
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
      const { script: script1 } = parseScript(code, { partId: 'test_part' })
      const generatedCode = scriptToCode(script1)
      const { script: script2 } = parseScript(generatedCode, { partId: 'test_part' })

      if (hasKnownIssue) {
        // For files with known codegen issues, only check structural equality (ops + inputs)
        expect(scriptsStructurallyEqual(script1, script2)).toBe(true)
      } else {
        // Full args comparison
        expect(scriptsEqual(script1, script2)).toBe(true)
      }
    })

    it(`${fileName}: codegen is deterministic`, () => {
      const { script } = parseScript(code, { partId: 'test_part' })
      const code1 = scriptToCode(script)
      const code2 = scriptToCode(script)
      expect(code2).toBe(code1)
    })
  }
})

describe('syntax features', () => {
  it('apiVersion comment is preserved', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code, { partId: 'test' })
    const regenerated = scriptToCode(script)
    expect(regenerated).toContain('apiVersion: 1')
  })

  it('single mesh return shorthand', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code, { partId: 'test' })
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('box')
  })

  it('Vec3 parameter forms (array vs number)', () => {
    const codeScalar = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0 }
}`
    const codeVec3 = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: [20, 30, 40] })
  return { shape: part0_v0 }
}`
    const { script: s1 } = parseScript(codeScalar, { partId: 'test' })
    const { script: s2 } = parseScript(codeVec3, { partId: 'test' })
    expect(s1.statements[0].args.size).toBe(20)
    expect(s2.statements[0].args.size).toEqual([20, 30, 40])
  })

  it('return with name metadata preserves name in meta', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0, name: 'my-box' }
}`
    const { script } = parseScript(code, { partId: 'test' })
    // For single mesh return, name is stored in meta (not terminalShapes)
    const name = script.meta?.name ?? script.terminalShapes?.[0]?.name
    expect(name).toBe('my-box')
  })

  it('chained operations preserve input references', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.translate({ offset: [5, 0, 0] }, part0_v0)
  const part0_v2 = cad.rotate({ anglesDeg: [0, 0, 45] }, part0_v1)
  return { shape: part0_v2 }
}`
    const { script } = parseScript(code, { partId: 'test' })
    expect(script.statements).toHaveLength(3)
    expect(script.statements[1].inputs).toEqual(['part0_v0'])
    expect(script.statements[2].inputs).toEqual(['part0_v1'])
  })
})
