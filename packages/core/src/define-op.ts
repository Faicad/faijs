/**
 * define-op — dual-path implementation decorator for geometry functions
 * (D-face contract: mesh mandatory as the default path, BREP optional).
 *
 *
 * `defineOp({ mesh?, brep?, ... })` declares the implementation set of a
 * geometry function (a function whose signature returns `SolidShape`). The
 * wrapper:
 * - auto-collects geometry inputs via `args.filter(isGeometryInput)` — a shape
 *   that is identity-registered (`isShape`) or a structural mesh shape
 *   (`isMeshShape`, positions + indices — e.g. bare ManifoldMeshData handed in
 *   by a host via `geoToManifoldMesh`). The old per-function form passed the
 *   actual geometry args (`dispatchPath([input], ...)`), so a bare mesh input
 *   dispatched to the mesh path (`hasBrep=false`); the re-collection must keep
 *   that compatibility. No `inputs` field — decided at runtime by the args
 *   themselves, not the author.
 * - calls the engine's `dispatchPath` to select brep/mesh by mode (static,
 *   no runtime fallback);
 * - wraps raw products: mesh path → `solid()`, brep path → `fromHandle()` /
 *   `fromBrep()` (D3/D4: products must come from constructors, brep products
 *   must carry a BREP slot).
 *
 * Zero heavy runtime dependencies: imports only runtime-state / shape /
 * handle-bridge / backend-dispatch / mesh/types (a zero-import module holding
 * the Shape type and the structural `isMeshShape` guard) — the dist/sdk.js
 * static-import guard keeps passing.
 */

import { dispatchPath, type BrepCapabilityName } from './cad-runtime/backend-dispatch'
import {
  getBackends,
  CONTRACT_VERSION,
  BrepUnsupportedError,
  MeshUnsupportedError,
} from './runtime-state'
import { isShape, solid, fromBrep } from './shape'
import { isMeshShape } from './mesh/types'
import { fromHandle, meshHandle, isOcctHandle } from './brep/handle-bridge'
import { positionalToObject, type SlotMap } from './api/internal/dual-form-args'
import { toOpFailure, unwrapResult, OpError } from './api/internal/result-unwrap'
import type { Shape } from './mesh/types'
import type { BrepHandle } from './brep/engine/types'

/** Raw mesh data (structurally identical to Shape; mesh impls return it). */
export type MeshData = { positions: Float32Array; indices: Uint32Array }

/**
 * Geometry-input recognition for dispatch auto-collection.
 *
 * Compat rule: the old per-function form passed the *actual* geometry args to
 * `dispatchPath` (`[input]` / `shapes`), so a bare ManifoldMeshData object
 * (e.g. `geoToManifoldMesh` output passed straight by a host) had no BREP slot
 * → `hasBrep=false` → mesh path. defineOp must keep that: an input counts as
 * geometry when it is identity-registered (`isShape`, constructor product) OR
 * structurally a mesh shape (`positions` + `indices`). Params objects and other
 * scalar args are not geometry inputs.
 *
 * @param v - the candidate argument.
 * @returns true when the argument is a geometry input (registered shape or bare mesh data).
 */
export function isGeometryInput(v: unknown): v is Shape {
  return isShape(v) || isMeshShape(v)
}

/** Product of a mesh implementation: raw mesh data, a wrapped Shape, or (with `outputs`) a record of named products. */
export type MeshProduct = MeshData | Shape | Record<string, MeshData | Shape>

/** Mesh implementation: sync or async (stdlib mesh paths are often async); returns a mesh product. */
export type MeshImpl<A extends unknown[]> = (...args: A) => MeshProduct | Promise<MeshProduct>

/** BREP implementation result: a raw handle, or a handle plus face evolution. */
export interface BrepResult {
  solid: BrepHandle
  faceEvolution?: Map<number, number[]>
}

/** Product of a BREP implementation: a raw handle, { solid, faceEvolution }, a wrapped Shape, or (with `outputs`) a record of named products. */
export type BrepProduct = BrepHandle | BrepResult | Shape | Record<string, BrepHandle | BrepResult | Shape>

/** BREP implementation: sync or async; returns a brep product. */
export type BrepImpl<A extends unknown[]> = (...args: A) => BrepProduct | Promise<BrepProduct>

