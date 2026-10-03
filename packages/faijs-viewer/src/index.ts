/**
 * `@faicad/faijs-viewer` — the reference way for any third-party host to
 * open and tessellate a project `.fai.zip` document.
 *
 * v1 API:
 * ```
 * import { openFaiZip } from '@faicad/faijs-viewer'
 * const result = await openFaiZip(bytes, {
 *   wasm: { occtUrl, manifoldUrl, brepkitUrl },
 * })
 * // result.meshes === [{ name, positions: Float32Array, indices: Uint32Array }]
 * ```
 *
 * The three wasm URLs are all mandatory: the engine's BREP chain depends on
 * OCCT, its mesh/CSG path depends on manifold, and brepkit is part of the
 * reserved engine surface. In a browser each kernel loads its wasm from the
 * given URL; in a Node/worker runner the same URLs are validated and the local
 * engines auto-load their bundled wasm.
 */

export { openFaiZip } from './open-fai-zip'
export type {
  OpenFaiZipOptions,
  FaiViewerMesh,
  FaiViewerError,
  FaiZipViewerErrorCode,
  OpenFaiResult,
  FaiZipViewerWasmOptions,
} from './types'
export { assertWasmUrls, installEngine } from './engine'
export type { ViewerWasmUrls } from './engine'