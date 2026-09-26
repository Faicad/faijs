/**
 * E3-b probe (2026-09-23): `cad.extrude` must register its construct role
 * table under the PART key (outputTablesByPart), not only the stmt key.
 *
 * GOTCHA: the delegated-projection path previously re-wrapped the adopted
 * result with `fromBrep(..., { roleTable })`. The same-statement
 * registeredStmtId dedupe swallowed the second registration, so the part-key
 * table stayed the EMPTY map adoptEntity had recorded → downstream
 * fillet/chamfer `cad.edgeRef(partN, i)` failed with
 * `edgeRef: input shape has no role table (nameless shape)`
 * (120 corpus runs; DIN93_M18TabWasher.FCStd first hit).
 *
 * Fix (same as revolve E3): `runtimeLineage.recordOutput(origin, table,
 * handle, part)` inside the op impl.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createRuntime } from '../index'
import { createNodePorts } from '../node'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { runtimeLineage } from '../topology/naming/lineage'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

const SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
], closed: true }] }`

describe('E3-b extrude role table', () => {
  it('records a non-empty part-key role table for the length path', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      const code = `
        const part0 = cad.profile(${SQUARE})
        const part1 = cad.extrude(part0, [0, 0, 5])
      `
      await runtime.execute(code, { topology: 'auto' })
      const table = runtimeLineage.tableOfPart('part1' as never)
      expect(table).toBeDefined()
      expect(table!.size).toBeGreaterThan(0)
    } finally {
      runtime.dispose()
    }
  })
})
