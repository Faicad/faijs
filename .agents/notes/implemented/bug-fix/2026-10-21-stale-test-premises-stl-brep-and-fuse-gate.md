# Agent Note: two long-red tests encoded premises that later changed — and how the verdict gate stays honest

Status: implemented

English | [中文](2026-10-21-stale-test-premises-stl-brep-and-fuse-gate.zh.md)

## Problem

Four tests had been red for weeks before any of this session's work touched them; a
`git worktree` copy of a clean `HEAD` reproduced them one for one, which is the only
reason they were not mistaken for a regression. Both failures shared one shape: **the
assertion froze a premise that a later, deliberate change had already overturned**, and
nobody re-read the test when the change landed.

1. `test/brep/case2-load-stl-cylinder-assembly.test.ts` asserted "STL → mesh, `cube_v0`
   has no solid" (`solidCache` / `brepSolids` must not contain it). v0.35.6 (commit
   `28c2811`) moved **STL onto the BREP path** on both engines (brepkit `importStl` +
   `weld`/`unify`; occt `reconstructSolidFromMesh`) precisely so that imported STL can be
   filleted / drilled / split — none of which works on a shell with no face-edge
   adjacency. So `cube_v0` now carries a BREP handle, and both assertions were asserting
   the opposite of the shipped behaviour. `docs/api-contract.md` §8 already said so in
   plain text ("**STL is not on the mesh path** since v0.35.6"); the test never followed.

2. `test/brep/engine/engine-verdict-equivalence.test.ts` froze the breach-kit verdict as
   it stood **at the moment the `capabilities` axis was deleted**, and required
   `oldBlocked == newBlocked` exactly. v0.35.7 (commit `72ab6bc`) removed
   `engines: ['occt']` from `fuse` after establishing that `fuseBrep` only calls
   `getBrepApi().fuse` (an L1 method brepkit also has). That is one intentional loss of
   interception — so the equality broke, and the gate was red for the wrong reason.

The second case is the interesting one: the gate was doing its job. "Any change to the
verdict set must surface" is exactly what we want. What was missing was a way to record
a *reviewed* change, so that real regressions are not drowned out by a permanently red
baseline.

## Decision

**case2 — update the assertions to the shipped premise, and make them bite.** The file's
own thesis (per-part BREP independence) never depended on STL being mesh; only its
parenthetical did. So `cube_v0 ∈ solidCache` is now asserted `true`, with the v0.35.6
reference inline, plus two shape-level assertions that are strictly stronger than the
old ones: `hasBrep(cube_v0) === true` and `hasMeshSolid(cube_v0) === false`. The second
`brepSolids` test now asserts what actually matters — both terminals are in the map **and
they do not share a handle** (`cubeSolid.solid !== matedSolid.solid`), which is the
observable face of "per part, not one global chain". The "mesh never enters
`solidCache`" invariant is *not* re-tested here: it lives in
`test/api/load-mesh-solid.test.ts:171` against the 3MF/mesh-mode path, which is the only
mesh path left. Two homes for one fact is how the gap opened in the first place.

**verdict-equivalence — keep the frozen `HEAD` snapshot, add a ledger.** A new
`INTENTIONALLY_UNGATED_BREP_OPS` map records reviewed post-`HEAD` un-gatings, one entry
per op, each with **commit + geometric proof + why it is safe**. Admission requires all
three; an entry without them is not a waiver, it is a hole. The two diff assertions became:

- "newly intercepted" must still be empty — over-narrowing is never allowed as a delta.
- "lost interception" must equal **exactly** the ledger's keys. A silent un-gating still
  goes red; a ledger entry that went stale (op re-gated) also goes red, because every key
  is checked against the `HEAD` blocked set.
- `fuse`'s proof points at `test/brep/engine/brepkit-fuse-op.test.ts`, which asserts volume
  ≈ 1875 for a union of two offset 10³ boxes — geometry truth, not "no error thrown".

Teeth were verified by renaming the `fuse` key in the ledger and re-running: 2 tests red
(`expected [Array(19)] to deeply equal [Array(20)]`, and the diff assertion naming `fuse`),
then green again on restore.

## Alternatives considered

- **Flip `fuse` back into the blocked set** (re-add `engines: ['occt']`). Would re-break
  the sheetmetal fold path, which calls L1 `fuse` on brepkit, and would contradict an
  established empirical result. Fixing a test by un-shipping a fix is the wrong direction.
- **Delete the four assertions.** The equality gate catches a whole class of regressions
  (an op losing its engine restriction by accident). Deleting it to make CI green trades
  a visible problem for an invisible one.
- **Bundle `case2` onto a 3MF fixture to keep "STL → mesh" alive.** That premise is dead
  by design; keeping it alive in another file would encode a false statement about the
  product. The mesh-terminal invariant is already covered where it belongs.
- **Rewrite the `HEAD` snapshot to today's state.** Then the test can no longer prove
  "the verdict did not drift at the moment the axis was deleted", which is its only
  reason to exist.

## Consequences

Both failures were discoverable by reading the contract: `docs/api-contract.md` §8 states
the STL change outright, and `arg-spec.ts:183-187` carries a five-line comment explaining
why `fuse`'s gate was removed. The tests simply were not part of the change's checklist.
Two consequences worth carrying forward:

- A behaviour change that flips an invariant must grep the tests that assert that
  invariant. "Which tests name this op / this file format?" is a cheap search; both of
  these would have been caught by it.
- When a frozen-snapshot gate legitimately needs to move, give it a **ledger with an
  admission rule**, not a relaxed assertion. The difference is whether the next
  un-reviewed change still turns the gate red.

A third, quieter cost: a permanently red gate trains readers to ignore it. These four
failures sat inside a suite that was green apart from them, so "4 red, pre-existing"
became a normal sentence in status reports. The ledger turns that sentence into "0 red",
which is the only baseline a future regression can stand out against.

## Verification

- The two files, run together: 16 passed.
- Full suite: **4881 passed / 0 failed** (was 4880 passed / 4 failed).
- Teeth check on the ledger: renaming the `fuse` key produced exactly 2 failures — the
  set-equality assertion (`expected [Array(19)] to deeply equal [Array(20)]`) and the
  diff assertion naming `fuse` — and restoring the key returned 10/10.
- `verify-agent-note-format`, `verify-agent-note-classification`, `verify-md-wrap`,
  `verify-md-links`, `verify-translation-pairing` clean for the new note pair.

## Files

- `packages/core/test/brep/case2-load-stl-cylinder-assembly.test.ts` — premise corrected;
  `hasBrep`/`hasMeshSolid` and handle-distinctness assertions added.
- `packages/core/test/brep/engine/engine-verdict-equivalence.test.ts` — `INTENTIONALLY_UNGATED_BREP_OPS`
  ledger + `headBlockedOnBrepkit()` helper; ledger-key staleness check.
