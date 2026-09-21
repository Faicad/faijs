# Agent Note: the naming chain breaks at unnamed shape producers

Status: implemented

## Problem

The FCStd port's face/edge references (`cad.edgeRef`) rest on a per-shape role
table. `edgeRef` refuses a shape that has none, and it is right to: the table is
what makes an `(origin, role)` pair resolvable and survivable across the ops that
follow.

Measured (2026-09-21): the Pad→Fillet chain the port emits —
`sketch → extrude → fillet(edgeRef(extrude_out, N))` — dies at the `edgeRef` with

```
E_TOPO_NOT_FOUND: edgeRef: input shape has no role table (nameless shape)
```

A survey of every `fromBrep` site in `api/` shows the producers that establish or
propagate a table are the exception:

| producer | table |
|---|---|
| `primitives.ts` (chain root) | yes |
| `import_brep` (chain root, E3) | yes |
| boolean / fillet / chamfer / copy / place / transform | propagated |
| **`extrude`** | **no** |
| **`revolve`** | **no** (generated compat projection — no code to hang naming on) |
| `sketch` (its face), `compound-geom`, `engrave`, `screw`, `svgExtrude`, `text` | no |
| `load`, `fai_*` (editor-owned) | no, and out of scope by the platform/library split |

So the defect class is not "extrude is broken" but "**being named is opt-in per
op, and forgetting it is silent**". Extrude is the worst member of the class
because it is the chain root of the most common FCStd feature chain. Two corpus
samples died on it: `strange_part_with_holes.fcstd` (CAM DemoParts, at the first
extruded Pad) and `ModelFromV021.FCStd` (PartDesign, at a revolve product — where
the first error is the `edgeRef` ordinal check instead, because ordinal 10 is out
of range for the revolve product, so the nameless shape is reached only later).

## Decision

- **`cad.extrude` establishes a chain-root role table on both of its paths**,
  through one helper (`registerExtrudeRoles` in `api/extrude.ts`) and the same
  mechanism `primitives.ts` uses: origin = the current statement's LHS (so two
  extrudes never collide), roles from `assignRoles` (extrude has no semantic
  namer, so the positional fallback `extrude:face_i` applies, which guarantees
  every face gets a role).
- **The table is registered through `fromBrep` for the solid actually returned**,
  so a product of the delegated length projection is adopted under the same slot
  shape as the up-to product.
- **No semantic `extrude:start/end/side` vocabulary was invented.** No consumer
  reads those strings today — `edgeRef` treats `(origin, role)` as an identity
  label and everything downstream advances by hash — and classifying the caps
  needs the extrude direction, which the assigner signature does not carry.
  Assuming +Z would mislabel every non-Z extrusion silently. It waits for a
  consumer that actually interprets the name.
- **`cad.revolve` stays unnamed on purpose**, pinned by a tripwire test. Fixing it
  is a design fork (a hand-written wrapper op, as `extrude` is, vs. a
  dispatcher-level choke point that names every brep product once), and that fork
  belongs to the plan, not to this fix.
- Documented limit: **an input's role table is not propagated through extrude** —
  the vendored extrude produces no face-evolution record, so there is nothing to
  advance hashes with. Only the faces the extrude itself introduces are named.
  That is still strictly better than before, when there was no table at all.

## Alternatives considered

- **Let `edgeRef` fall back to an ordinal/hash reference when no table exists** —
  rejected: that is the bypass this project forbids. The table *is* the
  capability, and the throw is the honest signal that the producer never
  delivered it. Removing the signal would hide the entire class instead of fixing
  one member of it.
- **Semantic `start/end/side` naming from an assumed +Z direction** — rejected:
  `cad.extrude` takes an arbitrary `normal`, so the assumption silently mislabels
  every non-Z extrusion. A wrong name is worse than an honest positional one.
- **Fix `revolve` in the same round** — rejected as scope: `cad.revolve` is a
  generated compat projection, and this project's rule is that faijs semantics
  (and naming is semantics) belong in a hand-written `defineOp`. Whether that
  wrapper is worth writing, or whether the dispatcher should name every brep
  product once, is a structural decision to take with the corpus distribution in
  hand.
- **Report the gap without fixing extrude** — rejected: Pads and Pockets are the
  corpus's most common feature chain, and the fix is one helper plus one
  registration.

## Consequences

- `packages/tests/faijs/edge-ref/edge-ref.test.ts` gains four cases: `edgeRef` on
  an extrude product resolves; the FCStd Pad→Fillet geometry is correct (7 faces;
  volume loss `(1−π/4)·r²·L`); the table survives `cad.place` (the port emits a
  `place` between features); and a tripwire pins `revolve`'s current nameless
  failure, to be flipped — never deleted — when revolve is fixed.
- Verified green: edge-ref 10/10; core api (extrude-upto, fillet, place,
  place-calibration, compound-geom, face-ref) 36/36; tests package (fillet,
  chamfer, boolean, transforms, topology-naming, features) 55/55.
- The B2 corpus sweep running alongside this change consumes the **installed
  tarball**, not this source tree, and its report records the engine cli sha256 —
  the two are not silently mixed. Re-measuring the 56-sample run census therefore
  needs a rebuild + reinstall of the tarball first.
- Still unnamed, and still a live failure mode: `revolve`, `sketch`'s face,
  `compound-geom`, `engrave`, `screw`, `svgExtrude`, `text`. Any `edgeRef` /
  `faceRef` applied to one of those products throws the same error it always did.
