/**
 * Mixed-modeling .fai.js tests — P0-1a regression matrix (M1–M5)
 *
 * These are the "test first" baseline for the mixed-modeling contract
 *
 *   M1  load(stl) + box      → union   (user-named scenario, mixed → brep)
 *   M2  load(stl) + cylinder → union   (curved BREP triangulation, mixed → brep)
 *   M3  sdf + box            → union   (BREP × SDF, mixed → mesh)
 *   M4  box + box            → union   (all-BREP control → brep, zero change)
 *   M5  load(stl) + load(stl) → union  (all-imported control → brep)
 *
 * Design change (2026-10-18): STL import no longer stays on the mesh path.
 * Since v0.35.6 (28c2811) `load` dispatches STL to the BREP path on both
 * engines (brepkit importStl / occt reconstructSolidFromMesh) so the editor
 * can fillet/chamfer/drill imported STL — a mesh-solid edge has no
 * adjacent-face lineage, which made those features impossible. Therefore M1,
 * M2 and M5 now expect the union to carry a BREP slot. A future refinement
 * (not yet implemented) may add a triangle-count pre-check (e.g. > 10k
 * triangles stays mesh); until then ALL STL imports convert to BREP.
 *
 * Run: npx vitest run test/faijs/mixed/mixed.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractMetadata } from '@faicad/faijs/lang/metadata-extractor'

/** `analyzeCode` 已迁至宿主层（A4）；旧实现即 extractMetadata(code).lines。 */
const analyzeCode = (code: string) => extractMetadata(code).lines
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { hasBrep } from '@faicad/faijs/shape'
import type { Shape } from '@faicad/faijs/mesh/types'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

const MIXED_DIR = fileURLToPath(new URL('.', import.meta.url))
// fixtures 是独立包（@faicad/faijs-fixtures → packages/fixtures/data）；相对本文件上 3 级 = packages/
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/data', import.meta.url))

/** Per-fixture expectation: which path the union must take. */
const EXPECTED_PATH: Record<string, 'brep' | 'mesh'> = {
  'm1-stl-box-union.fai.js': 'brep',
  'm2-stl-cylinder-union.fai.js': 'brep',
  'm3-sdf-box-union.fai.js': 'mesh',
  'm4-box-box-union.fai.js': 'brep',
  'm5-stl-stl-union.fai.js': 'brep',
}

function listFaijsFiles(): string[] {
  return readdirSync(MIXED_DIR)
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
      const summaries = analyzeCode(code)
      expect(summaries.length).toBeGreaterThan(0)
    })

    it(`${file}: executes in auto mode → valid result on expected path`, async () => {
      const runtime = createEditorRuntime(
        createNodePorts({ assetsDir: FIXTURES_DIR }),
        'auto',
      )
      const result = await runtime.execute(code)

      expect(result.failedAt).toBeUndefined()

      const geoStmts = analyzeCode(code).filter(s => s.hasAssignment)
      const lastStmt = geoStmts[geoStmts.length - 1]
      const shape = result.outputs.get(lastStmt.outputs[0] as never) as Shape | undefined
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
