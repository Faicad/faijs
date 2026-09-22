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

/**
 * Phase 2.11-③（D11 裁决）：blanket 默认已废除。裸函数既无 `fn.naming` 也无库级
 * `options.naming` 时**硬失败**——「能力缺口的正解是补能力或报错，不是加旁路开关」
 * （项目红线）。曾经这里硬编码一条 `unmodeled: 'bare function lift, provenance
 * not declared'` 兜底，正是 D11 否决的那个旁路；三库显式声明（2.11-②）落地后，
 * 它没有存在的理由。
 */

/**
 * Establish an admission-stage wrapper namespace for registerLib.
 *
 * Non-functions (contractVersion / resource objects) and native dual-ops
 * (already carrying DUAL_OP_META) pass through just as they are; any bare
 * function is lifted through compatOp so it cannot silently bypass the
 * statement-level boundary contract (B4).
 *
 * Naming declaration precedence (Phase 2.11-①/③): `fn.naming` (function-level)
 * → `options.naming` (library-level default) → **hard fail** (no default value).
 *
 * @param ns the library namespace object being registered.
 * @param options admission options (library-level naming default).
 * @returns the admitted namespace (bare functions replaced by compatOp facades).
 * @throws Error when a bare function has neither `fn.naming` nor a library-level default.
 */
export function admitCompatLib(ns: Record<string, unknown>, options?: LibNamingOptions): Record<string, unknown> {
  assertLibConforms(ns)
  const out: Record<string, unknown> = {}
  for (const [name, v] of Object.entries(ns)) {
    if (typeof v !== 'function') { out[name] = v; continue }
    if ((v as unknown as Record<string, unknown>)[DUAL_OP_META]) { out[name] = v; continue }
    const declared = (v as NamingCarrier).naming ?? options?.naming
    if (!declared) {
      throw new Error(
        `[faijs] lib function '${name}' is a bare function with no naming declaration. ` +
        `Attach fn.naming (Provenance) to the function, or pass registerLib(..., { naming }) / ` +
        `declare "faijs": { "naming": { "kind": "unmodeled", "reason": "..." } } in package.json. ` +
        `Undeclared provenance is a hard error (Phase 2.11-③ / plan D11): no blanket default exists.`,
      )
    }
    out[name] = compatOp(v as (...a: unknown[]) => unknown, {
      name,
      outputs: (v as OutputsCarrier).outputs, // only fn.outputs; no other annotation name is recognized (§3.6)
      naming: declared,
    })
  }
  return out
}