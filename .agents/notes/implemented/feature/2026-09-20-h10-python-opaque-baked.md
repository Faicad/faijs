# Agent Note: H10 — Python features bake legitimately (python-opaque → python-baked)

Status: implemented

English | [中文](2026-09-20-h10-python-opaque-baked.zh.md)

## Problem

C4 (the batch-convert final check) allows exactly three dispositions:
`translated` / `python-baked` / `preserved-only`. The rename consumer for the
Python exception existed (`auditMapping`: reason `python-opaque` → disposition
`python-baked`), but **no code ever produced the `python-opaque` reason**. The
feature translator returned `baked` + `type-not-whitelisted: <type>` for every
non-whitelisted type, so Python-scripted features (`Part::FeaturePython`,
`App::FeaturePython`, `Path::FeaturePython`, …) landed 100% in the gap list.
Python objects are the largest single gap family (4,514 objects / 647 files,
9.8% of the library). The existing test assertion `reason !== 'python-opaque'`
was vacuously true — nothing could ever emit that reason.

A related misclassification: `App::Point` / `App::Annotation` are datum/
annotation types that belong in `STRUCTURAL_TYPES` (preserved-only) but were
counted as translation gaps.

## Decision

- **Producer wired at the translation verdict** (`feature-translate.ts`):
  new exported predicate `isPythonOpaque(obj)` decides the C4 Python exception
  by **property presence** — a property named `Python` or `Proxy`, or any
  property whose XML `type` attribute is `App::PropertyPythonObject`. The
  whitelist check in `translateObject` returns
  `{ kind: 'baked', reason: 'python-opaque' }` for such objects (after the
  whitelist check, so whitelisted types are never captured by the exception).
- **Suffix is NOT evidence.** A type name ending in `Python` without the
  property stays a plain `type-not-whitelisted` gap. This matches the library
  profile's property-based counting and the plan's explicit requirement.
- **`App::Point` / `App::Annotation`** added to `STRUCTURAL_TYPES`
  (`convert.ts`) → `preserved-only`.
- **Vacuous test upgraded to a positive lock** (`convert.test.ts`): gaps from
  the Draft/Python corpus sample must never contain a type matching `/Python/`.

## Alternatives considered

- **Type-name suffix (`/\bPython\b/` on the type) as the trigger** — rejected:
  the plan mandates property-based evidence; a suffix alone risks free-riding
  non-Python objects into `python-baked` (violates V-C6) and misses Python
  carriers whose type name lacks the suffix.
- **Judging in `auditMapping` only (post-hoc)** — rejected: the audit sees only
  `type` + `reason`, not the parsed properties; property evidence must be read
  where the object graph is available (the translator).
- **Baking Python features' shapes as `cad.asset` now** — deferred: the plan
  lists downstream-consumption of Python shapes as a follow-up; this change
  only wires the ledger exception.

## Consequences

- Python-scripted features no longer block conversion as gaps; files whose
  only non-translated objects are Python-opaque (plus structural types) now
  convert with `ok=true` and a `python-baked` ledger entry each.
- `convert.test.ts:42`'s old vacuous assertion is kept (still true) and
  supplemented with the positive `/Python/` gap lock.
- Tests: `feature-translate.test.ts` H10 group (4 cases: GOTCHA for the
  FeaturePython-with-Proxy shape, suffix-insufficiency GOTCHA, property-name
  variant, V-C6 no-free-ride on a whitelisted Box); fcstd suite 125/125 green.
