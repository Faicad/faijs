# Agent Note: FCStd port M13 — coverage expansion, first batch (2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m13-coverage-wave1.zh.md)

## Probe conclusions (M13.0, scripts/probe-m13-types.ts)

| Type | Corpus shape | Decision |
|---|---|---|
| `Part::Compound`(5) | `Links` PropertyLinkList + own .brp | **implement** → cad.group |
| `Part::Sphere`(1)+AdditiveSphere(1) | Radius (draft sample params readable in XML) | **implement** → cad.sphere; partial-angle/missing-Radius explicitly baked |
| `Part::Offset2D`(22) | Source/Value/Fill/Join readable, but Offset2D is a 2D offset — faijs has no matching op, needs wire-offset capability first | **defer**, dependency not ready |
| `Part::Mirroring`(4) | three EngineBlock instances + one draft; parameter properties unreadable in the probe (mirror-plane storage is non-standard) | **defer**, shape needs a second probe |

## Implementation (M13.1)

- `Part::Compound`: all Links members resolvable → `cad.group`; any unresolvable → bake `compound-missing-members`
- `Part::Sphere`: full angle (Angle1=-90/Angle2=90/Angle3=360) → `cad.sphere` at Placement; partial angle → bake `sphere-partial-angle`; missing Radius → bake `sphere-missing-radius`

## Verification (M13.2 / DoD)

- V5 dual caliber: non-Python coverage 556→**562**, coverage 65.6%→**66.3%** (ArchDetail's 4 Compounds + draft Sphere/others enter the whitelist caliber)
- ArchDetail / draft_test_objects conversion → faijs-cli check all OK (draft product contains `sphere` and `group` calls)
- fcstd 13 files / 102 cases all green (+5: M13 whitelist extensions)

## Follow-up candidates (cost-benefit order)

1. `Part::Offset2D`(22): implement a wire-offset op in faijs first (biggest gain)
2. `Part::Mirroring`(4): add a probe to understand mirror-plane storage first
3. M13.3 external geometry full unlock: bring Drilling_1-like L2-prejudged sketches back to L1
4. M10 leftover container loader: close the cross-file `<Body>_out` reference loop
