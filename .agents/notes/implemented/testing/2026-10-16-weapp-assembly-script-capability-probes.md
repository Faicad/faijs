# Agent Note: Weapp assembly-script capability probes

Status: implemented

English | [中文](2026-10-16-weapp-assembly-script-capability-probes.zh.md)

## Problem

A downstream consumer (the weapp assembly/animation workbench in `3d_editor`) rests on three faijs capabilities. All three had been **read from the source, none had been verified by a test**:

1. **Multi-file projects under the `interpreter` backend.** weapp workers are eval-free and therefore pinned to `execBackend: 'interpreter'`. Multi-file loading lives in `DirectExecutor` (`executeDirectText` → `loadDirectModuleImports`), which is backend-agnostic on paper — but the existing coverage was split: `packages/tests/faijs/no-ir/multifile/multifile.test.ts` exercises multi-file on the **default backend only**, while `exec-backend-diff.test.ts` exercises vm × interpreter on **single-module scripts only**. The intersection was untested, and the downstream design listed it as its top risk.
2. **Host-injected namespaces usable without an `import` line.** `registerLib(binding, ns)` was expected to make `anim.foo(...)` resolve without `import * as anim from '...'`, but every existing test still wrote the import line.
3. **`cad.assembly({ members })` consuming its members.** The downstream design used this as one of three reasons why the assembly section and the motion section must live in one script ("split the script and the animation script can no longer import the member geometry").

## Decision

Pin all three as permanent tests, and correct the downstream claim where measurement disagreed.

- `packages/core/test/cad-runtime/exec-backend-multifile.test.ts` (8 cases) — multi-file × backend: named import, namespace import, consumed shape not exported, missing module, vm × interpreter per-item parity, and `entryKey` deciding the relative-import base.
- `packages/core/test/cad-runtime/lib-namespace-implicit.test.ts` (4 cases) — implicit namespace binding on the interpreter backend, explicit import still working, unregistered names rejected, and the same implicit form on vm.
- `packages/tests/faijs/no-ir/multifile/multifile.test.ts` A-11 (4 cases) — the effect of `cad.assembly({ members })` on the export surface, in both directions, with a `translate` control case.

## Key findings

- **Multi-file loading behaves identically on the `interpreter` backend** — import resolution, export surface, and failure messages all match vm, `entryKey` included. The downstream design's largest risk is cleared.
- **Implicit namespace binding works**, and so does the explicit import (two entry points into one mechanism, not a compat shim). An **unregistered** name is rejected at **parse time** with `ParseError: [security] SEC_FREE_IDENT ... unknown identifier "foo"` — earlier and louder than an execution-time `failedAt`.
- **`cad.assembly({ members })` does _not_ consume its members.** Shapes declared in the module and import bindings alike remain importable by downstream modules after being referenced by `cad.assembly`. This matches the pre-existing note in `live-shapes.test.ts` ("compound members assembly is not consumption") — `cad.assembly` takes the compound path. The downstream design's third justification for merging the assembly and motion sections was therefore **an invalid analogy** (it borrowed `translate`'s consumption semantics) and has been removed; the two remaining justifications (member-set closure for `validateJointRefs`, and `ExecutionResult.assemblies` being collected from the main module ctx only) still hold.
- Control case: `translate`'s consumption **does** remove a shape from the export surface. The consumption rule itself is intact — it simply does not apply to `cad.assembly`.

## Alternatives considered

- **Reusing `multifile.test.ts` for the interpreter matrix**: rejected — that file runs on the default backend by construction, and retrofitting a backend axis would blur two different invariants into one file. The new file states the intersection explicitly.
- **Probing through a host-level (weapp / platform) harness instead of faijs**: rejected — the questions are about faijs' own contract (module loading, namespace resolution, live-shape export surface). A host-level test would re-implement the harness and would pin host behavior instead of engine behavior.
- **Treating `cad.assembly` member references as consumption because the args carry top-level var-refs**: rejected after measurement — the compound path classifies assembly references as assembly, not consumption. Keeping the wrong claim would have encoded a false constraint into a downstream design.

## Consequences

- Three new/extended test files run in the existing suites (`test -w @faicad/faijs`, `test -w @faicad/faijs-tests`); no production source was modified, no dependencies changed.
- A downstream design document was corrected: justification #3 removed, its fact table and risk table updated to the measured semantics.
- Future readers asking "does multi-file survive the interpreter backend" or "can a host-injected namespace skip the import" now have executable answers instead of source-reading conclusions.
