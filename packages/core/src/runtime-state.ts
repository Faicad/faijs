/**
 * runtime-state — 全局运行时状态锚点（零依赖层）
 *
 * 设计文档：docs/plans/2026-08-29-engine-library-contract.md §6 / §7 / §8
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P0
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

import type { StatementIR } from './lang/types'
import type { PartName } from './identity'

// ── 后端配置（宿主注入的环境资源）──

/**
 * 执行模式（与 src/cad-runtime/ports.ts 的 ExecutionMode 保持一致）。
 * 此处重复定义是为了保持本模块零依赖；由守卫测试保证两者一致。
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
    /** 当前引擎能力声明（宽松结构，零依赖）。能力路由读（§8.4）。 */
    brepCapabilities?: {
      evolution?: boolean
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
  readonly stmt?: StatementIR
  constructor(message: string, stmt?: StatementIR) {
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
  readonly stmt?: StatementIR
  constructor(message: string, stmt?: StatementIR) {
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
  /** 当前执行语句（引擎在语句 fn 之前设置） */
  currentStmt: StatementIR | undefined
  /** Shape 构造器登记（isShape 的唯一依据） */
  readonly created: WeakSet<object>
  /** Shape 身份槽 */
  readonly slots: WeakMap<object, ShapeSlot>
  /** Shape → PartName 反查（keep 与 dependentsOf 用） */
  readonly shapeToName: WeakMap<object, PartName>
}

// ── 函数 BREP 域（控制流放松方案 §5.6 / D13） ──
// 本机函数体内的瞬态 BREP 句柄：进入函数时开启登记域，op 输出句柄写入时经
// registerFunctionBrep 登记；函数返回后引擎取走域、释放除返回值可到达句柄外的全部
// （对齐「调用方负责句柄生命周期」brep-ops.ts 与 meshesToStep 的 finally 模式）。
// 全局计数与 ModuleExecutor.userFunctionDepth 同步（单 runtime 场景，与 setCurrentStmt 同构）。

let functionBrepDepth = 0
const functionBrepDomain: unknown[] = []

/** 进入函数 BREP 域（ModuleExecutor 执行 local 语句 fn 之前调用）。 */
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

/** Shape 身份槽（OCCT 句柄 + 面演化 + 拓扑命名 + 装配行为）。 */
export interface ShapeSlot {
  solid?: unknown
  faceEvolution?: Map<number, number[]>
  /** 拓扑命名 RoleTable（§2.3 naming 槽：随 Shape 身份槽传播，不序列化）。 */
  roleTable?: unknown
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
export function setCurrentStmt(stmt: StatementIR | undefined): void {
  getRuntimeState().currentStmt = stmt
}

/**
 * 读取当前执行语句。库函数不应调用它（F1）。
 *
 * @returns the currently executing statement, or undefined if none.
 */
export function getCurrentStmt(): StatementIR | undefined {
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
 * 登记回调类型。由 ModuleExecutor 在装配时注入（保持 runtime-state 零依赖）。
 */
export type KeepSink = (stmtId: string, names: PartName[], hidden: boolean) => void

let keepSink: KeepSink | undefined

/**
 * 引擎装配 keep 的落地目标（ModuleExecutor.registerKeep）。
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
