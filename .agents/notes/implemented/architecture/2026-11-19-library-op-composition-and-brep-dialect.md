# Agent Note: Library-authored ops compose faijs ops; BREP dialect is normalized at the adapter

Status: implemented

English | [中文](2026-11-19-library-op-composition-and-brep-dialect.zh.md)

## Problem

A downstream library (faijs-sand3d) reported 13 API issues after M1/M2. Re-checking 0.47.1 against the source split them into:

- four already resolved by the current surface (`Shape` mesh fields, `BrepHolder`, typed `BrepEngineApi`, `makeFace`);
- five documentation gaps (nested `defineOp`, boolean compounds, `fromBrep`, naming propagation, compound terminals);
- two real defects: `shapeType` returned un-normalized dialect (occt lower-case, brepkit/smlib/mock upper-case) while `api/boolean.ts` and `boolean-closure.ts` compared lower-case literals; and `cad.revolve` typed only `{ axis }` although it accepts `at` / `angle`.

The downstream library also re-implemented `cad.extrude` / `cad.subtract` / `cad.loft` through the kernel because it believed nested `defineOp` was unsupported. A reproduction (`packages/core/test/cad-runtime/nested-op-repro.test.ts`) showed nesting works: nested calls share the statement anchor and deliberately skip lineage registration.

## Decision

1. `shapeType` returns the lower-case `ShapeType` union; every adapter normalizes in its boundary. Downstream code compares lower-case literals and does not call `toUpperCase()`.
2. `isCompoundHandle(kernel, handle)` and `getSolids(kernel, handle)` are exported from `@faicad/faijs/sdk`; a multi-solid compound is reported, not rejected.
3. `cad.revolve` exports `RevolveOptions { axis?, at?, angle? }` (angle in radians).
4. The library guide states the composition contract: nested ops are allowed, nested products do not register lineage, handles live in the enclosing function-BREP domain, and every geometry input must carry a PartName. Prefer the op over kernel re-implementation; use `getBrepApi()` only where no op exists, for arbitrary matrices, or for post-boolean naming propagation.

## Alternatives considered

**Keep `shapeType` as `string` and let every caller normalize.** Rejected: the engine mismatch already produced wrong boolean-operand classification on brepkit/smlib, and every library author would repeat the same defensive work.

**Add a `withStmt()` wrapper for nested ops.** Rejected: the reproduction shows no statement-context corruption; the real constraints are lineage naming and handle lifetime, both documentable.

**Add `cad.pose` or rewrite the downstream export architecture.** Rejected: posture at modelling time is a library concern, and the model terminal is a plain synchronous Shape.

## Consequences

- Downstream libraries can delete `toUpperCase()` and duck-typing workarounds.
- Tests that mocked `shapeType` with upper-case literals were normalized.
- Sweep/loft option gaps (`scale` / `twist` / `follow` / `loop`) remain open; they are capability work, not API clarity.