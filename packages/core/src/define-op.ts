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

import { dispatchPath, firstMissingCapability, type BrepCapabilityName } from './cad-runtime/backend-dispatch'
import {
  CONTRACT_VERSION,
  BrepUnsupportedError,
  MeshUnsupportedError,
  getCurrentStmt,
  getRuntimeState,
  nameOf,
} from './runtime-state'
import { asStmtId, type PartName } from './identity'
import { isShape, solid, fromBrep, getSlot } from './shape'
import { isMeshShape } from './mesh/types'
import { fromHandle, meshHandle, isOcctHandle } from './brep/handle-bridge'
import { positionalToObject, type SlotMap } from './api/internal/dual-form-args'
import { toOpFailure, unwrapResult, OpError } from './api/internal/result-unwrap'
import type { Shape } from './mesh/types'
import { BREP_ENGINE_IDS, type BrepEngineId, type BrepHandle } from './brep/engine/types'
import { type Provenance, runtimeLineage } from './topology/naming/lineage'

/** 合法引擎 id 集合（assertLibConforms 的 engines 校验用，D11-1）。 */
const BREP_ENGINE_ID_SET = new Set<string>(BREP_ENGINE_IDS)

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

/**
 * §1.4 registration guard: the StmtId whose top-level `wrapped` is currently
 * registering a lineage node. Nested op calls (an impl invoking another op /
 * itself) share the same `getCurrentStmt()` anchor and are skipped so they
 * don't trip N3 (E_TOPO_DUPLICATE_STMT) with identical content. C1 (single
 * live runtime) means at most one statement registers at a time.
 *
 * The marker lives on the runtime state and is reset at statement boundaries
 * (runtime-state.setCurrentStmt: anchor change / end-of-statement), NOT at op
 * granularity — a TS library function (cq-compat Workplane op, etc.) may call
 * several defineOps within one statement, and only the first one must register.
 */

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
  /**
   * 平台身份声明（D11，narrowing plan 2026-09-24）：本 op 实现可运行在哪些
   * BREP 引擎上——一个**引擎白名单**。缺省 = 全平台（中立 op——实现只用 L1 核心面）。
   *
   * 平台 op（实现 import 了 `occt-kernel/*` / `brepkit-kernel/*`，调用该平台
   * 原生方法）**必须**声明 `engines` 自证身份。
   *
   * 与 `capabilities` **可以并存**（2026-09-24 撤销 D11-7 互斥）：两者是正交的两轴——
   * `engines` 收窄「在哪些引擎上跑」，`capabilities` 声明「需要哪些内核能力」。判定
   * 次序 `engines` 在先（D11-2），能力门随后对同一引擎继续求交，故同时声明等于
   * 「只在这些引擎上，且要求这些能力」——不会静默放行"目标引擎缺该能力"的组合。
   */
  engines?: readonly BrepEngineId[]
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
  /**
   * Topology identity provenance (plan §4.4 / Phase 2.3, **required**).
   * Declares the op's face-mapping category + new-face vocabulary.
   * The lineage registrar (§4.3) reads this to build the blood-line graph;
   * missing naming = compile-time error (G4: no undeclared ops).
   */
  naming: Provenance
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
  /** 平台身份声明（D11，镜像 DualOpOptions.engines）。 */
  engines?: readonly BrepEngineId[]
  outputs?: string[]
  schema?: Record<string, string>
  /** D11 slot-map declaration (positional → object boxing table, §9 naming). */
  slotMap?: SlotMap
  /** Topology identity provenance (Phase 2.3, mirrors DualOpOptions.naming). */
  naming: Provenance
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
    engines: decl.engines,
    outputs: decl.outputs,
    schema: decl.schema,
    slotMap: decl.slotMap,
    naming: decl.naming,
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
    // §1.4 lineage registration (plan §4.3): every top-level dual-op execution
    // records a blood-line node via `runtimeLineage.register`, which enforces
    // N1 (untracked input → throw, never default to chain-root) / N2
    // (stmt↔anchor mismatch) / N3 (conflicting re-register). The graph is
    // cleared per program execution (direct-executor runCode) and C1 guarantees
    // a single live runtime, so the anchor is authoritative inside a statement.
    // Skip when no anchor is set (the op was invoked outside a statement
    // context — there is no lineage to record, and N2 must not fire on a context
    // that legitimately has none).
    //
    // Guard: a statement executes exactly one *top-level* op; an op's
    // implementation may invoke other ops (or itself) internally, and those
    // nested calls share the same `getCurrentStmt()` anchor. They are
    // implementation details, not statements, so they must NOT register a second
    // node under the same StmtId — that would trip N3 (E_TOPO_DUPLICATE_STMT)
    // on identical content. Only the outermost `wrapped` for the current
    // statement registers; the flag below stays set for the *entire* statement
    // execution (including the awaited impl), so nested calls see it and skip.
    const anchor = getCurrentStmt()
    const st = getRuntimeState()
    const isOuter = anchor != null && st.registeredStmtId !== anchor.id
    if (isOuter) st.registeredStmtId = asStmtId(anchor.id)
    try {
      if (isOuter && anchor) {
        runtimeLineage.register(
          {
            stmt: asStmtId(anchor.id),
            op: opLabel(meta),
            inputs,
            outputs: anchor.outputs as [PartName, ...PartName[]],
            provenance: meta.naming,
          },
          {
            nameOf,
            currentStmt: () => {
              const a = getCurrentStmt()
              return a ? { id: a.id } : undefined
            },
          },
        )
      }
    // D5 capability routing: feed the first missing capability to dispatchPath
    // (auto degrades to mesh, brep mode errors). Matched as a concrete name
    // against the engine's declaration set (family booleans + its `evolution`
    // list of *WithHistory kernel function names) — see firstMissingCapability.
    const missing = firstMissingCapability(meta.capabilities)
    const path = dispatchPath(inputs, meta, missing, meta.engines)
    if (path === 'brep') {
      const r = await runImpl(meta, decl.brep as unknown as ((...a: unknown[]) => unknown) | undefined, callArgs)
      const out = meta.outputs ? wrapByKeys(r, meta.outputs, wrapBrepOne) : wrapBrepOne(r)
      // 1.10 前置①：执行期把 hash 演化挂到血缘节点（kernel 类回走推进的数据源）。
      // 演化在几何算完那一刻可得（fromBrep → slot.faceEvolution），事后补挂不参与
      // N3 的内容比较（lineage.ts 设计如此）。无演化（identity/construct 等无历史
      // 输出）时跳过——identity 类推进不依赖演化，construct 词汇在节点 provenance 里。
      const outShape = (typeof out === 'object' && out !== null ? Object.values(out)[0] : out) as Shape | undefined
      const evolution = outShape ? getSlot(outShape)?.faceEvolution : undefined
      if (outShape && evolution) {
        runtimeLineage.attachEvolution(asStmtId(anchor!.id), evolution)
      }
      // 1.10 前置③：part 键的 roleTable 旁挂在这里记录（不是 fromBrep）——
      // impl 返回后 anchor.outputs 名字已定，而 fromBrep 时刻 shape 还未被
      // executor 命名（nameOf 为 undefined）。op 实现读输入表（inputRoleTable）
      // 与解析读表（tableOfPart）都走这份 part 键权威表。
      if (outShape && anchor && anchor.outputs.length > 0) {
        const stmtId = asStmtId(anchor.id)
        const table = runtimeLineage.outputTableOf(stmtId)
        const solid = runtimeLineage.outputHandleOf(stmtId)
        if (table) runtimeLineage.recordOutput(stmtId, table, solid, anchor.outputs[0] as PartName)
      }
      return out
    }
    const m = await runImpl(meta, decl.mesh as unknown as ((...a: unknown[]) => unknown) | undefined, callArgs)
    return meta.outputs ? wrapByKeys(m, meta.outputs, wrapMeshOne) : wrapMeshOne(m)
    } finally {
      // 同语句去重标记不在 op 粒度清理——语句边界由 runtime-state.setCurrentStmt
      // 在锚点变化时重置；TS 库函数体内连续 op 调用共享锚点，嵌套调用正确跳过。
    }
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
/**
 * Detect whether a library namespace exports any dual-op function (carries
 * `DUAL_OP_META`). Used by `registerLib`'s inferred `autoLift` default: a
 * library that already declares dual-ops does not need bare-function lifting.
 *
 * @param ns - the library namespace object.
 * @returns `true` if at least one exported value is a dual-op function.
 */
