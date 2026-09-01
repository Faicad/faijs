/**
 * L3 bridge — occt-wasm kernel single-instance injection (D10).
 *
 * The ported `kernel/occtWasm` adapter is constructor-injected (DI form, never
 * imports `occt-wasm` itself). This file is the **only** faijs-side place
 * wiring the two together (boundary rule D8/R5: core side may import the
 * vendored tree only from `api/`):
 *
 *   initOcctWasm()  ──same instance──▶  OcctWasmAdapter  ──▶  registerKernel
 *   (faijs existing                (vendored, DI)             (vendored kernel
 *    occt singleton)                                            registry, D10)
 *
 * `occtKernel.getKernel()` returns the faijs singleton `OcctKernel`; building
 * the adapter over that exact instance guarantees the single-instance ban
 * (D10: two wasm instances would put handles in different pointer spaces and
 * silently desync `hasBrep`/`brepOf`/face evolution).
 *
 * See docs/plans/2026-09-01-layered-api-architecture.md §D10 / §D8.
 */

import { getKernel as getFaijsKernel } from '../occt-kernel/occtKernel'
import type { OcctKernelOwner } from '../vendored/brepjs/kernel/occtWasm/occtWasmAdapter.js'
import { OcctWasmAdapter } from '../vendored/brepjs/kernel/occtWasm/occtWasmAdapter.js'
import {
  freezeKernels,
  getActiveKernelId,
  getKernel as getVendoredKernel,
  registerKernel,
} from '../vendored/brepjs/kernel/index.js'
import type { KernelAdapter } from '../vendored/brepjs/kernel/types.js'

let _bound = false

/**
 * Bind the ported kernel registry to the faijs single occt-wasm instance.
 *
 * Idempotent: the first call registers the adapter and freezes the registry
 * (D10 冻结); subsequent calls return the already-bound adapter without
 * re-registering. Call after `initOcctWasm()` has been run (e.g. inside
 * `registerOcctBrepEngine()` host assembly).
 *
 * @returns the registered kernel adapter.
 */
export function bindOcctKernel(): KernelAdapter {
  if (_bound) return getVendoredKernel('occt-wasm')

  const faijsKernel = getFaijsKernel() as unknown as OcctKernelOwner
  const adapter = OcctWasmAdapter.fromKernel(faijsKernel)
  registerKernel('occt-wasm', adapter)
  freezeKernels()
  _bound = true
  return adapter
}

/**
 * Whether the vendored kernel registry has been bound (D10).
 * @returns true once bound to the occt-wasm kernel.
 */
export function isOcctKernelBound(): boolean {
  return _bound && getActiveKernelId() === 'occt-wasm'
}

/**
 * Access the currently bound vendored kernel adapter (reads the registry).
 * @throws If the bridge has not been bound.
 * @returns the vendored occt-wasm kernel adapter.
 */
export function getBrepjsKernel(): KernelAdapter {
  return getVendoredKernel('occt-wasm')
}