# Agent Note: ModuleRegistry lands — multi-file project imports on the no-IR direct channel (P5)

Status: implemented

English | [中文](2026-09-06-module-registry-multifile-p5.zh.md)

## Problem

The guarded no-IR execution channel (P1–P4) executed a single `.fai.js` scene; top-level `import` lines were skipped and nothing materialized relative module imports (`import { bp } from './x.fai.js'`). P5's multi-file engine surface (plan §4.5, A-8/A-9/A-10) needs: per-dependency execution on its own ctx, an export surface (values/fns/liveShapes), binding validation against the producing module's live shapes, cycle detection, and D6 (cross-file references must not consume the referenced shape's display eligibility).

## Decision

P5 engine-side multi-file landed with the runtime default still `'module'` (guarded):

1. **`HostPorts.projectLoader?: ProjectLoader`** (`listModules` / `readSource` / `fingerprint?`) — the multi-file channel is off when absent, so single-file behavior is unchanged.
2. **`cad-runtime/module-registry.ts`**: `ModuleRegistry` resolves a module's relative imports DFS (each dependency executed by an injected `ModuleRunner` with its own ctx and the runtime's registered namespaces), detects cycles (`MODULE_CYCLE`, message carries the path), and builds each module's `FaiModuleExports`: `values` (non-function ctx keys) + `fns` (ctx functions) + `liveShapes` (computeLiveShapes over the module's own lines/keep — so in-module consumption hides a shape from B, A-9). Named bindings must be in `liveShapes ∪ fns`, else `BINDING_NOT_EXPORTED` (missing module → `MODULE_NOT_FOUND`; dependency execution failure → `MODULE_EXEC_FAILED`); all map to `ExecutionResult.failedAt` with the import line number.
3. **`DirectExecutor` module-scope parsing**: source is first parsed as an ESM module so top-level imports are legal and skipped; flat code falls back to the old wrapped parse for legacy top-level `return`/`await` text. Imported bindings are preseeded into the shared ctx via a new `DirectExecOpts.imports`; member-expression emission prefers `__ctx` when the object name is a ctx key (imported shape receivers and module namespaces), falling back to `__ns` for registered libraries. Argument-text hoisting also rewrites ctx keys, so `cfg.OUTX` (module namespace member) resolves.
4. **MetadataExtractor**: expression walking stops at namespace-binding roots (`cfg.OUTX` keeps `cfg` out of the refs), matching the plan's HostArg reference model.
5. **CadRuntime direct path**: `execute`/`append` resolve relative imports through a per-call `ModuleRegistry` (loading errors short-circuit to `failedAt`) and pass the seed map into `DirectExecutor`.

## Verification

`packages/tests/faijs/no-ir/multifile/multifile.test.ts` (8 cases, mesh, in-memory ProjectLoader): named import + union geometry; missing export / missing module / cycle → failedAt with import line and message; namespace import (`cfg.OUTX`); imported function calls; A-9 (module-consumed shape is not importable, live shape is); A-10 (imported shape stays a direct terminal in B). Core `module-registry.test.ts` (10 cases) covers the pure registry (binding gate, namespace seed, per-call cache, cycle, errors, path normalization). A-5 (parameter reference fidelity through `update`) is covered in the runtime-face parity suite. Core 85 files / 1240, tests 74 files / ~1535, no-ir 205, typecheck, lint, export-jsdoc all green.

## Alternatives considered

- **Share one ctx between modules and the main file**: rejected — per-module ctx is what gives clean exports and D6 semantics; seeding only the *bound* names into the importer mirrors ES-module import binding semantics.
- **Validate bindings only at runtime when used**: rejected — the gate must be static at load time so a missing export fails with the import line before any scene execution.
- **Host-keyed module resolution in the engine**: rejected — the engine only normalizes relative specifiers (`./..` segment resolution against the base module's key) and matches `listModules()` exactly; hosts own the moduleKey strings.

## Consequences

- Multi-file no-IR scenes (mesh) work end-to-end in guarded direct mode: dependencies are executed independently, exports gated by live shapes, cycles and missing modules report through the normal `failedAt` channel.
- Open gaps for the remaining P5/P6 work: fingerprint-based module caching across execute/append calls (v1 reloads dependencies every call), `// @export` narrowing, 3d_editor host wiring of `projectLoader`, param-editing UI surface, and the full P4 default flip (BREP/topology/naming/changed/activeValues convergence). Default remains `'module'`; module-path consumers are untouched.
