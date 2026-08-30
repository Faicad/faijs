# Translation Rules

English | [中文](translation-rules.zh.md)

## General principles

- Translate meaning, not words. Read the whole paragraph, then write the target language naturally.
- Keep code blocks, inline code, URLs, and file paths untranslated.
- Preserve Markdown structure exactly: same headings, same list nesting, same blockquote depth.
- Generated regions (code blocks, tables produced by scripts) must be byte-identical after paired-document path normalization.
- Each translated document must link to its counterpart (language switcher).

## Chinese conventions

- Use simplified Chinese (简体中文).
- Use full-width punctuation in prose: `，。：；！？（）""''`
- Do not use full-width punctuation in code blocks or inline code.
- Keep a space between half-width and full-width characters: `使用 BREP 引擎` not `使用BREP引擎`.
- Use `你` not `您` for user-facing prose.

## English conventions

- Use American English spelling (e.g., `behavior`, `color`, `center`).
- Use Oxford comma in lists of three or more.
- Sentence case for headings (capitalize only the first word and proper nouns).

## Terms that should not be translated

See [terminology.md](terminology.md) for the glossary of terms that stay in their original language.
