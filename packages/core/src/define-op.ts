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

import { dispatchPath } from './cad-runtime/backend-dispatch'
import {
  CONTRACT_VERSION,
  BrepUnsupportedError,
  MeshUnsupportedError,
  getCurrentStmt,
  getRuntimeState,
  nameOf,
} from './runtime-state'
import { asStmtId, type PartName, type StmtId } from './identity'
import { isShape, solid, fromBrep, getSlot, type CompoundShape } from './shape'
import { isMeshShape } from './mesh/types'
import { materializeTessellation } from './brep/deferred-tess'
import { fromHandle, meshHandle, isOcctHandle } from './brep/handle-bridge'
import { positionalToObject, type SlotMap } from './api/internal/dual-form-args'
import { toOpFailure, unwrapResult, OpError, type ResultLike } from './api/internal/result-unwrap'
import type { Shape } from './mesh/types'
import { BREP_ENGINE_IDS, type BrepEngineId, type BrepHandle } from './brep/engine/types'
import type { DimName, DimDecl, DimSpec } from './units'
import { type Provenance, runtimeLineage } from './topology/naming/lineage'
import { flushPendingPmi, registerPmiParents, registerPmiTransform } from './api/pmi/registry'
import type { PmiAffine } from './api/pmi/affine'

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
export type MeshProduct = MeshData | Shape | CompoundShape | Record<string, MeshData | Shape | CompoundShape>

/** Mesh implementation: sync or async (api mesh paths are often async); returns a mesh product. */
export type MeshImpl<A extends unknown[]> = (...args: A) => MeshProduct | Promise<MeshProduct>

/** BREP implementation result: a raw handle, or a handle plus face evolution. */
export interface BrepResult {
  solid: BrepHandle
  faceEvolution?: Map<number, number[]>
}

/** Product of a BREP implementation: a raw handle, { solid, faceEvolution }, a wrapped Shape, or (with `outputs`) a record of named products. */
export type BrepProduct =
  | BrepHandle
  | BrepResult
  | Shape
  | CompoundShape
  | Record<string, BrepHandle | BrepResult | Shape | CompoundShape>
  | ResultLike

/** BREP implementation: sync or async; returns a brep product. */
export type BrepImpl<A extends unknown[]> = (...args: A) => BrepProduct | Promise<BrepProduct>

