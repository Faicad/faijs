/**
 * Shared fixture for the P26 gear-lib-demo §8.4 e2e family (compat boundary).
 *
 * Why this module exists: the §8.4 script must stay byte-identical across the
 * sibling `gear-lib-demo-*.test.ts` files, and those files are split on purpose
 * — see `faijs/_support/worker-yield.ts` for the full mechanism and the
 * measurements. Short version: birpc's `onTaskUpdate` call timeout is hard-coded
 * at 60s (vitest-dev/vitest#8164; fixed in #8297 by disabling it), and the
 * worker can only read a response when it returns to the event loop, so a
 * stretch of synchronous wasm geometry work that never reaches a poll phase —
 * measured as low as three consecutive 30s blocks, and only ~35s for a single
 * atomic execute — trips it, turning a fully green run into exit 1.
 *
 * Each `execute` of this script costs ~7-10s (one cold build plus four
 * downstream statements through the compat bridge), so the full §8.4 scenario
 * cannot live in one file. Files yield between heavy phases via
 * `yieldWorkerRpc()`; `faijs/parity` additionally runs in its own vitest pass
 * (packages/tests/package.json) because contention is what stretches its single
 * atomic screw execute past the budget.
 */

import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import type { StdlibNamespace } from '@faicad/faijs/runtime-state'
import * as mechPkg from '@faicad/gear-lib-demo'

/**
 * §8.4 scenario script (geometry-first flow), verbatim:
 *
 *   import * as gear from '<gearlib>'
 *   let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })
 *   let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })
 *   let u1 = cad.union(g1, cad.box(30, 30, 5, { centered: true }))
 *
 * plus the `planetary` multi-output record (§8.1 outputs).
 */
export const SCRIPT = [
  "import * as gear from 'gear-lib-demo'",
  'let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })',
  'let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })',
  'let a1 = gear.planetary({ thickness: 8, sunTeeth: 12, planetTeeth: 6, numPlanets: 3 })',
  'let b0 = cad.box(30, 30, 5, { centered: true })',
  'let u1 = cad.union(g1, b0)',
  'let x1 = cad.box(1, 1, 1, { centered: true })',
].join('\n')

/** Registered library projection: the real @faicad/gear-lib-demo entries. */
export const gearNs: StdlibNamespace = {
  external: mechPkg.external,
  thread: mechPkg.thread,
  planetary: mechPkg.planetary,
}

/** Different `external` body for the B2 "new library version" check. */
export const gearV2: StdlibNamespace = {
  external: ((p: Parameters<typeof mechPkg.external>[0]) =>
    mechPkg.external(p)) as (...args: any[]) => unknown,
  thread: mechPkg.thread,
  planetary: mechPkg.planetary,
}

/** `registerLib` options shared by every call site (property order preserved). */
export const LIB_OPTIONS: Parameters<CadRuntime['registerLib']>[2] = {
  autoLift: true,
  packageName: 'gear-lib-demo',
}

/**
 * Boots the OCCT BREP engine and returns a runtime with `gear` registered.
 *
 * `registerOcctBrepEngine` is idempotent (already-registered → wasm pre-init
 * only), so calling it once per file or per test is equivalent.
 */
export async function bootGearRuntime(mode: 'auto' | 'mesh' = 'auto'): Promise<CadRuntime> {
  await registerOcctBrepEngine()
  const runtime = createRuntime(createNodePorts(), mode)
  runtime.registerLib('gear', gearNs, LIB_OPTIONS)
  return runtime
}
