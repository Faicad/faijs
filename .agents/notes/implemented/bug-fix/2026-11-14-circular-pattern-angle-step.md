# Agent Note: circularPattern takes an angle step, not a nominal full angle

Status: implemented

English | [中文](2026-11-14-circular-pattern-angle-step.zh.md)

## Problem

`circularPattern`'s fourth parameter was `fullAngle`, documented as the total swept angle. Nothing implemented that: every layer divided it by `count` and used the quotient as the per-instance step (`replicate.ts`, `patternFns.ts`, `smlibKernel.ts`), and occt-wasm's own primitive takes a total angle in radians and divides it by `count` internally. So a caller asking for four instances 30° apart had to pass 120 — a number that matches neither "total span" (90°) nor "step" (30°). Only `fullAngle = 360` was self-consistent, because `360 / count` is both the full-circle share and the spacing of a closed ring, which is why the defect survived so long.

## Decision

The parameter is `angleStep`, in degrees: `count` instances (original included) sit at `0, step, …, (count−1)·step`, defaulting to `360 / count`. `fullAngle` is gone with no alias. Validation: `count` must be a positive integer; with `count > 1` a step of 0 or `|step| ≥ 360` is rejected on both faces (`[api/circularPattern] angleStep …` on the script face, `PATTERN_INVALID_STEP` on the compat face). The occt adapter now converts the documented step into occt-wasm's total-angle-radians form (`count · step · π/180`) instead of passing the step straight through. The brepkit adapter, which can only produce a full-turn split, fails loudly when `angleStep ≠ 360 / count` rather than returning instances at wrong angles.

## Alternatives considered

- **Keep `fullAngle` and document it as `count × step`.** Rejected: the name says "angle swept by the pattern" while the value is a nominal product that matches reality only at 360°, and every caller has to compute a derived number.
- **Support both `fullAngle` and `angleStep`, deprecating the former.** Rejected: two spellings of one concept keep the wrong mental model alive and make every call site ambiguous; no in-repo script-face caller needs migrating.
- **Name it `spanAngle` / `totalAngle` and divide by `count − 1`.** Rejected: it would match "first-to-last span", but neither kernel works that way (occt-wasm and SMLib both rotate by a step) and `count = 1` would divide by zero. The kernels' own API is a step, so the surface API is a step.

## Consequences

- `circularPattern(shape, axis, 4, 30)` now means four instances 30° apart — the same form SMLib and occt-wasm take internally; closed rings stay `angleStep = 360 / count` (explicit or default), so whole-circle call sites are unchanged.
- The occt adapter change is a behaviour fix beyond the rename: passing the step straight to occt-wasm produced `step / count` radians, i.e. four instances at 69.7° for `(30, 4)`. `test/api/circular-pattern-step.test.ts` pins kernel-level angles plus fused-bbox equality against hand-rotated baselines; `test/smlib-kernel/circular-pattern-step.test.ts` pins the same contract on SMLib and skips when the optional wasm package is absent.
- `arg-spec.ts` and the generated L3 surface (`api/generated/*`) carry the new name; `docs/ops-api-inventory.md` and its Chinese pair are regenerated from the JSDoc.
