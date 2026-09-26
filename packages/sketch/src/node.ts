/**
 * @faicad/faijs-sketch/node — Node-only entry.
 *
 * Resolves the planegcs WASM binary from the installed package and hands it to
 * the environment-agnostic solver factory. Browser/worker hosts must not import
 * this subpath — they inject wasm bytes through `HostPorts.assets` and call
 * `createPlanegcsSolver({ wasmBytes })` from the main entry instead.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createPlanegcsSolver } from './planegcs-backend.js'
import type { SketchSolver } from './solver.js'

const require = createRequire(import.meta.url)

let wasmPathCache: string | undefined

/**
 * Resolve the planegcs WASM binary path from the installed package.
 *
 * @returns the absolute path of `planegcs.wasm` inside `@salusoft89/planegcs`.
 */
export function planegcsWasmPath(): string {
  if (!wasmPathCache) {
    const pkgDir = dirname(require.resolve('@salusoft89/planegcs/package.json'))
    wasmPathCache = join(pkgDir, 'dist', 'planegcs_dist', 'planegcs.wasm')
  }
  return wasmPathCache
}

/**
 * Instantiate the planegcs solver using the installed wasm binary.
 *
 * @returns a `SketchSolver` backed by the planegcs WASM module.
 */
export async function createNodePlanegcsSolver(): Promise<SketchSolver> {
  return createPlanegcsSolver({ wasmPath: planegcsWasmPath() })
}