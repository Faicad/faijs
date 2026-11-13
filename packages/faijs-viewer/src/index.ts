/**
 * `@faicad/faijs-viewer` — the reference way for any third-party host to
 * open and tessellate a project `.fai.zip` document.
 *
 * v1 API:
 * ```
 * import { openFaiZip, openFaiSource } from '@faicad/faijs-viewer'
 * const result = await openFaiZip(bytes, {
 *   wasm: { occtUrl, manifoldUrl },
 * })
 * const fromScript = await openFaiSource(sourceText, {
 *   wasm: { occtUrl, manifoldUrl },
 * })
 * // result.meshes === [{ name, positions: Float32Array, indices: Uint32Array }]
 * ```
 *
 * The two wasm URLs are both mandatory: the engine's BREP chain depends on
 * OCCT and its mesh/CSG path depends on manifold. brepkit is not part of the
 * viewer surface — hosts must not ship or fetch a brepkit wasm. In a browser
 * each kernel loads its wasm from the given URL; in a Node/worker runner the
 * same URLs are validated and the local engines auto-load their bundled wasm.
 */

export { openFaiZip } from './open-fai-zip'
export { openFaiSource } from './open-fai-source'
export type {
  OpenFaiZipOptions,
  OpenFaiSourceOptions,
  FaiViewerMesh,
  FaiViewerError,
  FaiZipViewerErrorCode,
  OpenFaiResult,
  FaiZipViewerWasmOptions,
} from './types'
export { assertWasmUrls, installEngine } from './engine'
export type { ViewerWasmUrls } from './engine'