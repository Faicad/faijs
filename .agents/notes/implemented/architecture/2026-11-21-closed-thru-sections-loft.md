# Agent Note: Closed ThruSections for `cad.loft`

Status: implemented

English | [中文](2026-11-21-closed-thru-sections-loft.zh.md)

## Problem

`sand3d`'s `loft(..., loop=True)` and other closed-profile lofts need a
ThruSections surface whose first and last sections meet, with **no** end caps.
faijs exposed only `LoftOptions { ruled, endPoint }`; adding the first section to
the end and lofting a solid would create two coincident caps — an internal
partition, not a ring.

## Decision

1. Add `BrepEngineApi.loftShell(sections, ruled)`: the neutral "loft as a shell"
   step. occt maps it to `loft(wires, isSolid=false, ruled)`; brepkit and smlib
   fail explicitly.
2. Add `LoftOptions.closed`. The implementation appends the first section,
   calls `loftShell`, then `sew([shell], 1e-6)` and `makeSolid(sealed)`.
3. Reject `closed` together with `endPoint`, and require at least three
   sections (`E_LOFT_CLOSED_ENDPOINT` / `E_LOFT_CLOSED_SECTIONS`).
4. Document that closed loft is occt-only; a brepkit host sees the explicit
   `loftShell` failure rather than a silently different solid.

## Alternatives considered

**Append the first section and loft a solid, then delete the caps.** The caps
are not addressable without the loft history, and the coincident caps may
already be an internal face; deleting by geometry is guesswork. Rejected.

**Approximate the ring in the caller** (duplicated first section plus a seam
cap). That produces geometry with a different topology, against the "never
emit a semantically different approximation" rule. Rejected.

**Make closed a new `cad.loftClosed` op.** `LoftOptions.closed` keeps the
surface small and reuses the existing arity/signature checks; the occt-only
limit is reported by `loftShell`. Chosen.

## Consequences

- A closed loft needs at least three sections and cannot combine with
  `endPoint`.
- brepkit/smlib hosts fail closed loft explicitly.
- `packages/core/test/api/loft-closed.test.ts` pins a four-section ring
  (bbox ±12 in X/Y, ±2 in Z, volume > 0) and the fewer-than-three refusal.
- `cad.loft`'s basic `{ruled, endPoint}` behaviour and existing tests are
  unchanged.