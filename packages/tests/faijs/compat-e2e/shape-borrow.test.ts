/**
 * P1 regression e2e — a faijs Shape (adopted from a vendored handle) can be
 * passed BACK into a library function whose parameter is a vendored `Solid`.
 *
 * Crash (fixed): `borrowBrepjsShape` wrapped the numeric arena id directly, so
 * the borrowed view's `wrapped` was a raw number — vendored code that uses
 * `KernelShape` as a WeakMap key (shapeTypeCache) crashed with
 * "Invalid value used as weak map key". The borrow now produces a structurally
 * valid `OcctWasmHandle` view of the same arena slot (zero-copy).
 *
 * Round trip under test:
 *   p0 = sheet.author({...one flange...})
 *   s1 = sheet.solidOf(p0)          → vendored Solid adopted as a faijs Shape
 *   u1 = sheet.unfoldSolid(s1)      → s1 borrowed back as a vendored Solid view
 *
 * The foreign unfold detects planar panels + cylindrical bends numerically;
 * the authored flange provides the cylindrical bend (bendLines ≥ 1).
 */

import { beforeAll, describe, expect, it } from 'vitest'
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
  solidOf: sheetPkg.solidOf,
  unfoldSolid: sheetPkg.unfoldSolid,
}

const SCRIPT = [
  "import * as sheet from 'sheet-lib'",
  'let p0 = sheet.author({ thickness: 2, base: { length: 100, width: 60 }, flanges: [',
  "  { id: 'wx1', length: 30, angleDeg: 90, side: 'xmax', rule: { innerRadius: 2, kFactor: 0.44 } }",
  '] })',
  'let s1 = sheet.solidOf(p0)',
  'let u1 = sheet.unfoldSolid(s1)',
].join('\n')

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 180000)

describe('P1 — faijs Shape round-trips into a vendored-Solid library parameter', () => {
  it('solidOf product is a brep-backed Shape; unfoldSolid(s1) detects the flange bend instead of crashing', async () => {
    const runtime: CadRuntime = createRuntime(createNodePorts(), 'auto')
    try {
      runtime.registerLib('sheet', sheetNs, { autoLift: true })
      const res = await runtime.execute(SCRIPT)
      expect(res.failedAt).toBeUndefined()

      const s1 = res.outputs.get(asPartName('s1')) as Shape
      expect(isShape(s1)).toBe(true)
      expect(hasBrep(s1)).toBe(true)

      const u1 = res.activeValues?.get(asPartName('u1')) as
        | { pattern?: { bendLines?: unknown[]; holes?: unknown[] }; warnings?: unknown[] }
        | undefined
      expect(u1).toBeDefined()
      expect(u1!.pattern).toBeDefined()
      expect(Array.isArray(u1!.pattern!.bendLines)).toBe(true)
      expect(u1!.pattern!.bendLines!.length).toBeGreaterThanOrEqual(1)

      // ownership check: the borrow must not have consumed/disposed s1's slot
      expect(hasBrep(s1)).toBe(true)
    } finally {
      runtime.dispose()
    }
  }, 120000)
})
