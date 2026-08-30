/**
 * Parity .faijs tests — test BREP/mesh equivalence
 *
 * For each .faijs file in test/faijs/parity/:
 * 1. Parse with parseScript
 * 2. Execute in BREP mode and mesh mode
 * 3. Verify bbox/size are equivalent (within tolerance)
 *
 * Run: npx vitest run test/faijs/parity/parity.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseScript } from '@faicad/faijs'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import { ensureTestFontLoader } from '@faicad/faijs-core/brep/text/fontTestHelper'

beforeAll(async () => {
  await registerOcctBrepEngine()
  ensureTestFontLoader()
}, 120000)

const PARITY_DIR = fileURLToPath(new URL('.', import.meta.url))

function listFaijsFiles(): string[] {
  return readdirSync(PARITY_DIR)
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

function bboxSize(bbox: ReturnType<typeof computeBBox>): [number, number, number] {
  return [
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ]
}

/** Check if two values are close within relative tolerance */
function closeTo(a: number, b: number, relTol: number = 0.01): boolean {
  const diff = Math.abs(a - b)
  const mag = Math.max(Math.abs(a), Math.abs(b))
  return diff <= relTol * mag || diff < 1e-6
}

describe('parity .faijs tests (BREP vs mesh)', () => {
  const files = listFaijsFiles()

  for (const file of files) {
    const filePath = join(PARITY_DIR, file)
    const code = readFileSync(filePath, 'utf-8')

    it(`${file}: parses successfully`, () => {
      const { script } = parseScript(code)
      expect(script.statements.length).toBeGreaterThan(0)
    })

    it(`${file}: BREP and mesh modes produce equivalent bbox (1% tolerance)`, async () => {
      const { script } = parseScript(code)

      // Execute in BREP mode
      const brepRuntime = createRuntime(createNodePorts(), 'brep')
      const brepResult = await brepRuntime.execute(script)
      expect(brepResult.failedAt).toBeUndefined()

      const geoStmts = script.statements.filter(s => s.hasAssignment)
      const lastStmt = geoStmts[geoStmts.length - 1]

      const brepShape = brepResult.outputs.get(lastStmt.outputs[0]) as Shape | undefined
      expect(brepShape).toBeDefined()
      const brepBBox = computeBBox(brepShape!.positions)
      const brepSize = bboxSize(brepBBox)

      // Execute in mesh mode
      const meshRuntime = createRuntime(createNodePorts(), 'mesh')
      const meshResult = await meshRuntime.execute(script)
      expect(meshResult.failedAt).toBeUndefined()

      const meshShape = meshResult.outputs.get(lastStmt.outputs[0]) as Shape | undefined
      expect(meshShape).toBeDefined()
      const meshBBox = computeBBox(meshShape!.positions)
      const meshSize = bboxSize(meshBBox)

      // For screw, allow larger tolerance due to thread differences
      const tolerance = file.includes('screw') ? 0.05 : 0.01

      // Verify bbox sizes are close (tolerance)
      for (let i = 0; i < 3; i++) {
        expect(closeTo(brepSize[i], meshSize[i], tolerance)).toBe(true)
      }
    })
  }
})
