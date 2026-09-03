/**
 * admit-compat-lib — registerLib's admission-stage enhancement (B4 fix).
 *
 * Design: docs/plans/2026-09-03-faijs-brepjs-compat-api.md §4.3.3
 *
 * Hard ordering constraint: assertLibConforms runs BEFORE wrapping — DUAL_OP_MEta
 * hangs on the function object with enumerable:false (define-op.ts:221) and
 * assertLibConforms iterates values via Object.values to judge metadata; a
 * wrap-first admission would let bare functions silently skip the whole strict
 * validation pass (verified in practice, R8).
 *
 * @module
 */

import { assertLibConforms, DUAL_OP_META } from '../define-op'
import { compatOp } from '../api/internal/compat-op'

type GeometryFieldsCarrier = { geometryFields?: string[] }

/**
 * Establish an admission-stage wrapper namespace for registerLib.
 *
 * Non-functions (contractVersion / resource objects) and native dual-ops
 * (already carrying DUAL_OP_META) pass through just as they are; any bare
 * function is lifted through compatOp so it cannot silently bypass the
 * statement-level boundary contract (B4).
 *
 * @param ns the library namespace object being registered.
 * @returns the admitted namespace (bare functions replaced by compatOp facades).
 */
export function admitCompatLib(ns: Record<string, unknown>): Record<string, unknown> {
  assertLibConforms(ns)
  const out: Record<string, unknown> = {}
  for (const [name, v] of Object.entries(ns)) {
    if (typeof v !== 'function') { out[name] = v; continue }
    if ((v as unknown as Record<string, unknown>)[DUAL_OP_META]) { out[name] = v; continue }
    out[name] = compatOp(v as (...a: unknown[]) => unknown, {
      name,
      geometryFields: (v as GeometryFieldsCarrier).geometryFields,
    })
  }
  return out
}