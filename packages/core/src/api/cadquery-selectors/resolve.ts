/**
 * cadquery-selectors/resolve — evaluate a parsed `SelectorExpr` against a set
 * of candidate entities (plan §4.5). Clean-room re-encoding of
 * `cadquery/selectors.py`:
 *
 *   · `_SimpleStringSyntaxSelector._chooseSelector` — atom → selector object
 *   · `_NthSelector.cluster`/`filter` — center-projection sort + cluster
 *   · `BaseDirSelector.filter` — linear edges / planar faces only, else drop
 *   · `BinarySelector` set algebra (`AndSelector`/`SumSelector`/
 *     `SubtractSelector`/`InverseSelector`) from the expression grammar.
 *
 * Every child of a set operation is applied to the SAME full input list and its
 * results combined (upstream `BinarySelector.filter`), so operands do not chain
 * into each other.
 *
 * Validated against the LOCKED cadquery 2.8.0 probe (C:\cqenv\sel_probe.py)
 * — cube_off ground truth recorded in plan §5.2.
 *
 * @platform occt — narrowing evaluates kernel `ShapeHandle`s through the
 * native occt-kernel (`getKernel()`: isSame identity dedup etc.), so this
 * module is occt-coupled by nature.
 */
import { getKernel } from '../../occt-kernel/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import type { AtomDesc, EntityKind, SelectorExpr, SelStep, Vec3 } from './types'
import type { EntityGeom, P3, ShapeHandle } from './entity'
import { faceGeom, edgeGeom, vertexGeom, subShapeHandles } from './entity'
import { parseSelector } from './grammar'
import {
  NTH_TOLERANCE,
  isAligned,
  isDirectionCandidate,
  isParallel,
  isPerpendicular,
  typeMatches,
  entityDirection,
} from './predicates'

/** A set of candidate entities with their owning shape (for normal orientation). */
export interface Selection {
  owner: ShapeHandle | null
  items: EntityGeom[]
}

/** A fully-resolved narrowing chain: the surviving kind and kernel handles. */
export interface ChainResult {
  kind: EntityKind
  handles: ShapeHandle[]
}

/** Project a kernel handle of the given kind into its `EntityGeom`. */
function project(handle: ShapeHandle, kind: EntityKind): EntityGeom {
  if (kind === 'face') return faceGeom(handle)
  if (kind === 'edge') return edgeGeom(handle)
  return vertexGeom(handle)
}

/**
 * Multi-step `{kind, sel}` narrowing (plan §4.5). Each step collects the `kind`
 * sub-entities of every currently-held object, dedups by kernel identity, then
 * filters by the parsed selector. An empty `sel` collects without filtering
 * (CadQuery `.vertices()` / `.edges()`, whose `_filter` is a no-op).
 *
 *   resolveSelection(shape, [{face,'+Z'},{vertex,'<XY'}])
 *     → the +Z face's vertices with the smallest x+y, in the order they appear.
 *
 * @param owner - The owning shape handle to start from (or `null` for empty).
 * @param chain - The ordered per-kind narrowing steps to apply.
 * @returns The final kind and the surviving kernel handles at that kind.
 */
export function resolveSelection(owner: ShapeHandle | null, chain: SelStep[]): ChainResult {
  if (chain.length === 0) {
    return { kind: 'face', handles: owner ? subShapeHandles(owner, 'face') : [] }
  }
  let candidates: ShapeHandle[] = owner ? [owner] : []
  let kind: EntityKind = chain[0].kind
  for (const step of chain) {
    // ① collect: sub-entities of each candidate, union/ordered, dedup by identity.
    const gathered: ShapeHandle[] = dedupByIsSame(
      candidates.flatMap((o) => subShapeHandles(o, step.kind)),
    )
    // ② filter: resolve the selector over the gathered views.
    const items = gathered.map((h) => project(h, step.kind))
    candidates =
      step.sel.trim() === ''
        ? gathered
        : evalExpr({ owner, items }, parseSelector(step.sel)).map((g) => g._handle)
    kind = step.kind
  }
  return { kind, handles: candidates }
}

/** Deduplicate kernel handles by KERNEL identity (isSame), preserving order. */
function dedupByIsSame(handles: ShapeHandle[]): ShapeHandle[] {
  const out: ShapeHandle[] = []
  for (const h of handles) {
    if (!out.some((o) => kernOf().isSame(o as never, h as never))) out.push(h)
  }
  return out
}

