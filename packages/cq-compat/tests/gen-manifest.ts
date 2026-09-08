/**
 * gen-manifest.ts — (re)generate tests/manifest.json from the reference run.
 *
 * Reads out/ref/manifest.json (written by ref-harness/cq_step_plugin.py) and
 * emits the three-state case registry (parity plan §6.2):
 *
 *   ported   — a mirror .fai.js exists under tests/<module>/ (filename match)
 *   blocked  — no mirror yet; blockedBy names the first missing op/dependency
 *   skipped  — explicitly out of scope (see tests/README.md)
 *
 * The generator NEVER flips a case to `ported` based on anything other than
 * the presence of the mirror file, and NEVER removes existing hand-written
 * status annotations (status/blockedBy are preserved when already present).
 *
 * Usage: npx tsx packages/cq-compat/tests/gen-manifest.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const REF_MANIFEST = join(PKG, 'out', 'ref', 'manifest.json')
const OUT_MANIFEST = join(HERE, 'manifest.json')

function existingMirrors(): Set<string> {
  const mirrors = new Set<string>()
  for (const entry of readdirSync(HERE)) {
    const p = join(HERE, entry)
    if (!statSync(p).isDirectory()) continue
    if (entry === 'ref-harness' || entry === 'out') continue
    for (const f of readdirSync(p)) {
      if (f.endsWith('.fai.js')) {
        // mirror key = "<module>/<Class>__<test>__<var>" — same shape as the
        // manifest fileKey (module dir + file stem)
        mirrors.add(`${entry}/${f.replace(/\.fai\.js$/, '')}`)
      }
    }
  }
  return mirrors
}

function main() {
  if (!existsSync(REF_MANIFEST)) {
    console.error('gen-manifest: out/ref/manifest.json not found — run tests/ref-harness/run-ref.py first')
    process.exit(1)
  }
  const ref = JSON.parse(readFileSync(REF_MANIFEST, 'utf-8')) as Record<string, unknown>
  const prev = existsSync(OUT_MANIFEST)
    ? (JSON.parse(readFileSync(OUT_MANIFEST, 'utf-8')) as Record<string, unknown>)
    : {}
  // coverage.json — written by tests/ref-harness/analyze-coverage.py (AST analysis of
  // the upstream case bodies). Supplies per-case category + first missing op so a
  // `blocked` entry never falls back to the generic `op:unported` when we know better.
  const covPath = join(HERE, 'coverage.json')
  const coverage = existsSync(covPath)
    ? (JSON.parse(readFileSync(covPath, 'utf-8')) as {
        cases?: Record<string, { status?: string; blockedBy?: string | null; category?: string }>
      })
    : undefined
  const mirrors = existingMirrors()

  const out: Record<string, unknown> = {}
  let ported = 0
  let blocked = 0
  let skipped = 0
  // Manifest granularity = case + var (plan §6.2: one entry per exported STEP),
  // because a single upstream case exports several variables and each mirror
  // file realises exactly one of them.
  for (const [caseId, rawEntries] of Object.entries(ref)) {
    const entries = Array.isArray(rawEntries)
      ? (rawEntries as Array<{ var: string; file?: string; error?: string }>)
      : []
    const covCase = coverage?.cases?.[caseId]
    for (const e of entries) {
      const manifestKey = `${caseId}__${e.var}`
      // fileKey mirrors the on-disk layout "<module>/<Class>__<test>__<var>"
      const [mod, ...rest] = manifestKey.replace(/^tests\./, '').split('::')
      const fileKey = `${mod}/${rest.join('__')}`
      const prior = prev[manifestKey] as { status?: string; blockedBy?: string | null } | undefined
      if (prior?.status === 'skipped') {
        out[manifestKey] = prior
        skipped++
        continue
      }
      if (mirrors.has(fileKey)) {
        out[manifestKey] = { status: 'ported', source: caseId, blockedBy: null }
        ported++
        continue
      }
      // No mirror: entries whose ref run produced no STEP can never be paired
      // (assertion-only locals, Vector results, COMPSOLID export failures…), so
      // they are skipped rather than blocked.
      if (e.file === undefined) {
        out[manifestKey] = {
          status: 'skipped',
          source: caseId,
          blockedBy: null,
          reason: 'ref-no-step',
        }
        skipped++
        continue
      }
      out[manifestKey] = {
        status: 'blocked',
        source: caseId,
        // PORTABLE / PORTABLE-WITH-STUB cases have no missing op — they are
        // blocked only because the mirror script hasn't been written yet.
        // The generic 'op:unported' from a previous machine-generated run is
        // NOT preserved (only human-written annotations survive).
        // Always recompute from the latest coverage analysis — machine values
        // must never go stale (a previously-missing op that has since been
        // implemented flips the case to pending:mirror automatically).
        blockedBy:
          covCase?.blockedBy ??
          (covCase?.category === 'PORTABLE' || covCase?.category === 'PORTABLE-WITH-STUB'
            ? 'pending:mirror'
            : 'op:unported'),
      }
      blocked++
    }
  }

  writeFileSync(OUT_MANIFEST, JSON.stringify(out, null, 2) + '\n')
  console.log(`gen-manifest: ${ported} ported / ${blocked} blocked / ${skipped} skipped -> tests/manifest.json`)
}

main()
