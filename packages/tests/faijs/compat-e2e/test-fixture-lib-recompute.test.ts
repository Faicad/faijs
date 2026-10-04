/**
 * P26 e2e — test-fixture-lib §8.4 ⑤, incremental recompute (part 1 of 2).
 *
 * Split out of `test-fixture-lib-flow.test.ts`: each `execute` of the §8.4
 * script costs ~7-10s, and a single vitest worker busy for ~60s trips birpc's
 * hard-coded 60s `onTaskUpdate` RPC timeout — see `./gear-flow-fixture.js`.
 *
 * Covered here (the two cache-invalidation sub-cases):
 *   ⑤a re-registering the same library keeps the statementKey (no spurious
 *      recompute)
 *   ⑤b external-param change recomputes downstream; geometry changes
 * ⑤c (same binding, changed library implementation → full recompute) lives in
 * `test-fixture-lib-recompute-lib-change.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import { LIB_OPTIONS, SCRIPT, bootGearRuntime, gearNs } from './gear-flow-fixture.js'
import { yieldWorkerRpc } from '../_support/worker-yield.js'

describe('P26 test-fixture-lib §8.4 ⑤ — incremental recompute (key stability, param change)', () => {
  it('⑤a re-registering the same library keeps the statementKey (no spurious recompute)', async () => {
    const r = await bootGearRuntime('auto')
    try {
      await r.execute(SCRIPT)
      const u1Key0 = r.getStatementCacheEntry(asPartName('u1'))?.statementKey
      expect(u1Key0).toBeDefined()
      r.registerLib('gear', gearNs, LIB_OPTIONS)
      await r.execute(SCRIPT)
      const u1Key1 = r.getStatementCacheEntry(asPartName('u1'))?.statementKey
      expect(u1Key1).toBe(u1Key0)
    } finally {
      r.dispose()
    }
  }, 120_000)

  it('⑤b external-param change: full re-run via update; geometry changes', async () => {
    // T5: plan() deleted; use update() to verify recompute happens.
    const r = await bootGearRuntime('auto')
    try {
      const r1 = await r.execute(SCRIPT)
      expect(r1.failedAt).toBeUndefined()
      const changed = SCRIPT.replace('{ teeth: 20', '{ teeth: 24')
      // Yield between the two ~10s executes — see `faijs/_support/worker-yield.ts`.
      await yieldWorkerRpc()
      const r2 = await r.update(SCRIPT, changed)
      expect(r2.failedAt).toBeUndefined()
      // g1 geometry must change (teeth changed)
      const g1Before = r1.outputs.get(asPartName('g1')) as Shape | undefined
      const g1After = r2.outputs.get(asPartName('g1')) as Shape | undefined
      expect(g1After).toBeDefined()
      // GOTCHA (2026-09-25): after faijs-ification the core `fromHandle` fallback
      // tessellates cylinders with a fixed 64-segment budget, so the vertex count
      // (1542) is identical for radius 20 vs 24 — a length comparison is
      // degenerate. The content key (mesh coordinate hash) still changes with the
      // radius, which is the actual recompute witness.
      const { computeContentKey } = await import('@faicad/faijs/cad-runtime/content-key')
      const keyBefore = computeContentKey(g1Before!.positions, g1Before!.indices)
      const keyAfter = computeContentKey(g1After!.positions, g1After!.indices)
      expect(keyAfter).not.toBe(keyBefore)
    } finally {
      r.dispose()
    }
  }, 120_000)
})
