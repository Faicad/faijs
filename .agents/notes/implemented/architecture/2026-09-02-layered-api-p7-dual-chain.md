# Agent Note: Layered API port — P7 dual-chain integration (KernelCapabilities merge + first L3→L2 wiring)

Status: implemented

English | [中文](2026-09-02-layered-api-p7-dual-chain.zh.md)

## Problem

P6 retired stdlib and landed the L3 API face in `packages/core/src/api/`, but the plan's P7 (dual-chain integration) was still open on three fronts: (1) the ported `KernelCapabilities` (`exact` / `brepExport` / `exactMeasurement` / `tessellationModel`) existed only inside the vendored tree — faijs's `BrepCapabilities` data model lacked these engine-nature fields, so no adapter could truthfully declare them (D4 remaining work); (2) no L3 op consumed the ported L2 tree — the vendored L2 passed its own suites only through the p3/p5 test harnesses, leaving D11's "missing brep capability → call ported L2" path unwired; (3) the op-graph/replay cut was implicit only (the `kernel/manifold` directory was absent), with no lock-in assertion.

## Decision

1. **Merge `KernelCapabilities` into `BrepCapabilities` (D4).** Four data fields join the existing six routing flags: `exact`, `brepExport`, `exactMeasurement`, `tessellationModel` (new neutral mirror type `BrepTessellationModel` = `'build-time' | 'extract-time' | 'none'`, kept free of vendored imports per D8). The OCCT adapter (`brep/engine/adapters/occt.ts`) declares them truthfully: all true, `tessellationModel: 'extract-time'`. `BrepCapabilityName`/`dispatchPath` are **unchanged** — the new fields describe the engine's nature; they are not per-op routing keys. `disposalModel` is deliberately **not** merged (D5: faijs owns handle release via `cad-runtime` replacement release; the vendored port trimmed it, and the plan does not enforce it).
2. **First L3→L2 bridge op: `cad.fillet`.** BREP-only (`capabilities: ['directEdit']`), implemented by calling the vendored `topology/modifierFns.fillet` (edges `undefined` = all edges, `trackEvolution: false`). Handle integration follows D10: the faijs `BrepHandle` (runtime: occt-wasm u32 arena id) is wrapped into an `OcctWasmHandle` object (`helpers.handle` + the kernel's `getShapeType`) and lent into the vendored tree via `createBorrowedHandle` (non-owning — L2 reads the input, never releases it); the result handle is detached from the vendored GC registry (`unregisterFromCleanup`) and its u32 id is registered into the faijs identity slot (`fromBrep`) — release thereafter belongs to `cad-runtime`. The `Result → throw` flip (D3) is the fixed L3 boundary boilerplate.
3. **Bind the vendored kernel at the same assembly point.** `registerOcctBrepEngine()` now also calls `bindOcctKernel()` (idempotent) so L3 ops consuming ported L2 work in production host assembly, not only in the p3/p5 test harnesses.
4. **P7 acceptance suite.** `packages/tests/faijs/p7-dual-chain/` locks the cuts with static grep assertions: no `kernel/manifold` directory, no `opGraph.ts`/`replay.ts`, no runtime-switching `withKernel`, no three-tier `init()` fallback, `freezeKernels`/`getKernel` retained, and vendored imports outside `api/` rejected. `packages/tests/faijs/fillet/` asserts the wiring end-to-end: brep chain survival, identity-slot registration, volume decrease / face increase, `E_MESH_UNSUPPORTED` on mesh input, and `BrepUnsupportedError` capability routing with the brep-mock engine.

## Alternatives considered

- **L3 calls the kernel adapter directly (brepjs-mirror style) instead of the ported L2.** Rejected: D11's value is consuming ported L2 with its validation/edge-resolution machinery; kernel-direct would reimplement it and duplicate the code the port exists for.
- **Transfer the result by `copyShape` instead of `unregisterFromCleanup`.** Rejected: D10 says ownership *transfers* (cast), not copies — a copy breaks handle identity and adds kernel cost. The vendored tree does expose the escape hatch (`unregisterFromCleanup`), so O15's conservative fallback stays documented but unused.
- **Merge `disposalModel` as well.** Rejected: the vendored port trimmed it, D5 says brepjs arena semantics are not enforced, and faijs already owns release.
- **Add the new fields to `BrepCapabilityName` routing.** Rejected: D4 states the dispatch logic itself is unchanged; the merged fields are descriptive data for hosts/tools.

## Consequences

- `cad.fillet` is now available in `.fai.js` (BREP-only) — the first proof that ported L2 is consumable from L3, and the wiring template generalizes to the remaining missing capabilities (shell/offset/sweep/loft/…).
- Gates green: new suites (fillet 4 passed, p7-dual-chain 6 passed); affected suites (core engine/api 90 passed; d10/p3/p4/p5/refactor-acceptance/chamfer 1047 passed / 2 skipped; core runtime 219 passed; mixed/parity/v53-lib-brep-dispatch/topology-naming/primitives/transforms 66 passed); vendored strict `tsc` + core/tests `tsc --noEmit`; `lint` 0 errors; `check-layer-boundaries` (237 vendored files); `check-ghost-deps` (489 files); `api-surface-snapshot.mjs` (10 subpaths).
- Versions bump by patch: root/core `0.7.4 → 0.7.5`, mech-lib `0.5.11 → 0.5.12`.
- Per the user's instruction, `doc-sync` and the doc terminology cleanup (`docs/api-contract.md` stale `stdlib` references, `ops-api-inventory` regeneration from L3 declarations) are deferred to a single doc pass after development completes.
