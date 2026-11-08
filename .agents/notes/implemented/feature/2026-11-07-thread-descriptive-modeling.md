# Agent Note: Descriptive thread spec (`thread: 'M16-6H'`) for drill and screw

Status: implemented

English | [中文](2026-11-07-thread-descriptive-modeling.zh.md)

## Problem

Tapping a hole by spec required the internal three-key vocabulary: `fai_drill(part, { holeType: 'tapped', screwSystem: 'metric', screwSpecIdx: 10, screwThread: 'coarse' })`. The human-facing writing — "M16 thread hole" — had no direct entry point, and AI code generators reading the generated API manuals learned the internal `screwSpecIdx` vocabulary instead of the engineering callout notation.

The 2026-11-07 code audit also registered a defect list around threads: brep custom pitch falling back to coarse, hardcoded through-hole thread height, imperial PMI missing a default class, `handedness` never produced, dead 3MF PMI serialize/parse twins, broken 3MF PMI round-trip, brep tolerance ignored, `cad.screw` brep major diameter exceeding nominal, divergent `holeType:'screw'` semantics, and `mirror` missing `pmiRemap`.

## Decision

A descriptive spec grammar (`parseThreadSpec`) is the preferred entry for both ops, and the registered defects are fixed on the BREP chain only.

**Grammar** (normalized, space-tolerant): metric `M<dia>[×<pitch>][-<class>][↧|↓<depth>]`, imperial `[#<gauge>|<frac>"|<dec>][-<tpi>][-<class>][↧|↓<depth>]`, pipe `PT|R|Rc<size>[↧|↓<depth>]`. Classes: metric `[4-8][GH]`, imperial `1B|2B|3B`; depth suffix maps to the hole `depth` parameter. `specLabel` carries the spec part only.

**Keys**: `fai_drill` gains `thread`; `screw` gains `spec` (its `thread` key is taken by the tooth-profile enum).

**Semantics** (user-confirmed): with `thread` present, `holeType` defaults to `'tapped'`; `diameter` defaults to the table-derived pilot; no `depth` means through hole. The spec string is drawing-callout syntax: a `PmiThreadHole` is produced only when the string carries a tolerance-class suffix (`-6H`) or the caller passes `threadClass` explicitly; otherwise geometry only, no PMI, and no `6H` default on this path. String-carried fields conflict with their explicit params (`↧18` vs `depth`, `-6H` vs `threadClass`) and with the legacy three-key combination — `E_ARG` on each. The legacy three-key entry keeps working unchanged (existing scripts untouched), and both entries resolve to the same `ResolvedThreadSpec`.

**AI-facing visibility**: the generated AI manuals (`gen-skill-docs --emit`, consumed by ai-gateway; `gen-api-dts` → `api.d.ts`) advertise only `thread`/`spec` with grammar examples; the legacy `screwSystem`/`screwSpecIdx`/`screwThread` (and `screw`'s `system`/`specIdx`) params are hidden from the generated doc surface via a hide marker filtered by the generators — TypeScript types and runtime keep them.

**Scope**: BREP chain only; the mesh chain is frozen (separate decision, 2026-11-07). The metric table extends to M64.

**Delivered fixes**: JSDoc/type lies corrected; brep custom-pitch pass-through (`screwPitchCustom`); through-hole thread height derived from the bbox; imperial `'2B'` default on the legacy path; `handedness` PMI param; 3MF PMI serialize/parse unified with round-trip; brep `tolerance` honored (simple/tapped only — screw holes ignore it to preserve pilot/tooth pairing); `cad.screw` crest at nominal major diameter; `holeType:'screw'` tooth profile rooted at the pilot wall with apex to nominal; `mirror`-only `pmiRemap` (mirrorJoin deliberately not registered).

## Alternatives considered

**Replace the three-key entry with the descriptive key.** Rejected: existing scripts and downstream consumers use the three-key form; the descriptive key is additive (zero-modification rule).

**Default `6H` on the descriptive path and always emit PMI.** Rejected by the user: the spec string is drawing-callout syntax — a callout without a tolerance class annotates nothing; PMI is emitted only when the class is present in the string or passed explicitly.

**Map `↧18` to `threadDepth`.** Rejected by the user (chose hole `depth: 18`): matches the caller vocabulary where "no depth = through hole".

**Fix defects on both chains.** Rejected: the mesh chain is frozen; mesh-side defects are registered, not repaired.

**Hide legacy keys by deleting them from TypeScript types.** Rejected: type-level removal breaks existing scripts' typechecking; hiding applies to the generated AI-facing documentation surface only.

## Consequences

- All acceptance criteria verified green: `parseThreadSpec` grammar (29/29 tests); `fai_drill` `thread` key (mutex, PMI-condition, blind-hole, legacy-equivalence); `screw` `spec` key; AI-facing docs hide legacy keys; each Phase 2–4 fix carries its regression test; the 55-case thread baseline stays green (mesh cases as frozen baseline).
- The `#14` tooth-profile change made volume-based discrimination impossible (tooth depth is fixed by pilot→major while tooth width scales with pitch, so fill fraction is scale-invariant): regression tests use face-count and ring-probe discriminators instead of volume.
- The descriptive path's conditional PMI differs from the legacy path's always-PMI behavior — documented and locked by tests, not silently unified.
- `PmiAffine` reflection (for `mirror` pmiRemap) was verified by a probe test preserved in the suite; the reflection matrices produce `-0`, so direction assertions go through `expectVec` rather than raw equality.
- The `E_ARG`/`E_THREAD_SPEC` messages survive `toOpFailure` wrapping, so script-facing failures surface the original codes.
