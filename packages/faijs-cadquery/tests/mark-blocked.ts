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
  // CLOSED 2026-10-03 (roadmap B1-3a, stale label #2): `Workplane.threePointArc`
  //   has existed since the 2-D arc ops — the label was stale too. The mirror
  //   (a 25-step flat chain: nested `await` in an argument position is rejected
  //   by the parser) is a straight PASS: vol 13234.9225135, topo f26/e72/v48.
  // CLOSED 2026-10-03 (roadmap B1-3a, stale label): `Workplane.polyline` has
  //   existed since the 2-D drafting ops — the label was stale, not a missing
  //   API. The mirror now exists and is PASS-NT: geometry is exact against the
  //   ref (vol 5800, boolean diff 0) but the mirrored profile keeps an unhealed
  //   seam on the mirror axis (cand f15/e39/v26 vs ref f14/e36/v24).
  // free-function Solid constructors / CQ() wrapper
  // CLOSED 2026-10-03 (roadmap B1-3a): `Solid.makeCone(radius1, radius2, height)`
  //   is exported as `cq.solidMakeCone` (kernel primitive — core's `cad.cone`
  //   asserts radiusBottom > 0 and rejects the apex-at-base case upstream allows),
  //   and `CQ` (upstream's `CQ = Workplane` alias, cq.py:4565) builds an XY
  //   workplane seeded with a shape. testCone__s / testCone__t both carry mirrors
  //   and parity-PASS against their refs (vol 2.09439510239, com z 1.5).
  //   NOTE: `Workplane.plugin` / the CadQuery plugin-pattern (testCylinderPlugin)
  //   is NOT a `blocked` (future-gap) case — it is explicitly OUT OF SCOPE and is
  //   recorded as `skipped` in manifest.json (roadmap §2.3, like VTK/GLTF/VRML).
  //   `Workplane.plugin` was a CadQuery 1.x method removed in 2.x; the upstream
  //   test only demonstrates monkey-patching a class method (internally
  //   `eachpoint(lambda) + union`). The underlying `eachpoint`-lambda capability
  //   is a real future gap tracked separately by G-C25 / testCompoundCenter__s.
  //   => removed from BY_KEY 2026-10-04 so gen-manifest won't re-pin it to blocked.
  // CLOSED 2026-10-03 (roadmap B1-3a, stale label #3): `findSolid` has been
  //   exported since the object-stack work (P3) — the label was stale. Mirror
  //   `testFindSolid__s` is a straight PASS (compound of the two uncombined
  //   cubes: vol 2, topo f12/e24/v16/s2).
  // extrude(both=) / extrude(combine="cut"|"s") — CLOSED 2026-10-03 (roadmap B1-6):
  //   testExtrude__s / __wp_ref (both=True), testExtrude__wp /
  //   __wp_ref_regular_cut (combine="s"), and testExtrude__r (combine="cut") now
  //   all carry mirrors. The five BY_KEY entries were removed so gen-manifest
  //   re-derives them as `ported` (their manifest.json entries were cleared too —
  //   gen-manifest preserves any prior `blocked` + `manual:true` annotation).
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
  // 9.5e15) while bbox (4.4e-16) and topology (f1/e4/v4) match exactly. The
  // default `row-approx-loft` strategy matches CadQuery Face.makeSplineApprox
  // to 4.2e-11 (straight) / 5.6e-7 (helical) on gear grids and bit-identically
  // on polynomial grids (area 1608.303209872); the opt-in `grid` strategy
  // diverges (≈2.3e-4) because occt-wasm exposes no DegMin/DegMax/Tol3D surface
  // fit — it can only fit the whole grid with kernel defaults.
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
  // ---------------------------------------------------------------------------
  // pending:mirror cleanup batch (2026-09-11) — verified unreproducible
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // CLOSED 2026-10-03 (roadmap B1-7): wedge() with a degenerate (point) top.
  // Upstream CadQuery 2.8.0 builds a 5-face pyramid when xmin==xmax && zmin==zmax;
  // cq-compat now lofts the bottom wire to the apex vertex via `loftWithVertices`
  // (BRepOffsetAPI_ThruSections::AddVertex). The three mirrors
  // (testWedgeDefaults__s / testWedgeCombined__s / testWedgePointList__s) are in
  // place and parity-PASS. Also fixed: wedge fed its kernel-built solid to
  // `cad.translate`, which the CLI's autoLift:false path rejected via the
  // N1 guard (E_TOPO_UNTRACKED_INPUT) — it now uses kernel-level `translateBrep`.
  // ---------------------------------------------------------------------------
  // twistExtrude of a rect by 45deg over height 10 produces a twisted B-spline
  // solid; the comparator's symmetric boolean probe fails asymmetrically on the
  // near-coincident surfaces (same root cause as E4 testTwistExtrude,
  // kernel:boolean-near-coincident-bspline). Geometry itself matches to machine
  // precision (volΔ% 2.6e-5) — keep blocked until the kernel boolean is robust.
  'tests.test_cadquery::TestCadQuery::testTwistExtrudeCombine__r': 'kernel:boolean-near-coincident-bspline',
  // Free-function text() (2026-09-30): the FLAT overload
  // `text(txt, size, font, path, kind, halign, valign)` is mirrored and passing
  // (test_text__r1..r5, __c). The two remaining corners are still out of reach:
  //  - r7/r8/r9 use the SPINE overload `text(txt, size, spine, planar | face)` —
  //    glyphs are laid out along a path and (r9) projected onto the cylinder's
  //    side; cq-compat's `text` only builds flat, axis-aligned text.
  //  - test_faceOn engraves text onto a spherical FACE via `faceOn(f, text(…)`;
  //    `faceOn` is a `cadquery.func`-only op (never a Workplane/Shape method)
  //    that cq-compat does not implement.
  'tests.test_free_functions:::test_text__r7': 'op:text-spine',
  'tests.test_free_functions:::test_text__r8': 'op:text-spine',
  'tests.test_free_functions:::test_text__r9': 'op:text-spine',
  'tests.test_free_functions:::test_faceOn__f2': 'op:faceOn',
  // Free-function draft(): applies taper to an EXISTING solid's faces
  // (draft(box, fbot, fside, 5)); occt-wasm's draft(shape, face, angle, dir)
  // fails outright (same kernel gap as §7.26 testTaperedExtrudeHeight__s2 —
  // offsetWire2D / loft with 4-vs-8-edge sections / draft all fail).
  'tests.test_free_functions:::test_draft__res1': 'kernel:draft-existing-solid',
  'tests.test_free_functions:::test_draft__res2': 'kernel:draft-existing-solid',
  // project(): edge-to-surface projection (project(e, base) onto a cylinder
  // face). No cq-compat op or kernel projection exists.
  'tests.test_free_functions:::test_project__res': 'op:project',
  // Solved-assembly compounds: the Plane-constraint solver produces rotations
  // that are not clean angles (measured: constrain simple_assy s1 = 1x1x2 box
  // tilted ~4.25 deg, com (1,-4.5,0.5); subassy1/subassy2/nested_assy solved
  // placements likewise). The assembly solver is out of scope for mirrors
  // (handover doc §8.1 Assembly group, remote-phase item).
  'tests.test_assembly:::test_constrain__simple_assy': 'op:assembly-solve',
  'tests.test_assembly:::test_constrain__nested_assy': 'op:assembly-solve',
  'tests.test_assembly:::test_constrain__subassy1': 'op:assembly-solve',
  'tests.test_assembly:::test_constrain__subassy2': 'op:assembly-solve',
  // FixedAxis (0,1,1) solver output is not the minimal rotation: measured ref
  // bbox x ±1.026 / y,z ±0.745 for a 2x1x1 box (a pure -45 deg x rotation
  // would give exactly ±1 / ±0.7071 like test_fixed_rotation does) — the
  // solver's rotation cannot be reconstructed without the solver itself.
  'tests.test_assembly:::test_unary_constraints__simple_assy2': 'op:assembly-solve',
  'tests.test_assembly:::test_unary_constraints__assy': 'op:assembly-solve',
  'tests.test_assembly:::test_unary_constraints__w': 'op:assembly-solve',
  // box_and_vertex: solved compound of box + cylinder + a VERTEX whose exact
  // PointInPlane position is underdetermined (only plane distances are
  // asserted; the vertex contributes to the ref compound but its solved
  // position cannot be pinned without the solver).
  'tests.test_assembly:::test_PointInPlane_3_parts__box_and_vertex': 'op:assembly-solve',
  // ---------------------------------------------------------------------------
  // Exported-API batch (2026-10-01) — split/section/sweep/offset2D/mirrorX/
  // mirrorY/polarArray/rotateAboutCenter/slot2D/… were already implemented in
  // src/workplane.ts but missing from src/index.ts, so the coverage analyzer
  // counted them as missing. Exporting them flipped 26 cases to
  // pending:mirror; 10 were mirrored and pass (testSection box/s1/s2,
  // testSlot2D box/result, testRotateAboutCenter r, testPolarArray s,
  // testSimpleMirror s, testOccBottle p). These are the ones that turned out to
  // be genuine gaps behind the analyzer's false "portable" verdict.
  // ---------------------------------------------------------------------------
  // offset2D of a self-intersecting shrinking profile (polyline+mirrorX+
  // mirrorY, offset -0.9): upstream OCC MakeOffset2D SPLITS the offset into 4
  // independent closed regions (ref s4 / vol 1.15123653709), while the kernel
  // offsetWire2D returns per-input-wire COMPOUNDS of 2 wires (large ring,
  // face area 72.37 vs upstream's small regions) — a MakeOffset2D semantics
  // gap, NOT a missing end-cap (probed 2026-10-01: degree analysis shows no
  // dangling endpoints; makeFace on the sub-wire succeeds with the wrong
  // area). Needs the kernel's full multi-region offset semantics.
  'tests.test_cadquery::TestCadQuery::testOffset2D__s': 'op:offset2D-multi-region',
  // testEnclosure needs `split(keepTop=, keepBottom=)` plus `.all()` to index
  // the two halves as separate objects (lid / bottom). The faijs-side gap is
  // CLOSED (split gained keepTop/keepBottom + partAt, 2026-10-01) — the chain
  // is now blocked by the KERNEL: fillet REJECTS re-filleting a fillet output
  // ("fillet: operation failed" / "fillet: TopoDS::Solid" on a still-1-solid
  // TopoDS), and testEnclosure fillets twice (|Z r10 then #Z r2). Kernel-side,
  // tracked in docs/analysis/2026-09-29-occt-wasm-gap-plan.md §10.1.
  'tests.test_cadquery::TestCadQuery::testEnclosure__oshell': 'kernel:fillet-chain-reapply',
  'tests.test_cadquery::TestCadQuery::testEnclosure__ishell': 'kernel:fillet-chain-reapply',
  'tests.test_cadquery::TestCadQuery::testEnclosure__box': 'kernel:fillet-chain-reapply',
  'tests.test_cadquery::TestCadQuery::testEnclosure__lid': 'kernel:fillet-chain-reapply',
  'tests.test_cadquery::TestCadQuery::testEnclosure__bottom': 'kernel:fillet-chain-reapply',
  'tests.test_cadquery::TestCadQuery::testEnclosure__lowerLid': 'kernel:fillet-chain-reapply',
  'tests.test_cadquery::TestCadQuery::testEnclosure__cutlip': 'kernel:fillet-chain-reapply',
  'tests.test_cadquery::TestCadQuery::testEnclosure__topOfLid': 'kernel:fillet-chain-reapply',
  'tests.test_cadquery::TestCadQuery::testEnclosure__result': 'kernel:fillet-chain-reapply',
  // extrude("next"/"last") — untilNextFace/untilLastFace — plus the indexed
  // face selector `faces(">X[1]")`. Neither exists. NOTE: the ref geometry also
  // disagrees with a straight reading of the source (wp_ref measures s3 /
  // vol 2125 / bbox x[-5, 32.5] where two 10³ boxes would be s2 / 2000 /
  // x[-5, 25]), so even once the ops land the mirror needs re-deriving.
  'tests.test_cadquery::TestCadQuery::testExtrudeUntilFace__wp_ref': 'op:extrude-until-face',
  'tests.test_cadquery::TestCadQuery::testExtrudeUntilFace__wp_ref_extrude': 'op:extrude-until-face',
  'tests.test_cadquery::TestCadQuery::testExtrudeUntilFace__part': 'op:extrude-until-face',
  'tests.test_cadquery::TestCadQuery::testExtrudeUntilFace__part_section': 'op:extrude-until-face',
  // r2 = Workplane().box(1,1,3).split(r1) where r1 is a parametricSurface —
  // `parametricSurface` is not implemented, so nothing to split with.
  'tests.test_cadquery::TestCadQuery::testParametricSurface__r2': 'op:parametricSurface',
  // sweep with an inner-hole section CLOSED (2026-10-01): the ref STEP for
  // test_history_sweep__res is a PLAIN UNIT BOX (vol=1.0, f6/e12/v8/s1) — a
  // ref-side anomaly, not the hollow-tube sweep product the upstream
  // expression builds. The mirror reproduces the ref geometry (comment pins
  // the anomaly). No sweep-hole-section capability is implied by the flip.
  // `side` is a History sub-shape lookup (op.generated(f1.outerWire().edges())),
  // not pure geometry — same class as test_history_extrude__sides (§7.2).
  'tests.test_free_functions:::test_history_sweep__side': 'op:history-subshape',
  // ---------------------------------------------------------------------------
  // pending:mirror cleanup batch (2026-10-01) — triaged against upstream sources
  // ---------------------------------------------------------------------------
  // cut = box.faces(">Z").workplane(invert=True).rect(1.5,5)
  //        .twistExtrude(10, 90, combine="cut") — the 90°-twist tool cut into
  // the box hangs the kernel boolean (>300 s, no completion), the same
  // near-coincident twisted B-spline boolean gap as testTwistExtrude/Combine.
  'tests.test_cadquery::TestCadQuery::testTwistExtrudeCombineCut__cut': 'kernel:boolean-near-coincident-bspline',
  // union/intersect with tol=eps (fuzzy boolean). cq-compat and the core
  // boolean API have no tolerance channel at all, so the fuzzy-merged results
  // (res_fuzzy vol 2.001, res_fuzzy_intersect vol 1.0 vs plain 0.499) cannot
  // be reproduced. box1_cmp/box4_cmp (single-box compounds) ARE mirrored and
  // pass — only the tol-dependent vars stay blocked.
  'tests.test_cadquery::TestCadQuery::testFuzzyBoolOp__res_fuzzy': 'op:fuzzy-bool',
  'tests.test_cadquery::TestCadQuery::testFuzzyBoolOp__res_fuzzy2': 'op:fuzzy-bool',
  'tests.test_cadquery::TestCadQuery::testFuzzyBoolOp__res_fuzzy_intersect': 'op:fuzzy-bool',
  'tests.test_cadquery::TestCadQuery::testFuzzyBoolOp__res_fuzzy_intersect_cmp': 'op:fuzzy-bool',
  'tests.test_cadquery::TestCadQuery::testFuzzyBoolOp__res_fuzzy_intersect_val': 'op:fuzzy-bool',
  // Solid.makeSolid(Shell.makeShell(faces)) over 4 arbitrary 3D triangle faces
  // CLOSED (2026-10-01): faceFromPoints (3D vertex ring -> wire -> face) +
  // solidFromFaces give the exact √2/12 tetrahedron; mirror parity PASS.
  // NOTE: solidFromFaces' first argument is the FRAME workplane, not a face —
  // passing f1 there silently drops it from the sew (3 faces, vol √2/18).
  // Assembly solver cases: solved placements need the constraint solver
  // (PointOnLine / Point via expression grammar / tag-based selection), same
  // class as the existing op:assembly-solve entries.
  'tests.test_assembly:::test_PointInPlane_constraint__box_and_vertex': 'op:assembly-solve',
  'tests.test_assembly:::test_point_on_line__assy': 'op:assembly-solve',
  'tests.test_assembly:::test_point_on_line__simple_assy2': 'op:assembly-solve',
  'tests.test_assembly:::test_point_on_line__w': 'op:assembly-solve',
  'tests.test_assembly:::test_expression_grammar__nested_assy': 'op:assembly-solve',
  'tests.test_assembly:::test_constrain_with_tags__nested_assy': 'op:assembly-solve',
  // pytest.raises error-path assertions (duplicate name / empty solve /
  // invalid constraint kind / unary-with-solve) — no exported geometry.
  'tests.test_assembly:::test_duplicate_name__nested_assy': 'raises',
  'tests.test_assembly:::test_empty_solve__nested_assy': 'raises',
  'tests.test_assembly:::test_constraint_validation__simple_assy2': 'raises',
  'tests.test_assembly:::test_single_unary_constraint__simple_assy2': 'raises',
  'tests.test_assembly:::test_save_raises__nested_assy': 'raises',
  // STEP subshape metadata round-trip (subshape names/colors/layers) —
  // importStep/load return plain members; no _subshape_names metadata channel.
  'tests.test_assembly:::test_assembly_subshape_import__subshape_assy': 'op:assembly-subshape-import',
  'tests.test_assembly:::test_assembly_subshape_import__imported_assy': 'op:assembly-subshape-import',
  'tests.test_assembly:::test_assembly_multi_subshape_import__multi_subshape_assy': 'op:assembly-subshape-import',
  'tests.test_assembly:::test_assembly_multi_subshape_import__imported_assy': 'op:assembly-subshape-import',
  // Real export gaps that stay blocked (future work):
  //   - native/BREP export (test_native_export), STL variants (test_save_stl_formats)
  // Visualizer exporters (VRML / glTF / VTK.js) moved to `skipped` in manifest.json
  // (roadmap §2.3) — explicitly unsupported, like Workplane.plugin.
  'tests.test_assembly:::test_native_export__simple_assy': 'export',
  'tests.test_assembly:::test_save_stl_formats__nested_assy_sphere': 'export',
  // testCompoundCenter: Workplane.cyl monkeypatch over eachpoint (cylinder
  // placed at each construction-rect vertex, then unioned) — eachpoint is a
  // known gap.
  'tests.test_cad_objects::TestCadObjects::testCompoundCenter__s': 'eachpoint',
  // Plane.toLocalCoords / Plane.mirrorInPlane — UNLOCKED 2026-10-04. Both APIs
  //   were already implemented (src/plane.ts) and exported (src/index.ts), with
  //   mirrorInPlane probe-verified against cadquery 2.8.0. The two
  //   testPlaneMethods vars were merely missing their .fai.js mirrors — a stale
  //   label, same class as the B1-3a polyline/threePointArc/findSolid closures.
  //   Mirrors written; gen-manifest now reports them ported. Removed from BY_KEY
  //   so regeneration keeps them ported (do NOT re-add).
  // Shape operator overloads (faces(">Z") | faces("<Z") etc.) — operator
  // syntax unreachable in the .fai.js restricted subset.
  'tests.test_shapes:::test_set_ops__simple_box': 'op:shape-operator-overload',
  // Solid.addCavity — solid with an internal void (2 shells); not implemented.
  'tests.test_shapes:::test_addCavity__b1': 'op:addCavity',
  'tests.test_shapes:::test_addCavity__b2': 'op:addCavity',
  'tests.test_shapes:::test_addCavity__br': 'op:addCavity',
  // History sub-shape reflection.
  'tests.test_free_functions:::test_history_extrude__sides': 'op:history-subshape',
  'tests.test_free_functions:::test_history_loft__side': 'op:history-subshape',
  // test_history_loft__res = loft([plane(1,1), face(circle(1)).moved(z=1)]) —
  // needs the free-function plane() constructor (func-only gap).
  'tests.test_free_functions:::test_history_loft__res': 'plane',
  // testSketch r2 CLOSED (2026-10-01): extrude's taper branch now consumes
  // materialized sketch faces (draftPrism), mirror parity PASS (vol 0.835228,
  // machine-precision). The second .sketch() creates a fresh parent whose
  // stack holds only sketch2 — the first annulus sketch is NOT in the final
  // extrude (probed upstream).
  // testSketch r6: placeSketch of two circles located along a SPLINE's
  // locationAt(0)/locationAt(1) frames, then sweep(multisection=True) — needs
  // a frame-aware sketch placement (xDir binding) + sketch-section sweep.
  'tests.test_cadquery::TestCadQuery::testSketch__r6': 'op:sweep-sketch-sections',
  // ---------------------------------------------------------------------------
  // prism/solid free-function batch (2026-10-01) — the plain-geometry vars are
  // mirrored and pass; these need genuine new geometry paths:
  // ---------------------------------------------------------------------------
  // prism with a TILTED direction (0,0.1,1) from the bottom face — extrude
  // along a non-normal direction from a face is not supported.
  'tests.test_free_functions:::test_prism__res3': 'op:prism-tilt',
  // prism FROM/TO faces (loft between two extended faces, or a triangular
  // section swept face-to-face) — a face-to-face loft op does not exist.
  'tests.test_free_functions:::test_prism__res5': 'op:prism-from-face',
  'tests.test_free_functions:::test_prism__res6': 'op:prism-from-face',
  'tests.test_free_functions:::test_prism_taper__res2': 'op:extrude-taper-sketch',
  // taper res3 divides box by the circle face (boolean split by a face) before
  // a from-face subtractive prism — operator + from-face path.
  'tests.test_free_functions:::test_prism_taper__res3': 'op:prism-from-face',
  'tests.test_free_functions:::test_prism_taper__res5': 'op:prism-from-face',
  // CLOSED 2026-10-04 (roadmap B2-2): solid() free function + solidWithInner()
  // implemented via boolean cut. All 12 test_solid variables now ported.
  // B0-5 data hygiene: these three carried a full prose sentence as `blockedBy`
  // (written by an earlier script revision, then orphaned when their BY_KEY
  // entries were dropped — gen-manifest preserves `manual: true` annotations, so
  // the prose survived every regeneration). Normalised to tags:
  //   · hollow(t>0) needs MakeThickSolidByJoin with an INTERSECTION join; the
  //     occt-wasm offset is arc-join only (0.698/0.565 vs upstream 0.728/0.584
  //     on the unit box) — kernel work, roadmap G-F9 / B6-2.
  //   · test_name_geometries is blocked by the free `plane()` constructor
  //     (roadmap G-C6 / B1-5); addSubshape was masking it until B0-4 fixed the
  //     assembly surface.
  'tests.test_free_functions:::test_hollow__res2': 'kernel:hollow-intersection-join',
  'tests.test_free_functions:::test_hollow_open__res2': 'kernel:hollow-intersection-join',
  'tests.test_assembly:::test_name_geometries__assy': 'plane',
  // imprint history images — the free-function imprint is now implemented
  // (roadmap B2-1, 2026-10-04), but b1_imp/b3_imp need History.images()
  // (G-C18) to retrieve the post-imprint faces of the original shapes.
  'tests.test_free_functions:::test_imprint__b1_imp': 'history:images',
  'tests.test_free_functions:::test_imprint__b3_imp': 'history:images',
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
