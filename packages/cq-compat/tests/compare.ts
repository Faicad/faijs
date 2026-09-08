/**
 * compare.ts — batch STEP equivalence comparison (ref vs cand).
 *
 * Pairs `out/ref/<case>.step` with `out/cand/<case>.step` by identical file
 * name, runs `compareStepFiles` on each pair, and writes:
 *
 *   out/report.json — machine-readable: per-case metrics + counters + parity
 *   out/report.md   — human-readable summary
 *
 * Judgment (docs/plans/2026-09-08-cq-compat-cadquery-parity.md §7.2):
 *   PASS    — volume/centroid/bbox within tolerance and boolean diff small
 *   PASS-NT — numeric metrics pass but topology differs (recorded, not gated)
 *   FAIL    — any numeric metric out of tolerance
 * Cases present in ref but with no candidate STEP count as BLOCKED (they are
 * listed from ref/manifest.json so the parity denominator stays honest).
 *
 * Usage: npx tsx packages/cq-compat/tests/compare.ts
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareStepFiles, type StepCompareResult } from '../src/step-compare'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const OUT = join(PKG, 'out')
const REF = join(OUT, 'ref')
const CAND = join(OUT, 'cand')

interface CaseVerdict {
  status: 'PASS' | 'PASS-NT' | 'FAIL' | 'ERROR'
  volumeDiffPct?: number
  centroidDiff?: number
  bboxDiff?: number
  booleanDiff?: [number, number]
  topology?: string
  error?: string
}

function mainRefCases(): Map<string, string> {
  // ref manifest.json maps case_id -> entries; flatten to step file basenames
  const mpath = join(REF, 'manifest.json')
  const map = new Map<string, string>()
  if (!existsSync(mpath)) return map
  const manifest = JSON.parse(readFileSync(mpath, 'utf-8')) as Record<
    string,
    Array<{ var: string; file?: string; error?: string }>
  >
  for (const [caseId, entries] of Object.entries(manifest)) {
    for (const e of entries) {
      if (e.file) {
        const base = basename(e.file).replace(/\.step$/, '')
        map.set(base, caseId)
      }
    }
  }
  return map
}

async function main() {
  const refFiles = existsSync(REF)
    ? readdirSync(REF).filter((f) => f.endsWith('.step'))
    : []
  const candFiles = existsSync(CAND)
    ? readdirSync(CAND).filter((f) => f.endsWith('.step'))
    : []
  const candSet = new Set(candFiles)

  const report: Record<string, CaseVerdict> = {}
  let pass = 0
  let passNt = 0
  let fail = 0
  let error = 0

  for (const rf of refFiles) {
    const caseName = rf.replace(/\.step$/, '')
    const cf = `${caseName}.step`
    if (!candSet.has(cf)) continue // counted as BLOCKED below
    const refStep = join(REF, rf)
    const candStep = join(CAND, cf)
    try {
      const r: StepCompareResult = await compareStepFiles(
        refStep,
        candStep,
        { strictTopology: false, linearTolerance: 1e-3, volumeRelativeTolerance: 1e-3 },
      )
      const numericOk =
        r.volume.diffPct <= 0.1 && r.centerOfMass.maxDiff <= 1e-3 && r.bbox.maxDiff <= 1e-3
      const boolOk =
        r.booleanDiff.aMinusB.volume <= 0.1 && r.booleanDiff.bMinusA.volume <= 0.1
      const topoMatch =
        r.topology.a.faces === r.topology.b.faces &&
        r.topology.a.edges === r.topology.b.edges &&
        r.topology.a.vertices === r.topology.b.vertices
      const status: CaseVerdict['status'] = !numericOk
        ? 'FAIL'
        : !boolOk
          ? 'FAIL'
          : topoMatch
            ? 'PASS'
            : 'PASS-NT'
      if (status === 'PASS') pass++
      else if (status === 'PASS-NT') passNt++
      else fail++
      report[caseName] = {
        status,
        volumeDiffPct: r.volume.diffPct,
        centroidDiff: r.centerOfMass.maxDiff,
        bboxDiff: r.bbox.maxDiff,
        booleanDiff: [r.booleanDiff.aMinusB.volume, r.booleanDiff.bMinusA.volume],
        topology: `ref f${r.topology.a.faces}/e${r.topology.a.edges}/v${r.topology.a.vertices} vs cand f${r.topology.b.faces}/e${r.topology.b.edges}/v${r.topology.b.vertices}`,
      }
    } catch (e) {
      error++
      report[caseName] = {
        status: 'ERROR',
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  const refCaseCount = mainRefCases().size
  const compared = pass + passNt + fail
  const blocked = refCaseCount - compared
  const parity = refCaseCount > 0 ? (pass + passNt) / refCaseCount : 0

  const jsonOut = {
    counts: { pass, passNt, fail, error, blocked, refCases: refCaseCount, refSteps: refFiles.length },
    parity: Number(parity.toFixed(4)),
    cases: report,
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(jsonOut, null, 2))

  const lines: string[] = [
    '# cq-compat ⇄ CadQuery parity report',
    '',
    `| metric | value |`,
    `|---|---|`,
    `| ref cases | ${refCaseCount} |`,
    `| ref STEP files | ${refFiles.length} |`,
    `| cand STEP files | ${candFiles.length} |`,
    `| PASS | ${pass} |`,
    `| PASS-NT | ${passNt} |`,
    `| FAIL | ${fail} |`,
    `| ERROR | ${error} |`,
    `| BLOCKED (no candidate) | ${blocked} |`,
    `| parity | ${(parity * 100).toFixed(2)}% |`,
    '',
  ]
  const fails = Object.entries(report).filter(([, v]) => v.status !== 'PASS')
  if (fails.length > 0) {
    lines.push('| case | status | vol Δ% | centroid Δ | bbox Δ | boolean Δ |')
    lines.push('|---|---|---|---|---|---|')
    for (const [name, v] of fails.slice(0, 100)) {
      lines.push(
        `| ${name} | ${v.status} | ${v.volumeDiffPct?.toExponential(2) ?? '-'} | ${
          v.centroidDiff?.toExponential(2) ?? '-'
        } | ${v.bboxDiff?.toExponential(2) ?? '-'} | ${v.booleanDiff?.map((x) => x.toFixed(3)).join(' / ') ?? '-'} |`,
      )
    }
  }
  writeFileSync(join(OUT, 'report.md'), lines.join('\n'))

  console.log(
    `compare: PASS=${pass} PASS-NT=${passNt} FAIL=${fail} ERROR=${error} BLOCKED=${blocked} parity=${(parity * 100).toFixed(2)}%`,
  )
  console.log(`report -> ${join(OUT, 'report.md')}`)
}

main()