/** Optional declaration: capabilities (D5) and named multi-products (split, scheme C). */
export interface DualOpOptions {
  /** Op name (error messages); falls back to an anonymous prefix when absent. */
  name?: string
  capabilities?: BrepCapabilityName[]
  outputs?: string[]
  /** L3 schema per named parameter (G1 codegen + UI panel, plain string form). */
  schema?: Record<string, string>
  /**
   * D11 slot-map declaration (§4.2): the positional→object boxing table
   * (SlotMap) mapping a brepjs-style positional call onto this op's native
   * object form. Ops without it accept only the form their implementation
   * natively takes.
   */
  slotMap?: SlotMap
}

/** Implementation set (at least one of mesh/brep is required, D1/D1b); options are siblings of the implementations. */
export type DualOpImpls<A extends unknown[]> =
  | (DualOpOptions & { mesh: MeshImpl<A>; brep?: BrepImpl<A> })
  | (DualOpOptions & { mesh?: never; brep: BrepImpl<A> })

/** Metadata hung on the wrapped function object (K5: function info is data). */
export interface DualOpMeta {
  kind: 'dual-op'
  mesh?: unknown
  brep?: unknown
  /** Op name (error messages). */
  name?: string
  capabilities?: BrepCapabilityName[]
  outputs?: string[]
  schema?: Record<string, string>
  /** D11 slot-map declaration (positional → object boxing table, §9 naming). */
  slotMap?: SlotMap
}

/** Property key carrying DualOpMeta on wrapped functions. */
export const DUAL_OP_META = '__faijs__dualOp'

type MetaCarrier = { [DUAL_OP_META]?: DualOpMeta }

function wrapMeshOne(v: unknown): Shape {
  if (isShape(v)) return v
  return solid(v as MeshData)
}

function wrapBrepOne(v: unknown): Shape {
  if (isShape(v)) return v
  if (v !== null && typeof v === 'object' && 'faceEvolution' in v) {
    const res = v as BrepResult
    return fromBrep(meshHandle(res.solid), res)
  }
  // A plain object that is not a Shape and not an OCCT handle is a data
  // product (e.g. a compat fn returning a sheetmetal-style record), not a
  // geometry handle — pass it through so it lands in the engine's value
  // store instead of being tessellated as if it were a bare handle. Native
  // OCCT handles from an implementation are hand-computed shape numbers
  // (from a branded number return) or objects; only the number path reaches
  // fromHandle. The handle/data distinction must go through the shared
  // isOcctHandle leaf (handle-bridge) — never a hardcoded '__occtWasm' in v.
  if (v !== null && typeof v === 'object' && !isOcctHandle(v)) {
    return v as unknown as Shape
  }
  return fromHandle(v)
}

function wrapByKeys(r: unknown, keys: string[], wrapOne: (v: unknown) => Shape): Record<string, Shape> {
  const src = (r ?? {}) as Record<string, unknown>
  const out: Record<string, Shape> = {}
  for (const k of keys) {
    const v = src[k]
    // An output may be an array (e.g. the compat adapter adopts each element of
    // an array-valued `outputs` field); wrap element-wise so arrays stay arrays.
    out[k] = Array.isArray(v) ? (v.map(wrapOne) as unknown as Shape) : wrapOne(v)
  }
  return out
}

/** Human-readable op label for error messages (falls back when unnamed). */
function opLabel(meta: DualOpMeta): string {
  return meta.name ?? '<anon>'
}

/**
 * Run one implementation through the unified Result boundary (§5.2, D1).
 *
 * Transition contract: an implementation may
 *   ① return a `Result`  → unwrapped here (`err` becomes a throw);
 *   ② throw              → normalized into an op-labelled error;
 *   ③ return a plain product → passed through untouched.
 *
 * The two engine-level routing errors keep their class: `runtime.ts` matches
 * `BrepUnsupportedError` / `MeshUnsupportedError` by `instanceof` to turn them
 * into `ExecutionResult.failedAt`, so they must not be re-wrapped.
 *
 * @param meta - the op's metadata (name).
 * @param impl - the implementation to run.
 * @param args - the normalized argument list.
 * @returns the (unwrapped) implementation product.
 */
async function runImpl(
  meta: DualOpMeta,
  impl: ((...a: unknown[]) => unknown) | undefined,
  args: unknown[],
): Promise<unknown> {
  const label = opLabel(meta)
  let product: unknown
  try {
    product = await (impl as (...a: unknown[]) => unknown)(...args)
  } catch (e) {
    if (e instanceof BrepUnsupportedError || e instanceof MeshUnsupportedError) throw e
    // An OpError is already the engine-recognizable statement failure (thrown
    // by the compat adapter's Result unwrap, or by impls returning a Result);
    // re-wrapping it into a plain Error would make CadRuntime treat it as an
    // uncaught bug instead of a statement failure.
    if (e instanceof OpError) throw e
    throw toOpFailure(label, e)
  }
  return unwrapResult(product, label)
}

