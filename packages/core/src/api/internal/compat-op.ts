/**
 * compat-op — lift an arbitrary brepjs-shaped function into a faijs statement
 * op (brep-only).
 *
 * Design: docs/plans/2026-09-03-faijs-brepjs-compat-api.md §4.3.2
 *
 * Six-step boundary contract (all steps reuse verified infrastructure):
 *   1. Argument pass-through: the wrapped function normalizes positional /
 *      object forms internally (D11, §4.2); compatOp does no form mapping.
 *   2. Static dispatch gate: deep-collect geometry inputs → dispatchPath
 *      (brep-only; mesh mode / broken chain throws, never falls back).
 *   3. Input borrow: deep walk, any faijs Shape → createBorrowedHandle view
 *      (zero-copy, delete is a no-op).
 *   4. Call + Result unwrap: isResultLike → err throws an execution error
 *      carrying the op name and BrepError code.
 *   5. Output adoption: top-level handle / spec.geometryFields declared fields
 *      → adoptEntity (unregister finalizer + fromHandle).
 *   6. Return: the adopted Shape is taken over by the same consumer defineOp
 *      uses (runtime outputCache / solidCache).
 *
 * @module
 */

import { dispatchPath } from '../../cad-runtime/backend-dispatch'
import { DUAL_OP_META, type DualOpMeta, type ConsumeSpec } from '../../define-op'
import { isShape } from '../../shape'
import { borrowBrepjsShape, adoptEntity, callBrepjs } from './l3-bridge'
import { unwrapResult } from './result-unwrap'
import type { Shape } from '../../mesh/types'

/** compatOp's static spec. The library edge is derived by admitCompatLib; the
 *  cad edge is the same (form normalization happens inside the wrapped fn, D11). */
export interface CompatSpec {
  /** op name (used in error messages). */
  name: string
  /** object fields to adopt (default: only adopt the top level if the return is a handle). */
  geometryFields?: string[]
  /** timeline consumption declaration (default 'all', matching defineOp). */
  consumes?: ConsumeSpec
  /** L3 schema (codegen + UI panels, pass-through metadata). */
  schema?: Record<string, string>
}

const MAX_WALK_DEPTH = 4

/** Deep-collect geometry inputs (same Shape test as step 3) for the dispatch gate. */
export function collectShapes(v: unknown, out: Shape[], depth: number): void {
  // Explicit depth guards against deep/hrecursive structures.
  if (depth > MAX_WALK_DEPTH || v === null || typeof v !== 'object') return
  if (isShape(v)) { out.push(v as Shape); return }
  if (Array.isArray(v)) { for (const x of v) collectShapes(x, out, depth + 1); return }
  if (Object.getPrototypeOf(v) !== Object.prototype) return // class instances are not traversed (defensive)
  for (const x of Object.values(v)) collectShapes(x, out, depth + 1)
}

/** Step 3: inward deep walk — any faijs Shape in the structure maps to a
 *  borrowed view; everything else passes through (library-private handles
 *  pass through, §4.3.4). */
export function borrowDeep(v: unknown, depth: number): unknown {
  if (depth > MAX_WALK_DEPTH || v === null || typeof v !== 'object') return v
  if (isShape(v)) return borrowBrepjsShape(v as Shape)
  if (Array.isArray(v)) return v.map((x) => borrowDeep(x, depth + 1))
  if (Object.getPrototypeOf(v) !== Object.prototype) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = borrowDeep(x, depth + 1)
  return out
}

/**
 * Step 4: statement-boundary unwrap — err becomes an execution error carrying
 * the op name and error code (not silent; the engine's statement-level catch
 * already exists).
 *
 * Delegates to the shared {@link unwrapResult} (P23, §5.1): `defineOp`'s
 * Result-aware boundary and this bridge must never drift apart, so both call
 * the one leaf implementation.
 */
export function unwrapOrThrow(r: unknown, name: string): unknown {
  return unwrapResult(r, name)
}

/** Step 5: outward adoption — top-level handle or geometryFields declared
 *  fields; deduplication of already-adopted handles lives inside adoptEntity.
 */
function adoptOut(v: unknown, spec: CompatSpec): unknown {
  if (isShape(v)) return v                              // already a faijs Shape: pass through (no double adoption)
  if (spec.geometryFields && typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const rec = v as Record<string, unknown>
    for (const f of spec.geometryFields) rec[f] = adoptEntity(rec[f], spec.name)
    return v
  }
  return adoptEntity(v, spec.name)                       // top level: handle → adopt; pure data → pass through
}

/**
 * Lift a brepjs-shaped function into a faijs dual-op facade (brep-only).
 *
 * Returned function is `(…args) => Promise<unknown>`; the engine's compiled
 * products await calls, so a Promise return is transparent.
 *
 * @param fn   the brepjs-shaped function (dual-form normalization inside).
 * @param spec the static op spec (name + optional geometry fields).
 * @returns the compat op facade, tagged with DualOpMeta (kind: 'dual-op').
 */
export function compatOp(
  fn: (...args: unknown[]) => unknown,
  spec: CompatSpec,
): (...args: unknown[]) => Promise<unknown> {
  const impl = async (...args: unknown[]): Promise<unknown> => {
    // Step 1: args pass through unchanged (D11 normalization happens inside fn).
    // Step 2: static dispatch gate — brep-only:
    //   mesh mode → E_MESH_UNSUPPORTED; auto with a broken input chain →
    //   E_MESH_UNSUPPORTED (no mesh impl to degrade to); brep mode with an
    //   off-chain input → E_BREP_UNSUPPORTED. Zero inputs (constructors like
    //   author/torus): [].every(hasBrep) === true → 'brep'.
    const shapes: Shape[] = []
    for (const a of args) collectShapes(a, shapes, 0)
    dispatchPath(shapes, { brep: impl }, undefined)
    // Step 3: input borrow.
    const borrowed = args.map((a) => borrowDeep(a, 0))
    // Step 4: call + Result unwrap.
    const value = unwrapOrThrow(callBrepjs(fn as never, borrowed), spec.name)
    // Step 5/6: adopt the output and return it.
    return adoptOut(value, spec)
  }
  // Metadata convention identical to defineOp (kind 'depth-op', brep-only).
  const meta: DualOpMeta = {
    kind: 'dual-op',
    brep: impl,
    consumes: spec.consumes ?? 'all',
    schema: spec.schema,
  }
  Object.defineProperty(impl, DUAL_OP_META, { value: meta, enumerable: false })
  return impl
}