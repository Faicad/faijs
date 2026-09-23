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
 * Naming (2026-09-23): library authors no longer declare face naming
 * (`faijs.naming` / `fn.naming` / `namingFor` removed). A library is a black-box
 * part producer — its functions output parts, not single-op geometry, so no
 * per-function or per-library naming declaration can carry information
 * (design: docs/plans/2026-09-23-relax-lib-naming-design.md). Every bare
 * function is admitted with the fixed default `unmodeled` provenance: its
 * faces carry no stable identity and face references degrade to geometric
 * matching. Op-level naming (defineOp's `DUAL_OP_META.naming` / roleTable)
 * remains the only place where face naming is declared.
 *
 * @module
 */

import { assertLibConforms, DUAL_OP_META } from '../define-op'
import { compatOp } from '../api/internal/compat-op'
import type { Provenance } from '../topology/naming/lineage'

type OutputsCarrier = { outputs?: string[] }

/**
 * Default provenance for every bare library function (2026-09-23).
 *
 * Library functions are black-box part producers: no per-function or
 * per-library naming declaration exists (see file header). Faces of library
 * output get no stable identity — face references degrade to geometric
 * matching. The `default:` reason prefix distinguishes this implicit category
 * from a library author's explicit unmodeled accounting.
 */
const BARE_LIFT_DEFAULT_NAMING: Provenance = {
  kind: 'unmodeled',
  reason: 'default: bare library function lift — library parts have no op-level face naming',
}

/**
 * Establish an admission-stage wrapper namespace for registerLib.
 *
 * Non-functions (contractVersion / resource objects) and native dual-ops
 * (already carrying DUAL_OP_META) pass through just as they are; any bare
 * function is lifted through compatOp so it cannot silently bypass the
 * statement-level boundary contract (B4).
 *
 * Every bare function is admitted with `BARE_LIFT_DEFAULT_NAMING`
 * (unmodeled); no naming declaration is read or required (2026-09-23).
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
      outputs: (v as OutputsCarrier).outputs, // only fn.outputs; no other annotation name is recognized (§3.6)
      naming: BARE_LIFT_DEFAULT_NAMING,
    })
  }
  return out
}
