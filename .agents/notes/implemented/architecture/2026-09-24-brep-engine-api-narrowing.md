# Agent Note: BrepEngineApi narrowing and platform-native access

Status: implemented

English | [中文](2026-09-24-brep-engine-api-narrowing.zh.md)

## Problem

`BrepEngineApi` was a wide interface: it carried 119 methods that faijs "needed", not methods every registered BREP engine genuinely implements. brepkit-wasm implements only a subset, so the occt and brepkit adapters diverged in honesty — occt filled everything, brepkit filled gaps with `unsupported()` stubs, and capability declarations drifted from runtime configuration. The vendored measurement face (`measureSurfaceProps` / `measureLinearProps`) bypassed capability routing entirely, binding to occt-wasm through the borrow layer. And the script face had no measurement entry at all: scripts could not measure area or length, a real capability gap.

The interface had to mean one thing — the set of methods both adapters genuinely implement — and the platform layers below it had to be reachable by a typed, honest exit.

## Decision

**`BrepEngineApi` narrows to the L1 neutral contract face.** Its semantics change from "everything faijs needs" to "everything every registered BREP engine genuinely implements", narrowed to 99 L1 methods (`aligned` + `dialect`); a method may enter the interface only when occt, brepkit and mock all have a real (mock: approximate) implementation. Three compile-time assertions — `_AssertOcctApi` / `_AssertBrepkitApi` / `_AssertBrepMockApi` — now all carry force. Platform methods (135 normalized occt-only, e.g. `section`, `split`, `mirrorWithHistory`) leave the interface and are reached via the platform-native exit. The mapping table `engine-method-map.json` is the single source of truth (D10): every interface method is `aligned`/`dialect` there, and every such entry appears in the interface (no orphans).

**Three access exits, each typed honestly.** ① `getBrepApi(): BrepEngineApi` — the neutral, typed exit for portable code and third-party libraries (the only permitted L1 entry). ② `getOcctKernel()` / `getBrepkitKernel()` — platform-native exits returning the raw kernel instance, verbatim types, zero normalization; only adapter files and `@platform`-annotated op implementation files may import platform modules. `getKernel(): unknown` stays but is deprecated with corrected JSDoc (D12).

**`engines` declares platform identity (D11).** An op whose implementation statically imports `occt-kernel/*` or `brepkit-kernel/*` is a platform op and must declare `engines: ['occt']` / `['brepkit']` in `defineOp`. The check runs first in `dispatchPath` (D11-2, before mode and capabilities): brep mode throws `BrepUnsupportedError` before touching the kernel; auto mode statically degrades to mesh; `mode='mesh'` and `brep_mock` are exempt (D11-6 / D11-3). `engines` and `capabilities` are mutually exclusive (D11-7). The script face may expose platform ops under the same declaration — unsupported engines fail at the statement boundary (`failedAt`, Q11).

**The vendored measurement face is closed off as occt-only.** The 12 measurement query ops declare `engines: ['occt']`; the generator emits an engine guard as the first body line; a capability honesty test (declared → must be a function) covers the whole `methods` list.

**The script face gains neutral measurement ops (Phase 7).** `cad.area(shape)` / `cad.length(shape)` are hand-written ops in `api/measurement/index.ts` calling L1 `getSurfaceArea` / `getLength` via `getBrepApi()` — no borrow layer, no engine binding, platform-neutral by construction, registered through the arg-spec `scriptFace: true` / kind `faijs` channel so the symbol table and manifest stay in sync (three-source consistency). The engine-direct measurement parity test asserts the same numeric results through both adapters.

**A CI guard seals platform isolation.** `scripts/check-platform-imports.mjs` (parallel to `check-ghost-deps.mjs`, wired into `scripts/ci.ps1`) enforces: neutral modules (no `@platform` annotation, no adapter/entry/test exemption) must not statically import `occt-kernel/*` or `brepkit-kernel/*`; an `@platform`-annotated file containing `defineOp` must declare the matching `engines`. Previously-unannotated platform-bound files (`occt-kernel-bridge.ts`, `brep-topology.ts`, `brep-primitives.ts`) were annotated `@platform occt` to make their platform nature explicit.

## Alternatives considered

**Keep the wide interface and stub the gaps (`UnsupportedKernelOperationError`).** Rejected: runtime probing + runtime fallback violates the repo red line (BREP paths are decided by static rules before execution, never by try-catch), and a stub-filled interface gave every consumer a false sense of portability.

**Platform methods as optional interface slots.** Rejected: an optional slot still lives on the interface, still looks callable from portable code, and still has to be defined by every adapter — the narrowing would be cosmetic.

**Reach platform methods through `getKernel(): unknown` with a cast.** Rejected: it forces every caller to assert the type by hand; the typed `getOcctKernel()` / `getBrepkitKernel()` exits make the platform boundary explicit and greppable.

**Declare platform identity by capability-name prefix.** Rejected (user ruling): after narrowing, `capabilities: ['section']` would name a method that no longer exists on the interface; `engines` states the physical fact (the op imported the platform module) and is checkable at assembly time.

**Leave the measurement gap and let vendored ops cover it.** Rejected: the vendored face is occt-bound and bypasses capability routing; the L1-direct hand-written ops are the only platform-neutral measurement entry, verified equal to the engine values on both adapters.

## Consequences

- `BrepEngineApi` narrowed from 119 to 99 L1 methods; `brep-mock.ts` was aligned to the L1 core face (33+ platform methods removed, 13 missing L1 methods added); `liftCurve2dToPlane` became occt-only and the checkpoint marker kernel-only.
- Platform call sites (face-evolution, step export, thread loft, mirror replication, section) route through `getOcctKernel()`; 29 platform ops plus the generated vendored ops (fuse, extrude, revolve, …) declare `engines: ['occt']`.
- `cad.area` / `cad.length` are new script-face ops — occt gives 700 mm² / 280 mm (edge-face count) on a 20×10×5 box; brepkit length semantics on solid input (first-edge via `getEdgeCurveType`→`edgeLength`) are recorded as an adapter-level semantic gap, not normalized in this change.
- 150 core test files pass (2094 tests, 10 skipped); the new guards and parity tests add 30+ cases.
- Breaking change (Q12): this lands with the next **major** release, no compatibility aliases — a one-time switch.
- External packages (`cq-compat` / `fai_cq_gears` / `fai_cq_warehouse`) show typecheck errors against the narrowed surface and are fixed in the same change set. `cq-compat-compare` is an occt platform tool and now consumes `OcctKernel` / `ShapeHandle` directly (it never pretended to be a `BrepEngineApi` consumer after narrowing). `GearKernel` / `WarehouseKernel` switch from `extends BrepEngineApi` to a type intersection `Omit<BrepEngineApi, 'interpolatePoints' | 'getNurbsCurveData'> & { …platform members }` — they keep every L1 method while overriding `interpolatePoints` with the occt-native periodic semantics (L1 `interpolatePoints(points, degree)` is the brepkit dialect, so the intersection omits it before overriding; `getNurbsCurveData` likewise for the widened return shape). `exportStepFromSolids` call sites in warehouse tests pass the platform kernel with an explicit cross-face assertion — runtime is raw occt-wasm and entry solids never touch the L1-only mesh-reconstruction path.
