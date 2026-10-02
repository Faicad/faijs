# Agent Note: CadQuery selector string-syntax parity lands in the selector engine

Status: implemented

English | [中文](2026-10-02-cadquery-selector-string-syntax.zh.md)

## Problem

CadQuery's chainable string-syntax selectors — `faces(">Z")`, `edges("|Z")`,
`vertices("<XY")`, set algebra (`and`/`or`/`except`/`not`), index (`>Z[k]`),
multi-axis (`XY`), vectors, type (`%PLANE`), the six named views, and
per-level narrowing (`.faces("+Z").vertices("<XY")`) — are the bread-and-butter
of CadQuery models, but faijs only implemented a face subset. The old face path
relied on a bounding-box heuristic that silently returned the shape centre for
direction/parallel/perpendicular selectors (`faces("|Z")` placed one object at
the middle, not at the two planar faces), so vertex/edge selectors and
multi-level narrowing were entirely missing.

## Decision

The whole string grammar now matches cadquery 2.8.0 `selectors.py`, re-encoded
clean-room in the core engine, and every key syntax is locked in an automated
test. Adapter names: `parseSelector` (grammar), `resolveFaceSelector`
(legacy, kept for the pre-existing single-face path), `resolveEdgeSelection`,
`resolveFaceEdgeSelection`, `resolveVertexSelection`, all exported from
`@faicad/faijs/api/cadquery-selectors`.

- **engine (core):** `grammar.ts` + `types.ts` parse the atom into an AST;
  `predicates.ts` and `resolve.ts` evaluate it against the candidates. The
  resolver is `resolveSelection(owner, [{ kind, sel }])` — a chain of
  (collect→filter) steps; an empty `sel` collects without filtering (CadQuery
  `.vertices()`). Cluster-based sorting and the tolerance bound duplicate
  upstream `_NthSelector`.
- **semantics:** `BaseDir_` drops every non-planar-face/non-line-edge entity
  (so `vertices("|Z")` is empty and `>Z[1]` raises, as upstream); `>` is the
  DirectionMinMax selector, `>>`/`<<` run on the entity's own centre, negative
  indices wrap, and `%` filters by geometry type. Boot-validated against
  cadquery 2.8.0: `faces("|Z")` → 2, `edges("|Z")` → 4, `vertices("|Z")` → 0,
  `vertices(">Z")` → the four top corners. A parsing/type error (`%VERTEX`)
  raises `ParseException` like upstream.
- **Workplane wiring:** `faces/edges/vertices` append a typed `selChain`
  instead of losing the selection; `eachpoint` resolves the chain through
  `resolveSelection(owner, chain)` and places at the survivors' bbox centres.
  Each workplane reset site (`workplane()`, tagged, fillet/chamfer) clears the
  chain so a shell reset never leaks a stale selection.
- **legacy kept:** the old bbox face heuristic stays only for the
  pre-existing single-face paths that do not go through the chain, so
  untouched paths (e.g. `siblings`) are unaffected.

## Verification

- Selector engine unit tests green (52 cases).
- cq-compat `vitest` green, including `selectors-narrowing.test.ts` — which
  locks `vertices(">Z")`, `>Z[1]` raising, `>>Z`, the `BaseDir`-drop, the
  chain `faces("+Z").vertices("<XY")` → the min-x+y top corner, and the
  end-to-end `faces("|Z").eachpoint` placing two bumps (bbox ×1×1×1.1).
- `test_selectors` mirror set: 43/45 PASS (1 export fails only on the
  pre-existing `prism`/`draft` extrude-kernel case, unrelated to selectors).
- No regressions on the other mirror fixtures; both packages typecheck.

## Alternatives considered

- **Fold the whole legacy into the engine up front.** Rejected: several
  private `workplane.ts` helpers (`selectFaceHandles` and friends) already
  consume the old face selector; rewriting them raised the regression risk on
  `siblings`/fillet far above this change's value, so it is left as a
  follow-up simplification.
- **Reproduce cadquery's full class table (Perpendicular, Parallel,
  NearestToPoint, …).** Rejected: only the short-form string syntax is in
  scope; the object-oriented selector classes and the multi-object
  (`wires`/`shells`/`solids`) targets are out, so the whole class tree would
  have been dead weight.
- **Leak the probe into the runtime.** Rejected: every probe-derived
  expectation is pinned in `*.test.ts` (engine unit tests +
  `selectors-narrowing.test.ts` + the mirror fixtures), so the ground truth
  stays repeatable.

## Consequences

- `Workplane` gained a `selChain` field; anything that constructs a Workplane
  literally (test harnesses) keeps `selChain: undefined` consistent with the
  other selection slots.
- The follow-up can fold the remaining `shape-class.ts` string-selector
  classes and the three private `workplane.ts` parsers (used by
  `selectFaceHandles`/`selectEdgeHandles`/`selectFaceHandlesForRemoval`) into
  the central engine, now that the reference semantics live in one module.