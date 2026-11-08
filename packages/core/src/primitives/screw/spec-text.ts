/**
 * primitives/screw/spec-text — shared text layer for drawing-callout spec strings
 *
 * The descriptive-spec parsers (`thread-spec.ts`, `drill-spec.ts`) share this
 * module: hard input guards (length cap, invisible/bidi control characters),
 * the spec error type, the OCR edge-junk strips, the English depth keywords,
 * and the enumerated Chinese drawing keywords.
 *
 * Everything here is a pre-enumerated whitelist entry — normalization only
 * maps characters/keywords INTO the grammar of each parser; it never widens
 * the grammar, and anything outside the whitelist is an explicit reject
 * (code `E_THREAD_SPEC`). See the OCR-whitelist Agent Note (2026-11-08) for
 * the boundary contract.
 */

/**
 * Whitelist length cap. The longest legitimate callout is ~20 chars; 64 kills
 * overlong/DoS payloads before any normalization or regex work.
 */
export const MAX_SPEC_LENGTH = 64

/**
 * Invisible & bidirectional control characters — an attack surface (spoofed
 * text, bidi injection), never legitimate OCR output. Callers check on the raw
 * input and again after NFKC (which leaves these code points unchanged).
 */
export const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u

/**
 * OCR lead-in junk. A leading '.' is meaningful ('.25"' decimal inch) and a
 * leading '-' is a malformed spec, not junk — neither is stripped.
 */
export const LEADING_JUNK_RE = /^[\s"'(){}[\];:，。；：、「『【《]+/u

/**
 * OCR trailing junk. A trailing '"' is the inch mark — never stripped (and a
 * trailing '-' is malformed, not junk).
 */
export const TRAILING_JUNK_RE = /[\s.,;:()[\]】」》』、，。；：]+$/u

/** Depth-arrow variants (↧, ⇩, ⤓, ▼) → '↓'. */
export const DEPTH_ARROW_VARIANTS_RE = /[\u21A7\u21E9\u2913\u25BC]/gu

/** 'THRU' / 'THROUGH' trailing keyword (whitespace optional before it). */
export const THROUGH_RE = /\s*(?:THROUGH|THRU)\s*$/

/** '<depth> DEEP' — bare depth number (whitespace-separated) before the word. */
export const DEEP_RE = /(?:^|\s)(\d+(?:\.\d+)?)\s+DEEP\s*$/

/**
 * Chinese through keyword — '完全贯穿'. Applied before the closed-alphabet
 * guard, so the alphabet itself stays ASCII-only. An enumerated keyword, not
 * a general translation layer: shorter variants ('贯穿', '通孔') stay rejects.
 */
export const CN_THROUGH_RE = /完全贯穿/gu

/**
 * Chinese depth prefix — '深<n>' ('深10' → '↓10'); whitespace between the
 * prefix and the number is tolerated ('深 10').
 */
export const CN_DEEP_RE = /深\s*(\d+(?:\.\d+)?)/gu

/**
 * Explicit parse failure for a descriptive spec string.
 *
 * Carries code `E_THREAD_SPEC` so the statement boundary keeps the code
 * through `toOpFailure` (an `Error` with a string `code` property).
 */
export class ThreadSpecError extends Error {
  /** Stable error code, kept through the statement boundary (`toOpFailure`). */
  readonly code = 'E_THREAD_SPEC'
  constructor(detail: string, help = '') {
    super(`E_THREAD_SPEC: ${detail}${help === '' ? '' : ` ${help}`}`)
    this.name = 'ThreadSpecError'
  }
}
