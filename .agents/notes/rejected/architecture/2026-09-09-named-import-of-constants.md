# Agent Note: Named import of plain constants from a `.fai.js` module

Status: rejected — the gain is cosmetic, the cost is that every module's export surface silently becomes all of its top-level variables, which forecloses explicit-export narrowing.

English | [中文](2026-09-09-named-import-of-constants.zh.md)

## Problem

When porting a multi-file Python CadQuery project (mini_lathe), the first duplication a reader hits is the config block: 19 constants plus a `pin_holes` helper, copied verbatim into all seven part scripts. Python removes that duplication with `import config`, and every part then reads `config.OUTX`.

The faijs multi-file channel (P5, `.agents/notes/implemented/architecture/2026-09-06-module-registry-multifile-p5.md`) already covers the shape of that fix — but only partly. `import * as cfg from './config.fai.js'` works; `import { OUTX } from './config.fai.js'` is rejected by `ModuleRegistry.resolveBinding`, which admits only `liveShapes ∪ fns` and therefore fails a plain constant with `BINDING_NOT_EXPORTED`.

The question this note answers: should named import of plain constants be admitted, so that Python's `from config import X` has a faijs counterpart?

## Proposal

Relax `resolveBinding` from a two-way to a three-way rule:

| Value kind | Rule | Change |
|---|---|---|
| Shape value | must be in `liveShapes` | unchanged (A-9) |
| Non-shape constant | admitted directly | **new** |
| Function | via `fns` | unchanged |

The shape row is what makes the naive version of this proposal unsafe. `FaiModuleExports.values` holds *all* non-function ctx keys, shapes included. Admitting every value would let `import { base }` succeed for a shape that the producing module already consumed internally, which is precisely what A-9 forbids and what `multifile.test.ts` asserts fails. So "admit constants" and "admit everything" are not the same change, and only the former was ever on the table.

## Why the benefit is small

1. **The Python source being ported does not use the form.** Every one of the seven mini_lathe part scripts writes `config.OUTX`; not one writes `from config import OUTX`. The only `from X import Y` lines in the whole Python project are in `assemb.py`, and they import **shapes** (`from bottom_plate import bp`) — a case faijs already supports through `liveShapes`. The parity argument for named constants is therefore theoretical: it mirrors a Python feature the source does not exercise.
2. **The namespace form is already complete.** `import * as cfg` + `cfg.OUTX` is implemented, tested (`multifile.test.ts`, "namespace import" case), and needs no engine work.
3. **The visual gain is a prefix.** Deduplicating the config block removes ~130 duplicated lines. Whether the survivors read `OUTX` or `cfg.OUTX` is a matter of taste, and the prefix is arguably a feature — it marks at the use site which constants are shared project parameters versus locals like `slot_x` or `cut_centers`.

## Why the cost is large

1. **Export surface becomes "every top-level variable".** A module's public surface is currently *derived*: live shapes plus functions. Admitting constants makes it *everything* — including intermediate scratch values that were never meant to be importable. In `slide_mid.fai.js` that means `hole_positions`, `cut_centers`, `hexagon_side` and friends all become legal import targets. Python has the same laxity, but Python is not trying to keep a machine-checkable module boundary.
2. **It forecloses the better fix.** The P5 note already lists `// @export` narrowing as an open gap. Explicit export declarations are the principled answer to "what may another module import". Shipping implicit full export first creates consumers that depend on it, so the later narrowing becomes a breaking change. Rejecting this proposal keeps that door open at zero cost.
3. **It weakens the binding gate as a design signal.** Today the rule is one sentence — a module exports what it *produces and keeps*, plus what it *defines*. The three-way rule needs a clause explaining why shapes are special-cased, and that explanation has to be carried in every future discussion of the export surface.
4. **Blast radius is the engine, not the project.** `resolveBinding` is shared by every host (CLI, tests, 3d_editor). A mini_lathe authoring-convenience question would be answered by a permanent change to core semantics.

## Alternatives considered

- **Namespace import only (`import * as cfg` + `cfg.OUTX`) — chosen.** Zero core change; already implemented and tested; matches what the Python source actually writes. Cost is one prefix per use.
- **Admit all values, shapes included.** Rejected outright: breaks A-9, and `multifile.test.ts` would have to be inverted rather than extended.
- **Explicit `// @export` annotation.** The right long-term shape, and the reason this proposal is rejected rather than accepted-with-caveats. Out of scope for deduplicating mini_lathe; stays on the P5 open-gaps list.
- **Have the generator emit constants into a library instead of a `.fai.js`.** Rejected: it moves shared project parameters out of the project, and libraries are a different trust and packaging boundary.

## Acceptance criteria

Had this been accepted, it would have required:

1. `import { OUTX } from './config.fai.js'` resolves, and `OUTX` is usable as a bare identifier in the importing script.
2. `multifile.test.ts` A-8/A-9/A-10 cases still pass unchanged — in particular `import { base }` for a module-consumed shape still fails with `BINDING_NOT_EXPORTED`.
3. A new core unit test for named constant import, and one asserting a *shape* that is not live is still rejected.
4. `docs/library-dev-guide.md` / the multi-file contract documents the three-way rule.

None of these are implemented; the working tree is unchanged from before the proposal except for a one-line pointer comment in `module-registry.ts`.

## Risks

- **Reopening pressure.** Every Python port that uses `from config import X` will resurface this. The answer to record: check whether the source actually uses that form before treating parity as an argument.
- **Accidental reliance on the rejected behaviour.** Since the gate rejects rather than ignores, a mistaken `import { OUTX }` fails loudly at the import line with `BINDING_NOT_EXPORTED` and a list of live shapes. The failure mode is a clear error, not silent `undefined`.
- **Note drift.** The pointer comment in `module-registry.ts` names this note; if the note is ever superseded, that comment must move with it.
