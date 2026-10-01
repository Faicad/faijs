/**
 * probe-ref.ts — read the EXACT geometry of reference STEP files.
 *
 * Writing a parity mirror from the upstream Python source alone means guessing
 * volumes/centroids; guessing is how false PASS/FAIL pairs get produced. This
 * probes the real numbers out of the ref STEP (via `compareStepFiles(ref,
 * ref)`, which is exact by construction) so a mirror can be written against
 * measured values.
 *
 * Usage:
 *   npx tsx packages/cq-compat/tests/probe-ref.ts <refBase> [refBase...]
 *   npx tsx packages/cq-compat/tests/probe-ref.ts --substr testSection
 *
 * <refBase> is the out/ref file stem, e.g.
 *   tests.test_cadquery__TestCadQuery__testSection__s1
 */
import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareStepFiles } from '@faicad/cq-compat-compare'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const REF = join(PKG, 'out', 'ref')

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toPrecision(12) : String(n)
}

async function probe(base: string): Promise<boolean> {
  const f = join(REF, `${base}.step`)
  if (!existsSync(f)) {
    console.log(`MISSING ${base}`)
    return false
  }
  const r = await compareStepFiles(f, f, {
    strictTopology: false,
    linearTolerance: 1e-3,
    volumeRelativeTolerance: 1e-3,
  })
  const b = r.bbox.a
  const t = r.topology.a
  console.log(
    `${base}\n` +
      `  vol=${fmt(r.volume.a)}  com=(${fmt(r.centerOfMass.a.x)}, ${fmt(r.centerOfMass.a.y)}, ${fmt(r.centerOfMass.a.z)})\n` +
      `  bbox x[${fmt(b.xmin)}, ${fmt(b.xmax)}] y[${fmt(b.ymin)}, ${fmt(b.ymax)}] z[${fmt(b.zmin)}, ${fmt(b.zmax)}]\n` +
      `  topo f${t.faces}/e${t.edges}/v${t.vertices}/s${t.solids}`,
  )
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const targets: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--substr' && args[i + 1]) {
      const s = args[i + 1]!.toLowerCase()
      for (const f of readdirSync(REF)) {
        if (f.endsWith('.step') && f.toLowerCase().includes(s)) {
          targets.push(f.replace(/\.step$/, ''))
        }
      }
      i++
    } else if (!args[i]!.startsWith('--')) {
      targets.push(args[i]!)
    }
  }
  if (targets.length === 0) {
    console.log('probe-ref: pass ref file stems or --substr <substring>')
    return
  }
  for (const t of targets) await probe(t)
}

main()
