/**
 * GOTCHA (A1', Futaba3003-4-arms-horn, 2026-09-26): `cad.mirror` takes the
 * SOURCE SHAPE as a positional arg — `cad.mirror(part, { normal, at })`.
 *
 * Failure chain: the fcstd translator once set `noPositionalArgs` on the
 * Part::Mirroring branch, so renderArgs dropped `inputs[0]` and emitted
 * `cad.mirror({ normal, at })` — the dual-form discriminator then saw the
 * options object as args[0] and threw
 * `E_ARGS_FORM: unexpected parameter(s): normal, at. Expected: shape, options`.
 * Fixed in f8fc561 (translator side). This synthetic fixture pins the
 * ENGINE-side contract: the positional form executes and the mirror op
 * accepts { normal, at } options — plus the corpus profile shape.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createRuntime } from '../../src/index'
import { createNodePorts } from '../../src/node'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'

beforeAll(async () => { await initOcctWasm() }, 120000)

// Futaba3003-4-arms-horn s0 Sketch profile (converted form)
const HORN_PROFILE = `{ contours: [{ segments: [
  { kind: 'line', x1: -19.425, y1: 0, x2: 0, y2: 0 },
  { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 19.425 },
  { kind: 'arc', cx: 0, cy: 17.225, radius: 2.1999999999999993, startAngle: 1.5707963267948966, endAngle: 2.9717573568795337, ccw: true },
  { kind: 'line', x1: -2.168347760594, y1: 17.596844038991, x2: -4.17, y2: 5.925 },
  { kind: 'line', x1: -4.17, y1: 5.925, x2: -4.17, y2: 5.47 },
  { kind: 'arc', cx: -5.47, cy: 5.47, radius: 1.2999999999999998, startAngle: 4.1334457224505836e-13, endAngle: -1.570796326794587, ccw: false },
  { kind: 'line', x1: -5.47, y1: 4.17, x2: -5.925, y2: 4.17 },
  { kind: 'line', x1: -5.925, y1: 4.17, x2: -17.596844177971, y2: 2.168347736715 },
  { kind: 'arc', cx: -17.225, cy: 0, radius: 2.200000000001816, startAngle: 1.7406316876035515, endAngle: 3.141592653589793, ccw: true }
], closed: true }] }`

describe("GOTCHA: cad.mirror positional form (A1' Futaba3003 regression)", () => {
  it('cad.mirror(part, {normal, at}) executes and fuses like the corpus model', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      // Same statement chain as Futaba3003-4-arms-horn s0..s5
      const result = await runtime.execute(`
        const part0 = cad.profile(${HORN_PROFILE})
        const part1 = cad.extrude(part0, [0, 0, 2])
        const part2 = cad.mirror(part1, { normal: [1,0,0], at: [0,0,0] })
        const part3 = cad.union(part1, part2)
        const part4 = cad.mirror(part3, { normal: [0,1,0], at: [0,0,0] })
        const part5 = cad.union(part4, part3)
        const part_out = part5
      `, { topology: 'auto' })
      expect(
        result.failedAt,
        `execution should not fail: ${result.failedAt?.message ?? ''}`,
      ).toBeUndefined()
      const outputs = result.outputs as Map<string, unknown>
      expect(outputs.get('part_out')).toBeDefined()
    } finally {
      runtime.dispose()
    }
  }, 120000)
})
