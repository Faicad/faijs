# Agent Note: `migratePmiSet` takes a foreign-input type, not `PmiSet`

Status: implemented

English | [中文](2026-11-21-pmi-set-input-typing.zh.md)

## Problem

`migratePmiSet` exists to normalize PMI sets that come from outside faijs (3MF
`faijs:pmi` metadata, historical JSON, imported STEP AP242), including the legacy kind
literals `note` and `techNote` that `normalizePmiKind` maps onto `localNote` /
`generalNote`. Its parameter was typed `PmiSet`, whose `items` are `PmiItem[]` — and
`PmiItemKind` no longer contains `note` or `techNote` after the scope-axis rename. So the
one input shape the function is designed for could not be passed without a cast, and the
migration test had to feed values the declared type rejected
(`TS2322: '"note"' is not assignable to PmiItemKind`). The guard also returned `raw`
unmigrated when `items` was not an array, i.e. it silently handed legacy `kind` literals
back to callers.

## Decision

Introduce `PmiSetInput { items: readonly unknown[]; meta?: PmiSetMeta }` and take it as
the parameter type. `unknown[]` is the honest type: before migration the element kinds are
by definition outside the current enumeration. A non-array `items` now throws with context
instead of returning the raw set, per the repo rule that unknown/malformed input is
reported rather than masked. The sole production caller (`parsePmiFrom3mfMetadata`)
already validates `items` and wraps the call in a `try`, so its "malformed metadata →
`undefined`" contract is unchanged.

## Alternatives considered

- **Keep `PmiSet` and cast in the test.** Rejected: the cast would live in the test, not
  the API, and every future external-data caller would need the same cast — the signature
  would keep claiming that already-normalized input is required.
- **Accept `PmiSet | unknown` and branch inside.** Rejected: `unknown` already covers
  `PmiSet`; the union adds nothing and hides which fields the function reads.
- **Keep returning `raw` for a non-array `items`.** Rejected: that is the silent
  degradation the repo forbids, and the value it returns is typed as a migrated `PmiSet`
  when it is not.

## Consequences

- Legacy-kind sets can be passed to `migratePmiSet` without casts, and the compiler now
  enforces that callers cannot hand it pre-normalized types by accident.
- Callers that passed a structurally broken set (no `items` array) now get a thrown error
  carrying context instead of a pass-through value.
- `PmiSetInput` is exported from `api/pmi/kind-alias`; it is an input-only type and
  intentionally not re-exported as part of the public PMI surface beyond that module.
