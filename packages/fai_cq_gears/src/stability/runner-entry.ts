/**
 * Child-process entry for the T3 stability tests (plan §9.3).
 *
 * Usage: tsx runner-entry.ts <suiteId> <jsonParams>
 * Exit 0 = all invariants pass. On failure, prints "TAG: message" as the
 * last stderr line (tag grammar shared with stability.test.ts) and exits 1.
 */

import { getGearKernel } from '@faicad/cq-compat'
import { STABILITY_SUITES } from './cases'

async function main(): Promise<void> {
  const [suiteId, paramsJson] = process.argv.slice(2)
  const suite = STABILITY_SUITES.find((s) => s.id === suiteId)
  if (!suite) {
    console.error(`PRECALC: unknown suite ${suiteId}`)
    process.exit(1)
  }
  const params = JSON.parse(paramsJson) as Record<string, number>
  try {
    const kernel = await getGearKernel()
    suite.run(kernel, params)
  } catch (e) {
    // StabilityFailure message already carries the "TAG: ..." prefix.
    const msg = e instanceof Error ? e.message : String(e)
    console.error(msg)
    process.exit(1)
  }
}

void main()