export function hasDualOp(ns: Record<string, unknown>): boolean {
  const values = Object.values(ns)
  return values.some((v) => typeof v === 'function' && (v as MetaCarrier)[DUAL_OP_META])
}

/**
 * Assert that a library conforms to the dual-op contract: if it exports any
 * dual-op function, it must also export `contractVersion` matching the engine's.
 *
 * @param lib - the library namespace object being registered.
 * @throws {Error} when dual-op functions are present without a matching contract version.
 */
export function assertLibConforms(lib: Record<string, unknown>): void {
  if (hasDualOp(lib) && lib.contractVersion !== CONTRACT_VERSION) {
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
    // D11-7 互斥**已撤销**（2026-09-24 用户裁决）：engines 与 capabilities 是两条正交的
    // 声明轴——前者是引擎身份白名单（在哪些引擎上跑），后者是实现所需内核能力清单
    // （要用哪些方法）。两者并存是合法且更诚实的写法：engines 收窄候选集，能力门随后
    // 对同一引擎继续求交（dispatchPath 的求值次序本就是 engines 在先，D11-2）。
    // 曾经的理由「能力名空间只收 L1 中立名」与事实不符——BrepCapabilityName 含
    // BrepMethodKind 逐核真名（isNull / dispose / chamfer / shell / ...，见
    // brep/engine/types.ts），本就是内核名空间；平台 op 声明能力名并不越界。
    // 故此处不再校验两者是否同时出现。
    if (meta.engines !== undefined) {
      if (!Array.isArray(meta.engines) || meta.engines.length === 0) {
        throw new Error(`[faijs] lib function '${name}' declares invalid engines (expected non-empty BrepEngineId[])`)
      }
      const bad = meta.engines.find((e) => !BREP_ENGINE_ID_SET.has(e))
      if (bad !== undefined) {
        throw new Error(
          `[faijs] lib function '${name}' declares unknown engine '${String(bad)}' — expected one of ${BREP_ENGINE_IDS.join(', ')}`,
        )
      }
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
