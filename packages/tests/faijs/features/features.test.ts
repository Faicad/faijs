/**
 * Features .faijs tests — test feature ops (drill, split, extrude, engrave, screw, knurl, sdf)
 *
 * For each .faijs file in test/faijs/features/:
 * 1. Parse with parseScript
 * 2. Execute with createRuntime (mesh mode)
 * 3. Verify non-empty mesh, valid bbox
 *
 * Run: npx vitest run test/faijs/features/features.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseScript } from '@faicad/faijs'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { initOcctWasm } from '@faicad/faijs'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import { ensureTestFontLoader } from '@faicad/faijs-core/brep/text/fontTestHelper'

beforeAll(async () => {
  await initOcctWasm()
  ensureTestFontLoader()
}, 120000)

const FEATURES_DIR = fileURLToPath(new URL('.', import.meta.url))

function listFaijsFiles(): string[] {
  return readdirSync(FEATURES_DIR)
    .filter(f => f.endsWith('.faijs'))
    .sort()
}

function computeBBox(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i])
    min[1] = Math.min(min[1], positions[i + 1])
    min[2] = Math.min(min[2], positions[i + 2])
    max[0] = Math.max(max[0], positions[i])
    max[1] = Math.max(max[1], positions[i + 1])
    max[2] = Math.max(max[2], positions[i + 2])
  }
  return { min, max }
}

describe('features .faijs tests', () => {
  const files = listFaijsFiles()

  for (const file of files) {
    const filePath = join(FEATURES_DIR, file)
    const code = readFileSync(filePath, 'utf-8')

    it(`${file}: parses successfully`, () => {
      const { script } = parseScript(code)
      expect(script.statements.length).toBeGreaterThan(0)
    })

    it(`${file}: executes in mesh mode → non-empty mesh`, async () => {
      const { script } = parseScript(code)
      const runtime = createRuntime(createNodePorts(), 'mesh')
      const result = await runtime.execute(script)

      expect(result.failedAt).toBeUndefined()

      const geoStmts = script.statements.filter(s => s.hasAssignment)
      const lastStmt = geoStmts[geoStmts.length - 1]
      const shape = result.outputs.get(lastStmt.outputs[0]) as Shape | undefined
      expect(shape).toBeDefined()
      expect(shape!.positions.length).toBeGreaterThan(0)
      expect(shape!.indices.length).toBeGreaterThan(0)

      const bbox = computeBBox(shape!.positions)
      const size = [
        bbox.max[0] - bbox.min[0],
        bbox.max[1] - bbox.min[1],
        bbox.max[2] - bbox.min[2],
      ]
      for (const s of size) {
        expect(s).toBeGreaterThan(0)
        expect(Number.isFinite(s)).toBe(true)
      }
    })
  }
})
