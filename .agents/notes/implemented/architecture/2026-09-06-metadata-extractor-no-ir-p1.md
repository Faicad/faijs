# Agent Note: MetadataExtractor lands (P1, first step of the no-IR dual-channel runtime)

Status: implemented

English | [中文](2026-09-06-metadata-extractor-no-ir-p1.zh.md)

## Problem

The `.fai.js` parser semantic layer (`parseScript` → `ScriptIR`) serves both the execution channel and the UI channel, which is why "every feature change forces a parser change." The 2026-09-06 no-IR dual-channel plan requires decoupling the execution channel from the UI channel, reducing the parser to a metadata extractor, and eventually deleting the intermediate IR. Before any IR deletion, an IR-free `MetadataExtractor` must exist and its output must be locked equal to the old path by parity tests (A-16/A-17/A-14) — the R11 red line.

## Decision

P1 landed with no IR code deleted; the execution chain is untouched:

1. Added `lang/parse-error.ts` (single home of `ParseError`/`ParseErrorCode`) and `lang/fnv-hash.ts` (single home of `fnv1a32`). `lang/parser.ts` now re-exports both, giving the new and old paths one shared class identity.
2. Added `lang/metadata-extractor.ts`: `extractMetadata(code)` → `UiMetadata` (lines/params/imports/functions/blocks/keep/meta/terminalShapes). The `lines` face directly produces `StatementSummary` (id = `'s'+lineNo`); its semantics are field-equal to the current `parseScript` projection (folding, HostArg reference shapes, refs, packageName, container/flat line numbering). It imports neither parser.ts nor compile.ts, generates no executable code, evaluates nothing, and takes no part in execution.
3. Rewired `analyzeCode` (in `lang/statement-summary.ts`) and `codeToArgs` (in `lang/code-to-args.ts`) to run through `extractMetadata` — function names, signatures, and return types unchanged, and `analyzeCode` still throws `ParseError` carrying a line number. `parseScript` remains the parse entry of the execution chain; the two paths coexist.
4. Parity and unit tests:
   - `packages/core/src/lang/metadata-extractor.test.ts` — 19 cases incl. A-6/A-7/A-11 samples;
   - `packages/tests/faijs/no-ir/parity/a16-lines.test.ts` — 61 cases: over all 40 `.fai.js` fixtures plus synthetic rows, `extractor.lines` is field-equal to the legacy (parseScript projection) under the `'s'+lineNo` id rule; the `keep` table equals the normalized `parseUserKeep` extraction; `params`/`imports` faces match.
   - The full core suite is green (82 files / 1170 cases); typecheck and lint are green.

## Alternatives considered

- **Make `MetadataExtractor` call `parseScript` internally.** Zero cost, but the parity test would be circular and the extractor could not survive the P6 parser deletion — it would defeat the "IR-free extractor" goal. Rejected.
- **Ship a from-scratch extractor whose fold/reference semantics drift from the current path.** Rejected — A-16 is the deletion gate; any drift would surface on the fixture parity corpus, so the semantics were ported iso-morphically instead.

## Consequences

- The UI channel (`analyzeCode`/`codeToArgs`/timeline data sources) no longer depends on `ScriptIR`; statement-summary builds no IR intermediate.
- `StatementSummary.id` semantics move from sN (statement ordinal) to `'s'+lineNo` (stable under append). Hosts treat ids as opaque strings, so nothing breaks; parity comparisons normalize by this rule.
- `parseScript`/`compileToModule`/`ModuleExecutor`/`terminal-dag` stay on the execution chain; P2 (DirectExecutor) adds the IR-free execution path, and IR deletion (P6) is only allowed once R11 gates pass.