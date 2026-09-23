# Agent Note: vendored measurement surface engine convergence (glue synthesis + measure mapping + injection reset)

Status: implemented

English | [中文](2026-09-24-vendored-measurement-surface-engine-convergence.zh.md)

## Problem

`injectCurrentBrepEngineAsKernel()` (assembly-time adapter injection, §7.10) had three faijs-side defects that made the vendored brepjs measurement surface occt-only and a re-injection dangerous:

1. **Missing glue methods** — `wrapBrepEngineApi` passed the engine's `BrepEngineApi` through without `createVector3d / createPoint3d / createDirection3d / createAxis1 / createAxis2 / createAxis3`, so `assertGlueMethodsComplete` rejected any non-occt engine at assembly time.
2. **Injection cache without a reset** — a module-level `_injected` flag short-circuited re-injection. After occt injected once, switching to brepkit and calling inject again silently returned the **stale occt adapter**, which dereferences brepkit's numeric handles as occt-wasm pointers → OOM/crash. Reproduced with a probe during debugging of `measurement-parity.test.ts`.
3. **Measure method name/shape mismatch** — the vendored measure face calls `kernel.volume / area / length / centerOfMass / linearCenterOfMass` (its own naming, `measureFns.ts`); the bare pass-through exposed none of those names, so injection would have failed at execution time with `TypeError` even if the glue check had passed.

## Decision

All fixes live in faijs's own bridge (`api/occt-kernel-bridge.ts`); vendored brepjs gets exactly one test-only export and zero logic changes.

- **Glue methods are synthesized at the wrapper layer, not added to `BrepEngineApi`.** The six constructors are pure JS data literals in the vendored surface (zero kernel calls — verified in `constructionOps.ts`), i.e. a *calling convention*, not a kernel capability. Extending the engine contract would force every adapter to implement meaningless boilerplate. Field shapes copy the vendored occt adapter verbatim (`__type` + mandatory `delete: noop`; axis1 uses `origin+direction`, axis2/3 use `origin+zDir+xDir?` with 6- or 9-arg forms).
- **Measure mapping at the wrapper layer.** `volume→getVolume`, `centerOfMass→getCenterOfMass` (vec object → tuple), `boundingBox→getBoundingBox(_, true)` (xmin..zmax → min/max tuples); vendored `KernelShape` is unwrapped (`number` or `.id`) before calling. `shapeType`/`isNull` are same-name pass-through.
- **Gaps are registered, never stubbed.** `UNMAPPED_VENDORED_MEASURE_METHODS = ['area', 'length', 'linearCenterOfMass']` — `BrepEngineApi` has no `getSurfaceArea`/`getLength`/`getLinearCenterOfMass`, so these stay `undefined` on the adapter and tests pin that. A fake `0` would be a silent wrong value, harder to trace than a crash.
- **Reset hooks, test-only.** `__resetKernelInjectionForTests()` clears the bridge cache; `__resetKernelRegistryForTests()` in the vendored registry clears kernels and unfreezes. The registry reset had to be a vendored export because `_frozen` is a module-level variable — writing `globalThis.__FAICAD_FAIJS_KERNEL_REGISTRY__.frozen = false` does not touch it, and rebuilding the globalThis state from the faijs side would hard-code the vendored private structure (`stateVersion` checked), silently breaking on vendored upgrades. The injection short-circuit now shares the `isKernelInjected()` criterion so a registry-visible injection is never re-run against a frozen registry.
- **Registration id unchanged.** `'occt-wasm'` is a registry slot name (host-side criterion + D10 globalThis singleton compat), not an engine identity; the vendored face always reads the parameterless `getKernel()`.

## Alternatives considered

- **Adding glue methods to `BrepEngineApi`** — pollutes the engine contract with zero-geometry boilerplate every adapter must copy.
- **Resetting only `globalThis` state from faijs** — requires hard-coding vendored private structures; breaks silently on vendored upgrade.
- **Renaming the registration id to the actual engine id** — no functional gain (vendored face never fetches by id); touches host criteria and D10 compat.
- **Stubbing `area`/`length` with 0** — silent wrong value, violates the no-fake-capability red line.

## Residual gap (registered, not fixed here)

brepkit's v1 adapter throws by whitelist for `shapeType` / `isNull` (`brepkitKernel.ts:577-578`), and the brepkit wasm layer has **no** type/validity query at all (probed: `toBrepJson` serializes a compound as `type:"solid"`; `getEntityCounts`/`getCompoundSolids` cannot distinguish them; invalid handles only surface as thrown errors). Since `measureVolumeProps` unconditionally calls `kernel.isNull` + `kernel.shapeType`, the vendored measure face is still brepkit-blocked at execution time — an **engine-adapter capability gap** (same nature as the missing `getSurfaceArea`), pinned by a GOTCHA test, not a wrapping bug.

## Consequences

- Any non-occt engine's `BrepEngineApi` now passes the assembly-time glue check; injection is engine-neutral and re-injection after a test reset follows the current engine (regression-pinned).
- Vendored measure capabilities backed by real `BrepEngineApi` methods (volume / centerOfMass / boundingBox / shapeType / isNull) work through the vendored face for engines that implement them; `area` / `length` / `linearCenterOfMass` remain explicit, test-pinned gaps until the engine contract is extended.
- The vendored tree carries one test-only export (`__resetKernelRegistryForTests`) and zero logic changes; the occt path is untouched.

## Verification

`measurement-parity.test.ts` (10 cases, dual-engine), `engine-switch-p2/p3/test`, `registry.test.ts`, `compat-op.test.ts` all green. Occt-path behavior unchanged (occt branch untouched).