function kernOf(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

// ─── single-kind conveniences (plan §4.6) ────────────────────────────────

/**
 * Narrow a single step and return the surviving kernel handles. Backs the
 * `resolveEdgeSelection` / `resolveVertexSelector` / `resolveFaceEdgeSelection`
 * projections.
 *
 * @param owner - The owning shape handle to start from (or `null` for empty).
 * @param kind - The topological kind of the step.
 * @param sel - The CadQuery selector string for the step (may be empty).
 * @returns The surviving kernel handles after the single-step narrowing.
 */
export function resolveStepHandles(
  owner: ShapeHandle | null,
  kind: EntityKind,
  sel: string,
): ShapeHandle[] {
  return resolveSelection(owner, [{ kind, sel }]).handles
}

/** Center dot direction — the ordering key for the N-th selectors. */
function projKey(g: EntityGeom, axis: Vec3): number {
  const c = g.center()
  return c.x * axis.x + c.y * axis.y + c.z * axis.z
}

/**
 * `_NthSelector.cluster` + `filter`: sort by key, cluster consecutive items
 * within `NTH_TOLERANCE`, then return the cluster at index `n` of the list
 * reversed when `max` is false. An empty input raises (upstream
 * `_NthSelector.filter` ValueError); an out-of-range `n` raises IndexError.
 */
function nthCluster(items: EntityGeom[], axis: Vec3, max: boolean, n: number): EntityGeom[] {
  if (items.length === 0) {
    throw new EmptyNthError('Can not return the Nth element of an empty list')
  }

  const keyed = items
    .map((g) => ({ g, key: projKey(g, axis) }))
    .sort((a, b) => a.key - b.key)

  const clusters: EntityGeom[][] = []
  let cur = [keyed[0].g]
  let start = keyed[0].key
  for (let i = 1; i < keyed.length; i++) {
    const { g, key } = keyed[i]
    if (Math.abs(key - start) <= NTH_TOLERANCE) {
      cur.push(g)
    } else {
      clusters.push(cur)
      cur = [g]
      start = key
    }
  }
  clusters.push(cur)

  // `_NthSelector.filter`: descending requires reversing the cluster list first.
  if (!max) clusters.reverse()

  // Python-style negative index (e.g. `>Z[-2]` ⇔ `clusters[-2]`).
  const idx = n < 0 ? clusters.length + n : n
  const out = clusters[idx]
  if (out === undefined) {
    throw new RangeError(
      `Attempted to access index ${n} of a list with length ${clusters.length}`,
    )
  }
  return out
}

/** ValueError-equivalent for an empty input to a N-th selector. */
export class EmptyNthError extends Error {}

// ── set operations (BinarySelector) ────────────────────────────────────────

/** `AndSelector`: intersection by kernel identity. */
function intersect(a: EntityGeom[], b: EntityGeom[]): EntityGeom[] {
  const bs = new Set(b.map((g) => g.hash()))
  return a.filter((g) => bs.has(g.hash()))
}

/** `SumSelector`: union (no duplicates) by kernel identity. */
function union(a: EntityGeom[], b: EntityGeom[]): EntityGeom[] {
  const seen = new Set<number>()
  const out: EntityGeom[] = []
  for (const g of a.concat(b)) {
    const h = g.hash()
    if (!seen.has(h)) {
      seen.add(h)
      out.push(g)
    }
  }
  return out
}

/** `SubtractSelector`: set difference by kernel identity. */
function subtract(a: EntityGeom[], b: EntityGeom[]): EntityGeom[] {
  const bs = new Set(b.map((g) => g.hash()))
  return a.filter((g) => !bs.has(g.hash()))
}

// ── atom application ──────────────────────────────────────────────────────

/** BaseDirSelector filter: the direction test over allowed entity kinds. */
function filterByTest(
  items: EntityGeom[],
  owner: ShapeHandle | null,
  test: (d: P3) => boolean,
): EntityGeom[] {
  const out: EntityGeom[] = []
  for (const g of items) {
    if (!isDirectionCandidate(g)) continue
    const d = entityDirection(g, owner ?? undefined)
    if (d !== null && test(d)) out.push(g)
  }
  return out
}

/** Apply one atom to the full candidate list, mirroring each selector.filter. */
function applyAtom(items: EntityGeom[], owner: ShapeHandle | null, desc: AtomDesc): EntityGeom[] {
  switch (desc.kind) {
    case 'dir':
      // `DirectionSelector` (bare `X` or `(x,y,z)`): angle≈0, signed — same as
      // the `+` operator (upstream `only_dir` maps to DirectionSelector).
      return filterByTest(items, owner, (d) => isAligned(d, desc.vec, 1))
    case 'signed':
      return filterByTest(items, owner, (d) => isAligned(d, desc.vec, desc.sign))
    case 'parallel':
      return filterByTest(items, owner, (d) => isParallel(d, desc.vec))
    case 'perpendicular':
      return filterByTest(items, owner, (d) => isPerpendicular(d, desc.vec))
    case 'type':
      return items.filter((g) => typeMatches(g, desc.name))
    case 'minmax':
      // `DirectionMinMaxSelector` = CenterNthSelector(n=-1, max) — no pre-filter.
      return nthCluster(items, desc.vec, desc.max, -1)
    case 'minmaxNth': {
      // `DirectionNthSelector`: parallel pre-filter, then Nth cluster.
      const parallel = filterByTest(items, owner, (d) => isParallel(d, desc.vec))
      return nthCluster(parallel, desc.vec, desc.max, desc.n)
    }
    case 'centerNth': {
      // `CenterNthSelector`: no pre-filter, arbitrary index (n=-1 when absent).
      const n = desc.n ?? -1
      return nthCluster(items, desc.vec, desc.max, n)
    }
  }
}

// ── expression evaluation ─────────────────────────────────────────────────

/** Evaluate an expression over the candidate list (upstream `Selector.filter`). */
function evalExpr(sel: Selection, expr: SelectorExpr): EntityGeom[] {
  const { items, owner } = sel
  switch (expr.op) {
    case 'atom':
      return applyAtom(items, owner, expr.desc)
    case 'and': {
      let acc: EntityGeom[] | null = null
      for (const t of expr.terms) {
        const r = evalExpr({ items, owner }, t)
        acc = acc === null ? r : intersect(acc, r)
      }
      return acc ?? []
    }
    case 'or': {
      let acc: EntityGeom[] = []
      for (const t of expr.terms) {
        acc = union(acc, evalExpr({ items, owner }, t))
      }
      return acc
    }
    case 'exc': {
      let acc: EntityGeom[] = evalExpr({ items, owner }, expr.terms[0])
      for (let i = 1; i < expr.terms.length; i++) {
        acc = subtract(acc, evalExpr({ items, owner }, expr.terms[i]))
      }
      return acc
    }
    case 'not': {
      // `InverseSelector`: complement of the operand within the full list.
      const r = evalExpr({ items, owner }, expr.term)
      return subtract(items, r)
    }
  }
}