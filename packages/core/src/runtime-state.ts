/**
 * runtime-state — 全局运行时状态锚点（零依赖层）
 *
 *
 * 本模块位于 L0+（零运行时依赖），是 L3 API 面（core/src/api，原 stdlib）与
 * cad-runtime（L2）之间唯一的共享状态。**放在这一层是为了避免循环依赖**：
 * api/ 不能 import cad-runtime（cad-runtime/api-namespace.ts 已经 import 了 api/）。
 *
 * 承载三类状态：
 * 1. Backends —— 宿主注入的环境资源（内核 / 端口 / 模式 / 标准库命名空间）
 * 2. 当前执行语句 —— keep() 归属用（引擎在语句 fn 之前设置）
 * 3. Shape 身份表 —— 构造器登记（isShape 依据）与 Shape→PartName 反查
 *
 * ⚠️ 依赖方向红线：本文件不得 import 任何 src/ 下的模块（只可 import type）。
 */

import type { PartName, StmtId } from './identity'

/**
 * Lightweight execution anchor — carries only the fields consumed by
 * library functions via getCurrentStmt(): `id` (StmtId), `outputs` (PartName[]),
 * `callee`, and `hasAssignment`. The DirectExecutor creates these from
 * line-number + writes.
 */
export interface ExecutionAnchor {
  readonly id: string
  readonly outputs: PartName[]
  readonly callee?: string
  readonly hasAssignment?: boolean
}

// ── 后端配置（宿主注入的环境资源）──

/**
 * 执行模式（与 src/cad-runtime/ports.ts 的 ExecutionMode 保持一致）。
 *
 * 此处重复定义是为了保持本模块零依赖。一致性由 `cad-runtime/runtime.ts:460`
 * （`mode: this.mode`，`ExecutionMode` → 本类型的赋值）在编译期间接钉住：
 * 只给 `ExecutionMode` 加成员而不加到这里 → 该行 tsc 报错。
 * （2026-09-22 核实：无独立守卫测试。）
 */
export type RuntimeExecutionMode = 'auto' | 'brep' | 'mesh'

/** 宿主注入的环境资源。字段类型用宽松结构，避免本模块依赖具体实现。 */
export interface Backends {
  /** 契约版本（装配期校验，不兼容即抛错） */
  readonly contractVersion: number
  /** 执行配置（可变对象，宿主可在运行期切换） */
  readonly config: {
    mode: RuntimeExecutionMode
    /** 当前 BREP 引擎 id（注册表首个注册者；未注册为 null）。能力路由读（§8.4）。 */
    brepEngineId?: string | null
    /**
     * 当前引擎能力声明（宽松结构，零依赖）。能力路由读（§8.4）。
     *
     * `evolution` = 本引擎**实际提供**的 `*WithHistory` 核函数名名单
     * （`brep/engine/types.ts` 的 `BrepEvolutionKind`）。**不是**族级布尔——
     * 族级布尔会多报能力、使静态判定失效（Phase 0.2）。
     * 本模块须零依赖，故此处只写 `readonly string[]`；权威类型见
     * `BrepCapabilities`，消费侧由 `backend-dispatch.engineCapabilitySet` 归一化。
     */
    brepCapabilities?: {
      evolution?: readonly string[]
      /**
       * 非演化内核方法名（D5）：本引擎**实际提供**的 L1 中立方法名
       * （`getBoundingBox` / `getVolume` / `getSurfaceArea` / `getLength` /
       * `getCenterOfMass` 等）。2026-09-24 narrowing plan §2.4：与
       * `backend-dispatch.EngineCapabilitiesLike` 对齐（该类型有 `methods`，
       * 运行时配置镜像此前缺失——非字面量赋值不做 excess property 检查，
       * `methods` 判定"能用但没被契约钉住"）。
       */
      methods?: readonly string[]
      heal?: boolean
      directEdit?: boolean
      advSurface?: boolean
      assembly?: boolean
      meshLift?: boolean
    }
    partTransform?: { position: [number, number, number]; scale?: [number, number, number] }
  }
  /** 几何后端。brep 引擎异步初始化 → 用 getter。 */
  readonly kernel: {
    readonly brep: unknown | null
    readonly csg: unknown | undefined
    readonly sdf: unknown | undefined
    /**
     * 网格实体后端（网格语义路径的内核；`brep/mesh-solid.ts` 的 `MeshSolidBackend`）。
     *
     * **与 `brep` 独立**：mesh 零件既可以在「宿主用 OCCT 做 BREP、用 brepkit 做
     * mesh」的装配下产出，也可以在纯 mesh 模式下产出。未装配 → `undefined`，
     * 此时 `load` 的 mesh 路径保持"裸网格、无近似拓扑"的历史行为（这不是静默
     * 降级：没有网格内核是宿主的装配事实，与"规范化失败"是两回事）。
     *
     * 类型在本模块里写 `unknown`（零依赖红线），权威类型见 `MeshSolidBackend`。
     */
    readonly meshSolid?: unknown
  }
  /** 宿主端口（透传 HostPorts） */
  readonly fonts: unknown
  readonly texture: unknown
  readonly assets: unknown
  readonly events: unknown
  /** faijs 自带标准库命名空间（引擎不区分它与第三方库——都是库函数；P5 起由宿主注入，core 不默认装配） */
  readonly cad?: StdlibNamespace
}

