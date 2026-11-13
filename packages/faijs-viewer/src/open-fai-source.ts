/**
 * `openFaiSource` — execute a single `.fai.js` script for a third-party host.
 *
 * A `.fai.js` file on disk is not a project container: it has no manifest, no
 * active model id, and its sibling modules / assets live in the host's
 * filesystem. This entry point accepts the source text directly and lets the
 * host supply the file-resolution capabilities that a self-contained
 * `.fai.zip` would otherwise provide through its archive payload.
 *
 * The engine wiring, terminal filtering and mesh structuring are shared with
 * `openFaiZip` (`installEngine`, `createViewerLibLoader`, `ensureSketchSolver`,
 * `extractMeshes`), so both entries expose the same options and the same
 * host-agnostic `OpenFaiResult`.
 */

import { createBrowserPorts, createRuntime } from '@faicad/faijs/browser'
import { installEngine } from './engine'
import { createViewerLibLoader } from './libs'
import { ensureSketchSolver, extractMeshes } from './open-fai-zip'
import type {
  FaiViewerError,
  FaiZipViewerErrorCode,
  OpenFaiResult,
  OpenFaiSourceOptions,
} from './types'

/** Module key used when the host does not name the script. */
const DEFAULT_ENTRY_KEY = 'model.fai.js'

function failure(
  code: Exclude<FaiZipViewerErrorCode, 'E_WASM_URL'>,
  message: string,
  detail?: unknown,
): FaiViewerError {
  return { code, message, detail }
}

/**
 * Execute and tessellate one `.fai.js` script.
 *
 * A missing or empty `wasm` url throws `E_WASM_URL` (a caller contract
 * violation). Render-relevant failures are returned on `result.error`.
 * `result.modelId` is empty: a single script has no container model id.
 *
 * @param source - The `.fai.js` source text to execute. type:string required:true
 * @param opts - Engine urls and optional host file-resolution capabilities. type:OpenFaiSourceOptions required:true
 * @returns The structured meshes, or a structured `error` describing the failure. type:Promise<OpenFaiResult> required:true
 */
export async function openFaiSource(
  source: string,
  opts: OpenFaiSourceOptions,
): Promise<OpenFaiResult> {
  await ensureSketchSolver(opts)
  // The two wasm urls are mandatory. A missing/empty url throws
  // (E_WASM_URL) rather than returning an `error` result.
  await installEngine(opts?.wasm)

  const entryKey = opts?.entryKey || DEFAULT_ENTRY_KEY
  if (typeof source !== 'string' || source.trim().length === 0) {
    return {
      sourceFile: entryKey,
      modelId: '',
      meshes: [],
      error: failure('E_SOURCE', 'openFaiSource requires a non-empty .fai.js source string.'),
    }
  }

  // The container path builds these ports from the archive; here the host
  // supplies them. Omitted capabilities leave the script self-contained.
  const libLoader = await createViewerLibLoader(opts?.libs)
  const ports = await createBrowserPorts({
    ...(opts?.assets ? { assets: opts.assets } : {}),
    ...(opts?.projectLoader ? { projectLoader: opts.projectLoader } : {}),
    ...(libLoader ? { libLoader } : {}),
  })

  const runtime = createRuntime(ports, opts?.mode ?? 'auto')
  const result = await runtime.execute(source, { entryKey })

  if (result.failedAt) {
    return {
      sourceFile: entryKey,
      modelId: '',
      meshes: [],
      error: failure(
        'E_EXECUTION',
        `Execution failed at op "${result.failedAt.callee}": ${result.failedAt.message}`,
        result.failedAt,
      ),
    }
  }

  const meshes = extractMeshes(result)
  if (meshes.length === 0) {
    return {
      sourceFile: entryKey,
      modelId: '',
      meshes: [],
      error: failure('E_NO_GEOMETRY', 'The model produced no visible, tessellable geometry.'),
    }
  }

  return { sourceFile: entryKey, modelId: '', meshes }
}
