# Agent Note: PMI note kinds renamed to `localNote` / `generalNote`

Status: implemented

English | [中文](2026-11-18-pmi-note-kinds-local-general.zh.md)

## Problem

The two PMI note kinds were named after their *shape*, not their *scope*:
`note` was "one text line with an optional `target`" and `techNote` was "a numbered
block". ASME Y14.100 §4.26 splits notes by scope: **general notes** apply to the
entire drawing or its associated list; **local notes** sit at the specific area or
point of application and apply only there. The old `note` carried *both* cases
(with `target` = local, without `target` = a single general requirement), so no
two-name scheme could line up with the standard while the model had one bucket for
two scopes.

## Decision

Rename the kinds so **placement is the only axis**:

- `note` → `localNote` — a note that applies only where it is attached; it must
  carry a `target` or an `anchor`. Constructing one with neither throws
  `[localNote] a local note needs a target or an anchor; use generalNote for
  requirements that apply to the whole part`.
- `techNote` → `generalNote` — applies to the whole part or the whole drawing;
  carries `items[]`, where an item with `index` renders with its number and an item
  without `index` renders as bare text (single unnumbered requirement).

The rename runs through the whole surface: kind literals, `PmiLocalNote` /
`PmiGeneralNote` / `PmiGeneralNoteLine` types, `PmiItem` union, factories
`localNote()` / `generalNote()`, Shape methods `addLocalNote()` / `addGeneralNote()`,
queries `pmiGeneralNotes()`, layout `generalNoteLines()` / `formatGeneralNote()`
(`api/pmi/general-note.ts`, replacing `tech-note.ts`), and the view helper
`generalNoteTexts()` (renamed from `globalNoteTexts`; it collects `generalNote`
items only).

**No legacy alias is exported** — `note`, `techNote`, `pmiTechNotes`,
`formatTechNote` and `globalNoteTexts` are gone, so an old `.fai.js` using them
fails to resolve. Reading *external* data stays tolerant: `api/pmi/kind-alias.ts`
exports `normalizePmiKind` / `migratePmiItem` / `migratePmiSet`, and the 3MF
metadata reader applies `migratePmiSet` so legacy literals land as
`localNote` (placement present) or `generalNote` (no placement). Internal strictness
and external tolerance are deliberately different: rejecting a real 3MF file because
of an old literal would be the worse failure.

## Alternatives considered

- **Keep the old names and only fix the docs**: rejected — the old pair is
  shape-based, so `localNote` semantics stay unexpressible and downstream consumers
  keep guessing from `target` presence.
- **`partNote` / `globalNote`**: rejected — "global" is not the distinguishing axis,
  "part" is exactly what *general* already means, and the pair is a false symmetry.
- **Keep alias exports for one release**: rejected by the user — a published alias
  keeps both names live in the symbol table, so scripts drift back to the old names
  and the rename never completes.
- **Fold general notes into `localNote` with an optional target**: rejected — it
  reproduces the exact defect being fixed (one bucket for two scopes).

## Consequences

- Old scripts must be migrated; the failure is a parse-level "unknown member", which
  is visible immediately rather than silently producing a general note where a local
  one was meant.
- Consumers that only borrowed the label (the drawing project compiles both kinds
  into `warnings[]` verbatim) needed no behavioural change, only the literals.
- `generalNote` still carries `items[]` / `title` / `category`; nothing new consumes
  them yet — that remains a separate decision.
