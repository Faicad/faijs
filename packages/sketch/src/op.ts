/**
 * op — the `cad.sketch` script-face op (sketch geometry + constraints → face).
 *
 * This op is provided by the sketch library, not core: a host merges it into
 * the `cad` namespace (see `./namespace`) only when it wants sketch support.
 * The planegcs solver is host-injected (`installSketchSolver`) because the wasm
 * source differs between Node and browser hosts — the library itself never
 * imports `node:*`.
 */
import { defineOp } from '@faicad/faijs/sdk'
import type { Provenance } from '@faicad/faijs/topology/naming'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { SketchConstraint, SketchGeom, SolveOutcome } from './canonical.js'
import { sketchFaces } from './faces.js'
import type { SketchSolver } from './solver.js'

/** The op name `cad.sketch`. */
export const SKETCH_OP_NAME = 'sketch' as const

let solverFactory: (() => Promise<SketchSolver>) | undefined
let diagnosticSink: ((outcome: SolveOutcome) => void) | undefined

/**
 * Install the host's planegcs solver factory.
 *
 * Node hosts pass `createNodePlanegcsSolver` from `@faicad/faijs-sketch/node`;
 * browser hosts pass a factory that resolves the wasm bytes through
 * `HostPorts.assets` and calls `createPlanegcsSolver({ wasmBytes })`.
 *
 * @param factory - async factory returning a `SketchSolver`.
 */
export function installSketchSolver(factory: () => Promise<SketchSolver>): void {
  solverFactory = factory
}

/** Undo {@link installSketchSolver}. */
export function uninstallSketchSolver(): void {
  solverFactory = undefined
}

/**
 * Install a diagnostics sink for non-`solved` outcomes (§5: allow ≠ silent).
 *
 * Hosts bridge this to their `HostPorts.events` sink / UI. Under-, redundant-
 * and conflicting-constraint sketches still produce geometry, but the
 * diagnostic must reach the host.
 *
 * @param sink - receives every non-`solved` solve outcome; `null` clears it.
 */
export function setSketchDiagnosticSink(sink: ((outcome: SolveOutcome) => void) | null): void {
  diagnosticSink = sink ?? undefined
}

/** `cad.sketch` parameters. */
export interface SketchParams {
  geoms: SketchGeom[]
  /** Optional — a constraint-free sketch is equivalent to `cad.profile` usage. */
  constraints?: SketchConstraint[]
  /** Product form: `'face'` (default) or `'wire'` (outer wire for sweep spines). */
  as?: 'face' | 'wire'
}

/**
 * Validate `cad.sketch` parameters: `geoms` must be a non-empty array and
 * `constraints`, when present, an array.
 *
 * @param params - the raw sketch operation parameters.
 */
export function assertSketchParams(params: Record<string, unknown>): void {
  const geoms = params.geoms
  if (!Array.isArray(geoms) || geoms.length === 0) {
    throw new Error('E_SKETCHC_NO_GEOMS: sketch requires at least one geometry')
  }
  if (params.constraints !== undefined && !Array.isArray(params.constraints)) {
    throw new Error('E_SKETCHC_BAD_CONSTRAINTS: constraints must be an array')
  }
}

async function resolveSolver(): Promise<SketchSolver> {
  if (!solverFactory) {
    throw new Error('E_SKETCHC_NO_SOLVER: no sketch solver installed (call installSketchSolver)')
  }
  return solverFactory()
}

/**
 * Sketch (geometry + constraints) → solve → face / outer wire.
 *
 * Permanently brep-only (D5, 2026-09-27): the mesh path reports
 * `E_MESH_UNSUPPORTED`. Sketch APIs never get a mesh path — industry
 * precedent (CadQuery, FreeCAD) solves sketches onto exact BREP edges.
 *
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name sketch
 * @returns Shape 平面几何（求解后构面）；`as:'wire'` 时返回外环 1D 曲线。
 * @param params.geoms - 草图几何（线段/圆/圆弧）。type:SketchGeom[] required:true
 * @param params.constraints - 草图约束（可空）。type:SketchConstraint[] required:false
 * @param params.as - 产物形态：'face'（默认）构面；'wire' 只交外环 wire。type:'face'|'wire' required:false
 * @example
 * const f = cad.sketch({
 *   geoms: [{ tag:'bottom', kind:'line', x1:0, y1:0, x2:80, y2:3 }],
 *   constraints: [{ kind:'horizontal', of: { tag:'bottom' } }, { kind:'length', of: { tag:'bottom' }, value: 80 }],
 * })
 */
export const sketch = defineOp({
  name: SKETCH_OP_NAME,
  capabilities: ['directEdit'],
  async brep(params: Record<string, unknown>): Promise<Shape> {
    assertSketchParams(params)
    const solver = await resolveSolver()
    const p = params as unknown as SketchParams
    return sketchFaces(p.geoms, p.constraints ?? [], {
      solver,
      as: p.as,
      onDiagnostic: (outcome) => {
        if (outcome.status !== 'solved') diagnosticSink?.(outcome)
      },
    })
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,
})