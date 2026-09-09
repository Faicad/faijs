/**
 * CadRuntime — 执行核心（L2 编排层）
 *
 * Direct-only execution: the runtime runs only the direct path
 * (extractMetadata → DirectExecutor → computeLiveShapes).
 *
 * 职责：
 * - 执行 .fai.js 源码文本，产出 ExecutionResult（纯计算，不碰 store/DOM）
 * - 管理 statementCache 作为实例成员
 * - 执行模式感知（auto / brep / mesh）
 *
 * 不做的事（留给 browser host）：
 * - undo 快照
 * - SceneMutator.createPart / commitGeometry
 * - scriptStore 写入
 * - group/assembly 重建
 * - window.dispatchEvent / toast
 */

import type { TerminalShape } from '../lang/types'
import type { Shape } from '../mesh/types'
import type { BrepChainState } from '../brep/brep-chain'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { getBrepEngine, hasBrepEngine, getActiveBrepEngineId } from '../brep/engine/registry'
import { ensureOcctDefaultEngine } from '../brep/engine/adapters/occt'
import { ParseError } from '../lang/parse-error'
import type { SecurityPolicy } from '../lang/security-scanner'
import type { HostPorts, ExecutionMode } from './ports'
import type { SelectorRuntimeData } from '../topology/build-selector-runtime'
import type { SelectorRuntime } from '../topology/types'
import { buildSolidTopologyRuntime } from '../brep/brep-topology'
import type { SolidTopologyResult } from '../brep/brep-topology'
import { buildTopologyFromMesh } from '../brep/brep-topology'
import type { BrepMeshResult } from '../brep/engine/types'
import { asPartName, type PartName, type StmtId } from '../identity'
import { DirectExecutor, type Namespaces, type DirectExecOpts } from './direct-executor'
import { ModuleRegistry, ModuleRegistryError, isRelativeSpecifier } from './module-registry'
import type { ModuleRunResult } from './module-registry'
import { computeLiveShapes, lineConsumes, blockConsumes, type KeepView } from './live-shapes'
import { extractMetadata, type UiMetadata } from '../lang/metadata-extractor'
import {
  configureBackends, CONTRACT_VERSION,
  assertContractVersion, type StdlibNamespace,
  type AssemblyKinematicsPose,
} from '../runtime-state'
import { admitCompatLib } from './admit-compat-lib'
import { hasDualOp } from '../define-op'
import { computeLibId } from './lib-id'
import { computeContentKey, stableFingerprint } from './content-key'
export { computeContentKey } from './content-key'
export { stableFingerprint } from './content-key'
import { isCompoundLike, getSlot, ensureSlot, type CompoundShape } from '../shape'
import type { PartNaming } from '../topology/naming/types'
import { buildPartNaming, assignPrimitiveFaceRoles, type PartNamingInput } from '../topology/naming/build-naming'
import { faceRowToHint } from '../topology/naming/geom-hint'
import { HASH_UPPER_BOUND } from '../brep/face-evolution'


// ── 装配变换死代码已删除 ──
// v8: applyPrecomputedTransform / eulerDegToMatrix3 / propagateTransform 已删除。
// 装配 pass 委托 executeDoAssemble（唯一真源），约束只存 face 数据、由 api/assembly 实时求解。

// ── 类型定义 ──

/**
 * A single validation error produced by CadRuntime.check.
 */
export interface CheckError {
  /** The stage that produced the error ('keep' = keep directive validation). */
  stage: 'parse' | 'symbol' | 'reference' | 'keep' | 'security'
  message: string
  line?: number
  stmtId?: string
  /** Parse diagnostic code (e.g. E_CONTROL_FLOW, passed through from parser ParseError.code). */
  code?: string
  /** SecurityScanner rule ID (only when stage='security'; e.g. SEC_IDENT / SEC_SYNTAX / ...). */
  ruleId?: string
}

/**
 * The aggregated result of a CadRuntime.check dry run.
 */
export interface CheckResult {
  ok: boolean
  errors: CheckError[]
  warnings: string[]
  /** Structured context for AI self-correction. */
  script?: { statements: number; callees: string[] }
}

/**
 * 拓扑来源类型 — 静态判定，不混用。
 * - `brep`：BREP 真拓扑（stepRuntimes），由 OCCT solid 构建
 * - `primitive`：primitive 假拓扑（primitiveRuntimes），创建时刻快照
 * - `mesh`：mesh 假拓扑（meshRuntimes），加载时刻快照
 */
export type TopologySource = 'brep' | 'primitive' | 'mesh'

/**
 * 单个 part 的拓扑数据 — 由 ExecutionResult 携带，宿主从结果消费。
 *
 * 宿主不应再直接 import faijs 的拓扑构建函数（buildSelectorRuntime 等），
 * 而是从 ExecutionResult.topology 中读取。
 */
export interface PartTopology {
  /** partName 即 faijs 变量名（PartName，品牌型） */
  partName: PartName
  /** 拓扑来源（静态判定） */
  source: TopologySource
  /** 序列化的拓扑数据（可跨 Worker 传输） */
  data: SelectorRuntimeData
}

/**
 * The result of a CadRuntime execution, carrying geometry, chain state, and
 * host-consumable topology data.
 */
export interface ExecutionResult {
  /**
   * Statement output cache (PartName → Shape or compound; includes the dual
   * front/back outputs of a split). UI query entry point listing every shape
   * variable — unregistered compounds returned by third parties (structural
   * test isCompoundLike) enter as well.
   */
  outputs: Map<PartName, Shape | CompoundShape>
  /** BREP 链状态（含逐 part solid 句柄） */
  brepChain: BrepChainState
  /** 终端几何列表 */
  terminals: TerminalShape[]
  /** 信息/警告列表 */
  infos: string[]
  /** 失败信息（如果执行中途出错）；lineNo 为 DirectExecutor 路径新增（§4.2 E-add，宿主按现状读前三个字段不破裂）；code 为原始错误码（如有，如 E_TOPO_NOT_FOUND / E_ARGS_FORM） */
  failedAt?: { index: number; callee: string; message: string; lineNo?: number; code?: string }
  /** 逐终端的 BREP 实体（仅持有 solid 的终端出现在此表）。key 为终端 PartName。 */
  brepSolids?: Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }>
  /**
   * 拓扑数据 — 每个 part 的拓扑运行时。
   * key 为 PartName。
   * E13：由 ExecutionResult 携带，宿主从结果消费。
   * 拓扑来源静态判定：BREP 成功时 source='brep'，否则根据 part 类型判定。
   */
  topology?: Map<PartName, PartTopology>
  /**
   * 拓扑命名数据 — 每个 part 的命名行（§3.7 of
   *
   * 宿主拾取到 Reference（序号）后 O(1) 反查命名行 → captureTopoRef 造 TopoRef。
   * BREP/primitive 完整（faceNaming 有 origin+role），mesh 只给 hint（role=''）。
   * 与 topology 并列、选择器 manifest 不改动；命名数据不进 topology-store。
   */
  naming?: Map<PartName, PartNaming>
  /**
   * 装配/分组结构 — 每个 compound 变量（group/assembly 产物）的成员变量名列表。
   * key 为 compound 变量名（PartName），value 为成员变量名列表。
   */
  compounds?: Map<PartName, PartName[]>
  /** 被 touch 声明的原地修改 Shape 的持有变量名（装配变换后 collectResult 填充，去重） */
  changed?: PartName[]
  /**
   * 活跃但非几何的值（keep-syntax 设计 §5.2，UI 可选消费）。
   * DAG 叶子且非 shape/compound：第三方测量/查询函数返回的 number/普通对象等。
   * 不进 terminals（terminals 只含几何，零回归）。
   */
  activeValues?: Map<PartName, unknown>
  /**
   * P3：装配运动副 per-member 位姿（键 = 成员名；含恒等链根），仅在含 joints 的
   * assembly solve 语句执行后出现。宿主从本字段读取（动画/导出），不新增返回值
   * 消费语义（asm.solve() 保持 R0 语句形态，与 do_assemble 现状一致）。
   */
  kinematics?: Map<PartName, AssemblyKinematicsPose>
}

