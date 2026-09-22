/**
 * admit-compat-lib — registerLib's admission-stage enhancement (B4 fix).
 *
 * Design: docs/plans/2026-09-03-faijs-brepjs-compat-api.md §4.3.3
 *
 * Hard ordering constraint: assertLibConforms runs BEFORE wrapping — DUAL_OP_META
 * hangs on the function object with enumerable:false (define-op.ts) and
 * assertLibConforms iterates values via Object.values to judge metadata; a
 * wrap-first admission would let bare functions silently skip the whole strict
 * validation pass (verified in practice, R8).
 *
 * Multi-output annotation: the only contract name is `fn.outputs` (the
 * `outputs` defineOp option); the legacy name is deleted repo-wide.
 *
 * @module
 */

import { assertLibConforms, DUAL_OP_META } from '../define-op'
import { compatOp } from '../api/internal/compat-op'
import type { Provenance } from '../topology/naming/lineage'

type OutputsCarrier = { outputs?: string[] }

/**
 * Function-level naming annotation (Phase 2.11-①): the only contract name is
 * `fn.naming` (mirrors `fn.outputs`). A library author attaches a `Provenance`
 * to a bare exported function so the lifter records the op's true face-mapping
 * category instead of the blanket `unmodeled` default.
 */
type NamingCarrier = { naming?: Provenance }

/** Library-level naming default (registerLib option; per-function `fn.naming` wins). */
export interface LibNamingOptions {
  /** Default provenance for bare functions that carry no `fn.naming`. */
  naming?: Provenance
}

/** The blanket fallback recorded when neither fn.naming nor library naming exists (Phase 2.11-③ may hard-fail this). */
export const BARE_LIFT_FALLBACK_NAMING: Provenance = {
  kind: 'unmodeled',
  reason: 'admitCompatLib: bare function lift, provenance not declared',
}

/**
 * Establish an admission-stage wrapper namespace for registerLib.
 *
 * Non-functions (contractVersion / resource objects) and native dual-ops
 * (already carrying DUAL_OP_META) pass through just as they are; any bare
 * function is lifted through compatOp so it cannot silently bypass the
 * statement-level boundary contract (B4).
 *
 * Naming declaration precedence (Phase 2.11-①): `fn.naming` (function-level)
 * → `options.naming` (library-level default) → blanket `unmodeled` fallback.
 *
 * @param ns the library namespace object being registered.
 * @param options admission options (library-level naming default).
 * @returns the admitted namespace (bare functions replaced by compatOp facades).
 */
export function admitCompatLib(ns: Record<string, unknown>, options?: LibNamingOptions): Record<string, unknown> {
  assertLibConforms(ns)
  const out: Record<string, unknown> = {}
  for (const [name, v] of Object.entries(ns)) {
    if (typeof v !== 'function') { out[name] = v; continue }
    if ((v as unknown as Record<string, unknown>)[DUAL_OP_META]) { out[name] = v; continue }
    const declared = (v as NamingCarrier).naming ?? options?.naming ?? BARE_LIFT_FALLBACK_NAMING
    out[name] = compatOp(v as (...a: unknown[]) => unknown, {
      name,
      outputs: (v as OutputsCarrier).outputs, // only fn.outputs; no other annotation name is recognized (§3.6)
      naming: declared,
    })
  }
  return out
}