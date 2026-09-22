# Agent Note: Split cq-compat into domain packages

Status: implemented

English | [中文](2026-09-22-cq-compat-package-split.zh.md)

## Problem

`@faicad/cq-compat` bundled the CadQuery-compatibility surface (Workplane API,
2D drawing, solids, features, selectors, transforms, gear kernel) together with
the assembly layer, the STEP/assembly compare tooling, and (planned) the 2D
sketch domain. Consumers such as `fai_cq_gears` and `fai_cq_warehouse` had to
carry the whole surface even when they only needed one domain, and the compare
tooling (a dev-only harness) shipped inside the runtime package.

## Decision

Split cq-compat into one compatibility main package plus domain packages, with
the main package keeping the full CadQuery-compatible body:

- `@faicad/cq-compat` (0.13.2) — keeps the compatibility body: workplane / 2D
  drawing / solids / features / selectors / transforms / gear kernel. Removes
  assembly and compare exports; re-exports `asBrepShape` and
  `resolveFaceSelector` (internal symbols the assembly layer needs).
- `@faicad/cq-compat-assembly` (0.1.0) — assembly compatibility layer:
  `buildAssembly` returns a `CqAssembly` object; `solve()` is idempotent and
  wraps the core global solver; `toCompound()` returns the solved compound;
  `save()` lives in node:fs and is excluded from the browser entry. Consumers
  only ever use the CadQuery syntax (`constraint` / `buildAssembly` /
  `solve()` / `toCompound()`), never core internals.
- `@faicad/cq-compat-compare` (0.1.0) — dev-only geometry-equivalence
  comparer (STEP and assembly compare). Must never appear in any runtime
  dependency chain; only dev scripts and tests import it.
- `@faicad/cq-compat-sketch` (0.1.0) — skeleton for the 2D constrained-sketch
  domain (mirrors CadQuery sketch.py / occ_impl/sketch_solver.py boundary);
  currently `export {}` with a Phase-2 plan, to be filled by the roadmap.

`fai_cq_gears` runtime is frozen: zero changes to dependency declarations and
`src/`; the only exception is dev-side compare imports pointing at
`cq-compat-compare`. `fai_cq_warehouse` has no runtime cq-compat dependency;
its dev-side compare imports moved to the new package. `3d_editor` is out of
scope (it consumes the core `cad.assembly` syntax directly and has no
`@faicad/cq-compat` import).

mini_lathe (external project) migrated its assembly script to the
`@faicad/cq-compat-assembly` grammar: `cqa.constraint` / `cqa.buildAssembly`
/ `asm.solve()` / `asm.toCompound()`, with a distinct local name `cqa` to avoid
the `cq` autoLoadLibsFromImports first-seen collision.

## Alternatives considered

- Thin down the main package to the gear-minimum surface (v2 layout): rejected
  by the user — "cq-compat的含义是cadquery兼容。你都去掉了，还谈什么兼容" — the
  compatibility body stays whole; only assembly and 2D sketch split out.
- Keep compare inside cq-compat: rejected by the user — dev tooling must be
  its own package so library consumers do not carry it.
- Provide an `@faicad/cq-compat-all` aggregator: rejected by the user — no
  aggregator package.
- Keep mini_lathe on the core `cad.assembly` syntax: rejected by the user —
  since it speaks CadQuery syntax it must use the CadQuery `solve()` API
  wrapping the underlying solver, not direct core calls.

## Consequences

- Root workspaces grew to 11 entries with a strict order
  (core → compare → cq-compat → assembly → sketch → gears → warehouse →
  sheetmetal → fixtures → tests → demo); `check-workspaces-order` enforces it.
- `cq-compat` 131 tests, `cq-compat-assembly` 21 tests, `cq-compat-compare`
  2 tests, `packages/tests` 1653+12 parity, mini_lathe 7 passed / 2 skipped
  (numeric e2e segment needs a cadquery-python reference file) all green.
- The faijs borrow-view lifecycle is tied to the execution context: rebuilding
  an assembly in TS with shapes read from `outputs` yields dead member views.
  Tests therefore verify the script end-to-end plus a syntax guard (no direct
  core-solver calls) instead of a TS-side rebuild; the GOTCHA is recorded in
  the mini_lathe test comments.
- Publish list and topology updated in the npm publish plan; versions stay
  0.1.0 (new packages) / 0.13.2 (cq-compat) until the release bump step.
- Pre-existing reds kept as-is and reported separately: core typecheck
  (place-calibration.test.ts:90, feature-translate.test.ts:266/882), lint
  (import-brep.test.ts:13, import-brep.ts:59,
  evolution-declaration.test.ts:86, convert.ts:26), gears stability 8 cases,
  warehouse params hash — none introduced by this change.