/** Optional declaration: named multi-products (split, scheme C) + platform identity. */
export interface DualOpOptions {
  /** Op name (error messages); falls back to an anonymous prefix when absent. */
  name?: string
  /**
   * 平台身份声明（D11，narrowing plan 2026-09-24）：本 op 实现可运行在哪些
   * BREP 引擎上——一个**引擎白名单**。缺省 = 全平台（中立 op——实现只用 L1 核心面）。
   *
   * 平台 op（实现 import 了 `occt-kernel/*` / `brepkit-kernel/*`，调用该平台
   * 原生方法）**必须**声明 `engines` 自证身份。
   *
   * 这是 op 侧**唯一**的收窄轴：引擎能做什么由引擎自己的实现与
   * `brep/engine/native-history.ts` 在写代码时刻定死，op 不声明能力、分派时不查能力表。
   */
  engines?: readonly BrepEngineId[]
  /**
   * 网格实体路径的引擎要求（方案 2026-10-01 §3.4）：本 op 的 mesh 实现**能接受
   * 网格实体输入**的前提是「当前装配的网格后端 id 在此名单内」。
   *
   * 缺省 = `['manifold']`：mesh 实现跑在内置 `mesh/`（manifold CSG）上，它不认识
   * 网格实体——拿网格实体喂它必须在**执行前**静态报错
   * （`E_MESH_SOLID_UNSUPPORTED`），绝不运行时改走别的后端。
   *
   * 与 `engines` 正交：`engines` 收窄的是 **BREP 引擎**身份，本字段收窄的是
   * **网格后端**身份（同一个 op 可以"BREP 走 occt、网格实体走 brepkit"）。
   */
  meshEngines?: readonly string[]
  outputs?: string[]
  /** L3 schema per named parameter (G1 codegen + UI panel, plain string form). */
  schema?: Record<string, string>
  /**
   * D11 slot-map declaration (§4.2): the positional→object boxing table
   * (SlotMap) mapping a positional call onto this op's native
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
/**
* Script-side dimension declaration (unit-system D8): per-parameter dim for
* the static `dimension` check stage. `'plain'` means a pure number with no
* physical dimension (design doc §3.1). Params absent here are treated as
* dimensionless and exempt from the check.
*/
paramDims?: Record<string, DimDecl>
  /** Return dimension declaration (D8): the value produced carries this dim. */
  retDim?: DimName
  /** D8+: recursive DimSpec for structured params (e.g. cad.sketch's shapes[]/constraints[]). */
  spec?: DimSpec
  /** D8+: dimension check mode: 'error' (default, blocks) or 'warn' (warns without blocking). */
  dimCheck?: 'error' | 'warn'
  /**
   * 坐标变换声明（PMI 裸世界坐标补偿）：本 op 是**变换类**吗——把输入几何整体
   * 施加了什么仿射。返回 `undefined` = 坐标系没变（不登记）。
   *
   * 用途只有一个：`PmiNote.anchor` / `PmiThreadHole.axis` 这类**裸世界坐标**
   * 不随几何自动跟随（`TopoRef` 会，它有语句级因果坐标）。登记后聚合时沿父链
   * 把矩阵乘上去（`api/pmi/affine.ts`），**标注数据本身一个字节不改**。
   *
   * 只有 `translate` / `rotate_euler` / `scale` / `scale3d` 声明。布尔 op 虽然
   * 会改面，但不改坐标系，所以不声明——这不是遗漏。
   *
   * 在 impl **成功返回之后**调用（参数此时已校验），签名拿到的是归一化后的
   * 参数对象；矩阵构造失败（参数缺失/非有限数）应返回 `undefined` 而不是抛错。
   */
  pmiRemap?: (params: Record<string, unknown>) => PmiAffine | undefined
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
  /** 平台身份声明（D11，镜像 DualOpOptions.engines）。 */
  engines?: readonly BrepEngineId[]
  /** 网格实体路径的引擎要求（镜像 DualOpOptions.meshEngines；缺省 = `['manifold']`）。 */
  meshEngines?: readonly string[]
  outputs?: string[]
  schema?: Record<string, string>
  /** D11 slot-map declaration (positional → object boxing table, §9 naming). */
  slotMap?: SlotMap
  /** Topology identity provenance (Phase 2.3, mirrors DualOpOptions.naming). */
  naming: Provenance
/** Script-side dimension declaration (D8, mirrors DualOpOptions.paramDims). */
paramDims?: Record<string, DimDecl>
  /** Return dimension declaration (D8). */
  retDim?: DimName
  /** D8+: recursive DimSpec (mirrors DualOpOptions.spec). */
  spec?: DimSpec
  /** D8+: dimension check mode (mirrors DualOpOptions.dimCheck). */
  dimCheck?: 'error' | 'warn'
  /** 坐标变换声明（镜像 DualOpOptions.pmiRemap）：变换类 op 的仿射矩阵工厂。 */
  pmiRemap?: (params: Record<string, unknown>) => PmiAffine | undefined
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
  // Pass through non-shape data keys (e.g. autoHeal's `report`): declared
  // outputs are the geometry that gets Shape-wrapped, but sibling data products
  // of the same op result must survive the statement boundary (§5.4).
  for (const k of Object.keys(src)) {
    if (!keys.includes(k)) out[k] = src[k] as unknown as Shape
  }
  return out
}

/**
 * 外观继承（设计文档 2026-10-05 v2 §6.1）：几何 op 返回新 Shape 时，默认继承
 * 第一个携带外观的几何输入（`inputs.find(appearance !== undefined)`）；产物
 * 已有外观则不动（后置 setColor 优先）。实现集中在产物包装点，避免每个 op
 * 手写——mesh 与 brep 两条路径的产物都经此补齐。
 */
