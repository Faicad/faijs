/**
 * Bug / panic helper — these throw and should never be caught in normal code.
 *
 * 第一方模块（2026-09-25 core-decouple Phase 1）：复制自 brepjs
 * `src/utils/bug.ts`（同源复制，签名不变；brepjs 包删除后仍由本文件承担）。
 */

/** Error thrown for invariant violations / programmer bugs (should never be caught). */
export class BrepBugError extends Error {
  /** The location (e.g. function name) where the invariant violation occurred. */
  readonly location: string;

  constructor(location: string, message: string) {
    super(`Bug in ${location}: ${message}`);
    this.name = 'BrepBugError';
    this.location = location;
  }
}

/**
 * Throws a BrepBugError for invariant violations / programmer errors.
 * Equivalent to Rust's panic!() — should never be caught in normal code.
 *
 * @param location - Where the violation occurred (e.g. function name).
 * @param message - Description of the violated invariant.
 * @returns Never returns; always throws.
 */
export function bug(location: string, message: string): never {
  throw new BrepBugError(location, message);
}