/**
 * Options controlling a single CadRuntime execution. All inputs are code text
 * or plain values — the engine's internal IR is never part of this surface.
 */
export interface ExecuteOptions {
  /** The parameter table. */
  params?: Record<string, unknown>
  /** partTransform（世界→局部坐标偏移 + 单位缩放） */
  partTransform?: { position: [number, number, number]; scale?: [number, number, number] }
  /** 语句前钩子（用于 undo 逐语句快照）；参数为语句 id（sN）与语句下标 */
  beforeStatement?: (stmtId: string, index: number) => void
  /**
   * 增量执行起点（兼容旧签名）：从指定位置开始顺序执行，
   * 之前的语句不进执行循环（缺省 0 = 全量执行）。
   */
  startIndex?: number
  /**
   * 拓扑构建开关（Phase 2.6）：
   * - 'auto'（默认）：为"在 BREP 链上"的终端自动构建 BREP 真拓扑
   * - 'brep'：为所有在 BREP 链上的输出构建拓扑（含非终端）
   * - 'off'：不自动构建（只返回宿主 setTopology 注入的拓扑）
   */
  topology?: 'auto' | 'brep' | 'off'
  /**
   * 主模块 key（相对项目根的路径，如 `src/assembly.fai.js`；多文件 §4.5）。
   * 宿主执行某个文件时传入——主模块的相对 import 以此为解析基准；不传则视为
   * 位于项目根（存量单文件行为不变：无 key 时 `./x.fai.js` 相对根解析）。
   */
  entryKey?: string
  /**
   * 执行护栏（§6.3 / D8，v1 可选、默认关闭）：**整轮超时**（覆盖 execute/append/update
   * 全程，含全部函数体重放），超时抛 {@link ExecutionLimitError}（E_EXEC_LIMIT）。
   * 防 `while(true)` 死循环挂死 worker/UI；不传则无超时（现状行为不变）。
   */
  executionTimeoutMs?: number
}

// 执行护栏超时错误（§6.3 / D8）定义在独立叶子文件 execution-limit-error.ts，
// DirectExecutor（direct 路径单元循环内检查）与本文件共用；此处 import + re-export
// 保持宿主 import 面不变（module 路径 runWithFailureHandling 的 Promise.race 使用）。
export { ExecutionLimitError } from './execution-limit-error'

/**
 * Thrown by CadRuntime.append when a newly appended statement references a
 * variable that is not in the persistent context — its producer was never
 * executed (cross-file reference to an unloaded part, or ctx cleared by
 * dispose). The host should upgrade to a full `execute(code)`.
 */
export class AppendPrefixError extends Error {
  constructor(
    /** The source statement id (sN) whose reference is missing. */
    readonly statementId: string,
    /** The referenced variable missing from the persistent ctx. */
    readonly missingVar: string,
  ) {
    super(
      `[faijs] append: prefix missing — statement "${statementId}" references ` +
      `"${missingVar}" which is not in the persistent context; ` +
      `run execute(code) for a full execution`,
    )
    this.name = 'AppendPrefixError'
  }
}

// ── CadRuntime ──

/** Shape 形状守卫（positions/indices 结构） */
function isShapeLike(v: unknown): v is Shape {
  return !!v && typeof v === 'object' && 'positions' in v && 'indices' in v
}

/** SelectorRuntime → SelectorRuntimeData：剥离 Map 字段（跨 Worker 传输用）。 */
function runtimeToData(rt: SelectorRuntime): SelectorRuntimeData {
  const {
    referenceMap: _referenceMap,
    referenceByNormalizedSelector: _referenceByNormalizedSelector,
    referenceByDisplaySelector: _referenceByDisplaySelector,
    faceReferenceByRowIndex: _faceReferenceByRowIndex,
    edgeReferenceByRowIndex: _edgeReferenceByRowIndex,
    vertexReferenceByRowIndex: _vertexReferenceByRowIndex,
    occurrenceIdByRowIndex: _occurrenceIdByRowIndex,
    faceReferenceMap: _faceReferenceMap,
    edgeReferenceMap: _edgeReferenceMap,
    vertexReferenceMap: _vertexReferenceMap,
    ...data
  } = rt
  return data as SelectorRuntimeData
}

/**
 * CadRuntime 构造选项（第 4 参；缺省全部可选）。
 *
 * direct 是唯一执行路径。security 透传给 DirectExecutor 与 extractMetadata
 * （A1/A2/A3 缺省 'strict'）。
 */
export interface CadRuntimeOptions {
  /** 安全策略档位（缺省 'strict'；透传给 DirectExecutor 与 extractMetadata） */
  security?: SecurityPolicy
}

/**
 * CadRuntime is the execution core of the L2 orchestration layer.
 *
 * It executes a .fai.js source text and produces an ExecutionResult
 * (pure computation that touches neither the scene store nor the DOM), manages
 * the statementCache as an instance member, resolves shape references
 * internally, and is execution-mode aware (auto/brep/mesh). Hosts own undoing,
 * scene mutation, script-store writes, group/assembly rebuilding, and event
 * dispatch.
 */
export class CadRuntime {
  /** The host-injected environment capabilities. */
  readonly ports: HostPorts
  /** The execution mode (auto/brep/mesh). */
  readonly mode: ExecutionMode
  /** direct 是唯一执行路径。保留属性以兼容外部读取。 */
  readonly executorMode = 'direct' as const

  /** 语句缓存（实例级，不再是模块单例）。key = 可命中的 PartName（stmt.id 即其首输出名） */
  private statementCache = new Map<PartName, {
    statementKey: string
    outputContentKey: string
    output: Shape
  }>()

  /** 场景代码累积（三接口收敛：append 只传新行，faijs 累积全文使 id 按位置稳定 + DAG/keep 分析可见全场景）。 */
  private accumulatedCode: string | null = null
  /** 已累积场景的语句 id 集（append 据此判定「新增语句」）。 */
  private accumulatedIds = new Set<StmtId>()

  // P0 增量闸门用：上次成功执行的指纹快照
  private lastParamsFingerprint: string | null = null
  private lastLibIdsFingerprint: string | null = null
  private lastPartTransformFingerprint: string | null = null
  private lastHadKinematics = false

  /**
   * PartName → OCCT 实体句柄，跨 execute 存活，持有所有权（顶替释放/删除/dispose 的唯一操作对象）。
   * op 层通过 brepChain.solidCache 读写——该引用指向此持久 Map（见 ensureBrepChain）。
   */
  private solidCache = new Map<PartName, BrepHandle>()

  /** 面演化映射缓存（PartName → FaceEvolution），随 solidCache 一并持久。 */
  private faceEvolutionCache = new Map<PartName, Map<number, number[]>>()

  /** 拓扑命名 RoleTable 缓存（PartName → RoleTable，§2.3），与 faceEvolutionCache 同生命周期。 */
  private roleTableCache = new Map<PartName, unknown>()

  /** OCCT 内核引用（环境级单例，initOcctWasm() 幂等；mesh 模式为 null）。供顶替释放用。 */
  private kernel: BrepEngineApi | null = null

  /**
   * 惰性初始化的 BREP 链：solidCache / faceEvolutionCache 引用实例持久 Map，
   * kernel 取环境单例。首次需要时创建一次，跨 execute 复用（不再每次新建）。
   */
  private brepChain: BrepChainState | null = null

  /**
   * 拓扑数据缓存：partName → PartTopology（实例级）
   * E13：宿主不再直接 import faijs 拓扑构建函数，而是从 ExecutionResult.topology 消费。
   * 拓扑构建由宿主在 execute 后调用 setTopology 注入（BREP 路径）或由加载时注入（mesh/primitive 路径）。
   */
  private topologyCache = new Map<PartName, PartTopology>()

  /** 无 IR 执行器（DirectExecutor，T5 后唯一执行路径） */
  private readonly directExecutor: DirectExecutor

  /** 安全策略档位（透传给 extractMetadata 与 DirectExecutor；缺省 'strict'） */
  private readonly securityPolicy: SecurityPolicy