/**
 * 契约版本。破坏性变更 +1。加载第三方库时校验，不兼容即抛错。
 *
 * v3（P23，§5.2 / D11）：`defineOp` 的实现边界统一为 Result 语义——实现可返回
 * `Result`（边界 unwrap，`err` → 抛错）、可抛错（归一为带 op 名的错误），
 * 也可照旧返回裸产物（透传）；并新增 D11 `positional` 位置形态声明。
 * v2 → v3 是破坏性变更：按 v2 契约构建的库必须重新构建。
 */
export const CONTRACT_VERSION = 3

/** 库函数签名（引擎视角：任意参数的普通函数，信息均匀化，不按名字分支）。 */
export type StdlibFn = (...args: any[]) => unknown

/** 库命名空间：函数名 → 库函数（faijs 自带标准库与第三方库同构）。 */
export interface StdlibNamespace {
  [name: string]: StdlibFn
}

/**
 * 契约版本校验（P7 第三方库通道）：加载时校验，不兼容即抛错（不静默降级）。
 * 第三方库模块若带 contractVersion 字段（与 CONTRACT_VERSION 对齐），必须匹配。
 *
 * @param lib - the library module whose contractVersion field is validated.
 */
export function assertContractVersion(lib: { contractVersion?: unknown }): void {
  if (lib.contractVersion !== undefined && lib.contractVersion !== CONTRACT_VERSION) {
    throw new Error(
      `[faijs] library contract version mismatch: got ${String(lib.contractVersion)}, expected ${CONTRACT_VERSION}`,
    )
  }
}

/**
 * brep 强制模式下的不支持错误（mesh-only 函数 / 输入不在 BREP 链）。
 *
 * 由分派路径抛出，CadRuntime 捕获后转换为 ExecutionResult.failedAt
 * （与旧解释器"brep 模式立即返回 E_BREP_UNSUPPORTED，不静默回退 mesh"的语义一致）。
 * P2 起定义在本层（零依赖），L3 API 命名空间与引擎共享同一类（instanceof 判定）。
 */
export class BrepUnsupportedError extends Error {
  /** The statement that triggered the unsupported operation, when available. */
  readonly stmt?: ExecutionAnchor
  constructor(message: string, stmt?: ExecutionAnchor) {
    super(message)
    this.name = 'BrepUnsupportedError'
    this.stmt = stmt
  }
}

/**
 * Unsupported error for mesh-forced mode (brep-only functions, or auto-mode
 * brep-only functions with a broken input chain).
 *
 * Symmetric to BrepUnsupportedError: thrown statically by the dispatch path,
 * caught by CadRuntime and converted into ExecutionResult.failedAt. A brep-only
 * function being unavailable in mesh mode is expected behavior (mode ×
 * implementation-set mismatch), not a bug fallback — the static-dispatch red
 * line (no try-catch, no runtime fallback) is unchanged.
 */
