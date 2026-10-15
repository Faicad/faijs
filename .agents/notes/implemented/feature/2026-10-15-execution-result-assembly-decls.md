# Agent Note: ExecutionResult assembly declarations and hoist string-literal guard

Status: implemented

English | [中文](2026-10-15-execution-result-assembly-decls.zh.md)

## Problem

Two gaps blocked hosts from consuming `cad.assembly` declarations:

1. **Declarations were unreachable from the result.** `ExecutionResult` carried
   `compounds` (member names only), but the constraint / joint declarations lived
   solely in the compound's behavior slot, and `getSlot` was not a public export.
   A host that wanted to solve an assembly on its own side had to pick compounds
   out of `outputs` and reverse-engineer internal slot structure.
2. **Identifier hoisting corrupted string literals.** The dialect's hoisting
   (`hoistBlockText`, `hoistText`) rewrote declared names with a text-level
   `\b<name>\b` global replace that did not distinguish code from strings. Inside
   a `for` body, `parent: 'carrier'` was emitted as `'__ctx.carrier'`; the
   assembly consumer then treated the unknown parent as absent and silently
   re-parented to the scene root — a silent mis-parent with no diagnostic.

## Decision

- **`ExecutionResult.assemblies?: AssemblyDecl[]`** — one entry per
  `cad.assembly` statement: `{ name?, memberNames, constraints, joints, solver,
  compound }` (the behavior's declaration fields plus the compound reference;
  the `solve` / `solveDetailed` methods are deliberately excluded). Collected in
  `collectDirectResult`, the same place `compounds` already comes from.
  `AssemblyDecl` lives next to `AssemblyBehavior` in `extra/ops/compound.ts` and
  is re-exported from `@faicad/faijs/extra`.
- **`AssemblyBehavior.kind?: 'group' | 'assembly'`** discriminates the two
  compound producers. `group` products stay in `compounds` but are excluded from
  `assemblies`: a group has no constraints or joints, and solving an empty
  constraint set trips the underdetermined diagnostic on the consumer side.
- **Hoisting skips protected ranges.** `collectHoistProtectedRanges` parses the
  text (module first, then the `(function(){ … })` fallback — the same strategy
  `hoistBlockText` already used) and collects string-literal ranges,
  template-literal quasi ranges, and comment ranges.
  `replaceOutsideProtected` applies each substitution sequentially (later
  substitutions see earlier output, as before) but keeps any match that falls
  inside a protected range. All four hoist substitutions — for-of head,
  declaration LHS, free references, namespace bindings — go through it in both
  `hoistBlockText` and `hoistText`. Free-reference and namespace substitutions
  are merged into single alternation passes (equivalent to the previous
  per-name sequential replaces: the inserted `__ctx.` / `__ns.` prefixes contain
  `_` and `.`, which are word-boundary breaks, so no name can be re-matched by
  another name's pattern).

## Alternatives considered

- Expose an `assemblyBehaviorOf(shape)` accessor instead of a result field:
  rejected — hosts would still have to discover compounds in `outputs`, and the
  declaration surface stays one indirection away from the result contract.
- Let consumers filter `group` out of `assemblies` themselves: rejected — the
  exclusion is a source-level fact (no constraints/joints), so it belongs at the
  producer; the discriminator also documents intent on the behavior itself.
- Rewrite block hoisting on the AST (the way `transformArg` does): rejected for
  now — the block path is deliberately text-level (its documented v1 limitation
  includes nested scopes); range protection removes the string-corruption class
  with a minimal diff. An AST rewrite remains a future option.
- Parse-failure fallback to unprotected replacement: kept (not an alternative
  but a boundary) — fragments that are not standalone-parseable JS (e.g. an
  object-method shorthand property) keep the previous behavior rather than
  throwing.

## Engineering notes

- **Symmetric corruption hides from parity tests.** While landing the merged
  alternation passes, a non-capturing group (`(?:a|b)` where the emitter read
  `$1`) made every hoisted name `__ctx.undefined`; the vm/interpreter parity
  tests still passed because both backends emitted the same broken text. The
  emitted-text assertions in `direct-executor.test.ts` are what caught it —
  behavior-level parity cannot see symmetric transform bugs.
- Regex literals are not protected (only strings, template text, comments); the
  security scanner already constrains them, and no dialect code path evaluates
  them.

## Consequences

- Hosts read declarations from `ExecutionResult.assemblies` and solve on their
  own side. Baking stays forbidden for them: calling `asm.solve()` /
  `do_assemble()` applies transforms to geometry vertices, which double-positions
  anything the host then animates.
- The downstream canary that pinned the hoisting defect (current wrong value
  `'__ctx.carrier'`, expected `'carrier'`) flips to passing once it consumes a
  faijs build containing this change.

## Testing

- `packages/core` suite green: 347 files, 3921 passed / 13 skipped.
- New tests: 6 in `test/cad-runtime/direct-executor.test.ts` (string /
  template / comment / namespace-text protection, no-false-positive on real
  references, dual-backend end-to-end), 2 in `test/cad-runtime/runtime.test.ts`
  (assembly declaration fields; `group` excluded plus declaration order).
- API coverage gate passes (`check-api-test-coverage`), typecheck passes.
