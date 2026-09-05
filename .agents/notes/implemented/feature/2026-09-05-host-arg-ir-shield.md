# Agent Note: HostArg -- IR shield for host-facing positional arguments

Status: implemented

English | [中文](2026-09-05-host-arg-ir-shield.zh.md)

## Problem

faijs 0.8.0 introduced five positional argument IR shapes (`ParamRefIR`, `VarRefIR`, `CallRefIR`, `ExprIR`, literals), but the host-facing API (`codeToArgs`, `formatCodeLine`, `StatementSummary`) leaked raw IR marker objects (`{$ref}`, `{$param}`, `{$call}`, `{$expr}`) directly to hosts like 3d_editor. Hosts had to hand-write `{$ref: name}` literals (12 occurrences), with no type safety and no guards. `StatementSummary` had redundant projections (`inputs`, `positionalKinds`) alongside the raw `positional` slot, and `hasComputedArgs` blocked entire timeline rows from editing.

## Decision

Introduce `HostArg` (`packages/core/src/lang/host-arg.ts`) as the sole host-facing argument type. Hosts construct and consume `HostArg` shapes (`{kind:'var-ref', name}`, etc.) and never touch IR. Two internal recursive converters (`argIRToHost` / `hostArgToIR`) bridge the IR-to-Host boundary -- not exported.

- `codeToArgs` returns `HostArg[]` positional + `Record<string, HostArg>` args (IR stripped via `argIRToHost`).
- `formatCodeLine` accepts `HostArg` positional/args and converts to IR via `hostArgToIR` at entry -- codegen logic unchanged.
- `StatementSummary` gains `args: Record<string, HostArg>`, loses `inputs` and `positionalKinds` (hosts derive inputs via `isHostVarRef` filter on `positional`).
- Host helpers exported: `isHostVarRef`, `isHostParamRef`, `isHostCallRef`, `isHostExprRef`, `isHostRef`, `hostArgToDisplay`, `hostArgToLiteral`, `HOST_REF_KINDS`.
- `argIRToHost` and `hostArgToIR` are not exported (IR red line).

Discrimination relies on runtime guards, not the type system -- `HostRef` is structurally a subtype of `JsonValue`. A reserved-word rule (kind values are `HOST_REF_KINDS`) deterministically resolves the only ambiguity; literal objects must not use these kind values.

## Alternatives considered

- **Export ArgIR types directly**: Rejected -- the IR red line (V5) mandates hosts never import IR types. Leaking `{$ref}` etc. forces hosts to hand-write IR literals, defeating the purpose.
- **Keep `inputs`/`positionalKinds` as convenience fields**: Rejected -- one home per fact. `inputs` is a trivial `isHostVarRef` filter on `positional`; `positionalKinds` is replaced by runtime guards. Keeping both creates dual sources of truth and transition-period compatibility copies (forbidden by repo rules).
- **Keep `hasComputedArgs` blocking**: Rejected -- per-field editability (via `isHostRef` guard) is strictly more expressive. The whole-row block was a stopgap for the IR-leak era; with HostArg, individual fields can be read-only while others remain editable.

## Consequences

- Version bump 0.8.0 to 0.9.0 (breaking: `StatementSummary` field changes, `codeToArgs`/`formatCodeLine` type changes).
- 3d_editor must migrate all 12 `{$ref}` hand-writes to `{kind:'var-ref', name}`.
- `hasComputedArgs` remains on `StatementSummary` as an information flag (no longer gates panel entry).
- The `codeToArgs` sentinel-declaration behavior (identifiers become param-ref in single-line context) is a known limitation; `analyzeCode` with full script context is the correct path for var-ref testing.
