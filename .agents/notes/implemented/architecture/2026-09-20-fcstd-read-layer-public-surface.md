# Agent Note: FCStd read layer goes public; corpus profiling leaves faijs

Status: implemented

English | [中文](2026-09-20-fcstd-read-layer-public-surface.zh.md)

## Problem

Faicad's rule is that faijs carries *generic* FCStd → `.fai.zip` capability and nothing else: library-corpus analysis belongs to the porting project `D:/Faicad/fcstd-port`. By 2026-09-20 that rule had been violated twice over.

- `packages/core/scripts/profile-fcstd-library.ts` (commit 50a30e6) and `packages/core/scripts/scan-fcstd-library.ts` (added the next day by an agent that had not looked at fcstd-port) were two implementations of the same full-library profile, plus a 785 KB `fcstd-library-profile.json` artefact.
- They disagreed on real numbers. The first reported **XLink = 0**; the second reported **145 refs in 11 files**. A raw XML check settled it: the library has **1,159 `<XLink>` elements across 15 files, every one with an empty `file` attribute** — i.e. both counts were wrong, and the plan's H9 item ("cross-document references must be implemented") rested on the wrong one.
- Meanwhile fcstd-port had no way to read FCStd at all: `tsconfig.build.json` excluded `src/fcstd`, and `package.json` exported no FCStd subpath, so the only way to profile the library was to import faijs sources across repository boundaries — which is what produced the duplicate in the first place.

## Decision

Delete the library-analysis code from faijs and make the read layer a first-class public API so consumers never need to reach into faijs internals again.

- Removed `profile-fcstd-library.ts`, `scan-fcstd-library.ts`, `probe-one.mjs` (hard-coded FreeCAD-library path) and the two profile artefacts.
- Added `packages/core/src/fcstd/index.ts` and the `@faicad/faijs/fcstd` subpath, exporting the read half only: `unpackFcstd`, `memberText`, `parseDocumentXml`, `parseSketchObject`, `parseGeometryList`, `parseConstraintList`, `parseExpressionEngine`, `CONSTRAINT_NAMES` and their types.
- Dropped `"src/fcstd"` from the `tsconfig.build.json` exclude list. A read-only probe (`tsc -p` with fcstd re-included, `--noEmit`) showed **0 errors** — the exclusion was WIP release scope, not a type problem.
- Regenerated `scripts/api-surface-snapshot.json` (now 11 subpaths, `./fcstd` → `memberText`, `parseDocumentXml`, `unpackFcstd`).
- fcstd-port owns the one remaining profiler, `lib/profile.mjs`, which consumes `@faicad/faijs/fcstd` from an installed tgz and writes `reports/library-profile.{json,md}`.

## Alternatives considered

- **A standalone profiler inside fcstd-port (own ZIP + regex scan).** Rejected: it would re-implement the `<ObjectData>` / `<Objects>` name→type split and the wrapper-element layout that `document.ts` already encodes, and two XML readers is exactly how the XLink discrepancy happened.
- **Keep the profiling script in faijs and have fcstd-port import it by relative path.** Rejected: cross-repository source import, and the publish plan requires consumers to go through a tgz.
- **Delete the duplicate without replacement until the conversion entry is published.** Rejected: the library profile is the input to every scheduling decision in the plan; losing the ability to regenerate it would strand §3/§10.

## Consequences

- The profile numbers changed on purpose and the plan was updated: expressions are now counted as **bindings** (17,166, of which 16,277 non-constant = 94.8%) instead of objects carrying an engine (the old 38,015 / 43% figure counted empty engines); XLink is 1,159 refs / 15 files / **0 cross-document**, so H9 is downgraded to non-blocking while `App::Link*` (149 objects, in-document link semantics) moves into the P2 ordering.
- Consumers can profile or inspect FCStd with no solver installed: the read layer depends only on `fflate` and `@xmldom/xmldom`.
- The **conversion** entry was not exportable at the time: `convert.ts` pulls `@salusoft89/planegcs` (then a devDependency) and `external-geo.ts` pulls the occt kernel. **Resolved 2026-09-20** — `planegcs` is now a `dependency` and both `./fcstd-convert` and the `faijs-fcstd-convert` bin ship; see Agent Note `2026-09-20-script-ownership-and-fcstd-convert-surface`.
- `@faicad/faijs/fcstd` is a new public subpath: any future change to the read layer is an API change, and the snapshot file must be regenerated after a dist build.
