/**
 * Platform Result face (L3 bridge) — the only legal way for non-`api/` core
 * code to reach the vendored `Result` implementation.
 *
 * D8 (docs/plans/2026-09-01-layered-api-architecture.md) forbids importing the
 * vendored tree from anywhere outside `src/api/`, while `src/fcstd/*` needs
 * `ok` / `err` / `isOk` / `Result`. Routing that need through this projection
 * keeps the bridge explicit instead of reaching into
 * `../vendored/brepjs/core/result.js` directly.
 *
 * Projection only — no reimplementation: the vendored module stays the single
 * source of truth for the Result semantics shared with the compat face.
 */
export * from '../vendored/brepjs/core/result.js'