export class MeshUnsupportedError extends Error {
  /** The statement that triggered the unsupported operation, when available. */
  readonly stmt?: ExecutionAnchor
  constructor(message: string, stmt?: ExecutionAnchor) {
    super(message)
    this.name = 'MeshUnsupportedError'
    this.stmt = stmt
  }
}

// ── 状态容器 ──

/**
 * The global runtime state singleton: backend configuration, the currently
 * executing statement, and the Shape identity tables (constructor registry,
 * identity slots, and Shape → PartName reverse lookup).
 */
export interface FaijsRuntimeState {
  readonly stateVersion: number
  /** 后端配置（configureBackends 写入） */
  backends: Backends | undefined
  /** 当前执行语句锚点（引擎在语句 fn 之前设置） */
  currentStmt: ExecutionAnchor | undefined
  /** Shape 构造器登记（isShape 的唯一依据） */
  readonly created: WeakSet<object>
  /** Shape 身份槽 */
  readonly slots: WeakMap<object, ShapeSlot>
  /** Shape → PartName 反查（keep 与 dependentsOf 用） */
  readonly shapeToName: WeakMap<object, PartName>
  /** 同语句 lineage 去重标记（define-op 写入；语句边界 setCurrentStmt 重置）。 */
  registeredStmtId: StmtId | undefined
}

// ── 函数 BREP 域（控制流放松方案 §5.6 / D13） ──
// 本机函数体内的瞬态 BREP 句柄：进入函数时开启登记域，op 输出句柄写入时经
// registerFunctionBrep 登记；函数返回后引擎取走域、释放除返回值可到达句柄外的全部
// （对齐「调用方负责句柄生命周期」brep-ops.ts 与 meshesToStep 的 finally 模式）。
// 全局计数与 DirectExecutor.userFunctionDepth 同步（单 runtime 场景，与 setCurrentStmt 同构）。

let functionBrepDepth = 0
const functionBrepDomain: unknown[] = []

/** 进入函数 BREP 域（DirectExecutor 执行 local 语句 fn 之前调用）。 */
export function enterFunctionBrep(): void {
  if (functionBrepDepth === 0) functionBrepDomain.length = 0
  functionBrepDepth++
}

/** 退出函数 BREP 域（fn 结束后调用）。 */
export function exitFunctionBrep(): void {
  functionBrepDepth = Math.max(0, functionBrepDepth - 1)
}

/**
 * 登记函数域内新产生的 BREP 句柄（hook 点在 op 输出 shape 槽位写入处——fromBrep）。
 * 非函数域（depth = 0）时 no-op（零开销，现状路径不变）。
 * @param solid - 新产生的 OCCT 句柄。
 */
export function registerFunctionBrep(solid: unknown): void {
  if (functionBrepDepth > 0) functionBrepDomain.push(solid)
}

/**
 * 取走当前函数域的句柄登记表并清空（引擎在 fn 结束后调用，随后释放非返回值句柄）。
 * @returns 当前函数域的句柄登记表快照。
 */
export function takeFunctionBrepDomain(): unknown[] {
  const domain = [...functionBrepDomain]
  functionBrepDomain.length = 0
  return domain
}

