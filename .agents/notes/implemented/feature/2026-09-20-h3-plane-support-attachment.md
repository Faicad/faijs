# Agent Note: H3 plane-support attachment resolution

Status: implemented

## Problem

Sketches attached to datum/origin planes (`MapMode`/`Support`/
`AttachmentOffset`, FreeCAD's AttachExtension) had zero support in the
converter: `convert.ts` read only the stored `Placement` property. FreeCAD
recomputes that placement from the attachment chain on save, so for files
where the support frame is rotated the converter would silently use the raw
stored value — correct only by accident, wrong whenever the chain semantics
diverge from a plain copy.

## Decision

- New `fcstd/attachment.ts` exports `resolveAttachment(obj, placements)` and
  `effectivePlacement(obj, placements)`. Resolution composes
  **support placement ∘ AttachmentOffset** (Hamilton quaternion product) and
  falls back to the stored `Placement` when the attachment is deactivated,
  has no support link, or the support target has no placement.
- **Plane supports only.** Corpus probe (`fcstd-port/tools/
  probe-attachment-usage.mjs`): 29/56 corpus files carry a non-deactivated
  MapMode — values in use: 5=mmFlatFace (68 objects), 6=mmTangentPlane (3),
  1=mmTranslate (1) — and every Support target is a datum/origin plane, where
  the support's frame IS the base frame. Curve/Frenet/face-projection modes
  return undefined (no guessed frames); implement per Attacher.cpp only when
  the corpus demands it.
- `convert.ts` builds its placements map via `effectivePlacement`, so
  attached sketches land on their support frame.
- **Contract test**: the composed result must equal the Placement FreeCAD
  stored in the same file (it recomputes the chain on save — the stored value
  is ground truth). Locked in `attachment.test.ts` (5 cases).

## Alternatives considered

- **Implement the full Attacher.cpp mode set now** — rejected: corpus
  evidence shows only plane supports; curve/face frames are a large surface
  (normal projection, Frenet frames, path parameters) with zero coverage in
  the 56 samples. Undefined-on-unresolvable keeps the C4 gap contract honest.
- **Keep reading the stored Placement and never resolve** — rejected: correct
  only while support frames are axis-aligned; a rotated datum plane would
  silently misplace geometry, exactly the failure class H3 exists to close.

## Consequences

- GOTCHAs locked by tests: `MapMode` is an `App::PropertyEnumeration` stored
  as `<Integer value="N"/>` (a string-name regex finds nothing — first probe
  version matched zero files); the support link property is `Support` (old) or
  `AttachmentSupport` (newer FreeCAD), both are read.
- 56-sample sweep after wiring: ok stays 22. The stored Placement already
  reflected the composed chain in this corpus (identity/translated supports),
  so this is correctness hardening, not a coverage change. The 13
  `sketch-not-solved` first-cause files are NOT attachment-related.
- faijs: `attachment.test.ts` green; fcstd suite 12 files / 117 cases green.
  Probe script lives in fcstd-port (`tools/probe-attachment-usage.mjs`).
