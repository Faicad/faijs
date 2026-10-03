/**
 * Mirror export-convention guard (B0-6).
 *
 * Every `.fai.js` mirror under `tests/<module>/` must export exactly ONE
 * terminal, because `tests/compare.ts` pairs `out/ref/<case>.step` with
 * `out/cand/<case>.step` by base name — a mirror that exports two terminals
 * makes the CLI write `<out>_0_<a>.step` / `<out>_1_<b>.step` instead, so the
 * case can never be paired and silently rots as "ported but never verified".
 *
 * GOTCHA (root cause, verified 2026-10-03 by controlled probe): a bare alias of
 * a COMPOUND does not mark it as consumed —
 *
 *     let assy = cq.compound(cq.val(b1), cq.val(b2))
 *     let result = assy            // <-- 2 terminals, not 1
 *
 * emits `<out>_0_assy.step` + `<out>_1_result.step`. The same alias on a plain
 * Shape (`let s = b1; let result = cq.val(s)`) emits exactly 1 — so the rule is
 * compound-specific, not a blanket ban on aliases. The liveness pass
 * (`core/src/cad-runtime/live-shapes.ts` `lineConsumes`) is name/arg based and
 * treats compounds differently from shapes; the fix on the mirror side is to
 * inline the producer:
 *
 *     let result = cq.compound(...)
 *
 * This produced 44 malformed `*.step_0_*` / `*.step_1_*` artifacts (plus 21
 * cases that were never compared).
 *
 * The mirrors are the source of truth here (NOT the generated `out/cand/`,
 * which is gitignored), so this guard scans the sources directly.
 *
 * Also guards the second residue found in the same batch: two mirrors still
 * imported the pre-rename package name `@faicad/cq-compat-assembly` (deleted
 * 2026-10-02; the surface moved to the `@faicad/faijs-cadquery/assembly`
 * subpath).
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TESTS = join(HERE, '..', 'tests')

function mirrorFiles(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(TESTS)) {
    const dir = join(TESTS, entry)
    if (!statSync(dir).isDirectory()) continue
    if (entry === 'ref-harness' || entry === 'out') continue
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.fai.js')) out.push(join(dir, f))
    }
  }
  return out.sort()
}

describe('mirror export convention (single terminal)', () => {
  it('no mirror aliases a COMPOUND terminal with a bare `let x = y` binding', () => {
    const offenders: string[] = []
    for (const file of mirrorFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n')
      // vars whose producer is a compound-valued call
      const compoundVars = new Set<string>()
      for (const l of lines) {
        const m = l.match(/^let ([A-Za-z_]\w*) = (.*)$/)
        if (m && /compound\(|toCompound\(/.test(m[2])) compoundVars.add(m[1])
      }
      for (const l of lines) {
        // `let <a> = <b>` — a bare alias is harmless for a Shape (the alias line
        // is still seen as consuming `b`), but NOT for a compound: a controlled
        // probe (2026-10-03) showed `let c0 = cq.compound(...); let result = c0`
        // emits 2 terminals (`<out>_0_c0.step` + `<out>_1_result.step`) while the
        // shape form emits 1. Inline the producer instead:
        //   let result = cq.compound(...)
        const m = l.match(/^let [A-Za-z_]\w* = ([A-Za-z_]\w*)\s*$/)
        if (m && compoundVars.has(m[1])) offenders.push(`${file}: ${l.trim()}`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('no mirror imports the deleted @faicad/cq-compat-assembly package', () => {
    const offenders: string[] = []
    for (const file of mirrorFiles()) {
      const src = readFileSync(file, 'utf8')
      if (src.includes('@faicad/cq-compat-assembly')) offenders.push(file)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