  /** 宿主注册库（含 cad：由根门面 createRuntime 包装注入；注入编译产物 fn 的第二参 ns） */
  private readonly libs: Record<string, StdlibNamespace>
  /** 库内容身份表 (binding → content hash)，增量 key 用（B2，§7.3） */
  private readonly libIds = new Map<string, string>()
  /** import specifier → binding 映射（registerLib 的 packageName 声明；check ①.5 校验 specifier） */
  private readonly specifierToBinding = new Map<string, string>()
  private readonly namespaces: Namespaces
  /** 默认命名空间绑定名（U10/R2）：根门面经 registerLib(binding, ns, {default: true}) 显式声明；
   *  缺省 'cad'（与 parser 缺省 defaultNs 一致）。namespace 字段缺省的语句归属该绑定。 */
  private defaultNsName = 'cad'

  /**
   * Register a library namespace. A version mismatch throws (no silent
   * degradation); afterwards compiled products may use the library via
   * `ns.<binding>.<callee>`. `cad` is registered the same way: the root facade
   * injects it through registerLib('cad', createInternalStdlib(), { default: true }).
   * @param binding - the namespace binding name.
   * @param ns - the namespace object to register.
   * @param options - `{ default: true }` declares this binding as the default
   *   namespace (host-declared default binding name, U10/R2).
   */
  /**
   * Register a library namespace under a statement-level binding.
   *
   * Third-party libraries (no defineOp / no contractVersion) are admitted
   * through compatOp so bare functions cannot silently bypass the statement
   * boundary contract (B4, §4.3.3). The `autoLift` option controls this:
   *   - `true`  → bare functions are lifted via compatOp (brep-only, B4).
   *   - `false` → no lifting (the library's functions are used as-is; the
   *     built-in cad surface uses this since its ops already carry
   *     `DUAL_OP_META`).
   *   - omitted → inferred: `!hasDualOp(ns)`. Libraries that already declare
   *     dual-ops (cad, gear-lib-demo's defineOp mocks) auto-lift `false`;
   *     all-bare-function libraries (sheetmetal) auto-lift `true`.
   *
   * The engine's built-in L3 surface is registered without `autoLift` by the
   * facade: inferred `false` (all ops carry `DUAL_OP_META`).
   * @param binding - the name scripts use to reach the namespace (e.g. 'cad').
   * @param ns - the library's export object.
   * @param options - registration hints. `packageName` declares the npm package
   *   backing this binding so `check()` can validate script import specifiers
   *   against registered libraries (specifier mismatch = hard check error).
   */
  registerLib(binding: string, ns: StdlibNamespace, options?: { default?: boolean; autoLift?: boolean; packageName?: string }): void {
    assertContractVersion(ns as unknown as { contractVersion?: number })
    // B4: admit bare (non-dual-op) library functions through compatOp when
    // autoLift is true (or inferred true — the library has no dual-op).
    // Hard ordering: assertLibConforms runs inside admitCompatLib BEFORE
    // wrapping — DUAL_OP_META hangs on the function object with
    // enumerable:false, and wrapping first would let bare functions silently
    // skip the strict validation pass (R8).
    const lift = options?.autoLift ?? !hasDualOp(ns as unknown as Record<string, unknown>)
    const admitted = lift
      ? (admitCompatLib(ns as unknown as Record<string, unknown>) as StdlibNamespace)
      : ns
    this.libs[binding] = admitted
    this.libIds.set(binding, computeLibId(binding, ns as unknown as Record<string, unknown>))
    if (options?.packageName) {
      this.specifierToBinding.set(options.packageName, binding)
    }
    if (options?.default === true) {
      this.defaultNsName = binding
    }
    this.directExecutor.setNamespaces({ ...this.libs } as Namespaces)
  }

  /** The runtime's default namespace binding name (host-declared; 'cad' by default). */
  get defaultNs(): string {
    return this.defaultNsName
  }

  constructor(
    ports: HostPorts,
    mode: ExecutionMode = 'auto',
    libs: Record<string, StdlibNamespace> = {},
    options: CadRuntimeOptions = {},
  ) {
    this.ports = ports
    this.mode = mode
    this.libs = libs
    this.namespaces = { ...libs } as Namespaces
    this.securityPolicy = options.security ?? 'strict'
    this.directExecutor = new DirectExecutor({
      namespaces: this.namespaces,
      setSolid: (partName, solid) => { this.solidCache.set(partName, solid) },
      setFaceEvolution: (partName, evo) => { this.faceEvolutionCache.set(partName, evo as Map<number, number[]>) },
      setRoleTable: (partName, roleTable) => { this.roleTableCache.set(partName, roleTable) },
      security: this.securityPolicy,
    })

    // P2：装配全局 backends（stdlib 经 getBackends() 取资源）。
    this.claimBackends()
  }

