/**
 * compat-projection — the single BREP-TS projection wrapper factory (P23, §4.2).
 *
 * Design: docs/plans/2026-09-03-faijs-brepjs-compat-api.md §4.2 / §4.3.2
 *
 * Every symbol on the TS compat face and every generated `compatOp` op funnels
 * through {@link projectBrepOp}. That is what makes the generated face and the
 * hand-curated `api/brepjs-compat` face one mechanism rather than two:
 *
 *   1. single-kernel assert (D10) — library code never installs a kernel;
 *   2. D11 dual-form normalization — object form → positional form, in the
 *      exported function (§4.2 「归一化位置」), not in a script-side adapter;
 *   3. the vendored call itself, through `callBrepjs` (Result shape preserved).
 *
 * P21's `api/brepjs-compat` used a private copy of steps 1–3 (`wrapDual`); P23 lifts it
 * here so `gen-l3-surface.ts` can emit one `compatOp(projectBrepOp(…), …)` line
 * per symbol instead of re-expanding the template for each op.
 *
 * @module
 */

import { resolveArgs, type FormClass } from './dual-form-args'
import { callBrepjs } from './l3-bridge'
import { isOcctKernelBound } from '../occt-kernel-bridge'
import { getBackends } from '../../runtime-state'

/**
 * Assert that a BREP kernel is bound before invoking a compat op.
 *
 * Reads the configured backend's kernel slot, guarding against the throw that
 * `getBackends()` performs before host configuration. Falls back to the
 * occt-kernel binding flag when nothing is configured.
 *
 * @param name - op name, used in the guiding error message.
 * @throws when no BREP kernel is bound (the message tells the host what to do,
 * because library code must never install a kernel itself — §4.2 rule 1).
 */
export function assertKernelBound(name: string): void {
  let kernelBound = false
  try {
    kernelBound = getBackends().kernel.brep != null
  } catch {
    // backends not configured yet — that is not an error, just no kernel
  }
  if (!kernelBound && !isOcctKernelBound()) {
    throw new Error(
      `[compat:${name}] no BREP kernel bound; run host init/bind (e.g. initOcct + bindOcctKernel) ` +
        `before the first compat.${name} call. Library code must not install kernels itself.`
    )
  }
}

/** Signature of a projected compat op (inputs normalized before the call). */
export type CompatProjection = (...args: unknown[]) => unknown

/**
 * Project a vendored brepjs function onto the faijs TS compat face.
 *
 * The returned function is brepjs-shaped: positional arguments in, `Result`
 * (or whatever the vendored function returns) out — no faijs `Shape`, no
 * adoption. Adoption and the statement-boundary unwrap are `compatOp`'s job
 * (§4.3.2 steps 4/5), which is why the script face can wrap the very same
 * projection the TS face exports.
 *
 * @param name      - op name (error messages + D11 discriminant context).
 * @param params    - machine parameter-name table (object form → positional).
 * @param formClass - D11 form class (A single-name dual-form / B1 options-only /
 *                    B2 two names).
 * @param impl      - the vendored function.
 * @returns the projected compat op.
 */
export function projectBrepOp(
  name: string,
  params: string[],
  formClass: FormClass,
  impl: (...args: never[]) => unknown,
): CompatProjection {
  return (...args: unknown[]) => {
    assertKernelBound(name)
    const positional = resolveArgs(args, { name, params, formClass })
    return callBrepjs(impl, positional)
  }
}
