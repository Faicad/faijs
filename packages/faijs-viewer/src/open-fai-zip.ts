/**
 * `openFaiZip` — the reference API of `@faicad/faijs-viewer`.
 *
 * v1 contract:
 * ```
 * openFaiZip(bytes, { wasm: { occtUrl, manifoldUrl, brepkitUrl } })
 * ```
 *
 * Given a project `.fai.zip` byte buffer and the three engine wasm URLs, this
 * reads the container, resolves the active (or requested) model, executes it
 * through `@faicad/faijs` (`createRuntime` over the container's own module
 * graph), and returns structured, tessellated mesh data plus provenance.
 *
 * The return value is host- and rendering-agnostic: arrays of
 * `Float32Array` / `Uint32Array` mesh data, no THREE or DOM in sight. A
 * render-relevant failure never throws — it is surfaced on `result.error` as a
 * structured `FaiViewerError`. Environment/setup failures (e.g. a missing or
 * empty `wasm` URL) throw a code-bearing error from `installEngine`.
 */

import { createBrowserPorts, createRuntime, isMeshShape } from '@faicad/faijs/browser'
import type { AssetResolver, ExecutionResult } from '@faicad/faijs'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import { mergeSketchNamespace, installSketchSolver, registerSketchSymbols } from '@faicad/faijs-sketch'
import { mergeDrawNamespace, registerDrawSymbols } from '@faicad/faijs-draw'
import { openContainer, type OpenContainerResult } from '@faicad/faijs/io/fai-zip'
import { installEngine } from './engine'
import type { FaiViewerMesh, FaiViewerError, OpenFaiZipOptions, OpenFaiResult, FaiZipViewerErrorCode } from './types'

/** Error codes emitted by this module (a strict subset of the public union). */
type LocalCode = Exclude<FaiZipViewerErrorCode, 'E_WASM_URL'>

function failure(code: LocalCode, message: string, detail?: unknown): FaiViewerError {
  return { code, message, detail }
}

/**
 * Hand the exact typed-array byte range out to the host without sharing the
 * archive page. Mesh arrays are already `Float32Array` / `Uint32Array`; this
 * isolates the backing buffer so the host (and potential transfer) is safe.
 */
function isolateArray<T extends Float32Array | Uint32Array>(array: Float32Array | Uint32Array): T {
  const ctor = array.constructor as new (source: ArrayLike<number>) => T
  return new ctor(array) as T
}

/**
 * Structure the visible terminals of an execution result into a flat mesh
 * list. Mirrors `packages/demo/main.ts#extractShapes`: hidden terminals
 * (boolean sources, etc.) are never counted; when no explicit terminal exists,
 * the last statement output is used.
 */
function extractMeshes(result: ExecutionResult): FaiViewerMesh[] {
  const meshes: FaiViewerMesh[] = []
  const visible = result.terminals.filter((t) => !t.hidden)

  if (visible.length > 0) {
    for (const terminal of visible) {
      const shape = result.outputs.get(terminal.id)
      if (shape && isMeshShape(shape)) {
        meshes.push({
          name: terminal.id,
          positions: isolateArray<Float32Array>(shape.positions),
          indices: isolateArray<Uint32Array>(shape.indices),
        })
      }
    }
    return meshes
  }

  const outputs = Array.from(result.outputs.values())
  const last = outputs[outputs.length - 1] as { positions?: Float32Array; indices?: Uint32Array } | undefined
  if (last && last.positions && last.indices) {
    meshes.push({
      name: 'output',
      positions: isolateArray<Float32Array>(last.positions),
      indices: isolateArray<Uint32Array>(last.indices),
    })
  }
  return meshes
}

/**
 * Build an asset resolver over the container's `assets/` payload map, backing
 * `cad.loadByKey` and the BREP-asset import op with the exact bytes the archive
 * carries. A missing key throws (mirrors `FetchAssetResolver`'s hard error).
 */
function containerAssetResolver(assets: Record<string, Uint8Array>): AssetResolver {
  return {
    async resolveByKey(key: string) {
      const bytes = assets[key]
      if (bytes === undefined) {
        throw new Error(`[faijs-viewer] asset key "${key}" is not present in this .fai.zip`)
      }
      const copy = new Uint8Array(bytes)
      return { bytes: copy.buffer as ArrayBuffer, format: 'brp' }
    },
    async resolveFile(_path: string) {
      throw new Error(
        '[faijs-viewer] resolveFile is unavailable — a .fai.zip is self-contained; load assets by key (`cad.load`) instead.',
      )
    },
    async resolveUrl(url: string) {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`[faijs-viewer] resolveUrl fetch failed: ${url} (${res.status})`)
        return await res.arrayBuffer()
      } catch (e) {
        throw new Error(`[faijs-viewer] resolveUrl failed for ${url}: ${String(e)}`)
      }
    },
  }
}

/** Node runner detection (mirrors core's `hasBrowserWindow`). */
function inNodeEnv(): boolean {
  return typeof window === 'undefined' || typeof window.addEventListener !== 'function'
}