/**
 * Declare a geometry function's dual-path implementation set.
 *
 * At least one implementation (mesh or brep) is required — enforced at
 * compile time by the union type and at construction time by a runtime check.
 * Geometry inputs are auto-collected by identity-or-structure
 * (`args.filter(isGeometryInput)` = `isShape` ∨ `isMeshShape`); raw mesh
 * products are wrapped by `solid()`, raw brep products by
 * `fromHandle()` / `fromBrep()`. `mode` selects the engine path via the
 * engine's static `dispatchPath` — the author never writes an `if (path)`
 * branch.
 *
 * @param decl - the declaration object: implementations `{ mesh }` (mesh-only),
 * `{ brep }` (brep-only, D1b), or `{ mesh, brep }` (dual-path), plus optional
 * `capabilities` (D5: missing capability degrades in auto, errors in brep mode)
 * and `outputs` (named multi-products, e.g. split) as siblings.
 * @returns the wrapped geometry function with dual-op metadata attached.
 */
export function defineOp<A extends unknown[]>(
  decl: DualOpImpls<A> & { outputs: string[] },
): ((...args: A) => Promise<Record<string, Shape>>) & MetaCarrier
/**
 * Overload without `outputs`: single-product functions resolve to a `Promise<Shape>`.
 * @param decl - the declaration object: implementations `{ mesh }`, `{ brep }`, or `{ mesh, brep }`.
 * @returns the wrapped geometry function with dual-op metadata attached.
 */
export function defineOp<A extends unknown[]>(
  decl: DualOpImpls<A>,
): ((...args: A) => Promise<Shape>) & MetaCarrier
/** Implementation signature (not visible to callers); matches the union of both overloads. */
export function defineOp<A extends unknown[]>(
  decl: DualOpImpls<A>,
): ((...args: A) => Promise<Shape | Record<string, Shape>>) & MetaCarrier {
  // Construction-time check (②): implementations must be functions, then at
  // least one implementation must be present.
  if (decl.mesh !== undefined && typeof decl.mesh !== 'function') {
    throw new Error('[faijs/defineOp] mesh must be a function')
  }
  if (decl.brep !== undefined && typeof decl.brep !== 'function') {
    throw new Error('[faijs/defineOp] brep must be a function')
  }
  if (typeof decl.mesh !== 'function' && typeof decl.brep !== 'function') {
    throw new Error('[faijs/defineOp] at least one implementation (mesh or brep) is required')
  }

  const meta: DualOpMeta = {
    kind: 'dual-op',
    mesh: decl.mesh,
    brep: decl.brep,
    name: decl.name,
    capabilities: decl.capabilities,
    outputs: decl.outputs,
    schema: decl.schema,
    slotMap: decl.slotMap,
  }

  // Async wrapper: implementations may be sync or async (stdlib mesh paths are
  // often async, e.g. drill/engrave/boolean). The compiled .fai.js product always
  // awaits the call, so returning a Promise is transparent.
  const wrapped = async (...args: A): Promise<Shape | Record<string, Shape>> => {
    // D11 (§4.2): faijs-native ops declare an object-form implementation, so a
    // brepjs-style positional call is boxed into the object form here — before
    // dispatch, so geometry inputs are collected from the normalized arg list.
    const callArgs = (
      meta.slotMap ? positionalToObject(args as unknown[], meta.slotMap, opLabel(meta)) : args
    ) as A
    // Geometry inputs: identity-or-structure auto collection (execution-time
    // read, same nature as hasBrep — decided before the implementation runs).
    // Compat: bare ManifoldMeshData args (host geoToManifoldMesh output) are
    // geometry inputs too — old form passed [input] so they reached the mesh path.
    const inputs = (callArgs as unknown[]).filter(isGeometryInput) as Shape[]
    // D5 capability routing: feed the first missing capability to dispatchPath
    // (auto degrades to mesh, brep mode errors).
    const missing = meta.capabilities?.find((cap) => !getBackends().config.brepCapabilities?.[cap])
    const path = dispatchPath(inputs, meta, missing)
    if (path === 'brep') {
      const r = await runImpl(meta, decl.brep as unknown as ((...a: unknown[]) => unknown) | undefined, callArgs)
      return meta.outputs ? wrapByKeys(r, meta.outputs, wrapBrepOne) : wrapBrepOne(r)
    }
    const m = await runImpl(meta, decl.mesh as unknown as ((...a: unknown[]) => unknown) | undefined, callArgs)
    return meta.outputs ? wrapByKeys(m, meta.outputs, wrapMeshOne) : wrapMeshOne(m)
  }

  Object.defineProperty(wrapped, DUAL_OP_META, { value: meta, enumerable: false })
  return wrapped as ((...args: A) => Promise<Shape | Record<string, Shape>>) & MetaCarrier
}

