/**
 * Non-modeling FCStd object types — the single source of truth shared by the
 * C4 disposition audit (`convert.ts`) and the code generator (`codegen.ts`).
 *
 * Why a separate module: `codegen.ts` must skip these objects BEFORE it calls
 * the translator (a datum plane must never enter a Body's feature chain), and
 * `convert.ts` must reclassify them after translation. Keeping the sets in
 * `convert.ts` would make `codegen.ts` import it back (convert → codegen), so
 * the knowledge lives here with zero dependencies.
 *
 * C4 contract: an object in these sets is never a translation gap, and its
 * geometry is never emitted as a modeling call. See the per-set docs below for
 * the evidence behind each classification.
 */

/** Non-modeling structural/datum types: never translation gaps. They carry
 * no feature semantics (containers, datum planes/lines/origins, groups) —
 * their semantics are consumed by the translator (Body.Group ordering,
 * datum-plane UpToFace anchors), not emitted as cad calls.
 *
 * GOTCHA (PadTest, 2026-09-21): a `PartDesign::Plane` also stores a `Shape`
 * `.brp` member — the plane FACE. The generic "any object with shape evidence
 * is a shape asset" rule therefore imported it and fed it into the Body's
 * union chain, which both corrupts the solid and fails at run time
 * (`[loadBrep] imported shape contains no solid sub-shapes`). Datum shapes are
 * SUPPORT geometry for attachment/up-to resolution, never modeling solids. */
export const STRUCTURAL_TYPES = new Set([
  'PartDesign::Body', 'App::Origin', 'App::Plane', 'App::Line',
  'App::DocumentObjectGroup', 'App::Part', 'PartDesign::Plane', 'PartDesign::Line',
  'PartDesign::CoordinateSystem',
  // H10 companion fix (plan §3.5): datum/annotation types, not modeling
  // features — previously misclassified as translation gaps.
  'App::Point', 'App::Annotation',
  // 2026-09-20 sweep regression triage: Part workbench datum plane (same
  // semantics as App::Plane) and a document text record — non-modeling.
  'Part::Plane', 'App::TextDocument',
  // Part workbench datum line (FEMExample) — same semantics as App::Line.
  'Part::Line',
  // 2026-09-21 triage (ArchDetail corpus): TechDraw is FreeCAD's 2D DRAWING
  // workbench. A page, an SVG template and a projected view are documentation
  // output — they render a shape onto a sheet and own no modeling geometry
  // (probe: none of the three carries a Shape .brp; DrawViewDraft only links
  // its source via `Source`, and a page links its template + views). Same
  // category as App::TextDocument/App::Annotation above. Their modeling
  // content is translated independently through the objects they reference.
  'TechDraw::DrawPage', 'TechDraw::DrawSVGTemplate', 'TechDraw::DrawViewDraft',
]);

/**
 * 2026-09-20 sweep triage: assembly/import container types — links, assembly
 * containers, import placeholders (Inventor/VRML). They reference or embed
 * external/other geometry but produce no modeling semantics of their own;
 * preserved-only. Modeling features (Part::Mirroring,
 * PartDesign::AdditiveSphere, …) are deliberately NOT here — they stay
 * explicit H7 gaps until translated.
 */
export const STRUCTURAL_TYPES_EXTENDED = new Set([
  'App::Link',
  'App::LinkElement',
  'Assembly::AssemblyObject',
  'Assembly::JointGroup',
  'App::InventorObject',
  'App::VRMLObject',
]);

/**
 * H7 companion (2026-09-20): FEM workbench objects carry SIMULATION semantics
 * (analysis containers, meshes, solver settings, boundary conditions, result
 * objects, post-processing filters) — no modeling geometry. They used to fall
 * into `type-not-whitelisted` and block whole files whose modeling part was a
 * single box. Like structural types they are `preserved-only`; their
 * regenerable field data (FemMesh / result Data properties) is deliberately NOT
 * carried into the container.
 *
 * DECISION (2026-09-21): the rule is the NAMESPACE, not an enumerated list.
 * Census of the 56-sample corpus (fcstd-port `out/probe-fem-types.mjs`): 29
 * distinct `Fem::` types, **every one** an analysis / mesh / solver / result /
 * constraint / filter object, zero modeling features; and the 3,201-file
 * FreeCAD library contains **0** `Fem::` objects, so the rule's blast radius is
 * exactly the FEM workbench. The previous enumerated list cost four
 * whack-a-mole rounds (each fix uncovered the next layer, because the sweep
 * report records only the first 4 reasons per file: fixed
 * FluidBoundary/Gear/Heatflux/InitialTemperature, then
 * PlaneRotation/Pulley/Temperature/Transform, then three more). The namespace
 * closes the family permanently.
 *
 * Note this classification is a LAST resort: an object with shape evidence is
 * taken by the shape-asset path and a Python object by `python-opaque` long
 * before `auditMapping` consults this predicate.
 *
 * Remote task on record (user decision, 2026-09-20): faijs will port FreeCAD's
 * FEM analysis capability in the future — separate feature; this classification
 * only stops simulation objects from blocking conversion.
 *
 * @param type - the FCStd object type, e.g. "Fem::ConstraintFixed".
 * @returns true when the type belongs to the FEM (simulation) workbench.
 */
export function isFemStructural(type: string): boolean {
  return type.startsWith('Fem::');
}

/**
 * True when the type carries no modeling semantics — structural/datum/
 * container/drawing/documentation or FEM simulation.
 *
 * `codegen.ts` uses this to short-circuit such objects to `preserved-only`
 * before translation, which is what keeps datum planes out of Body feature
 * chains and keeps their `.brp` face assets out of the shape-asset import path.
 * `convert.ts` uses it for the C4 post-translation reclassification, so the two
 * can never disagree.
 *
 * @param type - the FCStd object type, e.g. "PartDesign::Plane".
 * @returns true when the object must never produce a modeling call or be a shape asset.
 */
export function isNonModelingType(type: string): boolean {
  return STRUCTURAL_TYPES.has(type)
    || STRUCTURAL_TYPES_EXTENDED.has(type)
    || isFemStructural(type);
}
