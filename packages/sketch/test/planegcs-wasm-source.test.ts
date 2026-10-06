/**
 * planegcs wasm source modes — the three ways a host can hand faijs the binary.
 *
 * `createPlanegcsSolver` takes exactly one source, and the choice is a static
 * fact about the host (no runtime fallback):
 * - `wasmPath` — Node / browser: the module reads a path or fetches a URL;
 * - `wasmBytes` — the host already holds the binary;
 * - `wasmLoaderPath` — the platform can only instantiate from a code-package
 *   path (WeChat mini program: `WXWebAssembly.instantiate(path, imports)`).
 *
 * The `wasmBytes` case is a regression guard: before 2026-09-30 the bytes went
 * into `make_gcs_wrapper()`'s `locateFile`, and the emscripten glue called
 * `.startsWith` on them — `TypeError: b.startsWith is not a function`, i.e. the
 * documented browser path could not instantiate at all.
 *
 * The `wasmLoaderPath` case simulates the mini-program environment (no
 * `WebAssembly` of its own; the only loader takes a code-package path) and — as
 * with the brepkit arc defect — does not stop at "it instantiated": it asserts
 * the solved geometry against the exact values the constraints demand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPlanegcsSolver } from '../src/planegcs-backend.js'
import { createNodePlanegcsSolver, planegcsWasmPath } from '../src/node.js'
import { solveSketch } from '../src/solve.js'
import type { SketchConstraint, SketchGeom } from '../src/canonical.js'
import type { SketchSolver } from '../src/solver.js'

/** Square with H/V + corner coincidences + a length dimension on both pinned edges. */
const GEOMS: SketchGeom[] = [
  { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
  { tag: 'right', kind: 'line', x1: 1, y1: 0, x2: 1, y2: 1 },
  { tag: 'top', kind: 'line', x1: 1, y1: 1, x2: 0, y2: 1 },
  { tag: 'left', kind: 'line', x1: 0, y1: 1, x2: 0, y2: 0 },
]

/**
 * Both edges are dimensioned on purpose: with only `bottom` pinned, the solver's
 * minimal-displacement answer from a 1×1 guess is a 10×1 rectangle — an equally valid
 * solution that would make a "bottom == 10" assertion pass on the wrong geometry.
 */
const CONSTRAINTS: SketchConstraint[] = [
  { kind: 'horizontal', of: { tag: 'bottom' } },
  { kind: 'vertical', of: { tag: 'right' } },
  { kind: 'horizontal', of: { tag: 'top' } },
  { kind: 'vertical', of: { tag: 'left' } },
  { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
  { kind: 'coincident', a: { tag: 'right', at: 'end' }, b: { tag: 'top', at: 'start' } },
  { kind: 'coincident', a: { tag: 'top', at: 'end' }, b: { tag: 'left', at: 'start' } },
  { kind: 'coincident', a: { tag: 'left', at: 'end' }, b: { tag: 'bottom', at: 'start' } },
  { kind: 'length', of: { tag: 'bottom' }, value: 10 },
  { kind: 'length', of: { tag: 'right' }, value: 10 },
]

type Line = { x1: number; y1: number; x2: number; y2: number }

/** Solve the square and assert the geometry the constraints demand. */
async function assertSquareSolved(solver: SketchSolver): Promise<void> {
  const out = await solveSketch(GEOMS, CONSTRAINTS, { solver })
  expect(out.converged, `reason: ${out.reason}`).toBe(true)
  const [bottom, right, top, left] = out.geoms as Line[]
  expect(Math.hypot(bottom!.x2 - bottom!.x1, bottom!.y2 - bottom!.y1)).toBeCloseTo(10, 6)
  expect(Math.hypot(right!.x2 - right!.x1, right!.y2 - right!.y1)).toBeCloseTo(10, 6)
  // Every corner the coincidences name must actually close.
  expect(Math.hypot(bottom!.x2 - right!.x1, bottom!.y2 - right!.y1)).toBeCloseTo(0, 9)
  expect(Math.hypot(right!.x2 - top!.x1, right!.y2 - top!.y1)).toBeCloseTo(0, 9)
  expect(Math.hypot(top!.x2 - left!.x1, top!.y2 - left!.y1)).toBeCloseTo(0, 9)
  expect(Math.hypot(left!.x2 - bottom!.x1, left!.y2 - bottom!.y1)).toBeCloseTo(0, 9)
}

describe('createPlanegcsSolver — wasm source modes', () => {
  it('rejects a missing source and a multi-source call (no implicit precedence)', async () => {
    await expect(createPlanegcsSolver({})).rejects.toThrow(/E_SKETCHC_NO_WASM/)
    await expect(
      createPlanegcsSolver({ wasmPath: planegcsWasmPath(), wasmBytes: new Uint8Array(0) }),
    ).rejects.toThrow(/E_SKETCHC_BAD_WASM/)
    await expect(
      createPlanegcsSolver({ wasmPath: planegcsWasmPath(), wasmLoaderPath: '/wasm/planegcs.wasm.br' }),
    ).rejects.toThrow(/E_SKETCHC_BAD_WASM/)
  })

  it('wasmPath: the module reads the installed binary itself', async () => {
    await assertSquareSolved(await createPlanegcsSolver({ wasmPath: planegcsWasmPath() }))
  })

  it('wasmBytes (Uint8Array): host-held bytes instantiate the module', async () => {
    const bytes = new Uint8Array(readFileSync(planegcsWasmPath()))
    await assertSquareSolved(await createPlanegcsSolver({ wasmBytes: bytes }))
  })

  it('wasmBytes (ArrayBuffer): host-held bytes instantiate the module', async () => {
    const buf = readFileSync(planegcsWasmPath())
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    await assertSquareSolved(await createPlanegcsSolver({ wasmBytes: ab }))
  })
})

/**
 * Mini-program shape: the platform exposes only a code-package loader
 * (`WXWebAssembly.instantiate(path, imports)`), so the host installs a
 * `WebAssembly` adapter whose `instantiate` ignores the bytes it is handed and
 * compiles the package path instead.
 */
describe('createPlanegcsSolver — wasmLoaderPath (mini-program shape)', () => {
  const CODE_PACKAGE_PATH = '/wasm/planegcs.wasm.br'
  const realWebAssembly = globalThis.WebAssembly
  let loadedPaths: string[] = []

  beforeAll(() => {
    loadedPaths = []
    // The adapter only replaces `instantiate`; everything else the platform had
    // (`validate`, `RuntimeError`, …) stays reachable through the prototype.
    globalThis.WebAssembly = Object.assign(Object.create(realWebAssembly ?? null), {
      instantiate: (bytes: BufferSource, imports: WebAssembly.Imports) => {
        void bytes // intentionally dropped: this platform compiles from a code-package path
        loadedPaths.push(CODE_PACKAGE_PATH)
        return realWebAssembly.instantiate(new Uint8Array(readFileSync(planegcsWasmPath())), imports)
      },
      RuntimeError: realWebAssembly?.RuntimeError ?? class PlatformWasmError extends Error {},
    })
  })

  afterAll(() => {
    globalThis.WebAssembly = realWebAssembly
  })

  it('instantiates through the platform loader and solves the square exactly', async () => {
    const solver = await createPlanegcsSolver({ wasmLoaderPath: CODE_PACKAGE_PATH })
    await assertSquareSolved(solver)
    expect(loadedPaths).toEqual([CODE_PACKAGE_PATH])
  })
})

describe('createNodePlanegcsSolver — unchanged Node entry', () => {
  it('resolves the installed wasm and solves', async () => {
    expect(planegcsWasmPath()).toContain(join('planegcs', 'dist', 'planegcs_dist', 'planegcs.wasm'))
    await assertSquareSolved(await createNodePlanegcsSolver())
  })
})