/**
 * Assembly-time validation (③, strict mode, D-4): a library that exports any
 * dual-op function must carry a matching `contractVersion`, and every exported
 * dual-op must be structurally valid (mesh a function, brep a function or
 * undefined, capabilities/outputs well-formed). Called by `registerLib`.
 *
 * Functions without dual-op metadata are left untouched (declarative
 * enforcement boundary — K5 forbids name-based classification).
 *
 * @param lib - the library namespace object being registered.
 */
export function assertLibConforms(lib: Record<string, unknown>): void {
  const values = Object.values(lib)
  const hasDualOp = values.some((v) => typeof v === 'function' && (v as MetaCarrier)[DUAL_OP_META])
  if (hasDualOp && lib.contractVersion !== CONTRACT_VERSION) {
    throw new Error(
      `[faijs] library with dual-op functions must export contractVersion = ${CONTRACT_VERSION} (got ${String(lib.contractVersion)})`,
    )
  }

  for (const [name, value] of Object.entries(lib)) {
    if (typeof value !== 'function') continue
    const meta = (value as MetaCarrier)[DUAL_OP_META]
    if (!meta || meta.kind !== 'dual-op') continue
    if (typeof meta.mesh !== 'function' && typeof meta.brep !== 'function') {
      throw new Error(`[faijs] lib function '${name}' declares dual-op without any implementation`)
    }
    if (meta.mesh !== undefined && typeof meta.mesh !== 'function') {
      throw new Error(`[faijs] lib function '${name}' declares dual-op with a non-function mesh implementation`)
    }
    if (meta.brep !== undefined && typeof meta.brep !== 'function') {
      throw new Error(`[faijs] lib function '${name}' declares dual-op with a non-function brep implementation`)
    }
    if (meta.capabilities !== undefined && !Array.isArray(meta.capabilities)) {
      throw new Error(`[faijs] lib function '${name}' declares invalid capabilities (expected string[])`)
    }
    if (
      meta.outputs !== undefined
      && (!Array.isArray(meta.outputs) || meta.outputs.some((k) => typeof k !== 'string'))
    ) {
      throw new Error(`[faijs] lib function '${name}' declares invalid outputs (expected string[])`)
    }
    if (meta.schema !== undefined && !isValidSchema(meta.schema)) {
      throw new Error(`[faijs] lib function '${name}' declares invalid schema (expected Record<string, string>)`)
    }
    if (meta.name !== undefined && typeof meta.name !== 'string') {
      throw new Error(`[faijs] lib function '${name}' declares invalid name (expected string)`)
    }
    if (meta.slotMap !== undefined && !isValidSlotMap(meta.slotMap)) {
      throw new Error(
        `[faijs] lib function '${name}' declares invalid slotMap (expected { keys: string[]; vec3Keys?: string[]; shapeArity?: number })`,
      )
    }
  }
}

/** True when the D11 slot-map declaration has a non-empty string `keys` list. */
function isValidSlotMap(form: unknown): form is SlotMap {
  if (form === null || typeof form !== 'object') return false
  const keys = (form as { keys?: unknown }).keys
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) return false
  const vec3 = (form as { vec3Keys?: unknown }).vec3Keys
  if (vec3 !== undefined && (!Array.isArray(vec3) || vec3.some((k) => typeof k !== 'string'))) return false
  const arity = (form as { shapeArity?: unknown }).shapeArity
  if (arity !== undefined && (typeof arity !== 'number' || !Number.isInteger(arity) || arity < 0)) return false
  return true
}

/** True when every schema value is a non-empty string. */
function isValidSchema(schema: unknown): schema is Record<string, string> {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return false
  return Object.values(schema).every((v) => typeof v === 'string' && v.length > 0)
}
