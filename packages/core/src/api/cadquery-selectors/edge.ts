/**
 * cadquery-selectors/edge — CadQuery edge/vertex 选择器（hoild core 引擎 adapter）
 *
 * These are thin projections over the selector engine (plan §4.6). The heavy
 * lifting (direction rules, Nth clustering, set algebra, type filtering) lives
 * in `resolve.ts`; this file only bridges a faijs `Shape` into the engine's
 * kernel-handle space and adapts the result back to the cq-compat-consumed
 * `unknown[]` handle form.
 *
 * The legacy bbox-heuristic implementations (edn.g. `#Z` interpreted as "max
 * along axis", `|Z` from relative extents) were removed in favour of the
 * upstream `cadquery/selectors.py` semantics validated by
 * `selectors.test.ts`.
 */
import { resolveSelection, resolveStepHandles } from './resolve'
import { brepOf } from '../../shape'
import type { Shape } from '../../mesh/types'

/** faijs BREP handle for a shape (numeric id space shared with occt-wasm). */
function ownerHandle(shape: Shape): unknown {
  return brepOf(shape) as unknown
}

/**
 * Resolve a CadQuery EDGE selector string to concrete edge handles, using ONLY
 * the new selector engine (upstream `selectors.py` semantics):
 *
 *   · `|Z` — ParallelDirSelector (edges whose tangent is parallel to the axis)
 *   · `#Z` — PerpendicularDirSelector (edges whose tangent is perpendicular)
 *   · `X` / `+X` / `-X` — DirectionSelector (signed tangent angle≈0)
 *   · `>Z` / `<Z` — DirectionMinMaxSelector (extremal edge center along axis)
 *   · `%LINE` / `%CIRCLE` — TypeSelector
 *   · `and` / `or` / `except` / `not` — set algebra
 *   · empty / missing — all edges (CadQuery `.edges()`)
 *
 * @param shape - Shape whose BREP edges are enumerated for selection.
 * @param sel - CadQuery edge selector, or empty/null/undefined for all edges.
 * @returns the matched edge handles (kernel identity space; cast to unknown).
 */
export function resolveEdgeSelection(shape: Shape, sel: string | null | undefined): unknown[] {
  const selStr = sel ?? ''
  return resolveStepHandles(ownerHandle(shape) as never, 'edge', selStr) as unknown[]
}

/**
 * Resolve the edges belonging to the face picked by `sel` — upstream
 * `.faces(">Z").edges()` semantics. The face selector runs first over the
 * face candidate set, then the survivors' edges are collected (chain widening
 * to edges, no filter): the selected face's own edges.
 *
 * @param shape - the shape whose BREP faces/edges are enumerated.
 * @param sel - a face direction / type selector (">Z", "+Y", "%PLANE", etc.).
 * @returns the handles of the edges belonging to the selected face(s).
 */
export function resolveFaceEdgeSelection(shape: Shape, sel: string): unknown[] {
  const owner = ownerHandle(shape) as never
  return resolveSelection(owner, [
    { kind: 'face', sel },
    { kind: 'edge', sel: '' },
  ]).handles as unknown[]
}

/**
 * Resolve a CadQuery vertex selector string to vertex handles (upstream `.vertices()`).
 * Mirrors the narrowing semantics of the engine: direction-less selectors drop,
 * cluster-based (`>`, `<`, `>>`, `<<`, `(x,y,z)`) apply.
 *
 * @param shape - the shape whose BREP vertices are enumerated.
 * @param sel - the vertex selector string, or empty/undefined for all vertices.
 * @returns the matched vertex handles.
 */
export function resolveVertexSelection(shape: Shape, sel: string | null | undefined): unknown[] {
  return resolveStepHandles(ownerHandle(shape) as never, 'vertex', sel ?? '') as unknown[]
}