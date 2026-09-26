/**
 * E3-b end-to-end: cad.extrude must leave a part-key role table so that
 * cad.edgeRef(partN, i) resolves downstream (the nameless-shape defect
 * fixed by recordOutput(origin, table, handle, part)).
 *
 * extrude-roles.test.ts pins the table is non-empty; this pins the
 * downstream edgeRef actually resolves against the extruded solid — the
 * real-world failure mode (DIN93_M18TabWasher fillet/chamfer edgeRef).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createRuntime } from '../index'
import { createNodePorts } from '../node'
import { initOcctWasm } from '../occt-kernel/occtKernel'

beforeAll(async () => { await initOcctWasm() }, 120000)

const SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
], closed: true }] }`

describe('E3-b extrude → edgeRef end-to-end', () => {
  it('cad.edgeRef resolves on the extruded solid (no nameless-shape)', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      const result = await runtime.execute(`
        const part0 = cad.profile(${SQUARE})
        const part1 = cad.extrude(part0, [0, 0, 5])
        const e1 = cad.edgeRef(part1, 1)
      `, { topology: 'auto' })
      expect(result.failedAt, `execution should not fail: ${result.failedAt?.message ?? ''}`).toBeUndefined()
      const outputs = result.outputs as unknown as Map<string, unknown>
      expect(outputs.get('part1'), 'part1 produced').toBeDefined()
    } finally {
      runtime.dispose()
    }
  })
})
