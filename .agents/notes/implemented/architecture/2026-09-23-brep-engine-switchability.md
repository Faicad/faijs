# Agent Note: BREP engine switchability — capability names and assembly-time kernel injection

Status: implemented

English | [中文](2026-09-23-brep-engine-switchability.zh.md)

## Problem

faijs ran a single fixed BREP path: `bindOcctKernel()` hard-wired the vendored
kernel registry to the occt-wasm adapter, so no second BREP engine (brepkit,
memory mock) could back the compat op surface. Switching engines for parity
testing or host customization was impossible without touching vendored code.

## Decision

- **Assembly-time adapter injection replaces the fixed binding.**
  `injectCurrentBrepEngineAsKernel()` (Phase 2, commit `bc13f0f`) takes the
  engine from the BREP engine registry and registers it into the vendored kernel
  registry as a `KernelAdapter`: occt uses `OcctWasmAdapter.fromKernel` (full
  211-method adapter over the same occt-wasm singleton), any other engine uses a
  transparent `wrapBrepEngineApi()` pass-through. `bindOcctKernel()` is
  deprecated (throws); `isKernelInjected()` supersedes `isOcctKernelBound()`.
- **Capability names are three-layered** (Phase 1, commit `92aa0cd`):
  family-level booleans (`heal`/`directEdit`/…), `BrepEvolutionKind`
  (concrete `*WithHistory` names), and `BrepMethodKind` (concrete non-evolution
  method names). An alias like `'mirror'` cannot express both "provides
  `mirrorWithHistory`" and "provides `mirror`", so the two families are named
  separately.
- **Static determination, no runtime fallback.** Whether an op can run on the
  current engine is decided before execution from the capability table
  (capability-map.json, 36 compat ops / 64 unique kernel methods, Phase 0).
  A missing capability degrades statically (auto mode with mesh) or raises
  before execution (`BrepUnsupportedError` / `MeshUnsupportedError`); a
  capability is **never faked** — brepkit declares only the wasm exports its
  kernel adapter actually wires.
- **Capability-map convergence (Phase 3, commits `d022e68` / `5857132`).**
  All 64 kernel methods are registered on `BrepEngineApi`; occt wires the 33
  new registrations (18 native + 15 vendored composite proxies), brepkit wires
  7 real implementations (boundingBox, surfaceCenterOfMass, makeEllipsoid,
  makeTorus, makeVertex, mirror, shell) and keeps the rest `unsupported`
  without declaring them. `engine-switch-p3.test.ts` pins the contract:
  interface coverage (compile-time guard), instance completeness, and
  declaration ⊆ implementation.

## Alternatives considered

- **Runtime fallback (try-catch probing).** Rejected: whether the BREP chain is
  available is knowable statically; a runtime probe would let a declared
  capability die in the kernel after passing static dispatch — the exact
  silent-death red line the design forbids.
- **Aliased capability names (one string per family).** Rejected: `'mirror'`
  cannot distinguish "provides `mirrorWithHistory`" from "provides `mirror`";
  the evolution and method families must be disjoint names (P3).
- **Re-implementing vendored function logic in faijs (replica role mapping,
  Result semantics, keep handling).** Rejected: duplication and loss of the
  naming asset; injection keeps vendored functions byte-identical.
- **Declaring all brepkit wasm exports optimistically.** Rejected: wasm export
  presence ≠ adapter wiring; declaring a stub would pass static dispatch and
  die at runtime. brepkit declares only wired implementations and documents
  semantic mismatches (extrude/section/split are plane-style in wasm) as
  unsupported.

## Consequences

- Engine switch is now an assembly-time, static, host-visible operation; the
  registry is read-only after assembly (no runtime switching, no unregister).
- `capability-map.json` is the single source of truth linking compat ops to
  kernel methods; `ops-api-inventory.md` carries the capability declaration
  column generated from it, and `api-contract.md` §7.9/§7.10/§8.2 document the
  three-layer naming, static determination, and adapter injection.
- Parity testing between occt and brepkit is a first-class workflow
  (`engine-switch-p2/p3.test.ts`); chamfer and other brepkit-missing
  capabilities fail before execution with the engine id and capability name.
- Known gaps remain (recorded in the plan §5.3): family-level boolean residue
  (heal/directEdit/advSurface/assembly/meshLift) and `disposalModel` not yet
  merged into capabilities.
