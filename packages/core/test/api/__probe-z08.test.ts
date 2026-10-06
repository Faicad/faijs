/**
 * z08 pathway end-to-end: import_brep → place → union must keep shapes
 * addressable across the frozen-asset → boolean chain (the nameless-shape
 * defect along import_brep downstream).
 *
 * Uses the boss-solid.brp fixture. The original expect(true) probe is
 * replaced by a real assertion. The full z08 corpus conclusion (faijs
 * engine side is fine; only the fcstd-port cliRun wiring differed) is
 * recorded in fcstd-port/reports/z08-run-repro.md.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createRuntime } from '../../src/index'
import { createNodePorts } from '../../src/node'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'

beforeAll(async () => { await initOcctWasm() }, 120000)

const ASSETS_DIR = fileURLToPath(new URL('../../../fixtures/data/brp', import.meta.url))

describe('z08 pathway: import_brep → place → union', () => {
  it('union of a placed imported solid executes without nameless-shape', async () => {
    const runtime = createRuntime(createNodePorts({ assetsDir: ASSETS_DIR }), 'brep')
    try {
      const result = await runtime.execute(`
        const part0 = cad.import_brep({ asset: "boss-solid" })
        const part1 = cad.place(part0, { position: [100, 0, 0] })
        const part2 = cad.union(part0, part1)
      `, { topology: 'auto' })
      expect(result.failedAt, `execution should not fail: ${result.failedAt?.message ?? ''}`).toBeUndefined()
      const outputs = result.outputs as unknown as Map<string, unknown>
      expect(outputs.get('part2'), 'part2 produced').toBeDefined()
    } finally {
      runtime.dispose()
    }
  })
})
