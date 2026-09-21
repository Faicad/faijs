# Agent Note: Shape-asset evidence precedes python-opaque (EngineBlock)

Status: implemented

## Problem

EngineBlock gapped with `extrusion-missing-base`: its Part::Extrusion
features reference Draft circles (`Part::Part2DObjectPython`) that carry
BOTH `Proxy` (python-opaque evidence, H10) AND a real `Shape` `.brp`
member. The previous phase's shape-asset branch sat AFTER
`isPythonOpaque`, so the circles were baked silently as python-opaque and
the Extrusions found no variable.

Ordering is semantics: python-opaque means "behavior lives in Python code"
— but when a frozen Shape asset exists, the geometry is an existing fact
and import wins over bake (the bake was only ever a fallback for objects
whose geometry is NOT recoverable).

## Decision

- In `translateObject`'s non-whitelisted branch, the shape-asset check
  (`shapeCarriers` hit → `cad.import_shape`) now runs BEFORE
  `isPythonOpaque`. The Part::Feature special case collapses into it (same
  helper `shapeBrpFile()`, Shape-then-SubShape lookup).
- Whitelisted types are still never hijacked (test locked previously).
- **Correction to the previous note**: "ArchDetail converts" (previous
  phase) was inaccurate — ok 46→47 there came from another file;
  ArchDetail still gaps on its `Part::Compound` container's member
  resolution (compound-missing-members). Compounds remain next-phase work.
- all_objects residual `type-not-whitelisted` triaged: four more FEM
  constraint families (PlaneRotation/Pulley/Temperature/Transform) — same
  preserved-only semantics, set additions next phase (mechanical, low
  risk).

## Alternatives considered

- **python-opaque first + import only for Part::Feature** — that was the
  failing state: ordering must follow evidence strength (a frozen asset is
  stronger evidence of geometry than a Proxy is of untranslatability).
- **Add the four FEM constraint types in this same commit** — held back:
  each sweep phase ships one reviewed change; set additions ride the next
  phase.

## Consequences

- 56-sample sweep: ok 47→**48** (EngineBlock converts; its Extrusions and
  downstream Fusion002/Cut004 all resolve), gap 9→8, checkFail 0.
- Remaining 8: sketch-not-solved 2 (BIM policy / tangent topology),
  external-geometry 2 (curve projection / migrated format), compound 1
  (ArchDetail containers), unsupported-constraint 1 (InternalAlignment,
  documented), type-not-whitelisted 1 (all_objects FEM families, set
  addition), delta-exceeds-t1 1 (documented).
- fcstd suite 13 files / 140 cases green (+2: Draft-circle-import ordering
  GOTCHA; Part::Feature import_shape contract update).
