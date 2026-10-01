/**
 * compare-targeted.ts — compare a small explicit list of (refBase, candBase)
 * pairs so we can grade new mirrors without re-running the full 700-case suite.
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareStepFiles } from '@faicad/cq-compat-compare'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const REF = join(PKG, 'out', 'ref')
const CAND = join(PKG, 'out', 'cand')

const pairs: Array<[string, string]> = [
  ['tests.test_cadquery__TestCadQuery__testLocatedMoved__box', 'TestCadQuery__testLocatedMoved__box'],
  ['tests.test_cadquery__TestCadQuery__testLocatedMoved__box1', 'TestCadQuery__testLocatedMoved__box1'],
  ['tests.test_cadquery__TestCadQuery__testLocatedMoved__box2', 'TestCadQuery__testLocatedMoved__box2'],
  ['tests.test_cadquery__TestCadQuery__testTwistExtrudeCombine__r', 'TestCadQuery__testTwistExtrudeCombine__r'],
  ['tests.test_cadquery__TestCadQuery__testExplicitClean__s', 'TestCadQuery__testExplicitClean__s'],
  ['tests.test_free_functions___test_history_extrude__res', 'test_history_extrude__res'],
  ['tests.test_cadquery__TestCadQuery__testTwistExtrudeCombineCut__box', 'TestCadQuery__testTwistExtrudeCombineCut__box'],
  ['tests.test_cadquery__TestCadQuery__testTwistExtrudeCombineCut__cut', 'TestCadQuery__testTwistExtrudeCombineCut__cut'],
  ['tests.test_cadquery__TestCadQuery__testFuzzyBoolOp__box1_cmp', 'TestCadQuery__testFuzzyBoolOp__box1_cmp'],
  ['tests.test_cadquery__TestCadQuery__testFuzzyBoolOp__box4_cmp', 'TestCadQuery__testFuzzyBoolOp__box4_cmp'],
]

async function main() {
  let pass = 0, passNt = 0, fail = 0, error = 0
  for (const [refBase, candBase] of pairs) {
    const rf = join(REF, `${refBase}.step`)
    const cf = join(CAND, `${candBase}.step`)
    if (!existsSync(rf)) { console.log(`SKIP ${refBase}: no ref`); continue }
    if (!existsSync(cf)) { console.log(`SKIP ${refBase}: no cand`); continue }
    try {
      const r = await compareStepFiles(rf, cf, { strictTopology: false, linearTolerance: 1e-3, volumeRelativeTolerance: 1e-3 })
      const numericOk = r.volume.diffPct <= 0.1 && r.centerOfMass.maxDiff <= 1e-3 && r.bbox.maxDiff <= 1e-3
      const boolOk = r.booleanDiff.aMinusB.volume <= 0.1 && r.booleanDiff.bMinusA.volume <= 0.1
      const topoMatch = r.topology.a.faces === r.topology.b.faces && r.topology.a.edges === r.topology.b.edges && r.topology.a.vertices === r.topology.b.vertices
      const status = !numericOk ? 'FAIL' : !boolOk ? 'FAIL' : topoMatch ? 'PASS' : 'PASS-NT'
      if (status === 'PASS') pass++; else if (status === 'PASS-NT') passNt++; else fail++
      console.log(`${status} ${refBase} | volΔ%=${r.volume.diffPct?.toExponential(2)} comΔ=${r.centerOfMass.maxDiff?.toExponential(2)} bboxΔ=${r.bbox.maxDiff?.toExponential(2)} | ref f${r.topology.a.faces}/e${r.topology.a.edges}/v${r.topology.a.vertices} vs cand f${r.topology.b.faces}/e${r.topology.b.edges}/v${r.topology.b.vertices}`)
    } catch (e) {
      error++
      console.log(`ERROR ${refBase}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  console.log(`\nTARGETED: PASS=${pass} PASS-NT=${passNt} FAIL=${fail} ERROR=${error}`)
}
main()
