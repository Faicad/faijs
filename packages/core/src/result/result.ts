/**
 * Rust-inspired Result<T, E> type for explicit error handling.
 *
 * 第一方模块（2026-09-25 core-decouple Phase 1）：复制自 brepjs
 * `src/core/result.ts`（同源复制，签名不变）；import 来源改为 core 第一方
 * `result/` 内模块。Zero internal imports beyond errors — pure foundation module.
 */

import type { BrepError } from './errors';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** The Ok variant of a Result, holding a success value. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** The Err variant of a Result, holding an error value. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Discriminated union of {@link Ok} and {@link Err} for explicit error handling. */
export type Result<T, E = BrepError> = Ok<T> | Err<E>;

/** Type used for Results that carry no value. */
export type Unit = undefined;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Wrap a success value in an Ok Result.
 *
 * @param value - The success value to wrap.
 * @returns An Ok Result containing the value.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wrap an error value in an Err Result.
 *
 * @param error - The error value to wrap.
 * @returns An Err Result containing the error.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Singleton Ok Result carrying no value. */
export const OK: Ok<Unit> = ok(undefined);

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Type guard: check whether a Result is Ok.
 *
 * @param result - The Result to check.
 * @returns True if the Result is Ok.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Type guard: check whether a Result is Err.
 *
 * @param result - The Result to check.
 * @returns True if the Result is Err.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/** Transform the Ok value of a Result, leaving Err unchanged.
 *
 * @param result - The Result to transform.
 * @param fn - Function applied to the Ok value.
 * @returns A Result with the transformed value, or the original error.
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) return ok(fn(result.value));
  return result;
}

/** Transform the Err value of a Result, leaving Ok unchanged.
 *
 * @param result - The Result to transform.
 * @param fn - Function applied to the error value.
 * @returns A Result with the transformed error, or the original value.
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (result.ok) return result;
  return err(fn(result.error));
}

/** Chain a Result-returning function onto an Ok value.
 *
 * @param result - The Result to chain from.
 * @param fn - Function applied to the Ok value, returning a new Result.
 * @returns The chained Result, or the original error.
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (result.ok) return fn(result.value);
  return result;
}

/** Alias for andThen */
export const flatMap = andThen;

/** Return `a` if Ok, otherwise return `b`.
 *
 * @param a - The first Result.
 * @param b - The fallback Result used when `a` is Err.
 * @returns `a` if Ok, otherwise `b`.
 */
export function or<T, E, F>(a: Result<T, E>, b: Result<T, F>): Result<T, F> {
  if (a.ok) return a;
  return b;
}

/** Return `result` if Ok, otherwise call `fn` with the error and return its result.
 *
 * @param result - The Result to start from.
 * @param fn - Recovery function receiving the error.
 * @returns The original Result if Ok, otherwise the recovery Result.
 */
export function orElse<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => Result<T, F>
): Result<T, F> {
  if (result.ok) return result;
  return fn(result.error);
}

/** Combine two independent Results into a Result of a tuple.
 *
 * @param a - The first Result.
 * @param b - The second Result.
 * @returns Ok of the value tuple, or the first Err encountered.
 */
export function zip<A, B, E>(a: Result<A, E>, b: Result<B, E>): Result<[A, B], E> {
  if (!a.ok) return a;
  if (!b.ok) return b;
  return ok([a.value, b.value]);
}

/** Collect an array of Results into a Result of an array. Alias for {@link collect}. */
export const all = collect;

/** Run a side-effect on an Ok value without transforming the result.
 *
 * @param result - The Result to tap.
 * @param fn - Side-effect function called with the Ok value.
 * @returns The original Result, unchanged.
 */
export function tap<T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E> {
  if (result.ok) fn(result.value);
  return result;
}

/** Run a side-effect on an Err value without transforming the result.
 *
 * @param result - The Result to tap.
 * @param fn - Side-effect function called with the error value.
 * @returns The original Result, unchanged.
 */
export function tapErr<T, E>(result: Result<T, E>, fn: (error: E) => void): Result<T, E> {
  if (!result.ok) fn(result.error);
  return result;
}

/** Flatten a nested Result<Result<T, E>, E> into Result<T, E>.
 *
 * @param result - The nested Result to flatten.
 * @returns The inner Result if Ok, otherwise the outer error.
 */
export function flatten<T, E>(result: Result<Result<T, E>, E>): Result<T, E> {
  return result.ok ? result.value : result;
}

/** Map both Ok and Err variants in a single pass.
 *
 * @param result - The Result to transform.
 * @param okFn - Function applied to the Ok value.
 * @param errFn - Function applied to the error value.
 * @returns A Result with both variants transformed.
 */
export function mapBoth<T, U, E, F>(
  result: Result<T, E>,
  okFn: (value: T) => U,
  errFn: (error: E) => F
): Result<U, F> {
  return result.ok ? ok(okFn(result.value)) : err(errFn(result.error));
}

