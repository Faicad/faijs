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
  // U22 resolved 2026-09-09: exportStepFromSolids now dispatches solid -> shell
  // -> face, so face-compound parts export. The four former
  // 'step-export:faces-compound' entries (test_single_ent_selector__fs,
  // test_constructors__c1/c2, test_extrude_face__c) are mirrored and passing.
  // Shape-domain offset: brepjs-compat only projects makeOffset(face, offset) —
  // no `face(wire)` construction, no shell/thick-solid inward offset
  // (offset(shell, -0.25) -> hollow solid, ref vol 0.875), no both=/moved-
  // compound semantics. All four test_offset vars need the full projection.
  'tests.test_free_functions:::test_offset__r1': 'op:shape.offset',
  'tests.test_free_functions:::test_offset__r2': 'op:shape.offset',
  'tests.test_free_functions:::test_offset__r3': 'op:shape.offset',
  'tests.test_free_functions:::test_offset__r4': 'op:shape.offset',
  // ---------------------------------------------------------------------------
  // Phase 2 stage K (batch 2) — verified unreproducible, 2026-09-10
  // ---------------------------------------------------------------------------
  // Loft over COPLANAR sections (w1 = circle(1) and w2 = ellipse(1.5,1).move(0,
  // y=1) both sit at z=0). occt-wasm's `loft(wires, solid, ruled)` exposes none
  // of the upstream BRepOffsetAPI_ThruSections knobs (C2 continuity, uniform
  // parametrization, degree 3, CheckCompatibility), so the two builders diverge
  // only when sections share a plane: measured non-coplanar controls all match
  // exactly (3 circles 12.566370; circle/ellipse/circle 16.755155; spread +
  // tilted 17.320334 vs 17.320002) while the coplanar variant lands at
  // 19.798698 vs upstream 17.148726.
  'tests.test_free_functions:::test_loft__r4': 'kernel:loft-coplanar-sections',
  // The exported value is `compound(plane(1,1), vertex(0,0,1))`; the ref STEP is
  // a degenerate compound (vol -0.037037, one lone face) and the comparator's
  // boolean-difference probe fails on it ("cut: boolean operation failed"), so
  // no candidate can be graded.
  'tests.test_cadquery::TestCadQuery::test_loft_to_vertex__c': 'ref:degenerate-compound-vertex',
  // Shell with POSITIVE thickness and removed faces (MakeThickSolidByJoin
  // outward): the kernel only offers a rounded (arc) offset, and cutting the
  // removed face's swept slab reproduces neither the opening nor the wall
  // (s1: vol 1.047647 vs 1.031678, boolean diff 0.016, 30 faces vs 23;
  //  s3: 410.235431 vs 332.597162). s2 additionally needs intersection join.
  'tests.test_cadquery::TestCadQuery::testSimpleShell__s1': 'kernel:shell-outward-opening',
  'tests.test_cadquery::TestCadQuery::testSimpleShell__s2': 'kernel:shell-intersection-join',
  'tests.test_cadquery::TestCadQuery::testSimpleShell__s3': 'kernel:shell-outward-opening',
  // "Tall" ellipse (y_radius > x_radius): the kernel lays the major axis on
  // global X and rejects major < minor ("gp_Elips: invalid construction
  // parameters"); every rotation entry point re-approximates the curve.
  'tests.test_selectors::TestCQSelectors::testEdgeTypesFilter__c': 'kernel:ellipse-tall-axis',
  // ---------------------------------------------------------------------------
  // Phase 2 stage K (batch 3) — sweep family, 2026-09-11
  // ---------------------------------------------------------------------------
  // Multisection sweep along a NON-line path or with path-relative placement:
  // needs real MakePipeShell multisection (kernel only offers single-profile
  // sweep / loft-style multisection). specialSweep's ref additionally relies on
  // B-spline extrapolation beyond the section span (ref bbox exceeds the
  // sections' span by ~1.09 on each side).
  'tests.test_cadquery::TestCadQuery::testMultisectionSweep__specialSweep': 'op:sweep.multisection',
  'tests.test_cadquery::TestCadQuery::testMultisectionSweep__arcSweep': 'op:sweep.multisection',
  'tests.test_cadquery::TestCadQuery::testMultisectionSweep__normalSweep': 'op:sweep.multisection',
  // Spline-path sweep with auxiliary spine (binormal rotation): kernel's
  // sweepPipeShell legacy path silently drops the auxiliary spine, so no
  // equivalent geometry is reachable.
  'tests.test_cadquery::TestCadQuery::testSweep__result': 'op:sweep.aux-spine',
  // test_sweep r5-r8 use the free-function sweep() over faces/inner wires with
  // B-spline spines: needs the pipeShell path (profile placed BY the spine),
  // not reproducible via as-is-section lofts.
  'tests.test_free_functions:::test_sweep__r5': 'op:sweep.pipeshell',
  'tests.test_free_functions:::test_sweep__r6': 'op:sweep.pipeshell',
  'tests.test_free_functions:::test_sweep__r7': 'op:sweep.pipeshell',
  'tests.test_free_functions:::test_sweep__r8': 'op:sweep.pipeshell',
  // Auxiliary-spine sweep: kernel legacy path drops the auxiliary spine.
  'tests.test_free_functions:::test_sweep_aux__r1': 'op:sweep.aux-spine',
  'tests.test_free_functions:::test_sweep_aux__r2': 'op:sweep.aux-spine',
  // ---------------------------------------------------------------------------
  // Gear-extension ops E1–E4 parity (2026-09-11) — the mirrors run and produce
  // candidate STEPs, but the SOLID-oriented comparator cannot grade them. Each
  // snapshot below is the measured evidence that the geometry itself matches.
  // ---------------------------------------------------------------------------
  // E1 splineFace produces a FACE. The comparator's volume / centre-of-mass
  // metrics are undefined for a non-solid (measured volPct 575 %, centroid
  // 9.5e15) while bbox (4.4e-16) and topology (f1/e4/v4) match exactly. vs
  // CadQuery Face.makeSplineApprox the surface is bit-identical on polynomial
  // grids (area 1608.303209872) and only diverges on general curved grids
  // because occt-wasm exposes no points-approximation surface (its
  // `bsplineSurface` interpolates the grid; makeSplineApprox fits <=deg-3 @ tol
  // 1e-2).
  'tests.test_cadquery::TestFace::testSplineApproxPoly__r': 'comparator:non-solid-metrics',
  // E2 helix produces a WIRE. The in-memory wire is exact (len 51.250548550 vs
  // ref 51.250549089), but occt-wasm's STEP writer degrades the helix B-spline
  // (24 poles vs CadQuery's 85), so the round-tripped candidate measures
  // 44.1568406 and its bbox differs by 5.4e-3 — an export-fidelity bug, not a
  // geometry error.
  'tests.test_cadquery::TestCadQuery::testMakeHelix__r': 'kernel:step-export-wire-fidelity',
  // E4 twistExtrude is a solid whose volume/centroid/bbox/topology all match the
  // reference to machine precision (volDiffPct 2.6e-5 %, centroid 3.6e-14,
  // vertices identical, both shapes valid), but BRepAlgoAPI_Cut on the two
  // near-coincident twisted B-spline solids fails asymmetrically (A-B 2.6e-4,
  // B-A 999.99 = the whole solid; stable across 8..128 loft sections, with or
  // without a STEP round-trip), so the comparator's boolean probe cannot grade it.
  'tests.test_cadquery::TestCadQuery::testTwistExtrude__r': 'kernel:boolean-near-coincident-bspline',
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
