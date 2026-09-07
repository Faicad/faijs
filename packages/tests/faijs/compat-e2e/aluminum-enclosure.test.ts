/**
 * Aluminum sheet-metal enclosure — fixture-driven e2e over the compat boundary.
 *
 * Freezes the verified whole-package flow (2026-09-04 probe): `author` with 4
 * flanges + 4 closing seams → `autoReliefs` → 2× `addCutout` → `solidOf`
 * geometry terminal → `unfold` (flat pattern + bend report) → `report`.
 *
 * Verified geometry: the unfolded pattern develops to ≈26 826.59 mm² with 4
 * bend lines and 2 holes (base 120×80 + 4×40 walls, 1.5 mm aluminum,
 * kFactor 0.44); `solidOf` yields a brep-backed faijs Shape.
 *
 * Fixture: `aluminum-enclosure.fai.js` (lib binding 'sheet' ← import
 * 'sheet-lib'; the namespace key is the import binding name, parser F2).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName } from '@faicad/faijs-core/identity'
import { hasBrep, isShape } from '@faicad/faijs-core/shape'
import type { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import type { StdlibNamespace } from '@faicad/faijs-core/runtime-state'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as sheetPkg from '@faicad/sheetmetal'

const sheetNs: StdlibNamespace = {
  author: sheetPkg.author,
  autoReliefs: sheetPkg.autoReliefs,
  addCutout: sheetPkg.addCutout,
  solidOf: sheetPkg.solidOf,
  unfold: sheetPkg.unfold,
  report: sheetPkg.report,
}

const SCRIPT = readFileSync(fileURLToPath(new URL('./aluminum-enclosure.fai.js', import.meta.url)), 'utf-8')

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 180000)

describe('aluminum enclosure — whole-package sheetmetal flow over the compat boundary', () => {
  it('executes end-to-end: brep-backed solid, 4 bend lines, 2 holes, developed area ≈26 826 mm²', async () => {
    const runtime: CadRuntime = createRuntime(createNodePorts(), 'auto')
    try {
      runtime.registerLib('sheet', sheetNs, { autoLift: true })
      const res = await runtime.execute(SCRIPT)
      expect(res.failedAt).toBeUndefined()

      // s1 — the geometry terminal produced a brep-backed Shape
      const s1 = res.outputs.get(asPartName('s1')) as Shape
      expect(isShape(s1)).toBe(true)
      expect(hasBrep(s1)).toBe(true)
      expect(s1.positions.length).toBeGreaterThan(0)
      expect(s1.indices.length).toBeGreaterThan(0)

      // u1 — flat pattern: 4 bend lines (4 flanges), 2 holes, developed area
      const u1 = res.activeValues?.get(asPartName('u1')) as
        | {
            pattern?: { bendLines?: unknown[]; holes?: unknown[]; developedArea?: number }
            report?: unknown
            warnings?: unknown[]
          }
        | undefined
      expect(u1).toBeDefined()
      expect(u1!.pattern).toBeDefined()
      expect(u1!.pattern!.bendLines).toHaveLength(4)
      expect(u1!.pattern!.holes).toHaveLength(2)
      expect(u1!.pattern!.developedArea).toBeGreaterThan(26800)
      expect(u1!.pattern!.developedArea).toBeLessThan(26860)
      expect(u1!.report).toBeDefined()
      expect(Array.isArray(u1!.warnings)).toBe(true)

      // r1 — pure data query survives the boundary
      expect(res.activeValues?.get(asPartName('r1'))).toBeDefined()
    } finally {
      runtime.dispose()
    }
  }, 120000)
})
