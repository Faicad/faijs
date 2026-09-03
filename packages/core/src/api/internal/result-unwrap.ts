/**
 * result-unwrap — the single Result→throw bridge shared by every faijs
 * statement boundary (D1).
 *
 * Design: docs/plans/2026-09-03-faijs-brepjs-compat-api.md §5.1 / §5.2
 *
 * Three-layer error semantics (§5.1):
 *   library internals / TS compat face → `Result<T>` native (BrepError)
 *   statement boundary                 → `err` unwrapped into a throw
 *   faijs-specific op impls            → may return `Result`; same unwrap
 *
 * This module is a **leaf**: it imports nothing, so both the SDK layer
 * (`src/define-op.ts`, whose `dist/sdk.js` must stay free of heavy static
 * imports) and the compat bridge (`api/internal/compat-op.ts`) can share one
 * implementation. Having two copies would let the two boundaries drift.
 *
 * @module
 */

/** Structural shape of the vendored `Ok`/`Err` records (`vendored/brepjs/core/result.ts:12-21`). */
export type ResultLike =
  | { ok: true; value: unknown }
  | { ok: false; error: { code?: string; message?: string } }

/**
 * Structural test for a Result value.
 *
 * Only the `ok: boolean` discriminant is checked — the vendored `Result` is a
 * plain record, so no `instanceof` and no import is needed (which is what keeps
 * this module a leaf).
 *
 * @param v - the candidate value.
 * @returns true when `v` looks like an Ok/Err record.
 */
export function isResultLike(v: unknown): v is ResultLike {
  return typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean'
}

/**
 * Render an error thrown by (or returned from) an implementation as a
 * statement-level failure.
 *
 * The op name and the `BrepError.code` (when present) are always kept so the
 * engine's statement-level catch reports the same shape the plan's trace A/B
 * describe (`[faijs/compat] <op>: <CODE>: <message>`).
 *
 * @param name - the op name.
 * @param err  - the thrown value (Error or anything else).
 * @returns an Error carrying the op context.
 */
export function toOpError(name: string, err: unknown): Error {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    const prefix = `[faijs/op] ${name}: ${typeof code === 'string' ? code + ': ' : ''}`
    return new Error(prefix + err.message)
  }
  return new Error(`[faijs/op] ${name}: E_OP_FAILED: ${String(err)}`)
}

/**
 * Statement-boundary unwrap (D1).
 *
 * - a non-Result product → returned untouched (plain-data ops, mesh products);
 * - `ok`  → `.value`;
 * - `err` → throws an execution error carrying the op name and BrepError code.
 *
 * The engine's existing statement-level catch turns that throw into
 * `ExecutionResult.errors`; no new mechanism is introduced.
 *
 * @param r    - the implementation product.
 * @param name - the op name (error messages).
 * @returns the unwrapped value, or the input when it was not a Result.
 * @throws when `r` is an `Err`.
 */
export function unwrapResult(r: unknown, name: string): unknown {
  if (!isResultLike(r)) return r
  if (r.ok) return r.value
  const e = (r.error ?? {}) as { code?: string; message?: string }
  throw new Error(
    `[faijs/compat] ${name}: ${e.code ?? 'E_OP_FAILED'}: ${e.message ?? 'operation failed'}`,
  )
}
