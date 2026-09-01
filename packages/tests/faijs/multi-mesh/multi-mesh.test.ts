/**
 * Multi-mesh .fai.js tests — test multi-mesh DAG and multiple returns
 *
 * For each .fai.js file in test/faijs/multi-mesh/:
 * 1. Parse with parseScript
 * 2. Execute with createRuntime (mesh mode)
 * 3. Verify multiple terminal shapes
 *
 * Run: npx vitest run test/faijs/multi-mesh/multi-mesh.test.ts
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

const MULTI_MESH_DIR = fileURLToPath(new URL('.', import.meta.url))

function listFaijsFiles(): string[] {
  return readdirSync(MULTI_MESH_DIR)
    .filter(f => f.endsWith('.fai.js'))
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

describe('multi-mesh .fai.js tests', () => {
  const files = listFaijsFiles()

  for (const file of files) {
    const filePath = join(MULTI_MESH_DIR, file)
    const code = readFileSync(filePath, 'utf-8')

    it(`${file}: parses successfully`, () => {
      const { script } = parseScript(code)
      expect(script.statements.length).toBeGreaterThan(0)
    })

    it(`${file}: executes in mesh mode → multiple terminal shapes`, async () => {
      const { script } = parseScript(code)
      const runtime = createRuntime(createNodePorts(), 'mesh')
      const result = await runtime.executeIR(script)

      expect(result.failedAt).toBeUndefined()

      // Check for multiple terminal shapes
      const terminals = result.terminals
      expect(terminals.length).toBeGreaterThan(1)

      // Verify each terminal shape has valid geometry
      for (const terminal of terminals) {
        const shape = result.outputs.get(terminal.id) as Shape | undefined
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
      }
    })
  }
})
