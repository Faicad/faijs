/**
 * Mixed-modeling .faijs tests — P0-1a regression matrix (M1–M5)
 *
 * These are the "test first" baseline for the mixed-modeling contract
 * (docs/plans/2026-08-29-faijs-module-runtime-plan.md §6.1.5):
 *
 *   M1  load(stl) + box      → union   (user-named scenario, mixed → mesh)
 *   M2  load(stl) + cylinder → union   (curved BREP triangulation, mixed → mesh)
 *   M3  sdf + box            → union   (BREP × SDF, mixed → mesh)
 *   M4  box + box            → union   (all-BREP control → brep, zero change)
 *   M5  load(stl) + load(stl) → union  (all-mesh control → mesh, zero change)
 *
 * Judgment (per plan): M4/M5 must be byte-identical to pre-change behavior;
 * M1–M3 must produce a valid result with assertable geometry. Any failure
 * here is a real bug to fix with P0-1b/P0-1c.
 *
 * Run: npx vitest run test/faijs/mixed/mixed.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseScript } from '@faicad/faijs-core/lang/parser'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { hasBrep } from '@faicad/faijs-core/shape'
import type { Shape } from '@faicad/faijs-core/mesh/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

const MIXED_DIR = fileURLToPath(new URL('.', import.meta.url))
// fixtures 是独立包（@faicad/faijs-fixtures → packages/fixtures/data）；相对本文件上 3 级 = packages/
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/data', import.meta.url))

/** Per-fixture expectation: which path the union must take. */
const EXPECTED_PATH: Record<string, 'brep' | 'mesh'> = {
  'm1-stl-box-union.faijs': 'mesh',
  'm2-stl-cylinder-union.faijs': 'mesh',
  'm3-sdf-box-union.faijs': 'mesh',
  'm4-box-box-union.faijs': 'brep',
  'm5-stl-stl-union.faijs': 'mesh',
}

function listFaijsFiles(): string[] {
  return readdirSync(MIXED_DIR)
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

describe('mixed-modeling regression matrix (M1–M5)', () => {
  const files = listFaijsFiles()

  for (const file of files) {
    const expectedPath = EXPECTED_PATH[file]
    expect(expectedPath, `missing expected path for ${file}`).toBeDefined()

    const filePath = join(MIXED_DIR, file)
    const code = readFileSync(filePath, 'utf-8')

    it(`${file}: parses successfully`, () => {
      const { script } = parseScript(code)
      expect(script.statements.length).toBeGreaterThan(0)
    })

    it(`${file}: executes in auto mode → valid result on expected path`, async () => {
      const { script } = parseScript(code)
      const runtime = createRuntime(
        createNodePorts({ assetsDir: FIXTURES_DIR }),
        'auto',
      )
      const result = await runtime.executeIR(script)

      expect(result.failedAt).toBeUndefined()

      const geoStmts = script.statements.filter(s => s.hasAssignment)
      const lastStmt = geoStmts[geoStmts.length - 1]
      const shape = result.outputs.get(lastStmt.outputs[0]) as Shape | undefined as Shape | undefined
      expect(shape).toBeDefined()
      expect(shape!.positions.length).toBeGreaterThan(0)
      expect(shape!.indices.length).toBeGreaterThan(0)

      // Path assertion: union result must carry a BREP slot iff the expected path is brep.
      expect(hasBrep(shape!)).toBe(expectedPath === 'brep')

      const bbox = computeBBox(shape!.positions)
      const size = bboxSize(bbox)
      for (const s of size) {
        expect(s).toBeGreaterThan(0)
        expect(Number.isFinite(s)).toBe(true)
      }
    })
  }
})