/** Shape 身份槽（OCCT 句柄 + 网格实体句柄 + 网格面句柄 + 面演化 + 拓扑命名 + 装配行为）。 */
export interface ShapeSlot {
  /** BREP 精度链句柄。与 `meshSolid` / `meshFace` **互斥**（同时存在 = 缺陷）。 */
  solid?: unknown
  /**
   * 网格实体句柄（近似链）。与 `solid` **互斥**——网格零件按定义没有精度链，
   * BREP 实体也不携带网格实体。互斥由 `backend-dispatch.assertShapeSlotExclusive`
   * 在分派前静态校验（不给运行时"选边站"的机会；方案 §3.2）。
   *
   * 它只表示"这个 Shape 是网格零件"这一事实，句柄的生命周期由
   * `brep/mesh-solid.ts` 的 `MeshSolidRegistry` 持有。
   */
  meshSolid?: unknown
  /**
   * 网格链**面**句柄（近似链的构造中几何，方案 2026-10-01 §4 Phase 3）。
   *
   * 与 `solid` / `meshSolid` 互斥：它是网格链上的一张面（`sketchOnFace` 在
   * 近似拓扑面上铺草图后的产物），既不是精度链实体，也不是网格零件本身。
   * 它存在的原因和 BREP 链上「面 Shape」完全对称——BREP 侧 `sketchOnFace` 返回
   * `fromBrep(face, { solid: face })`，面句柄同样占着 `solid` 槽；网格侧若把面句柄
   * 塞进 `solid`，`hasBrep` 会变真、分派会走精度链，在只有网格后端的宿主上必然报错。
   * 所以面句柄需要自己的一格，不能借位。
   */
  meshFace?: unknown
  faceEvolution?: Map<number, number[]>
  // 1.10 前置③：roleTable 槽字段已删除——权威落点在血缘图旁挂
  // （topology/naming/lineage.ts 的 recordOutput / tableOfPart），
  // 解析缓存 miss 由回走重算恢复（api/topo-resolve.ts）。
  /** mesh/primitive 面 hint 快照（§3.6 setTopology 注入时由 runtime 提炼写入，解析兜底用）。 */
  faceHints?: unknown
  behavior?: unknown
}

/**
 * 装配变换（引擎应用）：求解在库（solveTransforms），应用与下游失效在引擎（P6）。
 * index = 成员下标（compound.children 内）。
 */
export interface AssemblyTransform {
  index: number
  quaternion: [number, number, number, number]
  pivot: [number, number, number]
  translation: [number, number, number]
  rotationMatrix: number[]
}

/**
 * do_assemble 的待应用变换登记（P6：求解 ≠ 传播）。
 * 库只把求解结果写到这里；引擎在语句执行后取走并应用 + 失效下游。
 */
const pendingAssemblyKeys = new Set<object>()
const pendingAssemblyTransforms = new WeakMap<object, AssemblyTransform[]>()

/**
 * Register a compound's pending assembly transforms (called from the
 * do_assemble method body; accumulates across calls).
 *
 * @param c - the compound object that owns the transforms.
 * @param ts - the assembly transforms to append.
 */
export function setPendingAssemblyTransforms(c: object, ts: AssemblyTransform[]): void {
  if (ts.length === 0) return
  pendingAssemblyKeys.add(c)
  const existing = pendingAssemblyTransforms.get(c) ?? []
  pendingAssemblyTransforms.set(c, [...existing, ...ts])
}

/**
 * Take all pending assembly transforms and clear them (called by the engine's
 * afterStatement hook; consumed exactly once).
 *
 * @returns the list of compounds with their accumulated transforms.
 */
export function takePendingAssemblyTransforms(): Array<{ compound: object; transforms: AssemblyTransform[] }> {
  const out: Array<{ compound: object; transforms: AssemblyTransform[] }> = []
  for (const c of pendingAssemblyKeys) {
    const ts = pendingAssemblyTransforms.get(c)
    if (ts && ts.length > 0) out.push({ compound: c, transforms: ts })
    pendingAssemblyTransforms.delete(c)
  }
  pendingAssemblyKeys.clear()
  return out
}

// ── P3：运动副位姿登记（ExecutionResult.kinematics）──
// 与 pendingAssemblyTransforms 同模式：库只把 solveKinematics 的 per-member 位姿
// 写到这里，引擎在语句执行后取走并放入 ExecutionResult.kinematics（宿主动画/导出
// 从 ExecutionResult 读取，不新增返回值消费语义）。

/** 单个成员的位姿（position + faijs [x,y,z,w] rotation；与 api/assembly/joints 的 KinematicsPose 结构一致）。 */
export interface AssemblyKinematicsPose {
  position: [number, number, number]
  rotation: [number, number, number, number]
}

/** 位姿键：成员名 → AssemblyKinematicsPose（含恒等链根；键 = PartName）。 */
export type AssemblyKinematics = Record<string, AssemblyKinematicsPose>

