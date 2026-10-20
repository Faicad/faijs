/**
 * solver-loader — planegcs solver loading, aligned with core's wasm pattern.
 *
 * Mirrors `setOcctWasmInitFn` / `initOcctWasm` (occt) and
 * `setBrepkitWasmInitFn` / `initBrepkitWasm` (brepkit):
 *
 * 1. `setSketchSolverInitFn(fn | null)` — host injects a solver factory
 *    (browser/weapp pass a factory that knows the wasm URL).
 * 2. `initSketchSolver()` — internal three-stage init:
 *    ① custom init fn from globalThis shared slot;
 *    ② Node auto: `createNodePlanegcsSolver()` (resolves wasm from node_modules);
 *    ③ throw "no init function set and not in Node environment".
 * 3. globalThis sharing: the factory is stored on `globalThis['__faijs_sketch_solver__']`
 *    so CDN-externalized multi-instance works (same as occt/brepkit).
 *
 * `installSketchSolver` is retained as a deprecated alias of
 * `setSketchSolverInitFn` for one release to avoid breaking too many
 * downstream call sites at once.
 */
import type { SketchSolver } from './solver.js'

/** The globalThis slot key for sharing the solver factory across instances. */
const SOLVER_SHARED_KEY = '__faijs_sketch_solver__'

type SolverFactory = () => Promise<SketchSolver>

interface SketchSolverSharedState {
  customInitFn: SolverFactory | null
}

/** Get or create the globalThis shared state for the sketch solver. */
function getSketchSolverSharedState(): SketchSolverSharedState {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[SOLVER_SHARED_KEY]) {
    g[SOLVER_SHARED_KEY] = { customInitFn: null } satisfies SketchSolverSharedState
  }
  return g[SOLVER_SHARED_KEY] as SketchSolverSharedState
}

/**
 * Inject (or clear, with `null`) the host's planegcs solver factory.
 *
 * Browser/weapp hosts call this once at startup with a factory that resolves
 * the wasm bytes and calls `createPlanegcsSolver({ wasmBytes | wasmLoaderPath })`.
 * Node hosts do NOT need to call this — `initSketchSolver()` auto-resolves
 * the wasm from `@salusoft89/planegcs` in `node_modules`.
 *
 * @param fn - the solver factory, or null to clear.
 */
export function setSketchSolverInitFn(fn: SolverFactory | null): void {
  getSketchSolverSharedState().customInitFn = fn
}

/**
 * Initialize and return the planegcs solver (idempotent — the factory is
 * called once; subsequent calls return the same promise).
 *
 * Three-stage (aligned with occt/brepkit):
 * ① custom init fn (host-injected via `setSketchSolverInitFn`);
 * ② Node auto: `createNodePlanegcsSolver()`;
 * ③ throw "no init function set and not in Node environment".
 *
 * @returns a promise resolving to a `SketchSolver`.
 */
let solverPromise: Promise<SketchSolver> | null = null

/**
 * Initialize the shared sketch solver instance (idempotent).
 *
 * Resolution order:
 * ① custom init function injected by the host;
 * ② Node auto: `createNodePlanegcsSolver()`;
 * ③ throw "no init function set and not in Node environment".
 *
 * @returns a promise resolving to a `SketchSolver`.
 */
export function initSketchSolver(): Promise<SketchSolver> {
  if (solverPromise) return solverPromise

  const shared = getSketchSolverSharedState()

  // ① custom init fn (host-injected)
  if (shared.customInitFn) {
    solverPromise = shared.customInitFn()
    return solverPromise
  }

  // ② Node auto: resolve wasm from node_modules
  if (typeof process !== 'undefined' && process.versions?.node) {
    solverPromise = (async () => {
      // Lazy-fetch node builtins via process.getBuiltinModule (Node >= 20.16), the
      // same pattern as occt-kernel/occtKernel.ts. A static `await import('node:module')`
      // would be statically analyzed by bundlers (vite/esbuild) and fail while bundling
      // this module for a non-Node target (e.g. the weapp mini program), even though
      // this branch never runs there.
      const nodeModule = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.('node:module') as
        | { createRequire: (filename: string) => { resolve: (id: string) => string } }
        | undefined
      const nodePath = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.('node:path') as
        | { dirname: (p: string) => string; join: (...parts: string[]) => string }
        | undefined
      if (!nodeModule || !nodePath) {
        throw new Error('[faijs] sketch solver node auto-init requires Node.js (process.getBuiltinModule)')
      }
      const { createPlanegcsSolver } = await import('./planegcs-backend.js')
      const require = nodeModule.createRequire(import.meta.url)
      const pkgDir = nodePath.dirname(require.resolve('@salusoft89/planegcs/package.json'))
      const wasmPath = nodePath.join(pkgDir, 'dist', 'planegcs_dist', 'planegcs.wasm')
      return createPlanegcsSolver({ wasmPath })
    })()
    return solverPromise
  }

  // ③ not Node and no init fn
  throw new Error(
    'E_SKETCHC_NO_SOLVER: no sketch solver init function set and not in Node environment. ' +
    'Call setSketchSolverInitFn() first.',
  )
}

/** Reset the solver promise (test-only). */
export function _resetSketchSolver(): void {
  solverPromise = null
  getSketchSolverSharedState().customInitFn = null
}
