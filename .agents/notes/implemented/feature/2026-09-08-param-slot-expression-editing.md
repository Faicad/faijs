# Agent Note: Param source-slot editing — faijs ArgSource/validateExpression/editArgSource + 3d_editor timeline

Status: implemented

English | [中文](2026-09-08-param-slot-expression-editing.zh.md)

## Problem

The 3d_editor timeline only showed operations; parameter definitions (`const w = 40`) and derived parameters (`const d = w * 2`) were not represented and could not be edited. The metadata extractor folded an expression into its runtime literal, so any host edit that reprinted the whole statement line would silently destroy the original expression text. The `hasComputedArgs` flag stood in as a read-only guard for exactly that failure, but it left parameters un-editable: a user could assign a value, yet never view or change the expression that produced it.

## Decision

Track the source span of every parameter slot and let edits replace exactly that span, never a reprinted line:

- **faijs, additive only** (`packages/core/src/lang/metadata-extractor.ts`, `lib/expr-validate.ts`, `lib/source-edit.ts`):
  - `extractMetadata(code)` → `UiMetadata` with `params` (line, name, value, type, computed) and `names` (sorted, deduplicated set of declared names used for expression validation), plus a flat `argSources` list. Each slot carries `stmtId`, `path`, `text`, `start`, `end`, `params` (referenced declared names), `refs`, `isExpression`. Paths cover positional slots (`positional[i]`, with `.field` / `[index]` nesting), named-arg slots (`args.<key>`), and RHS slots (`'rhs'` single-declaration; `'rhs:<name>'` on a multi-declaration line such as `const w = 40, h = 20`).
  - `validateExpression({ text, known })` → `{ ok: true }` or `{ ok: false, code: E_SYNTAX|E_REFERENCE|E_VALUE, message, line? }`: bracket-wrap then acorn parse for syntax errors; a whitelist of allowed expression forms separates reference errors from value errors.
  - `editArgSource(code, stmtId, path, newText)` → `Result<string, EditSourceError>`: re-extract → locate the slot → assert its `start`/`end` still slice to the recorded `text` (else `E_RANGE_STALE`) → validate the new expression (else `E_SYNTAX`/`E_REFERENCE`/`E_VALUE`) → splice the new text → acorn re-parse the whole result (else `E_SYNTAX`) → ok. `E_PARSE` is returned when the code cannot be extracted at all; the error is a discriminated union (`EditSourceError`).
  - The browser entry re-exports these plus `asStmtId`, so the host consumes only `@faicad/faijs/browser`.
- **3d_editor (host integration)**:
  - `script-store` gains `replaceSceneCode(newCode)`, which writes `sceneCode` and re-derives `statementIndex`. The `ScriptEngine.updateSceneCode(old, new)` path executes and commits geometry but does not itself persist the edited text; the host does both.
  - `src/engine/param-edit/param-edit.ts` `commitArgEdit`: uses `editArgSource` → on ok pushes the undo snapshot (`undo.label.editParam`) **before** any code mutation → `replaceSceneCode` → `ScriptEngine.updateSceneCode(old, new)`. `E_RANGE_STALE` retries once with the store's current code; `E_PARSE` degrades to a banner plus read-only "view code", never a silent skip.
  - `TimelinePanel.tsx` merges parameter nodes into the item list by code line: a single declaration, or the two declarations of one `const w = 40, h = 20` line, render as adjacent nodes keyed `param:<name>`, each with its own `rhs`/`rhs:<name>` slot. Clicking a parameter opens the expression editor (live check with `validateExpression`), Enter/confirm commits.
  - Deleting a parameter is pre-checked: if another slot references the name, deleting is blocked with a "referenced N times" notice; the check filters `argSources` host-side (no new faijs API). The reference count looks at `params ∪ refs` so a **computed** parameter whose references are recorded refs-only is still protected. A parameter that shares a multi-declaration line is also guarded.
