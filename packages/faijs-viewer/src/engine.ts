/**
 * Engine (kernel) wiring for the viewer.
 *
 * `@faicad/faijs` executes a `.fai.zip` model through environment-level kernel
 * singletons: the OCCT kernel (BREP chain), the manifold mesh engine, and the
 * secondary brepkit engine. Those singletons are configured through the
 * `setOcctWasmInitFn` / `setManifoldWasmUrl` / `setBrepkitWasmInitFn` hooks
 * exported by core. This module maps the three wasm URLs from the v1 contract
 * onto those hooks.
 *
 * Environment handling:
 * - In a real browser the three URLs are authoritative: each kernel loads its
 *   wasm from the given URL.
 * - In a Node.ts test / local runner the same three URLs are validated (v1
 *   requires them) but the engine falls back to core's node_modules auto-load,
 *   so tests run against real, local wasm without a network fetch.
 *
 * Dual-OCCT-copy note: `occt-wasm`'s opaque instance type is nominal per
 * package install (a `#private` member), so a pristine cross-copy type cannot
 * be expressed. The demo uses `OcctKernel.init({ wasm })` plus a cast to the
 * faijs-expected return shape; the viewer mirrors that established pattern.
 */

import { setOcctWasmInitFn, setManifoldWasmUrl } from '@faicad/faijs/browser'

/** A wasm URL triplet (same shape as the v1 contract). */
export interface ViewerWasmUrls {
  occtUrl: string
  manifoldUrl: string
  brepkitUrl: string
}

/** A code-pinned capability error surfaced by the viewer. */
export interface EngineError {
  code: 'E_WASM_URL'
  message: string
}

function throwEngine(message: string): never {
  const err = new Error(message)
  ;(err as Error & { code: string }).code = 'E_WASM_URL'
  throw err
}

/**
 * Validate the three v1 wasm urls. Throws a code-bearing `E_WASM_URL` error
 * when any is missing or empty, as required by the v1 contract.
 * @param wasm - The three v1 wasm asset URLs ({ occtUrl, manifoldUrl, brepkitUrl }) to validate. type:ViewerWasmUrls required:true
 */
export function assertWasmUrls(wasm: Readonly<ViewerWasmUrls> | undefined): void {
  if (!wasm) {
    throwEngine('openFaiZip requires `wasm` — supply { occtUrl, manifoldUrl, brepkitUrl }.')
  }
  for (const key of ['occtUrl', 'manifoldUrl', 'brepkitUrl'] as const) {
    if (typeof wasm[key] !== 'string' || wasm[key].length === 0) {
      throwEngine(`openFaiZip wasm.${key} must be a non-empty string.`)
    }
  }
}

function hasBrowserWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function'
}

/**
 * Bind the engine kernels for a real browser, installing the occt and manifold
 * init hooks from the configured URLs. `occt-wasm` is loaded lazily so this
 * path only exists in the browser (never forces the dependency at load time in
 * Node tests). brepkit is a secondary engine whose mesh boolean is not yet
 * wired (v1, plan §1.8), so its URL is accepted but not depended on at
 * execution time.
 */
async function bindBrowserWasm(wasm: Readonly<ViewerWasmUrls>): Promise<void> {
  const { OcctKernel } = await import('occt-wasm')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setOcctWasmInitFn((() => OcctKernel.init({ wasm: wasm.occtUrl })) as any)
  setManifoldWasmUrl(wasm.manifoldUrl)
  // brepkit: accepted, not consumed in v1.
  void wasm.brepkitUrl
}

/**
 * Install the engine kernels for an `openFaiZip` view. Safe to call
 * repeatedly — core's kernel singletons are environment-wide and
 * instance-neutral.
 *
 * In a browser the three URLs are registered; in a Node/worker runner the URLs
 * are still validated and the Node engine auto-loads its own local wasm.
 * @param wasm - The three v1 wasm asset URLs; validated here, registered in browsers. type:ViewerWasmUrls required:true
 */
export async function installEngine(wasm: Readonly<ViewerWasmUrls>): Promise<void> {
  assertWasmUrls(wasm)
  if (hasBrowserWindow()) {
    await bindBrowserWasm(wasm)
  }
}