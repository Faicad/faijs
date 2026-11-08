# Agent Note: OCR-variant whitelist for `parseThreadSpec`

Status: implemented

English | [中文](2026-11-08-thread-spec-ocr-whitelist.zh.md)

## Problem

The descriptive thread spec (`thread: 'M16-6H↧18'` / `spec: 'M16'`) is increasingly fed by OCR pipelines that read drawing callouts. Real OCR output arrives with full-width characters, wrong dash/quote/arrow glyphs, European decimal commas, and the callout keywords `THRU`/`DEEP` — all of which the strict grammar rejected. At the same time the string is an attacker-facing input surface: homoglyphs (Cyrillic `М`), zero-width/bidi control characters, injection payloads, and overlong inputs must never be silently tolerated or guessed into geometry.

The user's requirement (2026-11-08): the tolerance must be a **pre-enumerated whitelist**, not open-ended input compatibility; non-whitelisted input must be explicitly rejected (`E_THREAD_SPEC`); malicious and deliberately confusing input (injection, homoglyphs, zero-width/bidi characters, overlong DoS) must be defended against; the convenience/security boundary must be explicit and tested.

## Decision

`parseThreadSpec` normalizes through a three-layer whitelist. Normalization only maps characters INTO the existing grammar alphabet — it never widens the grammar — and the only grammar additions are enumerated productions:

- **L1 character equivalence classes**: NFKC (full-width forms, fraction glyphs — `½` → `1⁄2` with U+2044 mapped to `/`), one-char lookalike maps (dash variants → `-`, `*`/`·`/`∗` → `×`, curly/prime quotes → `"` with the NFKC-split `″`→`′′` pair collapsed to one inch mark, `⇩`/`⤓` → `↓`), digit-comma decimals (`1,5` → `1.5`), leading-dot decimal inches (`.25"`), and an OCR edge-junk strip (stray brackets/quotes/punctuation at the ends only; a leading `.` and a trailing `"` are meaningful and never stripped, and dashes are never stripped — `-M16` must not parse).
- **L2 enumerated keyword suffixes**: `THRU`/`THROUGH` sets `thru: true` on `ResolvedThreadSpec` (through hole; `depth` stays undefined ≡ existing through-hole semantics in `fai_drill`), and `<depth> DEEP` (whitespace-separated bare number) sets `depth`. Contradictions are explicit errors: THRU with any depth notation, ↓-suffix with DEEP.
- **L3 closed-alphabet class repair**: tolerance-class tokens repair only when exactly one candidate exists (`GH` → `6H`, `ZB` → `2B`, `6N` → `6H`); free numbers are never guessed — errors instead carry a nearest-table-entry suggestion (OCR-weighted Levenshtein ≤ 2 edits, confusion pairs at half cost, numeric tiebreak so `M17` suggests `M16` over `M12`), and a suggestion is a hint in the message, never auto-applied.

**Security boundary** (all `E_THREAD_SPEC` rejects): input over 64 characters (regex-DoS cap, checked before NFKC); invisible/bidi control characters (U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+FEFF, checked on raw and NFKC-normalized input); and a post-normalization alphabet guard (`A-Z 0-9 - × ↓ / " . #`) that rejects homoglyphs, injection payloads, markup, and unknown punctuation by code point.

**TPI steal guard (load-bearing)**: in the imperial branch, class repair only runs when the second token character is a letter. Without it, `LETTER_LOOKALIKES['8'] = 'B'` would repair the TPI token `18` into class `1B` and silently drop the TPI; the guard is pinned by a GOTCHA regression test.

**`fai_drill` mutex**: `thru` (from THRU) plus an explicit `depth` param → `E_ARG`, joining the existing string-vs-param mutexes.

**Docs**: the generated AI/user manual (`ops-api-inventory.md`/`.zh.md`) documents the whitelist in the `fai_drill` `thread` and `screw` `spec` rows via their JSDoc sources (regenerated with `gen-ops-api-inventory`).

## Alternatives considered

**Open-ended input compatibility (normalize anything plausible).** Rejected by the user: only a pre-enumerated whitelist is acceptable; anything else must be an explicit reject, both for security and because a wrong guess produces silently wrong geometry.

**Auto-repair free numbers (`M1O` → `M10` body digits).** Rejected: the body diameter/pitch are free numbers with many near-equal candidates; guessing risks silent wrong geometry. `M1O` rejects with a suggestion instead.

**Strip dashes as OCR edge junk.** Rejected: would let `-M16`/`M16-` parse as valid specs; the malformed-form signal is worth more than the junk-removal convenience.

**Let `screw` reject `THRU`/`DEEP` suffixes in its `spec`.** Not taken in this change: `screw` already ignores the `depth` suffix (pre-existing behavior, thread series is the single source it consumes); `thru` is likewise ignored rather than modeled. Registering this as a known limitation rather than expanding scope.

**Silent tolerance of zero-width characters via normalization.** Rejected: invisible text is an attack surface, not OCR output; both the raw and NFKC-normalized inputs are checked and rejected.

## Consequences

- `parseThreadSpec` accepts OCR variants of the same specs (85/85 parser tests, including 56 new OCR cases) and every one of the 11 pre-existing bad inputs stays red.
- The whitelist is enumerable and documented in one place (the `thread-spec.ts` file header + GRAMMAR_HELP), and the boundary is locked by security tests: homoglyphs, zero-width/bidi, injection payloads, overlong input, unknown keywords.
- Error messages carry nearest-entry suggestions (`M17` → `M16`, `NPT1/2` → `PT1/2`), which improves AI/OCR-pipeline recovery without any silent application.
- `ResolvedThreadSpec` gains an optional `thru` field; PMI data is built field-by-field, so nothing downstream changes shape. `fai_drill` rejects THRU + explicit `depth` with `E_ARG`.
- The NFKC `″` → `′′` split is a Unicode gotcha preserved as a regression test (two primes are one inch mark, not two).
- BREP chain only, as always; the mesh chain is frozen and untouched.
