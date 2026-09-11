# Bilingual Document Pairing

English | [中文](README.zh.md)

Every in-scope document is a trio of files in the same directory:

| File | Role |
|---|---|
| `foo.md` | English source |
| `foo.zh.md` | Chinese translation |
| `foo.i18n.yaml` | Consistency record (git blob hashes of both sides) |

## Scope

In-scope:
- Root `README.md`
- `docs/**/*.md` (except `docs/plans/`, `docs/analysis/`, `docs/handover/`, `docs/AGENTS.md`)
- `.agents/notes/**/*.md` (except `AGENTS.md` files)

Out of scope (excluded in `scripts/translation-pairing.manifest.json`):
- `docs/plans/` — design documents, single-language (Chinese)
- `docs/analysis/` — technical analysis, single-language (Chinese)
- `docs/handover/` — handover records, single-language (Chinese)
- `AGENTS.md`, `docs/AGENTS.md`, `.agents/notes/AGENTS.md` — instruction files, English only
- `docs/i18n/terminology.md`, `docs/i18n/style-samples.md`, `docs/i18n/translation-prompt.md` — bilingual by construction or machine-consumed

## Consistency record

The `.i18n.yaml` file records the git blob hash of each side at the last confirmed-consistent state:

```yaml
foo.md: <40-hex git blob hash>
foo.zh.md: <40-hex git blob hash>
```

When either side changes, the pair is out of sync until the record is updated with `npx tsx scripts/verify-translation-pairing.ts --write`.

## Language switcher

Each translated document must link to its counterpart. The Chinese side links to the English side, and the English side links to the Chinese side (when the English side is not the canonical source for a generated document).

## Structural matching

Both sides must have the same Markdown structure: same headings, same code blocks (generated regions must be byte-identical after paired-document path normalization), same list structure. The gate `verify-translation-pairing` enforces this.

See [translation-rules.md](translation-rules.md) for translation conventions and [terminology.md](terminology.md) for the term glossary.
