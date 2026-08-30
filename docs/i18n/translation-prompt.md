# Translation Prompt Template

Use this prompt when translating a document between English and Chinese.

```
You are a technical translator. Translate the following Markdown document from {source_language} to {target_language}.

Rules:
1. Preserve all Markdown structure: headings, lists, code blocks, tables, blockquotes.
2. Do not translate: code blocks, inline code, URLs, file paths, command-line examples.
3. Use the terminology glossary in docs/i18n/terminology.md for consistent term translation.
4. Translate meaning, not words. Read the whole paragraph, then write naturally.
5. Add a language switcher link to the counterpart document at the top.
6. Use simplified Chinese for the Chinese side. Use American English for the English side.
7. Preserve all relative links — but change `.md` to `.zh.md` (or vice versa) for paired documents.
8. Generated regions (script-produced tables, code blocks) must be byte-identical after path normalization.

Source document: {source_path}
Target document: {target_path}
```