function inheritInputAppearance(out: Shape | Record<string, Shape>, inputs: Shape[]): void {
  const src = inputs.find((i) => i.appearance !== undefined)
  if (!src?.appearance) return
  const setIfEmpty = (v: unknown): void => {
    if (v !== null && typeof v === 'object' && 'positions' in v && !(v as Shape).appearance) {
      ;(v as Shape).appearance = src.appearance
    }
  }
  if (isShape(out)) {
    setIfEmpty(out)
    return
  }
  for (const k of Object.keys(out)) {
    const v = out[k]
    if (Array.isArray(v)) (v as unknown[]).forEach(setIfEmpty)
    else setIfEmpty(v)
  }
}

/**
 * 元数据继承（设计文档 2026-10-05-meta §2 ③）：几何 op 返回新 Shape 时，默认
 * 继承第一个携带 meta 的几何输入（`inputs.find(meta !== undefined)`），对象引用
 * 共享；产物已有 meta 则不动（后置 setName 优先）。实现集中在产物包装点，mesh
 * 与 brep 两条路径的产物都经此补齐。名称是显式声明，继承只是保底——需要新名的
 * 产物（组合/变换后）由用户显式 `setName` 覆盖。
 */
function inheritInputMeta(out: Shape | Record<string, Shape>, inputs: Shape[]): void {
  const src = inputs.find((i) => i.meta !== undefined)
  if (!src?.meta) return
  const setIfEmpty = (v: unknown): void => {
    if (v !== null && typeof v === 'object' && 'positions' in v && !(v as Shape).meta) {
      ;(v as Shape).meta = src.meta
    }
  }
  if (isShape(out)) {
    setIfEmpty(out)
    return
  }
  for (const k of Object.keys(out)) {
    const v = out[k]
    if (Array.isArray(v)) (v as unknown[]).forEach(setIfEmpty)
    else setIfEmpty(v)
  }
}

/**
 * 无语句上下文时的字段兜底：把输入的 `pmi` 条目合并进产物的 `pmi` 字段。
 *
 * 只在 `anchor == null` 时调用——即 op 被**直接调用**（测试、包内复用、宿主直接
 * 调 API）而不是经由脚本语句执行。这条路径没有 `PartName`，注册表按名字索引
 * 用不上，标注只能靠 Shape 的纯数据字段承载；不合并的话，第二次调用钻孔就会把
 * 第一次的标注冲掉（产物是 `fromBrep` 新建的，字段为空）。
 *
 * 有语句上下文时**不做**：那条路径由 `api/pmi/registry.ts` 按零件名聚合，数据
 * 零拷贝。这里合并不是"因为几何变更而搬运"，而是"没有身份层时字段就是唯一载体"
 * 的降级约定。
 *
 * @param out - the op product (or its named outputs).
 * @param inputs - the op's geometry inputs.
 */
function inheritInputPmiWhenAnonymous(out: Shape | Record<string, Shape>, inputs: readonly Shape[]): void {
  const inherited = inputs.flatMap((i) => (i.pmi?.items ?? []) as unknown[])
  if (inherited.length === 0) return
  const mergeInto = (v: unknown): void => {
    if (v === null || typeof v !== 'object' || !('positions' in v)) return
    const shape = v as Shape
    const own = shape.pmi?.items ?? []
    shape.pmi = { items: [...(inherited as never[]), ...own] }
  }
  if (isShape(out)) {
    mergeInto(out)
    return
  }
  for (const k of Object.keys(out)) {
    const v = out[k]
    if (Array.isArray(v)) (v as unknown[]).forEach(mergeInto)
    else mergeInto(v)
  }
}

/** Human-readable op label for error messages (falls back when unnamed). */
function opLabel(meta: DualOpMeta): string {
  return meta.name ?? '<anon>'
}

/**
 * 从归一化后的实参里取出"参数对象"（最后一个非几何入参）。
 *
 * D11 之后 op 的实参形态统一为 `(input, params?)`；`positionalToObject` 已把
 * 位置形态装箱成对象，所以这里取最后一个既不是 Shape 也不是数组的对象即可。
 *
 * @param callArgs - the normalized argument list.
 * @returns the params object, or undefined when the call has none.
 */
