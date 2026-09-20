/**
 * P26 e2e — gear-lib-demo §8.4 ⑤c, B2 library-version recompute.
 *
 * Split out of `gear-lib-demo-flow.test.ts`: each `execute` of the §8.4 script
 * costs ~7-10s, and a single vitest worker busy for ~60s trips birpc's
 * hard-coded 60s `onTaskUpdate` RPC timeout — see `./gear-flow-fixture.js`.
 *
 *   ⑤c same binding, changed library implementation → full recompute.
 * ⑤a / ⑤b (statementKey stability, external-param change) live in
 * `gear-lib-demo-recompute.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import { LIB_OPTIONS, SCRIPT, bootGearRuntime, gearNs, gearV2 } from './gear-flow-fixture.js'
import { yieldWorkerRpc } from '../_support/worker-yield.js'

describe('P26 gear-lib-demo §8.4 ⑤c — same binding, changed library version recomputes in full (B2)', () => {
  it('⑤c re-registering a changed library implementation recomputes all lib-bound statements', async () => {
    // T5: plan() deleted; verify recompute via update().
    const r = await bootGearRuntime('auto')
    try {
      const r1 = await r.execute(SCRIPT)
      expect(r1.failedAt).toBeUndefined()
      r.registerLib('gear', gearV2, LIB_OPTIONS)
      // Yield between the two ~10s recomputes — see `faijs/_support/worker-yield.ts`.
      await yieldWorkerRpc()
      const r2 = await r.update(SCRIPT, SCRIPT)
      expect(r2.failedAt).toBeUndefined()
      const g1 = r2.outputs.get(asPartName('g1')) as Shape | undefined
      expect(g1).toBeDefined()
    } finally {
      r.dispose()
    }
  }, 120_000)
})
