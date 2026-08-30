# Skill: faijs Translate Docs

When translating a document between English and Chinese in the faijs repository.

## Workflow

1. Read the source document and the [terminology glossary](../../../docs/i18n/terminology.md)
2. Translate preserving Markdown structure exactly
3. Add a language switcher link at the top
4. Update paired-document links (`.md` ↔ `.zh.md`)
5. Run `npx tsx scripts/verify-translation-pairing.ts --write` to record the pair
6. Run `npx tsx scripts/verify-translation-pairing.ts` to verify consistency

## Rules

- Preserve all code blocks, inline code, URLs, file paths untranslated
- Generated regions must be byte-identical after path normalization
- Use simplified Chinese with full-width punctuation in prose
- Use American English for the English side

## See also

- [docs/i18n/README.md](../../../docs/i18n/README.md) — pairing contract
- [docs/i18n/translation-rules.md](../../../docs/i18n/translation-rules.md) — translation rules
