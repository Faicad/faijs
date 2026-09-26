/**
 * solve — `solveSketch`: the canonical-model entry to the planegcs pipeline.
 *
 * Projects canonical geometry/constraints to the FCStd shape the backend
 * consumes, solves, and projects the solved geometry back. Under- and
 * over-constraint are allowed and surface through `SolveOutcome.status` (§5);
 * projection errors (bad ref, unsupported geometry, unmapped constraint) are
 * raised so the caller can surface them explicitly rather than silently.
 */
import { isOk } from '@faicad/faijs/api/result'
import type { SketchConstraint, SketchGeom, SolveOutcome, SolveStatus } from './canonical.js'
import { fromFreeCadGeoms, toFreeCadConstraints, toFreeCadGeoms } from './project.js'
import { createPlanegcsSolver, type PlanegcsSolverOptions } from './planegcs-backend.js'
import type { ExternalFixedSeg, SketchSolver } from './solver.js'

/** Options for {@link solveSketch}. */
export interface SolveSketchOptions extends PlanegcsSolverOptions {
  /** A pre-built solver (avoids re-instantiating the wasm module per call). */
  solver?: SketchSolver
  /** Pre-projected fixed external geometry the constraints may reference. */
  external?: ExternalFixedSeg[]
}

/** Resolve a solver from the options (explicit solver → wasm source → error). */
async function resolveSolver(opts?: SolveSketchOptions): Promise<SketchSolver> {
  if (opts?.solver) return opts.solver
  if (opts?.wasmPath !== undefined || opts?.wasmBytes !== undefined) {
    return createPlanegcsSolver({ wasmPath: opts.wasmPath, wasmBytes: opts.wasmBytes })
  }
  throw new Error('E_SKETCHC_NO_WASM: solveSketch needs opts.solver, opts.wasmPath or opts.wasmBytes')
}

/** Probe the wrapper's remaining-DoF report when the backend exposes one. */
function readDof(solver: SketchSolver): number {
  const probe = (solver as unknown as { getDof?: () => number }).getDof
  if (typeof probe === 'function') {
    try {
      const v = probe.call(solver)
      if (typeof v === 'number' && Number.isFinite(v)) return v
    } catch {
      /* backend does not report DoF */
    }
  }
  return -1
}

/**
 * Solve a canonical sketch.
 *
 * @param geoms - canonical geometry; stored coordinates are the initial guess.
 * @param constraints - canonical constraints (default: none — a declarative sketch).
 * @param opts - solver selection / external geometry.
 * @returns the solved geometry plus explicit diagnostics.
 * @throws SketchProjectionError for bad refs / unsupported geometry / unmapped constraints.
 */
export async function solveSketch(
  geoms: SketchGeom[],
  constraints: SketchConstraint[] = [],
  opts?: SolveSketchOptions,
): Promise<SolveOutcome> {
  const fcstdGeoms = toFreeCadGeoms(geoms)
  const projected = toFreeCadConstraints(constraints, geoms)
  const solver = await resolveSolver(opts)

  const result = await solver.solve(fcstdGeoms, projected.constraints, opts?.external)
  if (!isOk(result)) {
    return {
      geoms, converged: false, status: 'failed', dof: -1,
      problemConstraints: [], droppedConstraints: [], reason: 'solver-error',
    }
  }

  const raw = result.value
  const solvedCanonical = fromFreeCadGeoms(raw.geoms).map((g, i) => {
    const input = geoms[i]
    const tag = input?.tag
    // Preserve the author's arc orientation (ccw) across the solve. The FCStd
    // round-trip only reports a CCW-normalised span (see fromFreeCadGeoms), so a
    // CW arc would otherwise come back as ccw:true and be rebuilt as the long CCW
    // arc through arcToHandles — the A3 regression class. The solver only relocates
    // coordinates; it does not change which arc (CW minor vs CCW) the author intended.
    if (g.kind === 'arc' && input?.kind === 'arc') {
      const withCcw = { ...g, ccw: input.ccw }
      return tag === undefined ? withCcw : { ...withCcw, tag }
    }
    return tag === undefined ? g : { ...g, tag }
  })

  let status: SolveStatus
  let dof: number
  if (raw.converged) {
    dof = readDof(solver)
    if (raw.droppedConstraints.length > 0) {
      status = 'redundant'
    } else if (dof > 0) {
      status = 'underconstrained'
    } else {
      status = 'solved'
    }
  } else {
    dof = -1
    status = raw.reason === 'conflicting' ? 'conflicting'
      : raw.reason === 'redundant' ? 'redundant'
        : 'failed'
  }

  return {
    geoms: solvedCanonical,
    converged: raw.converged,
    status,
    dof,
    problemConstraints: raw.problemConstraints,
    droppedConstraints: raw.droppedConstraints,
    reason: raw.converged ? undefined : raw.reason,
  }
}