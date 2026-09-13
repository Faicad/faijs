/**
 * T3 stability sweep driver — runs every suite × case via runner-entry.ts
 * (same child-process isolation as stability.test.ts) and prints a summary.
 *
 * Usage: bun stability-sweep.ts [casesPerClass] [seed]
 * Exit 0 = all pass; exit 1 = some cases failed (summary lists them).
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STABILITY_SUITES } from './cases'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUNNER = join(HERE, 'runner-entry.ts')

const N = Number(process.argv[2] ?? 20)
const SEED = Number(process.argv[3] ?? 42)
const CASE_TIMEOUT_MS = 120_000

let pass = 0
const failures: string[] = []

for (const suite of STABILITY_SUITES) {
  const cases = suite.genParams(SEED, N)
  for (let i = 0; i < cases.length; i++) {
    const p = cases[i].params
    console.log(`[sweep] ${suite.id} case ${i} ${JSON.stringify(p)}`)
    const res = spawnSync(
      process.execPath, [RUNNER, suite.id, JSON.stringify(p)],
      { timeout: CASE_TIMEOUT_MS, encoding: 'utf8', cwd: HERE },
    )
    if (res.status === 0) {
      pass++
      continue
    }
    const out = (res.stderr || res.stdout || '').trim().split('\n').pop() || ''
    const tag = res.status === null ? 'TIMEOUT' : (/^([A-Z_]+): /.exec(out)?.[1] ?? 'BUILDING')
    failures.push(`${suite.id}#${i} [${tag}] ${out || `exit ${res.status}`}`)
    console.log(`[sweep] FAIL ${failures[failures.length - 1]}`)
  }
}

console.log(`[sweep] done: ${pass} pass, ${failures.length} fail (n=${N}, seed=${SEED})`)
for (const f of failures) console.log(`[sweep]   ${f}`)
process.exit(failures.length === 0 ? 0 : 1)
