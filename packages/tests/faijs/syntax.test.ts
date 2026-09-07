/**
 * faijs syntax tests — analyzeCode statement summary features.
 *
 * 用 analyzeCode 验证语句摘要的 callee/outputs/inputs/positional 等字段。
 *
 * Run: npx vitest run test/faijs/syntax.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeCode } from '@faicad/faijs-core/lang/statement-summary'
import { isHostVarRef } from '@faicad/faijs-core/lang/host-arg'

const FAIJS_DIR = fileURLToPath(new URL('.', import.meta.url))

/** Recursively find all .fai.js files */
function listFaijsFiles(dir: string = FAIJS_DIR): string[] {
  const files: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFaijsFiles(fullPath))
    } else if (entry.name.endsWith('.fai.js')) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

describe('syntax: analyzeCode on fixture files', () => {
  const files = listFaijsFiles()

  for (const filePath of files) {
    const fileName = filePath.replace(FAIJS_DIR + '/', '').replace(/\\/g, '/')
    const code = readFileSync(filePath, 'utf-8')

    it(`${fileName}: parses successfully (statements > 0)`, () => {
      const summaries = analyzeCode(code)
      expect(summaries.length).toBeGreaterThan(0)
    })
  }
})

describe('syntax features', () => {
  it('single mesh flat code', () => {
    const code = `let part0 = cad.box(20, 20, 20, { centered: true })`
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].callee).toBe('box')
  })

  it('Vec3 parameter forms (array vs number)', () => {
    const codeScalar = `let part0 = cad.box(20, 20, 20, { centered: true })`
    const codeVec3 = `let part0 = cad.box(20, 30, 40, { centered: true })`
    const s1 = analyzeCode(codeScalar)
    const s2 = analyzeCode(codeVec3)
    expect(s1[0].positional).toEqual([20, 20, 20, { centered: true }])
    expect(s2[0].positional).toEqual([20, 30, 40, { centered: true }])
  })

  it('chained operations preserve input references', () => {
    const code = `let part0 = cad.box(20, 20, 20, { centered: true })
part0 = cad.translate({ offset: [5, 0, 0] }, part0)
part0 = cad.rotate_euler({ anglesDeg: [0, 0, 45] }, part0)`
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(3)
    // translate and rotate_euler both consume part0
    const tInputs = summaries[1].positional.filter(isHostVarRef).map(p => p.name)
    expect(tInputs).toEqual(['part0'])
    const rInputs = summaries[2].positional.filter(isHostVarRef).map(p => p.name)
    expect(rInputs).toEqual(['part0'])
  })

  it('multi mesh: two independent primitives → two outputs', () => {
    const code = `let part0 = cad.box(20, 20, 20, { centered: true })
let part1 = cad.sphere({ radius: 10, center: [30, 0, 0] })`
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(2)
    expect(summaries[0].outputs).toEqual(['part0'])
    expect(summaries[1].outputs).toEqual(['part1'])
  })
})