const pendingKinematicsKeys = new Set<object>()
const pendingAssemblyKinematics = new WeakMap<object, AssemblyKinematics>()

/**
 * Register a compound's pending assembly kinematics (P3; called from the
 * do_assemble/solve method body; accumulates across calls).
 *
 * @param c - the compound object that owns the kinematics.
 * @param kin - per-member poses keyed by member name (all members, incl. identity).
 */
export function setPendingAssemblyKinematics(c: object, kin: AssemblyKinematics): void {
  pendingKinematicsKeys.add(c)
  pendingAssemblyKinematics.set(c, kin)
}

/**
 * Take all pending assembly kinematics and clear them (called by the engine after
 * an assembly statement; consumed exactly once).
 *
 * @returns the list of compounds with their per-member kinematics.
 */
export function takePendingAssemblyKinematics(): Array<{ compound: object; kinematics: AssemblyKinematics }> {
  const out: Array<{ compound: object; kinematics: AssemblyKinematics }> = []
  for (const c of pendingKinematicsKeys) {
    const kin = pendingAssemblyKinematics.get(c)
    if (kin) out.push({ compound: c, kinematics: kin })
    pendingAssemblyKinematics.delete(c)
  }
  pendingKinematicsKeys.clear()
  return out
}

const STATE_VERSION = 1
const KEY = '__FAICAD_FAIJS_RUNTIME__'

/**
 * 获取全局状态（单例）。
 *
 * 挂在 globalThis 上是为了让"两份 faijs 代码"（宿主 bundle 一份、第三方库
 * 打进一份）共享同一份状态——两份 WeakSet 会导致 Shape 身份不通（几何孤岛）。
 * 构建期去重（external）是主手段，这里是兜底。
 *
 * @returns the shared global runtime state singleton.
 */
export function getRuntimeState(): FaijsRuntimeState {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[KEY] as FaijsRuntimeState | undefined
  if (existing) {
    if (existing.stateVersion !== STATE_VERSION) {
      throw new Error(
        `[faijs] runtime state version mismatch: loaded=${existing.stateVersion}, expected=${STATE_VERSION}`,
      )
    }
    return existing
  }
  const created: FaijsRuntimeState = {
    stateVersion: STATE_VERSION,
    backends: undefined,
    currentStmt: undefined,
    created: new WeakSet<object>(),
    slots: new WeakMap<object, ShapeSlot>(),
    shapeToName: new WeakMap<object, PartName>(),
    registeredStmtId: undefined,
  }
  g[KEY] = created
  return created
}

// ── 后端配置读写 ──

/**
 * 宿主在启动时调用一次，注入环境资源。
 *
 * @param backends - the host-injected environment resources.
 */
export function configureBackends(backends: Backends): void {
  getRuntimeState().backends = backends
}

/**
 * 读取后端配置。库函数通过它获取内核与宿主端口。
 *
 * 未配置时抛错——不要返回默认值兜底（配置是宿主的责任，缺失必须暴露）。
 *
 * @returns the configured backend resources.
 */
export function getBackends(): Backends {
  const b = getRuntimeState().backends
  if (!b) {
    throw new Error('[faijs] backends not configured: call configureBackends() before executing')
  }
  return b
}

// ── 当前执行语句（引擎内部状态）──

/**
 * 引擎在语句 fn 之前调用（替换现状的 exec.currentStmt = source）。
 *
 * @param stmt - the statement currently being executed.
 */
export function setCurrentStmt(stmt: ExecutionAnchor | undefined): void {
  const s = getRuntimeState()
  // 语句边界：锚点变化（含语句结束置 undefined）时解除同语句 lineage 去重标记，
  // 使下一条语句（或同 id 复跑）重新获得注册资格；同一条语句内 TS 库函数
  // （如 cq-compat Workplane op）连续调用多个 defineOp 时共享锚点，标记保持
  // 生效，嵌套调用正确跳过注册（见 define-op 的 isOuter 判定）。
  if (s.currentStmt?.id !== stmt?.id) s.registeredStmtId = undefined
  s.currentStmt = stmt
}

