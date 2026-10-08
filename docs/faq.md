# faijs FAQ

English | [中文](faq.zh.md)

> Frequently asked questions about the faijs API surface. Each answer is self-contained; for the authoritative contract see [api-contract.md](api-contract.md) and [library-dev-guide.md](library-dev-guide.md).

## Q1: What does `compatOp` mean?

One sentence: **`compatOp` wraps a library function that has only a BREP implementation — it takes kernel handles and returns `Result` — into a faijs statement op.** It is not a second implementation path parallel to `defineOp`, but a thin adapter layer built on top of it (implementation: `packages/core/src/api/internal/compat-op.ts`).

Background — the three op classes (see `AGENTS.md`):

| Class | Form | Paths | Examples |
|---|---|---|---|
| dual-op | `defineOp({ mesh, brep })` | mesh + brep | `box`, `union`, `knurl` |
| **compat op** | `compatOp(fn, spec)` | **BREP only** (mesh mode throws `E_MESH_UNSUPPORTED`) | `fuse`, `cut`, `extrude` |
| pure projection | plain re-export, not an op | — | `Sketcher`, `ok`/`err`, `getFaces` |

Why it exists: the op system needs an entry point for operations that only make sense on the BREP chain — they cannot provide a mesh implementation, so `defineOp({ mesh, brep })` does not fit. `compatOp` is that single entry point.

Engine kernels: the mechanism itself is kernel-neutral. The adapter calls through `getBrepApi()` — the engine-neutral `BrepEngineApi` L1 contract — and registered engines are `occt` (the default), `brepkit`, and `brep_mock` (`BREP_ENGINE_IDS` in `brep/engine/types.ts`). Whether an op is restricted to one kernel is declared via `spec.engines` (a "platform op"); ops with no `engines` declaration run on any engine. The core compat ops currently declare `engines: ["occt"]` because their implementations call occt-only kernel methods — that is a fact of today's implementations, not a limit of `compatOp`. Dispatching such an op under another engine fails statically with `E_BREP_UNSUPPORTED` (no runtime fallback).

It does only two things (everything else is owned by `defineOp`):

1. **Spec pass-through**: `CompatSpec` directly extends `DualOpOptions` (minus the `mesh`/`brep` fields); `capabilities`/`engines`/`outputs`/`slotMap`/`schema`/`naming` auto-sync — single source of truth, no self-invented fields.
2. **Adapter construction** (the two bridging steps `defineOp` cannot share):
   - **Call + unwrap**: the library function is called and the result goes through the shared `unwrapResult` — `err` becomes an `OpError` carrying the op name and `BrepError` code; async library functions are supported (awaited before unwrap).
   - **adoptOut (adoption)**: top-level kernel handles in the product (or fields named by `outputs`) are adopted into faijs `Shape` via `adoptEntity` (finalizer unregistered + `fromHandle`), passing through the caller's `segments` tessellation density.

After that, `defineOp` owns the rest: dispatch, `DUAL_OP_META` mounting, `assertLibConforms` validation. A compatOp product is therefore structurally identical to a `defineOp` product.

Practical consequences for script developers: `cad.fuse(...)`, `cad.cut(...)`, `cad.extrude(...)` are compatOp-wrapped brep-only ops; they have no mesh implementation and report `E_MESH_UNSUPPORTED` when the BREP chain is unavailable (static dispatch, no runtime fallback). Library developers writing a third-party op use `defineOp` when they have both implementations and `compatOp` when only a BREP implementation exists. Functions registered via `registerLib` are lifted through `compatOp` automatically (`admitCompatLib`), so a bare library function cannot bypass the statement-level boundary contract.

## Q2: What is the difference between a pure projection and an op?

In one sentence: **an op is an operation the execution engine dispatches and executes; a pure projection is just a re-export/wrapper at the TS layer — it is not an op and never enters the execution chain.**

| | op (dual-op / compat op) | pure projection |
|---|---|---|
| Essence | an operation object produced by `defineOp`/`compatOp`, carries `DUAL_OP_META` | a re-exported plain function/class, no op metadata |
| Execution | executed by the faijs VM, statement-level dispatch | a plain synchronous function call |
| Path dispatch | routed by `backend-dispatch.ts` static rules to mesh/brep | no dispatch concept |
| Result boundary | auto-unwrapped at statement boundary (`err` → `failedAt`) | no statement boundary; Result returned as-is to the caller |
| Symbol table | listed in `symbol-table.generated.ts` as a legal `cad.<name>` op | not in the op symbol table; scripts (`.fai.js`) generally cannot see it |
| Examples | `box`, `union`, `fuse`, `extrude`, `knurl` | `Sketcher`/`Blueprint`/`draw` DSL, `ok`/`err`/`isErr`, `getFaces`/`getEdges` |

Why the distinction matters: the `cad` namespace contains things that are not geometric operations — queries, combinators, DSL constructors. Their common traits:

1. **No engine-computed geometric product** — e.g. `getFaces(shape)` only lists sub-shapes of an existing shape; `ok`/`err` are Result utilities unrelated to geometry.
2. **No mesh/brep dual implementation** — there is no "run the same operation on two paths" question, so the `defineOp`/`compatOp` dispatch machinery does not apply.
3. **Aimed at TS library developers, not `.fai.js` scripts** — pure projections belong to the TS compatibility surface: imported directly from `@faicad/faijs/*` subpaths, executed on call, without statement-level unwrap.

Rule of thumb: something the engine must compute at statement-execution time, with possibly two implementations (mesh/brep), is an op (`defineOp` or `compatOp`); something that merely exposes existing capability under another name (re-export, query, utility, DSL) is a pure projection — just re-export it, never wrap it in an op.