  /**
   * 认领全局 backends 配置（P2 修复）：全局 backends 是单例，任何 runtime 创建都会
   * 覆盖它——后创建的实例（如预览用 mesh runtime）会把 mode/kernel getter 指向自己，
   * 先前 runtime 的后续 execute 会被静默劫持（dispatch 走错槽、缓存键漂移、
   * 顶替释放旧 BREP 句柄后拓扑重建撞上悬空句柄）。因此除构造外，每个执行入口
   * （execute，所有执行路径的汇聚点）都必须先重新认领本实例的配置。
   * 限制：并发交错执行多个 runtime 仍会互踩（与 setCurrentStmt 同级的串行假设）。
   * ⚠️ getter 的 this 指向所在对象字面量，用箭头闭包捕获实例（避免 no-this-alias）。
   */
  private claimBackends(): void {
    const brepChainOf = (): BrepChainState | null => this.brepChain
    const portsOf = (): HostPorts => this.ports
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: {
        mode: this.mode,
        get brepEngineId() {
          return getActiveBrepEngineId()
        },
        get brepCapabilities() {
          return brepChainOf()?.capabilities
        },
        get partTransform() {
          return brepChainOf()?.partTransform
        },
      },
      kernel: {
        get brep() {
          return brepChainOf()?.kernel ?? null
        },
        get csg() {
          return portsOf().csg
        },
        get sdf() {
          return portsOf().sdf
        },
      },
      fonts: this.ports.fonts,
      texture: this.ports.texture,
      assets: this.ports.assets,
      events: this.ports.events,
      cad: this.namespaces.cad,
    })
  }

  /**
   * 确保持久 BREP 链存在（惰性初始化）。
   * 引擎从注册表取当前 BREP 引擎（宿主装配时注册）；无引擎或 mesh 模式 → kernel 为 null。
   * OCCT 是内置默认引擎：宿主未注册任何引擎时，非 mesh 模式自动装配 OCCT——
   * 现有宿主无需改动即恢复默认 BREP 行为；换引擎仍是静态的（装配期注册其它引擎即可）。
   */
  private async ensureBrepChain(): Promise<BrepChainState> {
    if (this.brepChain) return this.brepChain
    if (this.mode !== 'mesh') {
      await ensureOcctDefaultEngine()
    }
    const engine = this.mode === 'mesh' || !hasBrepEngine()
      ? null
      : await getBrepEngine()
    const kernel = engine?.primitives ?? null
    this.kernel = kernel
    this.brepChain = {
      solidCache: this.solidCache,
      kernel,
      capabilities: engine?.capabilities,
      faceEvolutionCache: this.faceEvolutionCache,
      roleTableCache: this.roleTableCache,
      meshShapeCache: new Map<PartName, BrepMeshResult>(),
    }
    return this.brepChain
  }

  // ── 公开入口：execute / append / update（输入一律是代码文本，IR 在引擎内部） ──

  /**
   * Full execution from code text: parse → execute every statement.
   * @param code - the .fai.js source text.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async execute(code: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    return this.executeDirectText(code, opts)
  }

  /**
   * Append new statements (incremental execution): only execute the new code
   * text on the persistent ctx; prefix validation enforces that references
   * must already exist (AppendPrefixError otherwise).
   * @param code - the new .fai.js source text to append.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async append(code: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    return this.appendDirectText(code, opts)
  }

  /**
   * Direct-mode full execution: the code text runs on the DirectExecutor
   * and outputs/terminals are assembled from the persistent ctx +
   * extractMetadata + computeLiveShapes.
   */
  private async executeDirectText(code: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    const de = this.directExecutor
    // P2 修复：执行前重新认领全局 backends（本实例配置为准）。
    this.claimBackends()
    this.accumulatedCode = code
    const meta = extractMetadata(code, { defaultNs: this.defaultNsName, security: this.securityPolicy, namespaces: Object.keys(this.libs) })
    const libLoadFailure = await this.autoLoadLibsFromImports(meta.imports)
    if (libLoadFailure) return libLoadFailure
    // 多文件（§4.5）：相对 import 依赖装载 → 绑定 seed；装载错误 → failedAt 短路。
    const moduleLoad = await this.loadDirectModuleImports(meta, opts?.entryKey)
    if (!('seed' in moduleLoad)) return moduleLoad
    const brepChain = await this.ensureBrepChain()
    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }
    const outcome = await de.execute(code, {
      imports: moduleLoad.seed,
      params: opts?.params,
      ...(opts?.startIndex !== undefined ? { startLine: opts.startIndex } : {}),
      ...(opts?.beforeStatement ? { beforeStatement: opts.beforeStatement } : {}),
      ...(opts?.executionTimeoutMs !== undefined ? { executionTimeoutMs: opts.executionTimeoutMs } : {}),
    })
    if (outcome.failedAt) {
      return this.directFailedAtOrThrow(outcome.failedAt, meta)
    }
    const result = this.collectDirectResult(meta, opts)
    this.recordFingerprints(opts)
    return result
  }

  /** E6：DirectExecutor 失败行 → 场景语句序数（meta.lines 下标）；不在 lines → undefined。 */
  private directStmtOrdinal(meta: UiMetadata, lineNo: number | undefined): number | undefined {
    if (lineNo === undefined) return undefined
    const idx = meta.lines.findIndex((l) => l.line === lineNo)
    return idx < 0 ? undefined : idx
  }

  /**
   * Direct-mode failedAt handling (T5 direct-only path): all execution errors
   * from DirectExecutor's catch block are statement-level failures → keep in
   * failedAt (no re-throw). This includes OpError / BrepUnsupportedError /
   * MeshUnsupportedError (engine capability failures), TypeError (no_such_op),
   * and business parameter errors (e.g. E_ARGS_FORM, E_CHAMFER_NO_EDGES,
   * E_TOPO_NOT_FOUND). ParseError is re-thrown by DirectExecutor (not here).
   * The original error's `code` (e.g. E_TOPO_NOT_FOUND) is surfaced on
   * failedAt.code so hosts can programmatically distinguish error kinds.
   */
  private directFailedAtOrThrow(
    failedAt: { index: number; callee: string; message: string; lineNo?: number; error?: unknown },
    meta: UiMetadata,
  ): ExecutionResult {
    const index = this.directStmtOrdinal(meta, failedAt.lineNo) ?? failedAt.index
    const rawCode = failedAt.error instanceof Error ? (failedAt.error as { code?: unknown }).code : undefined
    const code = typeof rawCode === 'string' ? rawCode : undefined
    return {
      outputs: this.directShapes(),
      brepChain: this.brepChain!,
      terminals: [],
      infos: [],
      failedAt: { index, callee: failedAt.callee, message: failedAt.message, lineNo: failedAt.lineNo, code },
    }
  }

  /**
   * Direct-mode update: R3 语义——清 ctx 全量重跑新文本
   * （DirectExecutor.update 即 execute；无需 oldCode 差量）。
   */
  private async updateDirectText(_oldCode: string, newCode: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    this.accumulatedCode = newCode
    return this.executeDirectText(newCode, opts)
  }

  /**
   * Direct-mode append: DirectExecutor 共享 ctx 只执行新单元
   * （行号即边界）；prefix 校验保留 AppendPrefixError 语义（引用不在持久 ctx → 抛错，
   * 宿主升级为全量 execute）。
   */
  private async appendDirectText(code: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    const de = this.directExecutor
    if (!de) throw new Error('[faijs] direct executor is unavailable in module mode')
    this.claimBackends()
    const fullCode = this.accumulatedCode === null ? code : `${this.accumulatedCode}\n${code}`
    this.accumulatedCode = fullCode
    // Append never reconciles：持久 ctx 中先前已执行语句必须原样保留；缺引用的新单元
    // 在 DirectExecutor 内会静默拿到 undefined —— 这里按 module 路径语义前置抛错。
    // 先做 prefix 校验（skipSecurity=true，预检不触发安全扫描），再做 A1 安全扫描。
    const missing = de.missingPrefixVar(code)
    if (missing) throw new AppendPrefixError(`s${missing.unitLine}`, missing.varName)
    // looseVars: true (same semantics as the deleted module append path): references to
    // 已执行产出/其它文件的变量作为外部 var 透传，由 missingPrefixVar 前置校验决定成败。
    // A1 安全扫描需把 ctx 已有键 + 已注册命名空间都作为 knownNames（避免 SEC_FREE_IDENT 误杀 append 场景）。
    const appendKnownNames = [...Object.keys(this.libs), ...de.listCtxKeys()]
    const meta = extractMetadata(fullCode, { defaultNs: this.defaultNsName, looseVars: true, security: this.securityPolicy, namespaces: appendKnownNames, nsNames: Object.keys(this.libs) })
    const libLoadFailure = await this.autoLoadLibsFromImports(meta.imports)
    if (libLoadFailure) return libLoadFailure
    // 多文件（§4.5）：相对 import 依赖装载 → 绑定 seed（覆盖刷新 ctx 中旧 import 绑定）。
    const moduleLoad = await this.loadDirectModuleImports(meta, opts?.entryKey)
    if (!('seed' in moduleLoad)) return moduleLoad
    const brepChain = await this.ensureBrepChain()
    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }
    const outcome = await de.append(code, {
      imports: moduleLoad.seed,
      params: opts?.params,
      ...(opts?.beforeStatement ? { beforeStatement: opts.beforeStatement } : {}),
      ...(opts?.executionTimeoutMs !== undefined ? { executionTimeoutMs: opts.executionTimeoutMs } : {}),
    })
    if (outcome.failedAt) {
      return this.directFailedAtOrThrow(outcome.failedAt, meta)
    }
    const result = this.collectDirectResult(meta, opts)
    this.recordFingerprints(opts)
    return result
  }

  /** Direct-mode 失败结果的 outputs 部分：持久 ctx 中已产出的 shape/compound。 */
  private directShapes(): Map<PartName, Shape | CompoundShape> {
    const de = this.directExecutor!
    const outputs = new Map<PartName, Shape | CompoundShape>()
    for (const name of de.listCtxKeys()) {
      const v = de.getCtxVar(name)
      if (isShapeLike(v) || isCompoundLike(v)) outputs.set(asPartName(name), v as Shape | CompoundShape)
    }
    return outputs
  }

  /**
   * 多文件装载（direct 模式，§4.5）：项目内相对 import 依赖经 ModuleRegistry 装载
   * （每依赖独立 ctx 执行 + 绑定校验），返回 seed（绑定名 → 值，供 DirectExecutor
   * opts.imports 预置）。装载错误 → failedAt 短路结果（不抛穿）。
   */
  private async loadDirectModuleImports(
    meta: UiMetadata,
    baseKey?: string,
  ): Promise<{ seed: Record<string, unknown> } | ExecutionResult> {
    const loader = this.ports.projectLoader
    if (!loader) return { seed: {} }
    if (!(meta.imports ?? []).some((imp) => isRelativeSpecifier(imp.specifier))) return { seed: {} }
    const registry = new ModuleRegistry(loader, (code, imports) => this.runDirectModule(code, imports), this.securityPolicy)
    try {
      const seed = await registry.resolveImports(meta.imports ?? [], baseKey)
      return { seed }
    } catch (err) {
      if (err instanceof ModuleRegistryError) {
        return {
          outputs: new Map(),
          brepChain: this.brepChain!,
          terminals: [],
          infos: [],
          failedAt: {
            index: -1,
            callee: err.callee ?? 'import',
            message: err.message,
            lineNo: err.lineNo,
          },
        }
      }
      throw err
    }
  }

  /** 依赖模块执行（direct）：独立 DirectExecutor + 独立 ctx；失败抛 ModuleRegistryError。 */
  private async runDirectModule(code: string, imports: Record<string, unknown>): Promise<ModuleRunResult> {
    // A3：子模块固定 strict 策略（不接受降档）
    // BREP kernel 必须在依赖执行前就绪——模块装载排在 ensureBrepChain 之前，
    // 否则子模块里的 BREP op 会以 "no OCCT kernel" 失败。
    await this.ensureBrepChain()
    // 钩子必须复用主 executor 的那套：子模块产出的 BREP solid 要登记进本实例的
    // solidCache，否则主模块的 brepSolids 查不到它们（装配体 STEP 导不出精确曲面）。
    const de = new DirectExecutor({
      namespaces: { ...this.libs } as Namespaces,
      setSolid: (partName, solid) => { this.solidCache.set(partName, solid) },
      setFaceEvolution: (partName, evo) => { this.faceEvolutionCache.set(partName, evo as Map<number, number[]>) },
      setRoleTable: (partName, roleTable) => { this.roleTableCache.set(partName, roleTable) },
      security: 'strict',
    })
    const outcome = await de.execute(code, { imports })
    if (outcome.failedAt) {
      throw new ModuleRegistryError(
        'MODULE_EXEC_FAILED',
        `dependency module failed at line ${outcome.failedAt.lineNo ?? '?'}: ${outcome.failedAt.message}`,
        { lineNo: outcome.failedAt.lineNo, callee: outcome.failedAt.callee },
      )
    }
    return de
  }

  /**
   * Direct-mode result assembly：ctx → outputs / statementCache / terminals /
   * brepSolids / compounds（与 collectResult 的 mesh 面同构；输入换源为
   * DirectExecutor ctx + UiMetadata + computeLiveShapes，§4.2/§4.4）。
   */
  private collectDirectResult(meta: UiMetadata, opts?: ExecuteOptions): ExecutionResult {
    const de = this.directExecutor!
    const outputs = new Map<PartName, Shape | CompoundShape>()
    const shapeVarNames = new Set<PartName>()
    const compounds = new Map<PartName, PartName[]>()
    for (const name of de.listCtxKeys()) {
      const v = de.getCtxVar(name)
      if (!isShapeLike(v) && !isCompoundLike(v)) continue
      outputs.set(asPartName(name), v as Shape | CompoundShape)
      shapeVarNames.add(asPartName(name))
      if (isCompoundLike(v)) {
        const behavior = getSlot(v)?.behavior as { memberNames?: string[] } | undefined
        compounds.set(asPartName(name), (behavior?.memberNames ?? []).map(asPartName))
      }
    }
    // statementCache 同步（E8 getCachedOutput）：direct 无语句 key——用行级身份键填
    // content key，宿主继续从实例缓存读几何。
    for (const name of shapeVarNames) {
      const v = de.getCtxVar(String(name))
      if (isShapeLike(v)) {
        const shape = v as Shape
        this.statementCache.set(name, {
          statementKey: `direct:${String(name)}`,
          outputContentKey: computeContentKey(shape.positions, shape.indices),
          output: shape,
        })
      }
    }
    // T3-cond：DAG 叶子终端判定换 computeLiveShapes（§4.4）——输入换源：
    // 候选 = ctx 键；行内 keep 查 metadata.keep 表；函数体 exec.keep 登记读
    // DirectExecutor.keepByLine（行号键，与 computeLiveShapes KeepView 对齐）。
    const keepView: KeepView = {
      lineEntries: (lineNo) => meta.keep.get(lineNo),
      functionBody: (lineNo) => de.getKeepByLine(lineNo),
    }
    let terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepView,
      shapeVarNames,
      ...(de.getBlockOutputs().size > 0 ? { blockOutputs: de.getBlockOutputs() } : {}),
      explicitTerminals: meta.terminalShapes,
    })
    // 显式 return 优先（与 collectResult 同）：非显式分支按值判定补 compound kind。
    if (!meta.terminalShapes || meta.terminalShapes.length === 0) {
      terminals = terminals.map((t) => {
        const v = de.getCtxVar(String(t.id))
        return isCompoundLike(v) ? { ...t, kind: 'compound' } : t
      })
    }
    const brepSolids = this.directBrepSolids(terminals, compounds)
    // T3：拓扑——宿主注入（mesh/primitive，setTopology 缓存）原样带出 + BREP 真拓扑
    // 自动构建（与 collectResult 的 topology='auto'/'brep' 面同构）。solidCache 已由
    // DirectExecutor 的 setSolid 钩子同步（逐单元执行后写入），此处 buildBrepTopology
    // 命中缓存构建拓扑。
    const topology = new Map<PartName, PartTopology>(this.topologyCache)
    const topoMode = opts?.topology ?? 'auto'
    if (topoMode !== 'off') {
      const buildFor = (partName: PartName): void => {
        if (topology.has(partName)) return
        const rt = this.buildBrepTopology(partName)
        if (rt) topology.set(partName, { partName, source: 'brep', data: runtimeToData(rt) })
      }
      if (topoMode === 'brep') {
        for (const name of shapeVarNames) {
          const v = de.getCtxVar(String(name))
          if (isShapeLike(v)) buildFor(name)
        }
      } else {
        for (const t of terminals) buildFor(t.id)
      }
    }
    // T3：命名——与 topology 同 set（与 collectResult 的 naming 面同构）
    const naming = new Map<PartName, PartNaming>()
    for (const [partName, partTopo] of topology) {
      const input = this.buildNamingInput(partName, partTopo)
      if (input) naming.set(partName, buildPartNaming(input))
    }
    // T2：activeValues —— 镜像 collectActiveValues，输入换 meta.lines + lineConsumes/
    // blockConsumes。候选 = ctx 中非 shape/compound 键（第三方测量/查询函数返回的
    // number/普通对象）。DAG 叶子且非几何 → activeValues（不进 terminals，零回归）。
    const activeValues = this.collectDirectActiveValues(meta, keepView, shapeVarNames)
    // T2：changed —— DirectExecutor 逐单元写值前后比对（与 module 路径 exec.changed 同语义）。
    const deChanged = de.getChanged()
    return {
      outputs,
      brepChain: this.brepChain!,
      terminals,
      infos: [],
      brepSolids: brepSolids.size > 0 ? brepSolids : undefined,
      topology: topology.size > 0 ? topology : undefined,
      naming: naming.size > 0 ? naming : undefined,
      compounds: compounds.size > 0 ? compounds : undefined,
      kinematics: de.kinematicsSnapshot.size > 0 ? de.kinematicsSnapshot : undefined,
      changed: deChanged ? deChanged.map(asPartName) : undefined,
      activeValues: activeValues.size > 0 ? activeValues : undefined,
    }
  }

  /** 块起始行 → lines 中第一个 >= 该行的下标（与 live-shapes.blockIdxOf 同逻辑）。 */
  private static blockIdxOfLine(lines: UiMetadata['lines'], blockLine: number): number {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].line >= blockLine) return i
    }
    return lines.length
  }

  /**
   * T2：Direct-mode activeValues 收集——镜像 collectActiveValues（module 路径），
   * 输入换 meta.lines + lineConsumes/blockConsumes。
   *
   * 判定与 computeLiveShapes 同构：变量 v 的最后写者行（lines 下标 + blockOutputs）
   * 之后没有语句/块消费 v → DAG 叶子。叶子且非 shape/compound → activeValues。
   * 几何叶子走 terminals（跳过，零回归）。
   */
  private collectDirectActiveValues(
    meta: UiMetadata,
    keepView: KeepView,
    shapeVarNames: Set<PartName>,
  ): Map<PartName, unknown> {
    const de = this.directExecutor!
    const active = new Map<PartName, unknown>()
    // lastProducer：lines 中最后写者下标（与 computeLiveShapes 同逻辑）
    const lastProducer = new Map<string, number>()
    for (let i = 0; i < meta.lines.length; i++) {
      const line = meta.lines[i]
      if (!line.hasAssignment) continue
      for (const out of line.outputs) lastProducer.set(String(out), i)
    }
    // 候选 = ctx 中非 shape/compound 键
    for (const name of de.listCtxKeys()) {
      const v = de.getCtxVar(name)
      if (v === undefined || isShapeLike(v) || isCompoundLike(v)) continue
      // producerIdx：lines 中最后写者下标，或 blockOutputs 的块行号锚点
      const lineIdx = lastProducer.get(name)
      const blockLine = de.getBlockOutputs().get(name)
      let producerIdx: number | undefined
      let producerLine: number
      if (lineIdx !== undefined && blockLine !== undefined) {
        // 取较大者：块在 lines 之后时块是最后写者
        const blockIdx = CadRuntime.blockIdxOfLine(meta.lines, blockLine)
        producerIdx = blockIdx > lineIdx ? blockIdx : lineIdx
        producerLine = blockIdx > lineIdx ? blockLine : (meta.lines[lineIdx]?.line ?? 0)
      } else if (lineIdx !== undefined) {
        producerIdx = lineIdx
        producerLine = meta.lines[lineIdx]?.line ?? 0
      } else if (blockLine !== undefined) {
        producerIdx = CadRuntime.blockIdxOfLine(meta.lines, blockLine)
        producerLine = blockLine
      } else {
        // 无生产者（宿主注入 / 跨文件引用）→ 不进 activeValues（与 module 路径一致）
        continue
      }
      if (producerIdx === undefined) continue
      // 消费判定：producer 之后的 lines + blocks
      let consumed = false
      for (let i = producerIdx + 1; i < meta.lines.length; i++) {
        if (lineConsumes(meta.lines[i], asPartName(name), keepView, shapeVarNames)) {
          consumed = true
          break
        }
      }
      if (!consumed && meta.blocks.length > 0) {
        if (blockConsumes(meta.blocks, name, producerLine)) consumed = true
      }
      if (!consumed) active.set(asPartName(name), v)
    }
    return active
  }

  /** Direct-mode 逐终端 BREP solid 提取（终端 + 装配成员；无 kernel → 空）。 */
  private directBrepSolids(
    terminals: TerminalShape[],
    compounds: Map<PartName, PartName[]>,
  ): Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }> {
    const brepSolids = new Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }>()
    if (!this.kernel) return brepSolids
    for (const t of terminals) {
      const s = this.solidCache.get(t.id)
      if (s && this.kernel) brepSolids.set(t.id, { solid: s, kernel: this.kernel })
    }
    for (const members of compounds.values()) {
      for (const m of members) {
        if (brepSolids.has(m)) continue
        const s = this.solidCache.get(m)
        if (s && this.kernel) brepSolids.set(m, { solid: s, kernel: this.kernel })
      }
    }
    return brepSolids
  }

  /**
   * P 四（4.2）：execute 阶段自动装载未注册的库。
   *
   * import 表（UiMetadata.imports）驱动的自动装载。
   */
  private async autoLoadLibsFromImports(
    imports: ReadonlyArray<{ kind?: string; localName?: string; packageName?: string; specifier?: string }>,
  ): Promise<ExecutionResult | undefined> {
    if (!this.ports.libLoader) return undefined
    for (const imp of imports) {
      if (imp.kind !== 'namespace') continue // named/default import 不作语句级绑定，不在此装载
      // 相对 specifier 属多文件通道（§4.5），不是库——留给 ModuleRegistry 处理，
      // 否则会被当作裸包名送进 libLoader 而报"不在白名单"。
      if (isRelativeSpecifier(imp.specifier ?? '')) continue
      if (!imp.localName) continue
      if (this.libs[imp.localName]) continue  // 已注册（宿主注入或此前自动装载）→ 不覆盖
      let ns: StdlibNamespace
      try {
        ns = await this.ports.libLoader.loadLib(imp.packageName ?? imp.specifier ?? '')
      } catch (err) {
        return {
          outputs: new Map(),
          brepChain: this.brepChain!,
          terminals: [],
          infos: [],
          failedAt: {
            index: -1,
            callee: imp.localName,
            message: `import specifier "${imp.specifier}" cannot be auto-loaded: ${err instanceof Error ? err.message : String(err)}`,
          },
        }
      }
      const resolved = imp.packageName ?? imp.specifier ?? ''
      this.registerLib(imp.localName, ns, {
        autoLift: this.ports.libLoader.options?.autoLiftFor?.(resolved) ?? this.ports.libLoader.options?.autoLift ?? !hasDualOp(ns as unknown as Record<string, unknown>),
        packageName: imp.packageName,
      })
    }
    return undefined
  }


  /**
   * 构建一个 part 的命名输入（§3.7）。
   *
   * - BREP：roleTableCache 反查 {origin, role} + subShapeHashes 序号对照 + 面/边行 hint；
   * - primitive：assignPrimitiveFaceRoles 按固定面序给语义 role（§5.2，与 BREP 同一套命名器）；
   * - mesh：只填 hint（role=''，§5.3）。
   */
  private buildNamingInput(partName: PartName, partTopo: PartTopology): PartNamingInput | undefined {
    const faces = (partTopo.data.faces ?? []) as Array<{
      surfaceType?: string; normal?: readonly number[] | null; center?: readonly number[] | null; area?: number
    }>
    const edges = (partTopo.data.edges ?? []) as Array<{
      length?: number; center?: readonly number[] | null
    }>
    const edgeFaceOrdinals = this.edgeFaceOrdinalsOf(partTopo.data)

    if (partTopo.source === 'brep') {
      const roleTable = this.roleTableCache.get(partName) as PartNamingInput['roleTable']
      const solid = this.solidCache.get(partName)
      let ordinalToHash: readonly number[] | undefined
      if (solid && this.kernel) {
        ordinalToHash = Array.from(this.kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND))
      }
      return {
        source: 'brep',
        partName,
        faces,
        edges,
        roleTable,
        ordinalToHash,
        edgeFaceOrdinals,
      }
    }
    if (partTopo.source === 'primitive') {
      const primitiveRoles = assignPrimitiveFaceRoles(faces, partName)
      return { source: 'primitive', partName, faces, edges, primitiveRoles, edgeFaceOrdinals }
    }
    return { source: partTopo.source, partName, faces, edges, edgeFaceOrdinals }
  }

  /**
   * 从 SelectorRuntimeData 的 edgeFaceRows 提取每条边的两邻面序号（1 起；§3.7）。
   * mesh 无邻接 → undefined（edgeNaming.faces=null，只能 hint 兜底，§5.3）。
   */
  private edgeFaceOrdinalsOf(data: SelectorRuntimeData): ReadonlyArray<readonly [number, number] | null> | undefined {
    const edgeFaceRows = data.proxy?.edgeFaceRows
    const edges = (data.edges ?? []) as Array<{ faceStart?: number; faceCount?: number }>
    if (!Array.isArray(edgeFaceRows) && !(edgeFaceRows instanceof Uint32Array)) return undefined
    const rows = edgeFaceRows as ArrayLike<number>
    const out: Array<readonly [number, number] | null> = []
    for (const edge of edges) {
      const start = edge.faceStart ?? 0
      const count = edge.faceCount ?? 0
      if (count < 2) {
        out.push(null)
        continue
      }
      const a = rows[start]
      const b = rows[start + 1]
      if (a === undefined || b === undefined) {
        out.push(null)
        continue
      }
      out.push([a + 1, b + 1])
    }
    return out
  }

  // ── 语义入口：update / append（增量执行） ──

  /**
   * Update from the two code texts (before/after an edit): the diff is derived
   * from the passed codes themselves — the engine's persistent ctx is only an
   * execution cache, never the diff authority. Changed statements (paired by
   * positional id, S-2) plus their downstream closure are recomputed in
   * topological order; when nothing changed, the result is assembled from the
   * persistent ctx with zero execution.
   * @param oldCode - the .fai.js source text before the edit.
   * @param newCode - the .fai.js source text after the edit.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async update(oldCode: string, newCode: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    return this.updateIncremental(oldCode, newCode, opts)
  }

  // ── 公开：缓存访问 ──

  /**
   * Get the output geometry from the statement cache (keyed by PartName).
   * @param partName - the part name to look up.
   * @returns the cached shape, or undefined.
   */
  getCachedOutput(partName: PartName): Shape | undefined {
    return this.statementCache.get(partName)?.output
  }

  /**
   * Get a statement cache's full entry (statementKey / outputContentKey / output;
   * used by tests and host diagnostics).
   * @param partName - the part name to look up.
   * @returns the cached entry, or undefined.
   */
  getStatementCacheEntry(
    partName: PartName,
  ): { statementKey: string; outputContentKey: string; output: Shape } | undefined {
    return this.statementCache.get(partName)
  }

  /**
   * Write an entry into the statement cache (keyed by PartName).
   * @param partName - the part name to store under.
   * @param _stmt - unused (T5: direct path has no StatementIR).
   * @param output - the shape output.
   * @param outputContentKey - the output's content key.
   */
  writeToStatementCache(
    partName: PartName,
    _stmt: unknown,
    output: Shape,
    outputContentKey: string,
  ): void {
    this.statementCache.set(partName, {
      statementKey: `direct:${String(partName)}`,
      outputContentKey,
      output,
    })
  }

  /** 清除语句缓存（含 statementCache + DirectExecutor ctx 变量） */
  clearStatementCache(): void {
    this.statementCache.clear()
    this.directExecutor.reset()
  }

  // ── 公开：拓扑数据缓存 ──

  /**
   * Write an entry into the topology data cache. Hosts call this after a
   * successful BREP execution (building source='brep' topology via
   * buildSolidTopologyRuntime), on file load (source='mesh' via
   * buildSelectorRuntime), and on primitive creation (source='primitive' via the
   * primitive topology builder). The topology returned by execute()'s
   * ExecutionResult includes these cached entries.
   * @param partName - the part name to store under.
   * @param source - the topology source (brep/primitive/mesh).
   * @param data - the serialized topology data.
   */
  setTopology(partName: PartName, source: TopologySource, data: SelectorRuntimeData): void {
    this.topologyCache.set(partName, { partName, source, data })
    // §3.6：mesh/primitive 面 hint 快照——从拓扑行提炼写入对应 Shape 槽，
    // op 解析 TopoRef 时经输入 Shape 的命名槽走 geometric-fallback。
    const v = this.directExecutor.getCtxVar(partName)
    if (v && typeof v === 'object') {
      const hints = (data.faces ?? []).map((f) => faceRowToHint(f))
      ensureSlot(v).faceHints = hints
    }
  }

  /**
   * Get the topology data for a part.
   * @param partName - the part name to look up.
   * @returns the part topology, or undefined.
   */
  getTopology(partName: PartName): PartTopology | undefined {
    return this.topologyCache.get(partName)
  }

  /**
   * Delete the topology data for a part.
   * @param partName - the part name to delete.
   */
  deleteTopology(partName: PartName): void {
    this.topologyCache.delete(partName)
  }

  /**
   * 从 BREP solid 构建拓扑数据（接口分离 P0）。
   *
   * 宿主不再直接 import faijs 内部构建函数（buildSolidTopologyRuntime），
   * 而是通过此方法从 runtime 获取 BREP 拓扑。
   *
   * 按 PartName 直接查持久 solidCache + brepChain.meshShapeCache（均为 PartName key），
   * 不再需要 scopedId 投影。单一真源：solidCache（PartName → BrepHandle）。
   *
   * @param partName 终端变量名（PartName，在 brepChain.solidCache 中查找）
   * @returns SelectorRuntime，或 null（无可用 BREP solid）
   */
  buildBrepTopology(partName: PartName): SelectorRuntime | null {
    const brepChain = this.brepChain
    if (!brepChain?.kernel) return null

    // partName 即该变量的首输出变量名，按 PartName 查持久 solidCache
    const solid = brepChain.solidCache.get(partName)
    if (!solid) return null

    // 规则 1：优先从 brepChain.meshShapeCache 复用执行链产出的三角化结果
    // （与显示 mesh 完全同一份 mesh，不二次 meshShape）
    const cachedMesh = brepChain.meshShapeCache?.get(partName)
    if (cachedMesh && brepChain.kernel) {
      return buildTopologyFromMesh(brepChain.kernel, solid, cachedMesh)
    }

    // 无缓存（非执行链路径，如 STEP 导入后直接构建拓扑）→ 执行完整构建（含 meshShape 三角化）
    const result: SolidTopologyResult = buildSolidTopologyRuntime(brepChain.kernel, solid)
    return result.runtime
  }

  // ── 公开：dryRun 校验 ──

  /**
   * dryRun：acorn 语法门禁 + 元数据提取（T5 后唯一路径）。
   *
   * extractMetadata 全量解析（语法 + 引用），不查符号表。未知 callee 放行，
   * 试执行见 execute 的 failedAt。
   *
   * @param code .fai.js 文本
   * @returns CheckResult
   */
  check(code: string): CheckResult {
    try {
      const meta = extractMetadata(code, { defaultNs: this.defaultNsName, security: this.securityPolicy, namespaces: Object.keys(this.libs) })
      return {
        ok: true,
        errors: [],
        warnings: [],
        script: {
          statements: meta.lines.length,
          callees: meta.lines.map((l) => l.callee),
        },
      }
    } catch (err) {
      if (err instanceof ParseError) {
        const stage = err.code === 'E_SECURITY' ? 'security' : 'parse'
        return {
          ok: false,
          errors: [{ stage, message: err.message, line: err.line, ...(err.code ? { code: err.code } : {}), ...(err.ruleId ? { ruleId: err.ruleId } : {}) }],
          warnings: [],
        }
      }
      return {
        ok: false,
        errors: [{ stage: 'parse', message: err instanceof Error ? err.message : String(err) }],
        warnings: [],
      }
    }
  }

  // ── P0 增量：releasePartCaches / updateIncremental ──

  /**
   * 派生缓存失效（P0-4）：重放前对 `replayKeys`（经 `asPartName()` 转换）逐一清理
   * 所有派生缓存，确保重放后几何/拓扑/mesh 不命中旧值。
   *
   * 清理清单（§4.4）：
   * - `solidCache`：先 `kernel.release(handle)`，再删键（参照 dispose 的 try/catch）；
   * - `brepChain.meshShapeCache`：删键（跨轮保留，不清会返回旧 solid 的三角化）；
   * - `faceEvolutionCache` / `roleTableCache`：删键（与 runtime 同 Map 引用，删键即生效）；
   * - `topologyCache` / `statementCache`：删键（collectDirectResult 按新几何重新填充）。
   */
  private releasePartCaches(partNames: PartName[]): void {
    for (const name of partNames) {
      // solidCache: release OCCT handle first, then delete key
      const handle = this.solidCache.get(name)
      if (handle) {
        try { this.kernel?.release(handle) } catch { /* already released */ }
        this.solidCache.delete(name)
      }
      // brepChain.meshShapeCache
      this.brepChain?.meshShapeCache?.delete(name)
      // faceEvolutionCache / roleTableCache (same Map refs as runtime's)
      this.faceEvolutionCache.delete(name)
      this.roleTableCache.delete(name)
      // topologyCache / statementCache
      this.topologyCache.delete(name)
      this.statementCache.delete(name)
    }
  }

  /**
   * 前缀重放式 update 增量执行（P0-5）。
   *
   * 流程：
   * 1. 保守闸门 G0–G8 判定——任一命中则退化为全量 `executeDirectText`；
   * 2. 公共前缀扫描定位首个变更行 → 物理行；
   * 3. `unitRanges(newCode)` 映射物理行 → 单元起始行 `startLine`；
   * 4. `releasePartCaches(replayKeys)` 失效派生缓存；
   * 5. `directExecutor.replayFrom(newCode, startLine, opts)` 重放后缀区间；
   * 6. `outcome.failedAt` → 降级全量（§4.7）；
   * 7. `collectDirectResult` 组装结果。
   *
   * @param oldCode - 变更前文本（不信任，G3 校验与内部 accumulatedCode 一致）。
   * @param newCode - 变更后文本。
   * @param opts - 执行选项。
   * @returns ExecutionResult。
   */
  private async updateIncremental(
    oldCode: string,
    newCode: string,
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    const de = this.directExecutor
    this.claimBackends()

    // ── 保守闸门 G0–G8 ──

    // G1: 本实例从未执行过
    if (this.accumulatedCode === null) {
      return this.executeDirectText(newCode, opts)
    }

    // G3: 宿主传入的 oldCode 与内部基准不一致
    if (oldCode.trim() !== this.accumulatedCode.trim()) {
      return this.executeDirectText(newCode, opts)
    }

    // 切分行数组（两侧均按 \r?\n 切分）
    const oldLines = this.accumulatedCode.split(/\r?\n/)
    const newLines = newCode.split(/\r?\n/)

    // G2: 存在删除（new 比旧短）
    if (newLines.length < oldLines.length) {
      return this.executeDirectText(newCode, opts)
    }

    // G0: 非标准解析基线
    const { ranges, lineOffset } = de.unitRanges(newCode)
    if (lineOffset !== 0) {
      return this.executeDirectText(newCode, opts)
    }

    // G6: params 变化
    const paramsFp = stableFingerprint(opts?.params ?? null)
    if (paramsFp !== this.lastParamsFingerprint) {
      return this.executeDirectText(newCode, opts)
    }

    // G7: 注册库集合变化
    const libIdsEntries = [...this.libIds.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )
    const libIdsFp = stableFingerprint(libIdsEntries)
    if (libIdsFp !== this.lastLibIdsFingerprint) {
      return this.executeDirectText(newCode, opts)
    }

    // G8: partTransform 变化
    const ptFp = stableFingerprint(opts?.partTransform ?? null)
    if (ptFp !== this.lastPartTransformFingerprint) {
      return this.executeDirectText(newCode, opts)
    }

    // G5: 上一轮产生了装配运动学位姿
    if (this.lastHadKinematics) {
      return this.executeDirectText(newCode, opts)
    }

    // G4: 含相对 import 的多文件场景
    const meta = extractMetadata(newCode, { defaultNs: this.defaultNsName, security: this.securityPolicy, namespaces: Object.keys(this.libs) })
    if ((meta.imports ?? []).some((imp) => isRelativeSpecifier(imp.specifier))) {
      return this.executeDirectText(newCode, opts)
    }

    // ── 公共前缀扫描 ──
    // 逐行 trim 比较；空行/纯空白行等价
    let firstDiff = -1
    const maxLen = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxLen; i++) {
      const a = oldLines[i] ?? ''
      const b = newLines[i] ?? ''
      if (a.trim() !== b.trim()) {
        firstDiff = i
        break
      }
    }

    // 零变更路径（§4.6）
    if (firstDiff === -1) {
      return this.zeroChangePath(newCode, meta, opts)
    }

    // ── 映射物理行 → 单元起始行 ──
    const physicalLine = firstDiff + 1
    const adjusted = physicalLine - lineOffset
    let startLine: number | undefined
    // 找包含该行的单元（物理行落在块单元内部 → 块起始行）
    for (const r of ranges) {
      if (r.lineNo <= adjusted && adjusted <= r.endLine) {
        startLine = r.lineNo
        break
      }
    }
    if (startLine === undefined) {
      // 找首个 lineNo > physical 的单元（纯追加场景）
      for (const r of ranges) {
        if (r.lineNo > adjusted) {
          startLine = r.lineNo
          break
        }
      }
    }
    // 映射结果为空（改动只落在末尾注释/空行，其后无任何单元）
    if (startLine === undefined) {
      return this.zeroChangePath(newCode, meta, opts)
    }

    // ── 计算 replayKeys（与 DirectExecutor.replayFrom 同逻辑，用于 releasePartCaches） ──
    const allUnitsParsed = de.unitRangesWithWrites(newCode)
    const replayUnits = allUnitsParsed.filter((u) => u.lineNo >= startLine)
    const suffixWrites = new Set<string>()
    for (const u of replayUnits) for (const w of u.writes) suffixWrites.add(w)
    const prefixWrites = new Set<string>()
    for (const u of allUnitsParsed) {
      if (u.lineNo < startLine!) for (const w of u.writes) prefixWrites.add(w)
    }
    const replayKeys: string[] = []
    for (const w of suffixWrites) {
      if (!prefixWrites.has(w)) replayKeys.push(w)
    }

    // ── 派生缓存失效 ──
    this.releasePartCaches(replayKeys.map((k) => asPartName(k)))

    // ── BREP 链与 partTransform 同步 ──
    const brepChain = await this.ensureBrepChain()
    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }

    // ── 重放 ──
    // G4 already checked: no relative imports → moduleLoad.seed = {}
    const libLoadFailure = await this.autoLoadLibsFromImports(meta.imports)
    if (libLoadFailure) return libLoadFailure

    const execOpts: DirectExecOpts = {
      params: opts?.params,
      ...(opts?.beforeStatement ? { beforeStatement: opts.beforeStatement } : {}),
      ...(opts?.executionTimeoutMs !== undefined ? { executionTimeoutMs: opts.executionTimeoutMs } : {}),
    }

    // ExecutionLimitError / ParseError / security scan errors propagate
    // (not degraded — only failedAt triggers degradation below)
    const outcome = await de.replayFrom(newCode, startLine, execOpts)

    // ── 失败降级（§4.7）──
    if (outcome.failedAt) {
      de.reset()
      return this.executeDirectText(newCode, opts)
    }

    // ── 组装结果 ──
    this.accumulatedCode = newCode
    const result = this.collectDirectResult(meta, opts)
    // Record fingerprints after successful execution
    this.recordFingerprints(opts)
    return result
  }

  /**
   * 零变更路径（§4.6）：不执行任何语句，但需重新 collectDirectResult。
   */
  private async zeroChangePath(
    newCode: string,
    meta: UiMetadata,
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    const de = this.directExecutor
    this.claimBackends()
    this.accumulatedCode = newCode
    const libLoadFailure = await this.autoLoadLibsFromImports(meta.imports)
    if (libLoadFailure) return libLoadFailure
    const brepChain = await this.ensureBrepChain()
    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }
    de.clearRoundState()
    return this.collectDirectResult(meta, opts)
  }

  /**
   * 记录指纹快照（每次成功执行结束时调用）。
   */
  private recordFingerprints(opts?: ExecuteOptions): void {
    this.lastParamsFingerprint = stableFingerprint(opts?.params ?? null)
    const libIdsEntries = [...this.libIds.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )
    this.lastLibIdsFingerprint = stableFingerprint(libIdsEntries)
    this.lastPartTransformFingerprint = stableFingerprint(opts?.partTransform ?? null)
    this.lastHadKinematics = this.directExecutor.kinematicsSnapshot.size > 0
  }

  // ── 公开：释放 ──

  /**
   * Dispose the runtime, releasing all acquired OCCT handles and clearing every
   * cache. The instance is unusable afterwards.
   */
  dispose(): void {
    // 所有权在持久 solidCache：释放全部 OCCT handle（§9 决策 2）
    for (const [, handle] of this.solidCache) {
      try { this.kernel?.release(handle) } catch { /* 已释放 */ }
    }
    this.solidCache.clear()
    this.faceEvolutionCache.clear()
    this.roleTableCache.clear()
    this.statementCache.clear()
    this.topologyCache.clear()
    this.brepChain = null
    this.kernel = null
    this.directExecutor.reset()
  }
}

// ── 工厂函数 ──

/**
 * Create a CadRuntime instance.
 * @param ports - the host-injected environment capabilities.
 * @param mode - the execution mode (default 'auto').
 * @param libs - the host-injected library namespaces (including `cad`, which the
 * root facade injects automatically; core does not assemble it by default).
 * @param options - optional runtime options (e.g. `executor: 'direct' | 'module'`).
 * @returns a new CadRuntime.
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode, libs?: Record<string, StdlibNamespace>, options?: CadRuntimeOptions): CadRuntime {
  return new CadRuntime(ports, mode, libs, options)
}