/** Convert a nullable value to a Result, using `errorFn` to produce the error for null/undefined.
 *
 * @param value - The value to wrap; may be null or undefined.
 * @param errorFn - Factory producing the error for null/undefined input.
 * @returns Ok containing the value, or Err from `errorFn`.
 */
export function fromNullable<T, E>(value: T | null | undefined, errorFn: () => E): Result<T, E> {
  if (value === null || value === undefined) return err(errorFn());
  return ok(value);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Format an error for display, handling BrepError objects specially */
function formatError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    'code' in error &&
    'message' in error
  ) {
    // BrepError-like object
    const e = error as { kind: string; code: string; message: string };
    return `[${e.kind}] ${e.code}: ${e.message}`;
  }
  return String(error);
}

/** Extract the Ok value, throwing if the Result is Err.
 *
 * @param result - The Result to unwrap.
 * @returns The Ok value.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`Called unwrap() on an Err: ${formatError(result.error)}`);
}

/** Extract the Ok value, returning a default if the Result is Err.
 *
 * @param result - The Result to unwrap.
 * @param defaultValue - Value returned when the Result is Err.
 * @returns The Ok value, or the default.
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) return result.value;
  return defaultValue;
}

/** Extract the Ok value, computing a fallback from the error if the Result is Err.
 *
 * @param result - The Result to unwrap.
 * @param fn - Function producing a fallback value from the error.
 * @returns The Ok value, or the fallback.
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  if (result.ok) return result.value;
  return fn(result.error);
}

/** Extract the Err value, throwing if the Result is Ok.
 *
 * @param result - The Result to unwrap.
 * @returns The error value.
 */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (!result.ok) return result.error;
  throw new Error(`Called unwrapErr() on an Ok: ${String(result.value)}`);
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/** Pattern-match a Result, applying the ok or err handler.
 *
 * @param result - The Result to match on.
 * @param handlers - Object with `ok` and `err` handler functions.
 * @returns The value produced by the matching handler.
 */
export function match<T, E, U>(
  result: Result<T, E>,
  handlers: { ok: (value: T) => U; err: (error: E) => U }
): U {
  if (result.ok) return handlers.ok(result.value);
  return handlers.err(result.error);
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Collects an array of Results into a Result of an array.
 * Short-circuits on the first Err.
 *
 * @param results - The array of Results to collect.
 * @returns Ok of all values, or the first Err.
 */
export function collect<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

// ---------------------------------------------------------------------------
// Try-catch boundary
// ---------------------------------------------------------------------------

/**
 * Wraps a throwing function into a Result.
 * The mapError function converts the caught exception into the error type.
 *
 * @param fn - The function to execute.
 * @param mapError - Converts a caught exception into the error type.
 * @returns Ok of the result, or Err of the mapped exception.
 */
export function tryCatch<T, E>(fn: () => T, mapError: (error: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (e: unknown) {
    return err(mapError(e));
  }
}

/**
 * Wraps an async throwing function into a Result.
 * The mapError function converts the caught exception into the error type.
 *
 * @param fn - The async function to execute.
 * @param mapError - Converts a caught exception into the error type.
 * @returns A promise resolving to Ok of the result, or Err of the mapped exception.
 */
export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  mapError: (error: unknown) => E
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e: unknown) {
    return err(mapError(e));
  }
}

// ---------------------------------------------------------------------------
// Pipeline combinator
// ---------------------------------------------------------------------------

/** A chainable pipeline that short-circuits on the first Err. */
export interface ResultPipeline<T, E> {
  /** Chain a Result-returning transform. Short-circuits on Err. */
  then<U>(fn: (value: T) => Result<U, E>): ResultPipeline<U, E>;
  /** Extract the final Result. */
  readonly result: Result<T, E>;
}

/**
 * Create a chainable pipeline from a value or Result.
 *
 * ```ts
 * pipeline(shape)
 *   .then(s => filletShape(s, edges, 2))
 *   .then(s => shellShape(s, [topFace], 1))
 *   .result  // → Result<Shape3D>
 * ```
 *
 * @param input - A plain value or a Result to start the pipeline from.
 * @returns A chainable pipeline wrapping the input.
 */
export function pipeline<T, E = BrepError>(input: T | Result<T, E>): ResultPipeline<T, E> {
  // Detect Result objects by checking the 'ok' discriminant is a boolean
  function isResult(v: unknown): v is Result<T, E> {
    return (
      typeof v === 'object' &&
      v !== null &&
      'ok' in v &&
      typeof (v as Record<string, unknown>)['ok'] === 'boolean'
    );
  }

  const initial: Result<T, E> = isResult(input) ? input : ok(input);

  function makePipeline<U>(current: Result<U, E>): ResultPipeline<U, E> {
    return {
      then<V>(fn: (value: U) => Result<V, E>): ResultPipeline<V, E> {
        if (!current.ok) return makePipeline(current as Result<V, E>);
        return makePipeline(fn(current.value));
      },
      get result(): Result<U, E> {
        return current;
      },
    };
  }

  return makePipeline(initial);
}