/**
 * 读取当前执行语句。库函数不应调用它（F1）。
 *
 * @returns the currently executing statement, or undefined if none.
 */
export function getCurrentStmt(): ExecutionAnchor | undefined {
  return getRuntimeState().currentStmt
}

// ── Shape 身份表 ──

/**
 * Shape → 变量名反查（keep 与 dependentsOf 依赖）。
 *
 * @param shape - the shape to look up.
 * @returns the part name registered for the shape, or undefined.
 */
export function nameOf(shape: object): PartName | undefined {
  return getRuntimeState().shapeToName.get(shape)
}

/**
 * 登记 Shape → 变量名映射。
 *
 * @param shape - the shape to register.
 * @param name - the part name to associate with the shape.
 */
export function setName(shape: object, name: PartName): void {
  getRuntimeState().shapeToName.set(shape, name)
}

// ── keep 声明（库函数体调用）──

/**
 * 登记回调类型。由 DirectExecutor 在装配时注入（保持 runtime-state 零依赖）。
 */
export type KeepSink = (stmtId: string, names: PartName[], hidden: boolean) => void

let keepSink: KeepSink | undefined

/**
 * 引擎装配 keep 的落地目标（DirectExecutor.registerKeep）。
 *
 * @param sink - the keep callback registered by the engine, or undefined to clear.
 */
export function setKeepSink(sink: KeepSink | undefined): void {
  keepSink = sink
}

/**
 * 函数体 keep 声明：声明保留这些 Shape 对应的变量（可见）。
 *
 * 库作者在库函数体内调用：
 * ```ts
 * import { keep } from '@faicad/faijs'
 * export function group(params) {
 *   keep(...params.members)
 *   return compound(params.members)
 * }
 * ```
 *
 * 归属到"当前正在执行的语句"（引擎在 fn 之前 setCurrentStmt）。
 * 未登记在 shapeToName 的对象（库内部的自定义对象）被忽略——这是刻意的静默。
 *
 * @param shapes - the shapes whose corresponding variables should be kept.
 */
export function keep(...shapes: unknown[]): void {
  registerKeep(shapes, false)
}

/**
 * 函数体 keep 声明：保留但 canvas 不渲染（布尔系函数的源）。
 *
 * @param shapes - the shapes whose corresponding variables should be kept hidden.
 */
export function keepHidden(...shapes: unknown[]): void {
  registerKeep(shapes, true)
}

function registerKeep(shapes: unknown[], hidden: boolean): void {
  const stmt = getRuntimeState().currentStmt
  if (!stmt || !keepSink) return
  const names: PartName[] = []
  for (const s of shapes) {
    if (s === null || typeof s !== 'object') continue
    const n = nameOf(s)
    if (n !== undefined) names.push(n)
  }
  if (names.length === 0) return
  keepSink(String(stmt.id), names, hidden)
}

// ── 文件单位登记（unit-system §10.6：load op 的 detectedUnit 回传）──
// 与 pendingAssemblyTransforms 同模式：load op 把读出的文件声明单位写到这里，
// 引擎在语句执行后取走并按 part 名放进 ExecutionResult.detectedUnits（宿主写进
// LoadedFileModel.sourceUnit，不新增返回值消费语义）。

/** Per-part declared file units (key = PartName; null-never — absent key = unknown). */
export type DetectedUnits = Map<PartName, string>

const pendingDetectedUnits = new Map<PartName, string>()

/**
 * Register a part's declared file unit (called from the load op body; the unit
 * is metadata only — coordinates are already base-unit, never re-scaled).
 *
 * @param partName - the variable name the loaded shape will be bound to.
 * @param unit - the file's own declared unit (faijs UnitName).
 */
export function setPendingDetectedUnit(partName: PartName, unit: string): void {
  pendingDetectedUnits.set(partName, unit)
}

/**
 * Take all pending detected units and clear them (engine, after each statement;
 * consumed exactly once).
 *
 * @returns a fresh Map of part name → declared unit, copied from the pending
 *   store and cleared so it is consumed exactly once.
 */