/**
 * Make the `cad.sketch` / `cad.draw` constraint solver available to the
 * shared, module-global sketch op.
 *
 * The solver lives in `@faicad/faijs-sketch` and is host-injected via
 * `installSketchSolver`, because the planegcs wasm source differs between Node
 * and browser hosts. Node auto-loads the solver (its wasm ships in
 * `@salusoft89/planegcs`); a browser host self-hosts `planegcs.wasm` and passes
 * `opts.sketch.planegcsUrl`. The `E_SKETCH_NO_SOLVER` error is surfaced through
 * `OpenFaiResult.error`, never thrown.
 *
 * The Node-only subpath (specified by `NODE_SKETCH_SOLVER_SPECIFIER`) imports
 * `node:module` via `createRequire`, which a browser-targeted bundler cannot
 * shim for a code-splitting worker/chunk. It is therefore never written as a
 * literal in an `import()` here: `/* @vite-ignore *` plus an opaque specifier
 * leaves resolution entirely to the runtime, so Vite/Rollup/webpack never
 * bundle its node:* into a browser build. A Node host resolves it normally; a
 * browser host never reaches that branch.
 */
const NODE_SKETCH_SOLVER_SPECIFIER = '@faicad/faijs-sketch/node'

async function ensureSketchSolver(opts: OpenFaiZipOptions): Promise<void> {
  if (inNodeEnv()) {
    // The /node subpath imports `node:module`, so it must never be statically
    // imported from a browser-targeted entry. Dynamic import keeps the browser
    // bundle free of `node:*`.
    try {
      const nodeSolver = (await import(/* @vite-ignore */ NODE_SKETCH_SOLVER_SPECIFIER)) as {
        createNodePlanegcsSolver: unknown
      }
      installSketchSolver(nodeSolver.createNodePlanegcsSolver as Parameters<typeof installSketchSolver>[0])
    } catch {
      // The solver package is not installed in this process — sketch models
      // will surface E_SKETCHC_NO_SOLVER. Core mesh-only containers are unaffected.
    }
    return
  }
  const planegcsUrl = opts?.sketch?.planegcsUrl
  if (!planegcsUrl) return // browser without a self-hosted solver → E_SKETCHC_NO_SOLVER at execution time
  try {
    const res = await fetch(planegcsUrl)
    if (!res.ok) throw new Error(`planegcs fetch failed: ${planegcsUrl} (${res.status})`)
    const wasmBytes = new Uint8Array(await res.arrayBuffer())
    const { createPlanegcsSolver } = await import('@faicad/faijs-sketch')
    installSketchSolver(async () => createPlanegcsSolver({ wasmBytes }))
  } catch (e) {
    throw new Error(`[faijs-viewer] planegcs solver init failed: ${String(e)}`)
  }
}

/**
 * Open, execute, and tessellate a project `.fai.zip`.
 *
 * @param bytes the container byte array.
 * @param opts the viewer options; `opts.wasm` (three URLs) is required.
 * @returns an `OpenFaiResult` with structured meshes, or an `error`.
 */
export async function openFaiZip(bytes: Uint8Array, opts: OpenFaiZipOptions): Promise<OpenFaiResult> {
  await ensureSketchSolver(opts)
  // 1. Engine contract. The three wasm urls are mandatory; a missing or empty
  //    url throws (E_WASM_URL) — this is a caller contract violation, not a
  //    per-bytes render failure, so it propagates rather than returning an
  //    `error` result. In a browser the URLs bind occt/manifold wasm; in a
  //    Node runner they are validated and local engines auto-load.
  await installEngine(opts.wasm)

  // 2. Reader-side: parse the container (manifest, active model, module graph,
  //    payloads). Hard container errors become an E_CONTAINER result.
  let container: OpenContainerResult
  try {
    container = openContainer(bytes, { modelId: opts?.modelId })
  } catch (e) {
    return { modelId: '', meshes: [], error: failure('E_CONTAINER', (e as Error).message, e) }
  }

  // 3. Host ports: archive asset authorisation + the container module loader.
  //    The loader already enumerates/reads the `model/**` module graph.
  const ports = await createBrowserPorts({
    assets: containerAssetResolver(container.assets),
    projectLoader: container.loader,
  })

  // 4. Assemble a runtime bound to those ports, then execute the active model.
  const runtime = createRuntime(ports, opts?.mode ?? 'auto')
  // Real FreeCAD-converted containers call `cad.sketch` / `cad.draw`, which
  // live in the sketch and draw libraries rather than core. Re-register the
  // default `cad` binding with those merged in so such models execute. The
  // symbol-table entries are also registered so static analysis recognises them.
  registerSketchSymbols()
  registerDrawSymbols()
  runtime.registerLib('cad', mergeDrawNamespace(mergeSketchNamespace(createApiNamespace())), { default: true })
  const entryKey = container.activeModel.entry.slice('model/'.length)
  const entrySource = await container.loader.readSource(entryKey)
  const result = await runtime.execute(entrySource, { entryKey })

  if (result.failedAt) {
    return {
      sourceFile: container.manifest.source?.file,
      modelId: container.activeModel.id,
      meshes: [],
      error: failure(
        'E_EXECUTION',
        `Execution failed at op "${result.failedAt.callee}": ${result.failedAt.message}`,
        result.failedAt,
      ),
    }
  }

  // 5. Structure the visible terminals into host-friendly meshes.
  const meshes = extractMeshes(result)
  if (meshes.length === 0) {
    return {
      sourceFile: container.manifest.source?.file,
      modelId: container.activeModel.id,
      meshes: [],
      error: failure('E_NO_GEOMETRY', 'The model produced no visible, tessellable geometry.'),
    }
  }

  return {
    sourceFile: container.manifest.source?.file,
    modelId: container.activeModel.id,
    meshes,
  }
}