function lastParamsOf(callArgs: readonly unknown[]): Record<string, unknown> | undefined {
  for (let i = callArgs.length - 1; i >= 0; i -= 1) {
    const a = callArgs[i]
    if (a === null || typeof a !== 'object' || Array.isArray(a)) continue
    if (isGeometryInput(a)) continue
    return a as Record<string, unknown>
  }
  return undefined
}

/**
 * 语句出口的 PMI 收尾：把 impl 写在无名产物上的标注归位 + 登记本语句的坐标变换。
 *
 * 两件事都只能在这里做：
 * - **归位**：`fai_drill` 在 impl 内部 `appendPmiItem(drilled.shape, …)`，而那个
 *   Shape 由 `fromBrep` 新建、此刻还没被 executor 命名，注册表按零件名索引收不到。
 * - **坐标变换**：变换矩阵是 op 的知识（`pmiRemap` 声明），而语句 id 是
 *   `defineOp.wrapped` 的知识，两者只在这个出口相遇。
 *
 * 只在最外层调用（`isOuter`）：嵌套 op 调用是实现细节，它们的类目标注最终都该
 * 归到最外层产物上，变换也只由最外层那条语句登记。
 *
 * @param meta - the op metadata (reads `pmiRemap`).
 * @param stmtId - the current statement id.
 * @param part - the statement's product part name (undefined when unnamed).
 * @param callArgs - the normalized argument list (source of the params object).
 */
