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
  ['tests.test_cadquery__TestCadQuery__testSketch__r1', 'TestCadQuery__testSketch__r1'],
  ['tests.test_cadquery__TestCadQuery__testSketch__r2', 'TestCadQuery__testSketch__r2'],
  ['tests.test_cadquery__TestCadQuery__testSketch__r3', 'TestCadQuery__testSketch__r3'],
  ['tests.test_cadquery__TestCadQuery__testSketch__r4', 'TestCadQuery__testSketch__r4'],
  ['tests.test_cadquery__TestCadQuery__testSketch__r5', 'TestCadQuery__testSketch__r5'],
  ['tests.test_assembly___test_assembly__simple_assy', 'test_assembly__test_assembly__simple_assy'],
  ['tests.test_assembly___test_assembly__nested_assy', 'test_assembly__test_assembly__nested_assy'],
  ['tests.test_cadquery__TestCadQuery__testEachpoint__ref', 'TestCadQuery__testEachpoint__ref'],
  ['tests.test_cadquery__TestCadQuery__testEachpoint__sph', 'TestCadQuery__testEachpoint__sph'],
  ['tests.test_cadquery__TestCadQuery__testEachpoint__box', 'TestCadQuery__testEachpoint__box'],
  ['tests.test_cadquery__TestCadQuery__testEachpoint__r', 'TestCadQuery__testEachpoint__r'],
  ['tests.test_cadquery__TestCadQuery__test_compound_faces_center__compound', 'TestCadQuery__test_compound_faces_center__compound'],
  ['tests.test_cadquery__TestCadQuery__test_MergeTags__b', 'TestCadQuery__test_MergeTags__b'],
  ['tests.test_cadquery__TestCadQuery__testBrepImportExport__s', 'TestCadQuery__testBrepImportExport__s'],
  ['tests.test_cadquery__TestCadQuery__testBrepImportExport__si', 'TestCadQuery__testBrepImportExport__si'],
  ['tests.test_cadquery__TestCadQuery__test_export__w', 'TestCadQuery__test_export__w'],
  ['tests.test_shapes___test_bin_import_export__b', 'test_bin_import_export__b'],
  ['tests.test_shapes___test_bin_import_export__r', 'test_bin_import_export__r'],
  ['tests.test_free_functions___test_export__b1', 'test_export__b1'],
  ['tests.test_free_functions___test_export__b2', 'test_export__b2'],
  ['tests.test_free_functions___test_solid__b', 'test_solid__b'],
  ['tests.test_free_functions___test_solid__b_large', 'test_solid__b_large'],
  ['tests.test_free_functions___test_solid__b_small', 'test_solid__b_small'],
  ['tests.test_free_functions___test_solid__b1', 'test_solid__b1'],
  ['tests.test_free_functions___test_solid__sphere1', 'test_solid__sphere1'],
  ['tests.test_free_functions___test_solid__sphere2', 'test_solid__sphere2'],
  ['tests.test_free_functions___test_solid__s1', 'test_solid__s1'],
  ['tests.test_free_functions___test_solid__s2', 'test_solid__s2'],
  ['tests.test_free_functions___test_prism__box_shape', 'test_prism__box_shape'],
  ['tests.test_free_functions___test_prism__res1', 'test_prism__res1'],
  ['tests.test_free_functions___test_prism__res2', 'test_prism__res2'],
  ['tests.test_free_functions___test_prism__res4', 'test_prism__res4'],
  ['tests.test_free_functions___test_prism_taper__box_shape', 'test_prism_taper__box_shape'],
  ['tests.test_free_functions___test_prism_taper__res1', 'test_prism_taper__res1'],
  ['tests.test_free_functions___test_prism_taper__res4', 'test_prism_taper__res4'],
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