export function takePendingDetectedUnits(): DetectedUnits {
  const out = new Map(pendingDetectedUnits)
  pendingDetectedUnits.clear()
  return out
}

// ── 多零件降级登记（fileid-container-and-nesting §5.4：cad.load 只支持单零件）──
// 与 pendingDetectedUnits 同模式：`cad.load` op 读到多零件文件（多 solid STEP /
// 多 object 3MF）时降级取第一个零件，并把"原文件零件数"登记到这里；引擎在语句
// 执行后取走并按 part 名放进 ExecutionResult.multiPartCounts（宿主据此弹警告
// 「该文件包含 N 个零件，当前仅加载第一个」，§5.4:166）。

/** Per-part declared multi-part degradation (key = PartName; absent = 单零件/无多零件文件). */
export type MultiPartCounts = Map<PartName, number>

const pendingMultiPartCounts = new Map<PartName, number>()

/**
 * Register a part that was downgraded from a multi-part file (called from the
 * load op body; the shape returned is only the first-part geometry).
 *
 * @param partName - the variable name the loaded (single) shape is bound to.
 * @param partCount - the total number of parts the source file declared (>= 2).
 */
export function setPendingMultiPartCount(partName: PartName, partCount: number): void {
  pendingMultiPartCounts.set(partName, partCount)
}

/**
 * Take all pending multi-part counts and clear them (engine, after each
 * statement; consumed exactly once).
 *
 * @returns a fresh Map of part name → part count, copied from the pending store.
 */
export function takePendingMultiPartCounts(): MultiPartCounts {
  const out = new Map(pendingMultiPartCounts)
  pendingMultiPartCounts.clear()
  return out
}

// ── 网格实体登记（方案 2026-10-01 §3.3：load 的 mesh 路径产出网格实体 + 近似拓扑）──
// 与 pendingDetectedUnits 同模式：load op（在 @faicad/faijs-extra）不能直接持有
// CadRuntime 实例，故把"规范化得到的句柄"与"近似拓扑数据"登记到这里，引擎在语句
// 执行后取走：句柄进 MeshSolidRegistry + 写 Shape 槽，拓扑进 topologyCache。
//
// 两步分开登记（而不是塞进一个结构）是为了让**拓扑可缺失**：句柄是 mesh 零件的
// 身份，拓扑是它的可用性；将来若出现"只有句柄、拓扑延后构建"的路径，不需要改协议。

const pendingMeshSolids = new Map<PartName, unknown>()
const pendingMeshTopologies = new Map<PartName, unknown>()

/**
 * 登记某 part 的网格实体句柄（load op 调用；由引擎在语句执行后收编）。
 *
 * @param partName - the variable name the loaded mesh shape will be bound to.
 * @param solid - the normalized mesh solid handle (opaque outside the mesh backend).
 */
export function setPendingMeshSolid(partName: PartName, solid: unknown): void {
  pendingMeshSolids.set(partName, solid)
}

/**
 * 取走全部待收编的网格实体句柄并清空（引擎在语句执行后调用，消费一次）。
 *
 * @returns a fresh Map of part name → mesh solid handle.
 */
export function takePendingMeshSolids(): Map<PartName, unknown> {
  const out = new Map(pendingMeshSolids)
  pendingMeshSolids.clear()
  return out
}

/**
 * 登记某 part 的近似拓扑数据（load op 调用；`SelectorRuntimeData`，本层只按
 * `unknown` 透传——零依赖红线）。
 *
 * @param partName - the variable name the loaded mesh shape will be bound to.
 * @param data - the serializable selector runtime data built from the mesh solid.
 */
export function setPendingMeshTopology(partName: PartName, data: unknown): void {
  pendingMeshTopologies.set(partName, data)
}

/**
 * 取走全部待收编的近似拓扑数据并清空（引擎在语句执行后调用，消费一次）。
 *
 * @returns a fresh Map of part name → selector runtime data.
 */
export function takePendingMeshTopologies(): Map<PartName, unknown> {
  const out = new Map(pendingMeshTopologies)
  pendingMeshTopologies.clear()
  return out
}
