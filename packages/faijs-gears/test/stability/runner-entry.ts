/**
 * Child-process entry for the T3 stability tests (plan §9.3).
 *
 * Usage: tsx runner-entry.ts <suiteId> <jsonParams>
 * Exit 0 = all invariants pass. On failure, prints "TAG: message" as the
 * last stderr line (tag grammar shared with stability.test.ts) and exits 1.
 */

import { gearKernel } from '../../src/kernel'
import { initOCCT } from '../../src/test-setup'
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
    // 本文件由 vitest 以子进程 + tsx 直跑（见 stability.test.ts），拿不到
    // setupFiles 的装配 —— 自行扮宿主，否则 gearKernel() 的出口未就绪。
    await initOCCT()
    const kernel = gearKernel()
    suite.run(kernel, params)
  } catch (e) {
    // StabilityFailure message already carries the "TAG: ..." prefix.
    const msg = e instanceof Error ? e.message : String(e)
    console.error(msg)
    process.exit(1)
  }
}

void main()
