/**
 * mark-blocked.ts — record hand-written `blocked` annotations in tests/manifest.json.
 *
 * Phase 2 stage B: while writing mirror scripts we hit cases that cq-compat cannot
 * express yet. Instead of leaving them at the machine default (`pending:mirror`,
 * which claims "just needs a script"), we downgrade them to `blocked` with the
 * concrete first missing capability and `manual: true` so gen-manifest.ts keeps
 * the annotation across regenerations.
 *
 * Usage: npx tsx tests/mark-blocked.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST = join(HERE, 'manifest.json')

/** var-level: exact manifest key -> blockedBy */
const BY_KEY: Record<string, string> = {
  // shell: brepjs-compat has no `shell` projection; cq-compat's shell() silently no-ops
  'tests.test_cadquery::TestCadQuery::testLegoBrick__s': 'op:shell',
  'tests.test_cadquery::TestCadQuery::testLegoBrick__tmp': 'op:shell',
  // construction rect + circles: upstream cuts inner wires as holes (10 faces);
  // cq-compat fuses every pending profile (single pendingRect/pendingCircle slot)
  'tests.test_cadquery::TestCadQuery::testConstructionWire__r': 'op:pendingWires',
  // polygon + cutThruAll: makePolygonPrismAt at the through-cut height aborts the
  // occt-wasm process (Node-level crash, not a JS throw) — see U21 in the phase2 plan
  'tests.test_cadquery::TestCadQuery::testPolygonPlugin__s': 'kernel:crash-polygon-cutThruAll',
  // 2-D wire ops not implemented
  'tests.test_cadquery::TestCadQuery::testBoundingBox__result': 'op:threePointArc',
  'tests.test_cadquery::TestCadQuery::testIbeam__res': 'op:polyline',
  // free-function Solid constructors / CQ() wrapper
  'tests.test_cadquery::TestCadQuery::testCone__s': 'op:Solid.makeCone',
  'tests.test_cadquery::TestCadQuery::testCone__t': 'op:CQ',
  'tests.test_cadquery::TestCadQuery::testCylinderPlugin__s': 'op:Workplane.plugin',
  'tests.test_cadquery::TestCadQuery::testFindSolid__s': 'op:findSolid',
  // extrude(both=) / extrude(combine="cut"|"s")
  'tests.test_cadquery::TestCadQuery::testExtrude__s': 'op:extrude.both',
  'tests.test_cadquery::TestCadQuery::testExtrude__r': 'op:extrude.combine-cut',
  'tests.test_cadquery::TestCadQuery::testExtrude__wp_ref': 'op:extrude.both',
  'tests.test_cadquery::TestCadQuery::testExtrude__wp_ref_regular_cut': 'op:extrude.combine-s',
  'tests.test_cadquery::TestCadQuery::testExtrude__wp': 'op:extrude.combine-s',
  // cutBlind("last"|"next") — untilLastFace / untilNextFace
  'tests.test_cadquery::TestCadQuery::testCutBlindUntilFace__wp': 'op:cutBlind.until-face',
  'tests.test_cadquery::TestCadQuery::testCutBlindUntilFace__wp_last': 'op:cutBlind.until-face',
  'tests.test_cadquery::TestCadQuery::testCutBlindUntilFace__wp_next': 'op:cutBlind.until-face',
  // Shape.faces(">Z") face-compound extraction WORKS (faceCompound op, script kept
  // as .fai.js.blocked) but the faijs STEP exporter only handles shapes with solid
  // sub-shapes — exportStepFromSolids throws "shape contains no solid sub-shapes"
  // for a compound of faces (ref exports it fine via Shape.exportStep)
  'tests.test_shapes:::test_single_ent_selector__fs': 'step-export:faces-compound',
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as Record<
  string,
  { status?: string; blockedBy?: string | null; source?: string; manual?: boolean }
>

let written = 0
const missing: string[] = []
for (const [key, blockedBy] of Object.entries(BY_KEY)) {
  if (!(key in manifest)) {
    missing.push(key)
    continue
  }
  manifest[key] = {
    status: 'blocked',
    source: manifest[key]?.source ?? key.slice(0, key.lastIndexOf('__')),
    blockedBy,
    manual: true,
  }
  written++
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(`mark-blocked: ${written} annotated`)
if (missing.length > 0) {
  console.log('not present in manifest (skipped):')
  for (const k of missing) console.log('  ' + k)
}
