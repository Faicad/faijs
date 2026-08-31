/**
 * Primitives .faijs tests — test all primitive ops (box, sphere, cylinder, cone, wedge)
 *
 * For each .faijs file in test/faijs/primitives/:
 * 1. Parse with parseScript
 * 2. Execute with createRuntime (mesh mode)
 * 3. Verify non-empty mesh, valid bbox
 *
 * Run: npx vitest run test/faijs/primitives/primitives.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseScript } from '@faicad/faijs-core/lang/parser'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import type { Shape } from '@faicad/faijs-core/mesh/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

const PRIMITIVES_DIR = fileURLToPath(new URL('.', import.meta.url))

/** Read all .faijs files from the primitives directory */
function listFaijsFiles(): string[] {
  return readdirSync(PRIMITIVES_DIR)
    .filter(f => f.endsWith('.faijs'))
    .sort()
}

/** Compute bbox from mesh positions */
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

describe('primitives .faijs tests', () => {
  const files = listFaijsFiles()

  for (const file of files) {
    const filePath = join(PRIMITIVES_DIR, file)
    const code = readFileSync(filePath, 'utf-8')

    it(`${file}: parses successfully`, () => {
      const { script } = parseScript(code)
      expect(script.statements.length).toBeGreaterThan(0)
    })

    it(`${file}: executes in mesh mode → non-empty mesh`, async () => {
      const { script } = parseScript(code)
      const runtime = createRuntime(createNodePorts(), 'mesh')
      const result = await runtime.executeIR(script)

      expect(result.failedAt).toBeUndefined()

      // Get the last non-marker statement's output
      const geoStmts = script.statements.filter(s => s.hasAssignment)
      const lastStmt = geoStmts[geoStmts.length - 1]
      const shape = result.outputs.get(lastStmt.outputs[0]) as Shape | undefined
      expect(shape).toBeDefined()
      expect(shape!.positions.length).toBeGreaterThan(0)
      expect(shape!.indices.length).toBeGreaterThan(0)

      // Verify bbox is finite and non-zero
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
