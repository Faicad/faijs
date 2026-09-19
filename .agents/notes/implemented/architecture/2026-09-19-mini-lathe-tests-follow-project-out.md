# Agent Note: mini_lathe test fixture ownership follows the project out of the monorepo

Status: implemented

English | [中文](2026-09-19-mini-lathe-tests-follow-project-out.zh.md)

## Problem

mini_lathe was moved out of the faijs monorepo to `D:/Faicad/cadquery-port/mini_lathe` (commit a7326a3), but two cq-compat tests (`assembly-mini-lathe-e2e.test.ts`, `assembly-export-bake.test.ts`) stayed behind and kept probing the old paths — they failed suite-level with "mini_lathe root not found". A first fix (retarget the path candidates) stopped the bleeding but left the split-brain: faijs CI would keep carrying tests whose only fixture lives in another repository, so a cadquery-port rename or deletion would break faijs again.

## Decision

The two tests belong to the mini_lathe case study, not to the cq-compat library surface: their subject is "mini_lathe assembly solved on the cq-compat solver", mini_lathe is their only fixture, and the frozen reference poses (`out/ref/mini_lathe_poses.json`) live in the mini_lathe project. They were therefore **moved to `cadquery-port/mini_lathe/tests/`** (renamed `assembly-e2e.test.ts` / `export-bake.test.ts`) and deleted from cq-compat.

Supporting changes:

- `cadquery-port/mini_lathe` gained `vitest.config.ts` (aliases resolve `@faicad/faijs*` and `@faicad/cq-compat` to faijs live source, matching the monorepo M7 no-pack convention), a `test` script, and tsconfig paths covering `tests/`.
- cq-compat keeps all library-level tests; remaining "mini_lathe" mentions there are historical comments only, no file access (verified by grep).
- Reference poses were regenerated in place with `scripts/export-cadquery-ref.py` (cadquery-env python) — `out/` is gitignored, so the fresh checkout had no pose file.

## Alternatives considered

- **Retarget the path candidates in place (first fix).** Rejected after the user clarified the goal: "彻底剥离" — anything that reads mini_lathe files must live next to mini_lathe; a monorepo test reaching into a sibling repository is the coupling we are removing.
- **Move the whole cq-compat suite.** Rejected: the other assembly tests (constraints, global solver, lift boundary) test the library itself with synthetic fixtures and no mini_lathe file access; they are cq-compat's regression guard and stay.

## Consequences

- faijs CI no longer depends on anything outside the monorepo for cq-compat tests; cadquery-port owns the mini_lathe e2e/bake verification and runs it via `npm test` inside `mini_lathe/`.
- New installs of cadquery-port need `npm install` in `mini_lathe/` plus one `scripts/export-cadquery-ref.py` run before the tests can pass (documented gotcha: `out/` is gitignored).
- The alias setup embeds one fragile fact: `@faicad/faijs/shape` maps to `packages/core/src/shape.ts` (NOT `mesh/index.ts`) — pointing it at the wrong module surfaced as `isShape is not a function` (dual-instance symptom), not as a resolution error.
