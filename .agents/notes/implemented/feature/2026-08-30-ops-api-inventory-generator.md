# Agent Note: ops-api-inventory generated from JSDoc

Status: implemented

English | [中文](2026-08-30-ops-api-inventory-generator.zh.md)

## Problem

`docs/ops-api-inventory.md` — the `.faijs` API manual — was hand-written and
drifted out of sync with the stdlib operators: every runtime contract change
required a manual doc edit, and the doc gates had no way to notice the drift
between the manual and the actual op signatures.

## Decision

The inventory is now generated from the stdlib source of truth.
`scripts/gen-ops-api-inventory.ts` extracts each op's contract from its JSDoc —
`@group`/`@name`/`@doc-group` for sectioning and `@param params.<key>` for the
per-key parameter table — and renders three artifacts:
`docs/ops-api-inventory.md` (English), `docs/ops-api-inventory.zh.md`
(Chinese), and `docs/ops-api-inventory.i18n.yaml` (pairing record). Both
languages are generated from the same single-language JSDoc, so the bilingual
pair cannot drift.

The stdlib op JSDoc follows the standard nested-`@param` idiom
(`@param params.radius - …`), which also satisfies the verify-export-jsdoc
gate: every real function parameter has a matching `@param` tag and no stale
tag can survive. Runtime-default facts (`type:…` / `required:true` /
`default:…` tokens inside the param description) are parsed into the
type/required/default table columns; `@note` blocks become independent
blockquote paragraphs (adjacent `>` lines would otherwise merge in GFM and trip
verify-md-wrap).

Embedded markers carry the non-runtime facts code cannot express: `@qual`
(✅/⚠️/❌ interface-quality status), `@compat` (input-form compatibility), and
`@also` (cross-op links). `gen-ops-api-inventory.ts --check` verifies the
committed artifacts are in sync; it is wired in as the first stage of
`npm run doc-sync`, with dedicated `gen-ops-api-inventory` /
`check-ops-api-inventory` scripts.

## Alternatives considered

- **Non-standard per-key tags.** A private `@params-members`-style tag would
  carry each key's docs without mangling the standard contract, but the user
  rejected it: JSDoc must stay standard, and the gate already recognizes
  `params.<key>` as the parameter name `params`.
- **AST-driven key extraction.** Deriving the parameter table from the
  parameter type shapes duplicates facts the JSDoc already states, and cannot
  carry prose (units, defaults, meaning) without a parallel doc source.
- **Hand-maintained inventory.** The pre-existing approach; every contract
  change was a manual edit and no gate could detect staleness.

## Consequences

- Every contract fact now has one home (the stdlib JSDoc); the generated
  manual cannot go stale unless the generator or the JSDoc changes.
- The doc-sync chain starts with `gen-ops-api-inventory.ts --check`, so an
  out-of-sync manual fails the chain before any doc gate runs.
- The stdlib op JSDoc (previously missing or malformed) is now structured and
  standard, moving the operator-function share of verify-export-jsdoc from red
  to green (repo-wide violations 1085 → 1041, all remaining pre-existing).
- `@note` rendering uses one blockquote paragraph per note to stay GFM-correct.