function finalizePmi(
  meta: DualOpMeta,
  stmtId: StmtId,
  part: PartName | undefined,
  callArgs: readonly unknown[],
): void {
  if (part !== undefined) flushPendingPmi(part)
  const remap = meta.pmiRemap
  if (remap === undefined) return
  // `?? {}`：pmiRemap 带缺省值的 op（mirror 的默认镜像面 x=0）在没有参数对象时
  // 也要登记——否则 `cad.mirror(p)`（无 options）的几何镜像了、标注补偿却缺席。
  const params = lastParamsOf(callArgs) ?? {}
  let affine: PmiAffine | undefined
  try {
    affine = remap(params)
  } catch {
    // 参数不全/非法：坐标系未知。宁可不补偿（标注留在原坐标）也不要为一个
    // 纯显示问题中断整段建模。
    affine = undefined
  }
  registerPmiTransform(stmtId, affine)
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
 * `engines` (D11: engine whitelist for the implementation) and `outputs`
 * (named multi-products, e.g. split) as siblings.
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
    engines: decl.engines,
    meshEngines: decl.meshEngines,
    outputs: decl.outputs,
    schema: decl.schema,
    slotMap: decl.slotMap,
    naming: decl.naming,
    paramDims: decl.paramDims,
    retDim: decl.retDim,
    spec: decl.spec,
    dimCheck: decl.dimCheck,
    pmiRemap: decl.pmiRemap,
  }

  // Async wrapper: implementations may be sync or async (api mesh paths are
  // often async, e.g. drill/engrave/boolean). The compiled .fai.js product always
  // awaits the call, so returning a Promise is transparent.
  const wrapped = async (...args: A): Promise<Shape | Record<string, Shape>> => {
    // D11 (§4.2): faijs-native ops declare an object-form implementation, so a
    // positional call is boxed into the object form here — before
    // dispatch, so geometry inputs are collected from the normalized arg list.
    const callArgs = (
      meta.slotMap ? positionalToObject(args as unknown[], meta.slotMap, opLabel(meta)) : args
    ) as A
    // Geometry inputs: identity-or-structure auto collection (execution-time
    // read, same nature as hasBrep — decided before the implementation runs).
    // Compat: bare ManifoldMeshData args (host geoToManifoldMesh output) are
    // geometry inputs too — old form passed [input] so they reached the mesh path.
    const inputs = (callArgs as unknown[]).filter(isGeometryInput) as Shape[]
    // 注：这里**不**校验/搬运 PMI。标注归零件名所有（`api/pmi/registry.ts`），
    // 几何 op 消费带标注的零件是合法的（先钻孔后倒角是常规工艺），产物既不需要
    // 继承也不需要拦截——查询时沿这条语句登记的血缘图聚合即可。
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
        // PMI 父链快照必须**先于** register：register 会把 partOwner 覆盖成本条
        // 语句，之后 `stmtOf(input)` 就指向自己了（重赋值时输入名 == 输出名，
        // 聚合会自环断链）。见 api/pmi/registry.ts 文件头。
        registerPmiParents(asStmtId(anchor.id), inputs)
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
    const path = dispatchPath(inputs, meta, meta.engines)
    if (path === 'brep') {
      const r = await runImpl(meta, decl.brep as unknown as ((...a: unknown[]) => unknown) | undefined, callArgs)
      const out = meta.outputs ? wrapByKeys(r, meta.outputs, wrapBrepOne) : wrapBrepOne(r)
      inheritInputAppearance(out, inputs)
      inheritInputMeta(out, inputs)
      if (anchor == null) inheritInputPmiWhenAnonymous(out, inputs)
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
        // PMI 收尾：impl 内部写在未命名中间产物上的标注归位到产物名下；
        // 变换类 op 在这里登记坐标矩阵（标注数据不改，读时补偿）。
        // 只在 `isOuter` 时做——嵌套调用的标注留着，最终都归最外层产物。
        if (isOuter) finalizePmi(meta, stmtId, anchor.outputs[0] as PartName, callArgs)
      }
      return out
    }
    // 链切换兜底（'defer' 模式，方案 2026-10-21-weapp-tessellation-defer-plan §2.4）：
    // 判定走 mesh 链时，mesh 实现直接读输入 shape 的 positions/indices——若输入是
    // 'defer' 模式产出的懒 BREP shape（空 mesh），在此物化（幂等；物化参数与 eager
    // 路径一致），否则 mesh 实现会静默拿到垃圾几何。compound 成员一并物化。
    for (const s of inputs) {
      if (s && typeof s === 'object') {
        if ('positions' in s) materializeTessellation(s as Shape)
        const children = (s as { children?: unknown[] }).children
        if (Array.isArray(children)) {
          for (const child of children) {
            if (child && typeof child === 'object' && 'positions' in child) {
              materializeTessellation(child as Shape)
            }
          }
        }
      }
    }
    const m = await runImpl(meta, decl.mesh as unknown as ((...a: unknown[]) => unknown) | undefined, callArgs)
    const mOut = meta.outputs ? wrapByKeys(m, meta.outputs, wrapMeshOne) : wrapMeshOne(m)
    inheritInputAppearance(mOut, inputs)
    inheritInputMeta(mOut, inputs)
    if (anchor == null) inheritInputPmiWhenAnonymous(mOut, inputs)
    // PMI 收尾（mesh 链同 brep 链，见上面 brep 分支的注释）。
    if (isOuter && anchor && anchor.outputs.length > 0) {
      finalizePmi(meta, asStmtId(anchor.id), anchor.outputs[0] as PartName, callArgs)
    }
    return mOut
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
 * undefined, engines/outputs well-formed). Called by `registerLib`.
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
 * Read the dual-op metadata of a wrapped function (unit-system D8 declaration
 * surface). Returns `undefined` when the function carries no dual-op metadata,
 * so callers never probe the private key directly.
 *
 * @param fn - a function that may have been produced by `defineOp`/`compatOp`.
 * @returns the op's metadata, or `undefined`.
 */
export function dualOpMetaOf(fn: unknown): DualOpMeta | undefined {
  if (typeof fn !== 'function') return undefined
  return (fn as MetaCarrier)[DUAL_OP_META]
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
    // meshEngines（方案 2026-10-01 §3.4）：非空字符串数组。**不校验 id 是否为
    // "已注册的网格后端"**——装配在同一时刻前后，且第三方库可以被装配到我们不知道的
    // 后端上；门禁在 dispatchPath 处按当前装配比对（那里才拿得到真相）。
    if (meta.meshEngines !== undefined) {
      if (!Array.isArray(meta.meshEngines) || meta.meshEngines.length === 0 || meta.meshEngines.some((e) => typeof e !== 'string' || e.length === 0)) {
        throw new Error(`[faijs] lib function '${name}' declares invalid meshEngines (expected non-empty string[])`)
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