- The `hasComputedArgs` gate stays closed for P0 (zero regression). It opens only as a later release that ships together with per-slot editable operator arguments and backfill arg-source awareness, since opening it alone would write default values over referenced slots.
- **P1/T3 (released): per-slot operator-argument editing replaces the `hasComputedArgs` one-fits-all read-only gate.** `src/engine/features/arg-field.ts` defines the three-state field model (`editable-literal | editable-expression | readonly`, via `fieldEditState`) and the routing predicate `hasSlotEditorSlots(slots, paramNames)`: an op row routes to a timeline slot editor exactly when one of its `argSources` slots references a declared parameter — including derived (`computed`) parameters, which the extractor records in `refs` only, never `params` (`const d = w * 2` used as `box(w, h, d)`), so `hasSlotEditorSlots` inspects `params ∪ refs` against `meta.params[].name`. A trailing options object (`{ size: … }`) is the projection of its `args.*` sub-slots and is excluded from the slot list (editable unit is `args.size` etc.).
  - `TimelinePanel` builds a per-statement slot map, and `TimelineNode` routes: third-party → view-code; param-reference statement → `SlotEditorOverlay` (per-slot `ExpressionField`s, dependency chips that jump to the parameter definition and highlight its references, Enter commits via the shared `commitArgEdit` path); non-param-reference statements fall through to the numeric feature panel / backfill as before. Because the panel is never opened for a row that holds a parameter reference, the "backfill writes a default over a referenced slot" failure is closed **by construction** for every feature (box/chamfer/drill/engrave/knurl/fai_extrude/fai_split/transforms/assemble), not per-panel.
  - The slot commit keeps a `draftRef` mirror so `input change` followed by `Enter` in the same event frame reads the latest text even before a React flush.
  - `hasComputedArgs` is no longer consulted by any production consumer (fixtures and comments aside); it remains exported by faijs unchanged, and `meta.params[]/names[]` already include derived parameters, so the A1 switch is effectively in place at the extractor level.

## Alternatives considered

- Implementing the source-splice inside 3d_editor (`source-patch.ts`). Rejected per user directive: the splice is a pure function of faijs (`editArgSource`), shared by any host, and stays out of the 3d_editor tree.
- Re-print the statement line on edit (old `codeToArgs` → `formatCodeLine` round trip). Rejected: expression text would be lost; the gate exists because of that loss.
- Whole-line removal for a multi-declaration row. Rejected: each parameter has an independent span; removing one must not remove the sibling.
- Promoting derived params (`const d = w * 2`) into `paramNames` during the additive phase to carry routing. Resolved differently: derived params already appear in `meta.params[]/names[]` (A1 is effectively in place at the extractor), and the host's slot routing tests "references a declared parameter" by consulting `params ∪ refs` against `meta.params[].name` — derived references are recorded refs-only, so this predicate is what makes them first-class.
- Guessing an edit target when the script cannot be parsed. Rejected: `E_PARSE` is surfaced loud ("script is not parseable" + view-code), never guessed.

## Consequences

- The whole source is preserved because edits replace a concrete span, never a reprinted command line.
- Every edit snapshots undo state before any mutation; a stale edit retries with the current code; a bad parse surfaces explicitly.
- A slot range is computed per `editArgSource` call from the code passed in, so `E_RANGE_STALE` can only happen when the caller presents a truly old snapshot; the host's commit path re-uses the current `sceneCode` on that retry.
- Host contract: the new symbols (`extractMetadata`, `UiMetadata`, `ArgSource`, `validateExpression`, `editArgSource`, `EditSourceError`) are in the 3d_editor D-class whitelist, keeping the host's "browser entry only" import policy.
- Routing rule collapses the old `hasComputedArgs` read-only gate: rows referencing parameters edit per-slot, rows without stay in the feature panel; the feature-panel backfill can never touch a referenced slot, so the default-clobber failure is structurally removed across all features.
- Verification: 3d_editor component suite 367/367 (TimelinePanel per-slot tests: open slot editor, per-slot `editArgSource` commit through `updateSceneCode`, dependency-jump, computed-parameter reference routing), unit suite 1901 passing (only an unrelated break for `c4-brepjs-gear`), typecheck shows only the two pre-existing `compat` errors, `vite build` green; faijs core tests green.
- Scope boundary: T4 rename pre-check (P2) remains optional and deferred; per-panel `fx` field badges are not needed because parameter-referenced rows never open a feature panel (they go to the slot editor); this note records the current decision only.