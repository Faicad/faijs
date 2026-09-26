# Agent Note: intersect op degraded to brepkit via static capability dispatch

English | [中文](2026-09-26-intersect-brepkit-capability-degradation.zh.md)

## Problem

`intersect` declared `capabilities: ['intersectWithHistory']`. The brepkit adapter does not declare `intersectWithHistory` (its evolution set is exactly `['fuseWithHistory','cutWithHistory','filletWithHistory']`, hard-coded by `evolution-declaration.test.ts`), so on brepkit it was rejected before execution with `lacks capability 'intersectWithHistory'`. The user required brepkit support, noting the kernel has plain `intersect(a,b)` and the difference is only in naming/evolution extension.

## Design decision: Direction A (neutral op + static dispatch in booleanBrep)

Rejected Direction B (disjunctive capabilities in defineOp) because it would change the framework-level `firstMissingCapability`/`dispatchPath` semantics from conjunction to disjunction, with large blast radius. Direction A only reads the same declared capability set inside `booleanBrep` for a static branch — no new mechanism, no runtime try-catch.

### Changes in `api/boolean.ts`

1. `intersect` op: removed `capabilities: ['intersectWithHistory']` → neutral op.
2. `booleanBrep`: static dispatch via `engineCapabilitySet(getBackends().config.brepCapabilities)`:
   - Engine declares `*WithHistory` (occt) → `booleanWithRoleTable` history path, produces faceEvolution + roleTable.
   - Otherwise (brepkit) → bare L1 `kernel[op](a,b)`, no faceEvolution, no roleTable propagation.
3. `fuse`/`cut` keep their `*WithHistory` capability declarations — the dispatchPath gate guarantees they only reach `booleanBrep` when the engine declares the history method, so `useHistory` is always true for them. Zero behavior change.

### Honest naming degradation

On brepkit, intersect output has no face identity (lineage node registered as `kind:'kernel'` but no evolution attached). We explicitly did NOT fabricate an identity-mapping evolution table — the resulting solid's face hashes are fundamentally different from the inputs, so a恒等 mapping would be fake identity.

## Consequences

- intersect passes on occt + brepkit 2.129.15/3.4.18/4.0.32, bbox [16,16,20] identical across all four engines.
- occt behavior unchanged (still uses `intersectWithHistory`, full evolution/roleTable).
- If brepkit ever declares `intersectWithHistory` in the future, the branch automatically switches to the history path — no code change needed.

## Verification

- `brepkit-intersect-fix.test.ts` (4 cases): occt history path (with face evolution) + 3 brepkit versions bare path (no evolution, geometry correct).
- `multi-engine-op-parity.test.ts`: mismatches=0; intersect moved from error cases (24→21) to parity cases (129→132).
- Guards: `evolution-declaration`, `engine-switch-p3`, `arg-spec-capabilities` all pass.
- Naming suite (144 tests) and mesh path unaffected.
