/**
 * Transforms .faijs tests — test transform ops (translate, rotate, scale)
 *
 * For each .faijs file in test/faijs/transforms/:
 * 1. Parse with parseScript
 * 2. Execute with createRuntime (mesh mode)
 * 3. Verify non-empty mesh, valid bbox
 *
 * Run: npx vitest run test/faijs/transforms/transforms.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseScript } from '../../../src/lang/parser'
import { createRuntime } from '../../../src/cad-runtime/runtime'
import { createNodePorts } from '../../../src/node-host'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

const TRANSFORMS_DIR = resolve(process.cwd(), 'test/faijs/transforms')

function listFaijsFiles(): string[] {
  return readdirSync(TRANSFORMS_DIR)
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

describe('transforms .faijs tests', () => {
  const files = listFaijsFiles()

  for (const file of files) {
    const filePath = join(TRANSFORMS_DIR, file)
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

      const geoStmts = script.statements.filter(s => s.hasAssignment && (s.returnType ?? 'new_shape') === 'new_shape')
      const lastStmt = geoStmts[geoStmts.length - 1]
      const shape = result.outputs.get(lastStmt.id)
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
