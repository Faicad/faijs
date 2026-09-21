# Agent Note: FEM workbench objects → preserved-only (simulation semantics, not modeling)

Status: implemented

## Problem

Native FEM classes WITHOUT a Proxy property fell into `type-not-whitelisted`
gaps and blocked whole files whose modeling content was trivial:
`box_static.FCStd` is a Part::Box + material + 10 simulation objects; all
four box/constraint FEM corpus files (plus FEMExample,
constraint_contact_*) failed only because simulation semantics are not
modeling semantics. 7 of the 19 post-contour-fix failing files were FEM.

## Corpus facts (probe, 2026-09-20)

- FEM objects come in two flavors: Python subclasses
  (`Fem::FemAnalysisPython`, `Fem::FemMeshObjectPython`,
  `Fem::FemSolverObjectPython`, `Fem::FemMeshShapeBaseObjectPython`,
  `Fem::FemResultObjectPython`, `Fem::FeaturePython`) that carry a Proxy →
  already handled by H10 (`python-opaque` → `python-baked`); and native
  classes (`Fem::FemMeshObject`, `Fem::FemResultObject`, `Fem::FemAnalysis`,
  `Fem::FemPostPipeline`, `Fem::ConstraintFixed/Force/Pressure/Contact/
  Bearing/Displacement`) that gap.
- Property surfaces are pure simulation semantics: References (face links),
  Force/Pressure values, FemMesh data, result field data (Displacement*,
  Eigenmode*, MaxShear…). Zero modeling-geometry semantics.

## Decision

- New `FEM_STRUCTURAL_TYPES` set in `convert.ts` (+ exported
  `isFemStructural()`): FEM containers/meshes/solvers/results/constraints/
  post-pipeline. `auditMapping` classifies them `preserved-only` with reason
  `fem-simulation` — they stop being gaps.
- **Regenerable field data is NOT carried into the container**: FemMesh and
  result `Data` properties stay in the source FCStd only (they are derived
  from the shape / solver output, several MB per file in real cases).
- **Remote task on record (user decision, 2026-09-20): faijs will port
  FreeCAD's FEM analysis capability — separate future feature.** This
  classification only stops simulation objects from blocking conversion;
  when the FEM port happens, boundary conditions (which reference modeling
  faces by name) will need the face-naming stability recorded in
  `api/edge-ref.ts` GOTCHA.

## Alternatives considered

- **Carry meshes/results into the container** — rejected for now: derived,
  large, and no consumer in faijs yet; revisit with the FEM port.
- **Gap explicitly with a dedicated reason (`fem-unsupported`)** — rejected:
  gapping means no zip, which punishes valid modeling content for carrying
  an analysis task; preserved-only matches the structural-type precedent
  (App::Origin et al.).
- **Treat only constraints as structural, keep mesh/result as gaps** —
  rejected: inconsistent; every FEM class here is simulation semantics.

## Consequences

- 56-sample sweep: ok 32→**37**; FEM-gap files 0; cliCheck 0 failures.
  First-cause now: type-not-whitelisted 7 (Draft/Assembly/VRML — batch
  phase), sketch-not-solved 4, pocket-missing-dependency 3, five singles.
- Tests: `fem-disposition.test.ts` (2 cases; GOTCHA that the Proxy-less
  native classes were the gap source). fcstd suite 13 files / 123 cases
  green.
