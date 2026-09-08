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
        mirrors.add(f.replace(/\.fai\.js$/, ''))
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
  const mirrors = existingMirrors()

  const out: Record<string, unknown> = {}
  let ported = 0
  let blocked = 0
  for (const caseId of Object.keys(ref)) {
    // caseId: "tests.test_cadquery::TestBooleans::testBox::r" → file key
    const fileKey = caseId.replace(/^tests\./, '').replace(/::/g, '__')
    const prior = prev[caseId] as { status?: string; blockedBy?: string | null } | undefined
    if (prior?.status === 'skipped') {
      out[caseId] = prior
      continue
    }
    if (mirrors.has(fileKey)) {
      out[caseId] = { status: 'ported', source: caseId, blockedBy: null }
      ported++
    } else {
      out[caseId] = {
        status: 'blocked',
        source: caseId,
        blockedBy: prior?.blockedBy ?? 'op:unported',
      }
      blocked++
    }
  }

  writeFileSync(OUT_MANIFEST, JSON.stringify(out, null, 2) + '\n')
  console.log(`gen-manifest: ${ported} ported / ${blocked} blocked / ${Object.keys(prev).length - ported - blocked >= 0 ? Object.values(out).filter((v) => (v as { status: string }).status === 'skipped').length : 0} skipped -> tests/manifest.json`)
}

main()
