/**
 * T3 stability tests (plan §9.3) — port of cq_gears `tests/stability/`.
 *
 * Same contract as cq: deterministic seeded param sweeps → build each case
 * → check isSolid / volume bounds / bbox directions (BBOX_CHECK_TOL = 0.5).
 *
 * Runs are isolated per-case via a child process (spawnSync) with a hard
 * timeout — a hung occt-wasm build can't be interrupted in-process, and one
 * crash must not take down the worker. Cases default to n=20 per class
 * (cq's CI runs more; keep local runs bounded).
 */

import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STABILITY_SUITES, stabilitySuite } from './cases'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUNNER = join(HERE, 'runner-entry.ts')

const CASES_PER_CLASS = 20
const SEED = 42 // cq conftest default --rng_seed
const CASE_TIMEOUT_MS = 120_000 // cq conftest default --test_timeout

const SUITE_IDS = [
  'spur', 'herringbone', 'ring', 'herringbone-ring', 'rack', 'herringbone-rack',
  'worm', 'bevel',
]

/** Execute one case in a child process; exit codes map to failure tags. */
function runOneCase(suiteId: string, params: Record<string, number>): {
  ok: boolean; tag?: string; message?: string
} {
  const res = spawnSync(
    process.execPath, [RUNNER, suiteId, JSON.stringify(params)],
    { timeout: CASE_TIMEOUT_MS, encoding: 'utf8', cwd: HERE },
  )
  if (res.status === 0) return { ok: true }
  // Tag convention (runner-entry): stderr last line "TAG: message" or plain
  // message for unexpected throws; timeout yields null status.
  const out = (res.stderr || res.stdout || '').trim().split('\n').pop() || ''
  if (res.status === null && res.signal === undefined) {
    return { ok: false, tag: 'TIMEOUT', message: `killed after ${CASE_TIMEOUT_MS}ms` }
  }
  const m = /^([A-Z_]+): (.*)$/.exec(out)
  return m
    ? { ok: false, tag: m[1], message: m[2] }
    : { ok: false, tag: 'BUILDING', message: out || `exit ${res.status}` }
}

describe.skipIf(process.env.FAI_CQ_GEARS_SKIP_STABILITY)('stability (T3)', () => {
  it('deterministic case generation (same seed → same cases)', () => {
    // Cheap in-process check: gen_params must be pure.
    for (const s of STABILITY_SUITES) {
      const a = s.genParams(SEED, 5)
      const b = s.genParams(SEED, 5)
      expect(a).toEqual(b)
    }
  })

  for (const id of SUITE_IDS) {
    it(`${id}: ${CASES_PER_CLASS} seeded cases pass build + invariants`, () => {
      const suite = stabilitySuite(id)
      expect(suite).toBeDefined()
      const cases = suite!.genParams(SEED, CASES_PER_CLASS)
      const failures: string[] = []
      for (let i = 0; i < cases.length; i++) {
        const r = runOneCase(id, cases[i].params)
        if (!r.ok) {
          failures.push(`case ${i} [${r.tag}] ${r.message}`)
        }
      }
      // Report every failure (cq prints per-case); assert none.
      expect(failures).toEqual([])
    }, CASES_PER_CLASS * (CASE_TIMEOUT_MS + 5_000))
  }
})
