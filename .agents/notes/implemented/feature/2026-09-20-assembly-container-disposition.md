# Agent Note: assembly/import container types → preserved-only (container-link)

Status: implemented

English | [中文](2026-09-20-assembly-container-disposition.zh.md)

## Problem

After the SubShape/datum triage, the top remaining first-cause was
`type-not-whitelisted` (7 files): AssemblyExample (Assembly containers +
App::Link), ProjectTest (App::InventorObject import placeholder),
TestVRMLTextures (App::VRMLObject), plus all_objects (extra FEM constraint
families). These objects reference or embed other/external geometry but
produce no modeling semantics of their own — blocking whole files on them
punishes valid modeling content, exactly the pattern the FEM disposition
already fixed.

## Decision

- New exported set `STRUCTURAL_TYPES_EXTENDED` in `convert.ts`:
  `App::Link`, `App::LinkElement`, `Assembly::AssemblyObject`,
  `Assembly::JointGroup`, `App::InventorObject`, `App::VRMLObject` →
  `preserved-only` with reason `container-link`.
- FEM set completion (all_objects corpus): `Fem::ConstraintFluidBoundary`,
  `Fem::ConstraintGear`, `Fem::ConstraintHeatflux`,
  `Fem::ConstraintInitialTemperature` — same simulation semantics as the
  already-classified constraint families.
- **Modeling features stay OUT deliberately**: `Part::Mirroring` (2 files),
  `PartDesign::AdditiveSphere` (1) remain explicit `type-not-whitelisted`
  gaps — they are real geometry to translate (H7 work), and letting them
  ride the structural sets would fake conversion success (test locked).

## Alternatives considered

- **Preserved-only for Part::Mirroring/AdditiveSphere too** — rejected:
  unlike containers/links, these carry modeling semantics; a preserved-only
  ledger row would hide unimplemented translation behind a "kept as-is"
  label and corrupt the gap metric that drives H7 priorities.
- **Treat App::Link as a shape reference to resolve** — deferred: resolving
  linked documents needs the linked-file loading story; the corpus links
  point within the same document or to external files we don't ship.

## Consequences

- 56-sample sweep: ok 39→**42** (AssemblyExample, ProjectTest,
  TestVRMLTextures + FEM-bearing stragglers), gap 17→14, checkFail 0.
  All 14 remaining files are genuine geometry/solver work:
  sketch-not-solved 4, type-not-whitelisted 3 (draft_test_objects Draft
  objects, EngineBlock, all_objects aggregate), seven singles.
- Tests: fem-disposition.test.ts +2 cases (FEM family completion;
  container-link GOTCHA with the modeling-feature non-capture lock).
  fcstd suite 13 files / 130 cases green.
