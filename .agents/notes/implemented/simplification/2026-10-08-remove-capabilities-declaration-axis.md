# Agent Note: the capabilities declaration axis is deleted; engine identity is the only narrowing axis

Status: implemented

English | [中文](2026-10-08-remove-capabilities-declaration-axis.zh.md)

## Problem

Two static declaration axes narrowed whether an op could run: `engines` (an engine whitelist) and `capabilities` (a `BrepCapabilities` object on the engine side, `defineOp.capabilities` on the op side, intersected before execution by `engineCapabilitySet` / `firstMissingCapability` in `cad-runtime/backend-dispatch.ts`). The capability axis had been introduced without a design pass and never earned its keep:

- Under one name it mixed three unrelated kinds of thing: family-level booleans (`heal` / `directEdit` / `advSurface` / `assembly` / `meshLift`), `*WithHistory` kernel function names (`BrepEvolutionKind`), and plain kernel method names (`BrepMethodKind`). The booleans over-report — a kernel may implement only part of a family — and after the 2026-09-26 work only `directEdit` was ever declared by an op.
- For every op whose engine set already decided the verdict it duplicated `engines`, adding a second gate with the same outcome.
- It encouraged a false mental model: "capability" is not an axis of switching, it is a fixed property of an engine's source code, known at the moment the code is written.
- Four fields (`exact` / `brepExport` / `exactMeasurement` / `tessellationModel`) and four of the booleans had no reader and no declarer at all.

## Decision

Delete the axis outright: `BrepCapabilities`, `BrepTessellationModel`, `BrepMethodKind`, `BrepCapabilityName`, `EngineCapabilitiesLike`, `engineCapabilitySet`, `firstMissingCapability`, `defineOp.capabilities`, the arg-spec `capabilities` field and its generator output, the three adapters' `capabilities` objects, `BrepEngine.capabilities`, `Backends.config.brepCapabilities` and `BrepChainState.capabilities`. `engines` becomes the only narrowing axis, and it is the first check in `decidePath`.

The one question the axis answered that `engines` cannot is "does this engine natively implement this `*WithHistory` kernel function?". Six op bodies ask it to pick a static route (the authoritative face-evolution path, or the plain L1 call). That fact moves down to the engine layer, in `brep/engine/native-history.ts`:

`hasNativeHistory(kind: BrepEvolutionKind): boolean` derives its answer from `getBackends().config.brepEngineId` against a constant table — `occt`: all twelve; `brepkit`: `fuseWithHistory` / `cutWithHistory` / `filletWithHistory`; `brep_mock` and unknown ids: none. It is deliberately not `typeof kernel.X === 'function'`: every adapter exposes stubs across the whole surface, so a present function proves nothing. The table mirrors what the two real adapters declared before the deletion, so every route is unchanged.

## Alternatives considered

1. **Keep `capabilities` on the grounds that existing code depends on it.** Rejected: the dependency count is the argument for removing it, not against. Each consumer either re-encoded a fact `engines` already carried (the gate) or asked the one engine-fact question above.
2. **Express "natively has `*WithHistory`" as `typeof kernel.XWithHistory === 'function'`.** Rejected: `BrepEngineApi` declares the shared `*WithHistory` members as required, and brepkit's adapter supplies them all, including `intersectWithHistory`. A presence test would move brepkit's `intersect` from the plain route (no `roleTable`) onto the history route — an observable behaviour change.
3. **Keep a capability table but narrow it to `*WithHistory` names only.** Rejected: that is one question with one answer per engine, so the table becomes a middle layer whose only readers are the six call sites; keeping the answer in op metadata is precisely the mistake being corrected.
4. **Fold the question into `engines` by giving each op an engine set that reproduces today's capability verdicts.** Rejected as over-engineering: it would encode a kernel-function fact as an engine whitelist, so an engine gaining a `*WithHistory` would silently change which engines an op claims to support.

## Consequences

Script-face behaviour is unchanged: per-op verdicts on `occt` and `brepkit`, product geometry, and whether a product carries a `roleTable` are all identical. Verdict equivalence is no longer an argument but a pinned fact — `packages/core/test/brep/engine/engine-verdict-equivalence.test.ts` freezes the pre-deletion verdict data as literals and asserts set equality per op, so any drift shows up as a diff.

Two deliberate deltas, neither of them on the script face:

- **Error text.** A capability-gate refusal read `E_BREP_UNSUPPORTED: current engine lacks capability 'X' (brepEngineId=…)`; the same situation now travels through the engine gate and reads `E_BREP_UNSUPPORTED: op 'Y' requires engine occt (current=brepkit)`. A host that matched on the old text would be affected.
- **`brep_mock`.** The capability gate did apply to the test stand-in — its declaration was the empty object — so every op that declared a capability used to be statically refused on `brep_mock`. None are now. `packages/core/test/brep/engine/engine-switch.test.ts` pins the restored symmetry between the occt and mock descriptions.

`packages/core/src/api/surface/capability-map.json` and its generator are deliberately untouched: they are a build-time audit of which kernel methods each op calls, and they never took part in dispatch.
