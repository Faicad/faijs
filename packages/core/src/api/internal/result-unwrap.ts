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
 * Statement-boundary op failure (D1 unwrap / compat adoption).
 *
 * An `err` Result unwrapped at the statement boundary used to be thrown as a
 * plain `Error`, which `CadRuntime.runWithFailureHandling` (recognizing only
 * `BrepUnsupportedError`/`MeshUnsupportedError` by `instanceof`) re-threw out
 * of `execute()` instead of converting it into `ExecutionResult.failedAt`.
 * This class is the engine-recognizable carrier: defined in this leaf module
 * (zero imports) so both `define-op` and the compat bridge can throw it while
 * CadRuntime can catch it without importing anything heavier.
 *
 * A thrown `Error` that is *not* an `OpError` keeps its old meaning: an
 * unexpected implementation bug that must propagate (Result 体系 — expected
 * failures are `err` values, exceptions are bugs).
 */
export class OpError extends Error {
  /** The op name that produced the failure. */
  readonly op: string
  /** The `BrepError.code`, or `'E_OP_FAILED'` when the library sent none. */
  readonly code: string
  constructor(op: string, code: string, message: string) {
    super(message)
    this.name = 'OpError'
    this.op = op
    this.code = code
  }
}

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
 * Wrap an implementation-thrown exception as an {@link OpError} (statement-
 * level failure carrier). Used by `define-op.ts` `runImpl` so that
 * `CadRuntime.directFailedAtOrThrow` recognizes the error as an op failure
 * (not a bug to re-throw).
 *
 * @param name - the op name.
 * @param err  - the thrown value.
 * @returns an OpError carrying the op context and code.
 */
export function toOpFailure(name: string, err: unknown): OpError {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    const codeStr = typeof code === 'string' ? code : 'E_OP_FAILED'
    return new OpError(name, codeStr, `[faijs/op] ${name}: ${codeStr}: ${err.message}`)
  }
  return new OpError(name, 'E_OP_FAILED', `[faijs/op] ${name}: E_OP_FAILED: ${String(err)}`)
}

/**
 * Statement-boundary unwrap (D1).
 *
 * - a non-Result product → returned untouched (plain-data ops, mesh products);
 * - `ok`  → `.value`;
 * - `err` → throws an {@link OpError} carrying the op name and BrepError code
 *   (the engine converts `OpError` into `ExecutionResult.failedAt`).
 *
 * @param r    - the implementation product.
 * @param name - the op name (error messages).
 * @returns the unwrapped value, or the input when it was not a Result.
 * @throws an {@link OpError} when `r` is an `Err`.
 */
export function unwrapResult(r: unknown, name: string): unknown {
  if (!isResultLike(r)) return r
  if (r.ok) return r.value
  const e = (r.error ?? {}) as { code?: string; message?: string }
  const code = e.code ?? 'E_OP_FAILED'
  throw new OpError(
    name,
    code,
    `[faijs/compat] ${name}: ${code}: ${e.message ?? 'operation failed'}`,
  )
}
