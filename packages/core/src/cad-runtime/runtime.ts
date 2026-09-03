/**
 * CadRuntime — 执行核心（L2 编排层）
 *
 * Phase 1（VM 执行方案）：内部从"解释器主循环 + dispatcher switch"换成
 * compileToModule + ModuleExecutor。对外签名、ExecutionResult、ScriptIR、
 * 语句 id（sN）与产出名（PartName）语义全部不变。
 *
 * 职责：
 * - 执行 ScriptIR 语句序列，产出 ExecutionResult（纯计算，不碰 store/DOM）
 * - 管理 statementCache 作为实例成员（不再是模块级单例）
 * - 内部 resolveShapeRef（不再反向 import ScriptEngine / useScriptStore）
 * - 执行模式感知（auto / brep / mesh）
 *
 * 不做的事（留给 browser host）：
 * - undo 快照
 * - SceneMutator.createPart / commitGeometry
 * - scriptStore 写入
 * - group/assembly 重建
 * - window.dispatchEvent / toast
 */

import type { ScriptIR, StatementIR, TerminalShape, FunctionDefIR } from '../lang/types'
import type { Shape } from '../mesh/types'
import type { BrepChainState } from '../brep/brep-chain'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { getBrepEngine, hasBrepEngine, getActiveBrepEngineId } from '../brep/engine/registry'
import { ensureOcctDefaultEngine } from '../brep/engine/adapters/occt'
import { parseScript, ParseError } from '../lang/parser'
import { getFunctionSymbol } from '../lang/symbol-table'
import { validateKeepDirectives, withoutKeepDirectives } from '../lang/keep'
import type { HostPorts, ExecutionMode } from './ports'
import type { SelectorRuntimeData } from '../topology/build-selector-runtime'
import type { SelectorRuntime } from '../topology/types'
import { buildSolidTopologyRuntime } from '../brep/brep-topology'
import type { SolidTopologyResult } from '../brep/brep-topology'
import { buildTopologyFromMesh } from '../brep/brep-topology'
import type { BrepMeshResult } from '../brep/engine/types'
import { asPartName, type PartName, type StmtId } from '../identity'
import { compileToModule, type CompiledStatementMeta } from '../lang/compile'
import { ModuleExecutor, type ExecBookkeeping } from './module-executor'
import {
  configureBackends, CONTRACT_VERSION, setKeepSink, setName,
  assertContractVersion, BrepUnsupportedError, MeshUnsupportedError, type StdlibNamespace,
} from '../runtime-state'
import { DUAL_OP_META } from '../define-op'
import { admitCompatLib } from './admit-compat-lib'
import { computeLibId } from './lib-id'
import { computeContentKey } from './content-key'
export { computeContentKey } from './content-key'
import type { Namespaces } from './module-executor'
import { isCompoundLike, getSlot, ensureSlot, type CompoundShape } from '../shape'
import { computeLeafTerminals, consumes, type DagRuntimeView } from './terminal-dag'
import type { PartNaming } from '../topology/naming/types'
import { buildPartNaming, assignPrimitiveFaceRoles, type PartNamingInput } from '../topology/naming/build-naming'
import { faceRowToHint } from '../topology/naming/geom-hint'
import { HASH_UPPER_BOUND } from '../brep/face-evolution'


// ── 装配变换死代码已删除 ──
// v8: applyPrecomputedTransform / eulerDegToMatrix3 / propagateTransform 已删除。
// 装配 pass 委托 executeDoAssemble（唯一真源），约束只存 face 数据、实时 solveFaceMate 求解。

// ── 类型定义 ──

/**
 * A single validation error produced by CadRuntime.check.
 */
export interface CheckError {
  /** The stage that produced the error ('keep' = keep directive validation). */
  stage: 'parse' | 'symbol' | 'reference' | 'keep'
  message: string
  line?: number
  stmtId?: string
  /** Parse diagnostic code (e.g. E_CONTROL_FLOW, passed through from parser ParseError.code). */
  code?: string
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
  /** 失败信息（如果执行中途出错） */
  failedAt?: { index: number; callee: string; message: string }
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
   * docs/plans/2026-08-31-topology-naming-port-v2.md）。
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
   * 执行护栏（§6.3 / D8，v1 可选、默认关闭）：**整轮超时**（覆盖 execute/append/update
   * 全程，含全部函数体重放），超时抛 {@link ExecutionLimitError}（E_EXEC_LIMIT）。
   * 防 `while(true)` 死循环挂死 worker/UI；不传则无超时（现状行为不变）。
   */
  executionTimeoutMs?: number
}

/**
 * 执行护栏超时错误（§6.3 / D8）：整轮执行超过 `executionTimeoutMs` 时抛出。
 * code = 'E_EXEC_LIMIT'（宿主可按 code 识别，区别于普通执行错误）。
 */
export class ExecutionLimitError extends Error {
  /** 宿主可按 code 识别的错误码：'E_EXEC_LIMIT'。 */
  readonly code = 'E_EXEC_LIMIT'
  constructor(timeoutMs: number) {
    super(`[faijs] execution timed out after ${timeoutMs}ms`)
    this.name = 'ExecutionLimitError'
  }
}

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
 * CadRuntime is the execution core of the L2 orchestration layer.
 *
 * It executes a ScriptIR statement sequence and produces an ExecutionResult
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

  /**
   * Persistent SolidCache（docs/plans/2026-08-18-brepchain-persistent-solid-cache.md）：
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

  /** VM 执行器（持久 ctx + 编译产物缓存） */
  private executor: ModuleExecutor

  /** 宿主注册库（含 cad：由根门面 createRuntime 包装注入；注入编译产物 fn 的第二参 ns） */
  private readonly libs: Record<string, StdlibNamespace>
  /** 库内容身份表 (binding → content hash)，增量 key 用（B2，§7.3） */
  private readonly libIds = new Map<string, string>()
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
   * boundary contract (B4, §4.3.3). The engine's built-in L3 surface is
   * registered with `{ compat: false }` by the facade: its mesh/query helpers
   * keep their native statement-level behavior until P23 rebuilds it onto the
   * compat surface (§4.4 keeps dual-op mesh implementations untouched).
   * @param binding - the name scripts use to reach the namespace (e.g. 'cad').
   * @param ns - the library's export object.
   * @param options - registration hints.
   */
  registerLib(binding: string, ns: StdlibNamespace, options?: { default?: boolean; compat?: boolean }): void {
    assertContractVersion(ns as unknown as { contractVersion?: number })
    // B4: admit bare (non-dual-op) library functions through compatOp for
    // libraries that opt in (compat: true). Default off keeps the mesh-native
    // fixture set (`{ makeHeadstock: ... }` style) behaviorally unchanged — the
    // P22 wiring demonstrates the admit path while the in-repo libs (mech-lib,
    // sheetmetal) migrate onto it in P24/P25.
    const admitted = options?.compat === true
      ? (admitCompatLib(ns as unknown as Record<string, unknown>) as StdlibNamespace)
      : ns
    this.libs[binding] = admitted
    this.libIds.set(binding, computeLibId(binding, ns as unknown as Record<string, unknown>))
    if (options?.default === true) {
      this.defaultNsName = binding
      this.executor.setDefaultNsName(binding)
    }
    this.executor.setNamespaces({ ...this.libs } as Namespaces, this.libIds)
  }

  /** The runtime's default namespace binding name (host-declared; 'cad' by default). */
  get defaultNs(): string {
    return this.defaultNsName
  }

  constructor(ports: HostPorts, mode: ExecutionMode = 'auto', libs: Record<string, StdlibNamespace> = {}) {
    this.ports = ports
    this.mode = mode
    this.libs = libs
    this.namespaces = { ...libs } as Namespaces
    this.executor = new ModuleExecutor(this.namespaces, {
      releaseSolid: (partName) => {
        const handle = this.solidCache.get(partName)
        if (handle) {
          try { this.kernel?.release(handle) } catch { /* 已释放 */ }
          this.solidCache.delete(partName)
        }
      },
      getSolid: (partName) => this.solidCache.get(partName),
      releaseHandle: (handle) => {
        try { this.kernel?.release(handle) } catch { /* 已释放 */ }
      },
      setSolid: (partName, solid) => {
        this.solidCache.set(partName, solid)
      },
      setFaceEvolution: (partName, evo) => {
        this.faceEvolutionCache.set(partName, evo)
      },
      setRoleTable: (partName, roleTable) => {
        this.roleTableCache.set(partName, roleTable)
      },
    })

    // P2：装配全局 backends（stdlib 经 getBackends() 取资源）。
    // getter 保证 kernel 异步就绪与 partTransform 运行期变更可见（P5 会细化此装配）。
    // ⚠️ getter 的 this 指向所在对象字面量，用箭头闭包捕获实例（避免 no-this-alias）。
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
    const { script } = parseScript(code, { defaultNs: this.defaultNsName })
    // Full replace: the whole scene resets to this text.
    this.accumulatedCode = code
    this.accumulatedIds = new Set(script.statements.map((s) => s.id))
    return this.executeIR(script, opts)
  }

  /**
   * Full execution from a parsed ScriptIR. Internal: the public surface takes
   * code text only (see {@link execute}); kept for the engine and project tests.
   * @internal
   * @param script - the parsed ScriptIR to execute.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async executeIR(
    script: ScriptIR,
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    const { code, statements } = compileToModule(script)
    this.executor.setCompiled(script, statements)
    await this.executor.load(code)
    const brepChain = await this.ensureBrepChain()
    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }
    this.reconcile(script, statements)
    const exec = this.createBookkeeping(script, opts)
    const start = opts?.startIndex ?? 0
    return this.runWithFailureHandling(script, exec, async () => {
      if (start > 0) {
        const ids = statements.slice(script.params.length + start).map((s) => s.id)
        await this.executor.executeIds(ids, exec)
      } else {
        await this.executor.executeAll(exec)
      }
    }, opts)
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
    const { script: oldScript } = parseScript(oldCode, { defaultNs: this.defaultNsName })
    const { script } = parseScript(newCode, { defaultNs: this.defaultNsName })
    // The scene is now the new code (ids stay position-stable by line).
    this.accumulatedCode = newCode
    this.accumulatedIds = new Set(script.statements.map((s) => s.id))
    return this.updateIR(oldScript, script, opts)
  }

  /**
   * Update from parsed ScriptIRs. Internal: the public surface takes code text
   * only (see {@link update}); kept for the engine and project tests.
   * @internal
   * @param oldScript - the parsed ScriptIR before the edit.
   * @param script - the parsed ScriptIR after the edit.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async updateIR(oldScript: ScriptIR, script: ScriptIR, opts?: ExecuteOptions): Promise<ExecutionResult> {
    const { code, statements } = compileToModule(script)
    this.executor.setCompiled(script, statements)
    await this.executor.load(code)
    const brepChain = await this.ensureBrepChain()
    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }
    this.reconcile(script, statements)
    const exec = this.createBookkeeping(script, opts)
    const staleCompiledIds = this.planUpdateStale(oldScript, script, statements)
    if (staleCompiledIds.size === 0) {
      return this.collectResult(script, exec, opts)
    }
    return this.runWithFailureHandling(script, exec, async () => {
      await this.executor.executeFrom(staleCompiledIds, exec)
    }, opts)
  }

  /**
   * Append the newest statement text (one or more lines generated by the host
   * UI). Every statement in the passed text is treated as new and executed;
   * their inputs resolve from the persistent ctx (outputs of previously
   * executed statements, including other files on the same runtime). When a
   * referenced variable is not in the persistent ctx the prefix is incomplete
   * (e.g. cross-file reference to a never-executed part, or ctx cleared by
   * dispose) — an {@link AppendPrefixError} is thrown and the host should
   * upgrade to a full `execute(code)`.
   * @param code - the .fai.js source text of the newly added statements only.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult (all terminals covered —
   * unexecuted statements are assembled from the persistent ctx).
   */
  async append(code: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    // Append the newest statement text onto the accumulated scene code so ids
    // stay position-stable and DAG/keep analysis sees the whole scene. The
    // passed text is parsed loose: references to parts defined earlier resolve
    // as external vars, validated by assertAppendPrefix against the ctx.
    const fullCode = this.accumulatedCode === null ? code : `${this.accumulatedCode}\n${code}`
    this.accumulatedCode = fullCode
    const { script } = parseScript(fullCode, { looseVars: true, defaultNs: this.defaultNsName })
    // New statements = ids not seen in the previous accumulated scene.
    const newIds: (StmtId | PartName)[] = []
    for (const s of script.statements) {
      if (!this.accumulatedIds.has(s.id)) newIds.push(s.id)
    }
    this.accumulatedIds = new Set(script.statements.map((s) => s.id))
    return this.appendIR(script, newIds, opts)
  }

  /**
   * Append from a parsed ScriptIR. Internal: the public surface takes code text
   * only (see {@link append}); kept for the engine and project tests.
   * @internal
   * @param script - the parsed ScriptIR containing the appended statements.
   * @param newIds - the appended statement ids to execute (derived by append from
   *                the accumulated scene; kept for internal callers).
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async appendIR(
    script: ScriptIR,
    newIds: (StmtId | PartName)[],
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    const { code, statements } = compileToModule(script)
    this.executor.setCompiled(script, statements)
    await this.executor.load(code)
    const brepChain = await this.ensureBrepChain()
    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }
    // Append never reconciles: it never deletes statements, and the persistent
    // ctx of previously executed statements must stay untouched.
    this.assertAppendPrefix(script, statements, newIds)
    const exec = this.createBookkeeping(script, opts)
    // newIds are source statement ids (sN) or output part names (partN) →
    // translate to compiled product ids (s1..sN)
    const sourceIdToCompiled = new Map<string, StmtId>()
    for (const meta of statements) {
      if (meta.sourceIndex === undefined) continue
      const stmt = script.statements[meta.sourceIndex]
      for (const outId of stmt.outputs) sourceIdToCompiled.set(outId, meta.id)
    }
    const compiledIds = newIds.map((id) => sourceIdToCompiled.get(String(id)) ?? (id as StmtId))
    return this.runWithFailureHandling(script, exec, async () => {
      await this.executor.executeIds(compiledIds, exec)
    }, opts)
  }

  /**
   * Validate the append prefix: every reference of the newly appended
   * statements must resolve to a definition within the accumulated scene text
   * itself or to a variable already in the persistent ctx (executed before).
   * Missing references throw {@link AppendPrefixError}.
   */
  private assertAppendPrefix(
    script: ScriptIR,
    statements: CompiledStatementMeta[],
    newIds: (StmtId | PartName)[],
  ): void {
    // Everything defined in the full scene script (params + statement outputs)
    // is a valid prefix; only refs outside the scene must already be in the
    // persistent ctx (cross-file parts executed earlier).
    const idSet = new Set(newIds.map(String))
    const localDefs = new Set<string>()
    for (const p of script.params) localDefs.add(p.name)
    for (const s of script.statements) for (const o of s.outputs) localDefs.add(String(o))
    for (const meta of statements) {
      if (meta.sourceIndex === undefined) continue
      const source = script.statements[meta.sourceIndex]
      if (!source) continue
      const isNew =
        idSet.has(String(source.id)) || source.outputs.some((o) => idSet.has(String(o)))
      if (!isNew) continue
      for (const ref of source.refs ?? []) {
        if (localDefs.has(ref)) continue
        if (this.executor.getCtxVar(ref) !== undefined) continue
        throw new AppendPrefixError(String(source.id), ref)
      }
    }
  }

  /**
   * Dependency analysis producing the set of statements that need recompute.
   * Internal: operates on the parsed IR; the public surface takes code text.
   * @internal
   * @param script - the parsed ScriptIR to analyze.
   * @returns the stale statements and the map of reused part names to their
   * output content keys.
   */
  plan(script: ScriptIR): { stale: StatementIR[]; reused: Map<PartName, string> } {
    const { statements } = compileToModule(script)
    // 先同步 executor 的脚本元数据——plan 计算参数语句 key 依赖 executor.script 的 params
    this.executor.setCompiled(script, statements)
    const { staleCompiledIds, reused } = this.planCompiled(script, statements)
    const stale: StatementIR[] = []
    for (const id of staleCompiledIds) {
      const meta = statements.find((m) => m.id === id)
      if (meta?.sourceIndex !== undefined) stale.push(script.statements[meta.sourceIndex])
    }
    return { stale, reused }
  }

  /**
   * plan 的编译产物形态：按 deps 级联 + statementKey 判定 stale。
   * 参数语句（改参数 = 参数语句 key 变化）经 deps 级联使全部引用语句 stale（根治 plan 不感知 params）。
   */
  private planCompiled(
    script: ScriptIR,
    statements: CompiledStatementMeta[],
  ): { staleCompiledIds: Set<StmtId>; reused: Map<PartName, string> } {
    const staleCompiledIds = new Set<StmtId>()
    const reused = new Map<PartName, string>()

    for (const meta of statements) {
      const source = meta.sourceIndex !== undefined ? script.statements[meta.sourceIndex] : undefined
      // void / same_shape 语句不产出几何，不参与增量分析
      if (source && !source.hasAssignment) continue
      // deps 级联：任一依赖 stale → 本语句 stale
      const depStale = meta.deps.some((d) => staleCompiledIds.has(d))
      if (depStale) {
        staleCompiledIds.add(meta.id)
        continue
      }
      const newKey = this.executor.computeKey(meta, source)
      const cached = this.executor.getCachedKey(meta.id)
      if (cached && cached.key === newKey) {
        const primary = meta.writes[0]
        if (primary !== undefined) reused.set(asPartName(primary), cached.outputContentKey)
      } else {
        staleCompiledIds.add(meta.id)
      }
    }

    return { staleCompiledIds, reused }
  }

  /**
   * Diff-based change-point detection for update(old, new): the two passed code
   * texts are the diff authority (never the executor cache). Statements are
   * paired by id (S-2: same position → same id); the own key (param = param|value,
   * statement = ns.callee|args) is compared and any difference marks the
   * statement stale, cascading through deps. Unpaired new statements (ADD) are
   * always stale; old statements missing from the new text (DELETE) are
   * reclaimed by reconcile.
   */
  private planUpdateStale(
    oldScript: ScriptIR,
    script: ScriptIR,
    statements: CompiledStatementMeta[],
  ): Set<StmtId> {
    const oldById = new Map<string, StatementIR>()
    for (const s of oldScript.statements) oldById.set(String(s.id), s)
    const oldParams = new Map<string, unknown>()
    for (const p of oldScript.params) oldParams.set(p.name, p.value)
    const newParams = new Map<string, unknown>()
    for (const p of script.params) newParams.set(p.name, p.value)

    const stale = new Set<StmtId>()
    for (const meta of statements) {
      const source = meta.sourceIndex !== undefined ? script.statements[meta.sourceIndex] : undefined
      if (source && !source.hasAssignment) continue
      // deps cascade: a statement depending on a stale one is itself stale
      if (meta.deps.some((d) => stale.has(d))) {
        stale.add(meta.id)
        continue
      }
      const newKey = this.ownKeyOf(meta, source, newParams)
      const oldKey = this.oldKeyOf(meta, source, oldById, oldParams, oldScript.functions)
      if (oldKey !== newKey) stale.add(meta.id)
    }
    return stale
  }

  /** Own key of a statement (no dep output contents — downstream goes stale via the deps cascade).
   *  local 语句：key 前缀 `local.<callee>#<bodyHash>`（§6.2 / P4）——编辑函数体 → 调用语句 key 变 → 重放。 */
  private ownKeyOf(
    meta: CompiledStatementMeta,
    source: StatementIR | undefined,
    paramByName: Map<string, unknown>,
  ): string {
    const primary = meta.writes[0]
    if (!source) return `param|${JSON.stringify(paramByName.get(primary))}`
    const head = source.local
      ? `local.${source.callee}#${this.executor.bodyHashOf(source.callee)}`
      : `${source.namespace ?? this.defaultNsName}.${source.callee}`
    return `${head}|${JSON.stringify(withoutKeepDirectives(source.args))}`
  }

  /** Own key of the paired old statement; '' when unpaired (ADD) → always stale. */
  private oldKeyOf(
    meta: CompiledStatementMeta,
    source: StatementIR | undefined,
    oldById: Map<string, StatementIR>,
    oldParams: Map<string, unknown>,
    oldFunctions?: FunctionDefIR[],
  ): string {
    const primary = meta.writes[0]
    if (!source) return `param|${JSON.stringify(oldParams.get(primary))}`
    const old = oldById.get(String(source.id))
    if (!old) return ''
    const oldHash = old.local
      ? (oldFunctions?.find((f) => f.name === old.callee)?.bodyHash ?? 'missing')
      : ''
    const head = old.local
      ? `local.${old.callee}#${oldHash}`
      : `${old.namespace ?? this.defaultNsName}.${old.callee}`
    return `${head}|${JSON.stringify(withoutKeepDirectives(old.args))}`
  }

  // ── 内部：VM 执行编排 ──

  /**
   * Reclaim ctx variables whose defining statement is no longer in the script
   * and release their kernel resources. Cross-file protection: variables still
   * referenced by the script (outputs of parts in other files) are kept — the
   * runtime has no code for them and must not treat them as "not in script".
   */
  private reconcile(script: ScriptIR, statements: CompiledStatementMeta[]): void {
    const activeIds = new Set(statements.map((s) => s.id))
    const writeSets = new Map(statements.map((s) => [s.id, s.writes.map(asPartName)]))
    const referenced = new Set<string>()
    for (const meta of statements) {
      if (meta.sourceIndex === undefined) continue
      for (const ref of script.statements[meta.sourceIndex].refs ?? []) referenced.add(ref)
    }
    this.executor.reconcileCtx(activeIds, writeSets, referenced)
  }

  /** 创建执行记账（outputCache 预填 + keep 装配 + shapeToName 预填）。 */
  private createBookkeeping(script: ScriptIR, opts: ExecuteOptions | undefined): ExecBookkeeping {
    const outputCache = new Map<PartName, Shape>()
    // All alive shape vars from the persistent ctx (append passes only the
    // newest statements; previously executed parts must stay covered).
    for (const name of this.allShapeVarNames()) {
      const v = this.executor.getCtxVar(name)
      if (isShapeLike(v)) outputCache.set(name, v as Shape)
    }
    // keep()（import 入口）统一装配到 ModuleExecutor.internalKeep
    setKeepSink((stmtId, names, hidden) => this.executor.registerKeep(stmtId as StmtId, names, hidden))
    // 预填 shapeToName：持久 ctx 中所有活跃 Shape → 变量名（keep() 反查依赖）。
    // append/update 只重放新增语句，已执行语句的 Shape 需在此补齐。
    for (const name of this.allShapeVarNames()) {
      const v = this.executor.getCtxVar(name)
      if (v !== null && typeof v === 'object') setName(v, name)
    }
    return { outputCache, beforeStatement: opts?.beforeStatement, changed: new Set<PartName>() }
  }

  /** 执行并捕获模式不支持失败（BrepUnsupportedError / MeshUnsupportedError → ExecutionResult.failedAt）。
   *  执行护栏（§6.3 / D8）：设了 executionTimeoutMs 时整轮超时抛 ExecutionLimitError。 */
  private async runWithFailureHandling(
    script: ScriptIR,
    exec: ExecBookkeeping,
    run: () => Promise<void>,
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    const guard = async (): Promise<ExecutionResult> => {
      try {
        await run()
      } catch (err) {
        if (err instanceof BrepUnsupportedError || err instanceof MeshUnsupportedError) {
          const index = err.stmt ? script.statements.indexOf(err.stmt) : -1
          return {
            outputs: exec.outputCache,
            brepChain: this.brepChain!,
            terminals: [],
            infos: [],
            failedAt: { index, callee: err.stmt?.callee ?? '', message: err.message },
          }
        }
        throw err
      }
      return this.collectResult(script, exec, opts)
    }
    const timeoutMs = opts?.executionTimeoutMs
    if (timeoutMs !== undefined && timeoutMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExecutionLimitError(timeoutMs)), timeoutMs)
      })
      try {
        return await Promise.race([guard(), timeout])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }
    return guard()
  }

  /**
   * All shape/compound variable names currently alive in the persistent ctx.
   * The engine executes only the current script's statements, but the result
   * must cover every part — including parts executed by earlier calls
   * (append passes only the newest statements).
   */
  private allShapeVarNames(): Set<PartName> {
    const names = new Set<PartName>()
    for (const key of this.executor.listCtxKeys()) {
      const v = this.executor.getCtxVar(key)
      if (isShapeLike(v) || isCompoundLike(v)) names.add(asPartName(key))
    }
    return names
  }

  /** 从持久 ctx 组装完整 ExecutionResult（outputs / statementCache / brepSolids / topology / compounds / activeValues）。 */
  private collectResult(script: ScriptIR, exec: ExecBookkeeping, opts?: ExecuteOptions): ExecutionResult {
    const outputs = new Map<PartName, Shape | CompoundShape>()
    // All alive shape/compound vars from the persistent ctx — covers parts
    // executed by previous calls (append passes only the newest statements).
    for (const name of this.allShapeVarNames()) {
      const v = this.executor.getCtxVar(name)
      // keep-syntax §5.1：outputs 含所有 shape 变量（mesh + compound，结构判定）
      outputs.set(name, v as Shape | CompoundShape)
    }

    // 同步 statementCache（getCachedOutput / writeToStatementCache 公开 API 依赖）
    for (const meta of this.executor.getMetas()) {
      const cached = this.executor.getCachedKey(meta.id)
      for (const w of meta.writes) {
        const v = this.executor.getCtxVar(w)
        if (isShapeLike(v)) {
          const shape = v as Shape
          this.statementCache.set(asPartName(w), {
            statementKey: cached?.key ?? '',
            outputContentKey: computeContentKey(shape.positions, shape.indices),
            output: shape,
          })
        }
      }
    }

    // P6：装配变换的应用与同步由引擎完成（applyPendingAssemblyTransforms 直接写
    // 身份槽 + solidCache/faceEvolutionCache），此处不再需要反同步循环。

    // T3-cond: DAG 叶子终端判定（§4.1）
    // 显式 terminalShapes（return [...]）优先；否则用“最后写者 + 下游无独占消费”算法
    // （keep-syntax 设计 §3：C0/C1 声明层 + C3/C5 推断层，消费判定由 keep 驱动）。
    // 收集所有 shape-typed 顶层变量名（含 compound 变量；结构判定 isCompoundLike，
    // 第三方返回的未注册 compound 同样识别——keep-syntax §5.3）
    const shapeVarNames = this.allShapeVarNames()
    // 运行时视图：函数体 exec.keep 登记（ModuleExecutor.internalKeep，C1 判定）——
    // 省略 view 会退回纯静态（union 的 exec.keepHidden 将不生效，输入被误消费）
    const view: DagRuntimeView = {
      value: (name) => this.executor.getCtxVar(name),
      internalKeep: (stmt) => this.executor.getInternalKeep(stmt.id),
      // C2：语句调用的 op 若带 L3 静态 consumes 声明（D2），以声明为准。
      // 命名空间缺省 = 默认绑定名（this.defaultNsName，lang 层 F2 缺省 'cad'）；本机函数调用（local）无库元数据。
      opConsumes: (stmt) => {
        if (stmt.local) return undefined
        const ns = stmt.namespace ?? this.defaultNsName
        const fn = this.libs[ns]?.[stmt.callee]
        if (typeof fn !== 'function') return undefined
        const fnWithMeta = fn as unknown as { [DUAL_OP_META]?: import('../define-op').DualOpMeta }
        return fnWithMeta[DUAL_OP_META]?.consumes
      },
    }
    const explicitTerminals = script.terminalShapes ?? []
    let terminals: TerminalShape[]
    if (explicitTerminals.length > 0) {
      terminals = explicitTerminals
    } else {
      terminals = computeLeafTerminals(script, shapeVarNames, view).map((t) => {
        const v = this.executor.getCtxVar(t.id)
        return isCompoundLike(v) ? { ...t, kind: 'compound' } : t
      })
    }
    // keep-syntax §5.2：活跃但非几何的值 → activeValues（不进 terminals，零回归）
    const activeValues = this.collectActiveValues(script, view, shapeVarNames)
    const brepSolids = this.extractBrepSolids(script, terminals)

    // 装配/分组结构：compound 变量 → 成员变量名列表（Phase 2.4）
    const compounds = new Map<PartName, PartName[]>()
    for (const name of this.allShapeVarNames()) {
      const v = this.executor.getCtxVar(name)
      if (isCompoundLike(v)) {
        const behavior = getSlot(v)?.behavior as { memberNames?: string[] } | undefined
        compounds.set(name, (behavior?.memberNames ?? []).map(asPartName))
      }
    }

    // 拓扑：宿主注入（mesh/primitive）+ 自动构建 BREP 真拓扑（Phase 2.6）
    const topology = new Map<PartName, PartTopology>(this.topologyCache)
    const topoMode = opts?.topology ?? 'auto'
    if (topoMode !== 'off') {
      const buildFor = (partName: PartName): void => {
        if (topology.has(partName)) return
        const rt = this.buildBrepTopology(partName)
        if (rt) topology.set(partName, { partName, source: 'brep', data: runtimeToData(rt) })
      }
      if (topoMode === 'brep') {
        // brep 模式：为所有在 BREP 链上的输出构建拓扑（含非终端）
        for (const name of this.allShapeVarNames()) {
          const v = this.executor.getCtxVar(name)
          if (isShapeLike(v)) buildFor(name)
        }
      } else {
        // auto 模式：为"在 BREP 链上"的终端构建拓扑
        for (const t of terminals) {
          buildFor(t.id)
        }
      }
    }

    // 拓扑命名（§3.7）：与 topology 同 set，宿主拾取后 O(1) 反查命名行造 TopoRef
    const naming = new Map<PartName, PartNaming>()
    for (const [partName, partTopo] of topology) {
      const input = this.buildNamingInput(partName, partTopo)
      if (input) naming.set(partName, buildPartNaming(input))
    }

    // 变更声明（P6）：引擎推导——语句写值前后比对 + 装配应用记录（exec.changed）
    const changed: PartName[] = [...exec.changed]

    return {
      outputs,
      brepChain: this.brepChain!,
      terminals,
      infos: [],
      brepSolids: brepSolids.size > 0 ? brepSolids : undefined,
      topology: topology.size > 0 ? topology : undefined,
      naming: naming.size > 0 ? naming : undefined,
      compounds: compounds.size > 0 ? compounds : undefined,
      changed: changed.length > 0 ? changed : undefined,
      activeValues: activeValues.size > 0 ? activeValues : undefined,
    }
  }

  /**
   * 构建一个 part 的命名输入（§3.7）。
   *
   * - BREP：roleTableCache 反查 {origin, role} + subShapeHashes 序号对照 + 面/边行 hint；
   * - primitive：assignPrimitiveFaceRoles 按固定面序给语义 role（§5.2，与 BREP 同一套命名器）；
   * - mesh：只填 hint（role=''，§5.3）。
   *
   * @param partName - the part whose naming to build.
   * @param partTopo - the part's topology entry (source + serialized rows).
   * @returns the PartNamingInput, or undefined when the topology rows are unavailable.
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
      // §5.2：把「固定面序」升级为「语义 role」，与 BREP assignRoles 同一套命名器
      const primitiveRoles = assignPrimitiveFaceRoles(faces, partName)
      return { source: 'primitive', partName, faces, edges, primitiveRoles, edgeFaceOrdinals }
    }
    // mesh：只填 hint（role=''，§5.3）
    return { source: partTopo.source, partName, faces, edges, edgeFaceOrdinals }
  }

  /**
   * 从 SelectorRuntimeData 的 edgeFaceRows 提取每条边的两邻面序号（1 起；§3.7）。
   * mesh 无邻接 → undefined（edgeNaming.faces=null，只能 hint 兜底，§5.3）。
   *
   * @param data - the serialized topology data.
   * @returns per-edge adjacent face ordinal pair, or undefined.
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

  /**
   * 收集活跃但非几何的值（keep-syntax 设计 §5.2）→ Map<PartName, unknown>。
   *
   * 判定与 computeLeafTerminals 同构：变量 v 的最后一次赋值语句 P 之后，
   * 没有任何语句消费 v（consumes 判定，C0/C1/C3/C5）→ 该变量是 DAG 叶子。
   * 叶子且非 shape/compound（第三方测量/查询函数返回的 number/普通对象）→ activeValues。
   * 几何叶子走 terminals（本函数跳过，零回归）；显式 terminalShapes 分支不受影响。
   */
  private collectActiveValues(
    script: ScriptIR,
    view: DagRuntimeView,
    shapeVarNames: Set<PartName>,
  ): Map<PartName, unknown> {
    const active = new Map<PartName, unknown>()
    const lastProducer = new Map<string, number>()
    script.statements.forEach((stmt, i) => {
      if (!stmt.hasAssignment) return
      for (const out of stmt.outputs) lastProducer.set(out, i)
    })
    const names = new Set<string>()
    for (const meta of this.executor.getMetas()) {
      for (const w of meta.writes) names.add(w)
    }
    for (const name of names) {
      const v = this.executor.getCtxVar(name)
      if (v === undefined || isShapeLike(v) || isCompoundLike(v)) continue
      const producerIdx = lastProducer.get(name)
      if (producerIdx === undefined) continue
      let consumed = false
      for (let i = producerIdx + 1; i < script.statements.length; i++) {
        if (consumes(script.statements[i], asPartName(name), view, shapeVarNames)) {
          consumed = true
          break
        }
      }
      if (!consumed) active.set(asPartName(name), v)
    }
    return active
  }

  /** 逐终端提取 BREP solid（含装配成员 solid）。 */
  private extractBrepSolids(
    script: ScriptIR,
    terminals: TerminalShape[],
  ): Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }> {
    const brepSolids = new Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }>()
    if (!this.kernel) return brepSolids

    if (terminals.length > 0) {
      for (const t of terminals) {
        const s = this.solidCache.get(t.id)
        if (s && this.kernel) brepSolids.set(t.id, { solid: s, kernel: this.kernel })
      }
    } else {
      const newShapeStmts = script.statements.filter((s) => s.hasAssignment)
      if (newShapeStmts.length > 0) {
        const lastStmt = newShapeStmts[newShapeStmts.length - 1]
        const lastPartName = lastStmt.outputs[0] ?? lastStmt.id
        const finalSolid = this.solidCache.get(asPartName(lastPartName))
        if (finalSolid && this.kernel) {
          brepSolids.set(asPartName(lastPartName), { solid: finalSolid, kernel: this.kernel })
        }
      }
    }

    // 装配成员 solid 提取：compound 语句（assembly，带 members）本身不持有 solid，
    // 但其 members 在 solidCache 中有更新后的 solid（B4：运行时 compound 值判定，不再按 callee 特判）。
    // 双条件：outputs[0] 的 shape 是 compound 且 args.members 存在——实际等价于原 assembly 判定
    //（group 成员本就在 terminals/brepSolids 中，has() 检查直接跳过，行为零变化）。
    for (const stmt of script.statements) {
      const out0 = stmt.outputs[0]
      if (!out0) continue
      const members = stmt.args?.members
      if (!Array.isArray(members)) continue
      const shape = this.executor.getCtxVar(out0)
      if (!isCompoundLike(shape)) continue
      for (const m of members) {
        const name = typeof m === 'string' ? m : (m as { $ref?: string } | null)?.$ref
        if (!name) continue
        const mId = asPartName(name)
        if (brepSolids.has(mId)) continue
        const s = this.solidCache.get(mId)
        if (s && this.kernel) brepSolids.set(mId, { solid: s, kernel: this.kernel })
      }
    }

    return brepSolids
  }

  /** 旧 statementKey 计算（跨 part 子重放用，逻辑与旧解释器一致）。 */
  private computeLegacyStatementKey(
    stmt: StatementIR,
    getInputContentKey: (id: PartName) => string | undefined,
  ): string {
    const parts: string[] = [stmt.callee]
    parts.push(JSON.stringify(stmt.args))
    for (const inputId of stmt.inputs) {
      const ck = getInputContentKey(inputId)
      parts.push(ck ?? 'missing')
    }
    return parts.join('|')
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
   * @param stmt - the statement whose key is computed.
   * @param output - the shape output.
   * @param outputContentKey - the output's content key.
   */
  writeToStatementCache(
    partName: PartName,
    stmt: StatementIR,
    output: Shape,
    outputContentKey: string,
  ): void {
    const getInputContentKey = (id: PartName) => this.statementCache.get(id)?.outputContentKey
    const stmtKey = this.computeLegacyStatementKey(stmt, getInputContentKey)
    this.statementCache.set(partName, {
      statementKey: stmtKey,
      outputContentKey,
      output,
    })
  }

  /** 清除语句缓存（含 statementCache + executor key 缓存 + ctx 变量） */
  clearStatementCache(): void {
    this.statementCache.clear()
    this.executor.clearCache()
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
    const v = this.executor.getCtxVar(partName)
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
   * dryRun：parse + 符号检查 + 引用预检，零几何副作用。
   *
   * 设计文档 §4.9：三阶段，全部无 per-函数代码——
   * ① parse（零知识解析）；② 符号检查（callee ∈ 符号表，未知 → "函数不存在"；
   * receiver 非空 = 成员方法，不查符号表）；③ 引用预检（inputs/refs 须先定义）。
   *
   * @param code .fai.js 文本
   * @returns CheckResult
   */
  check(code: string): CheckResult {
    const errors: CheckError[] = []
    const warnings: string[] = []

    // ① parse（acorn 闸门；零知识解析）
    let script: ScriptIR
    try {
      const result = parseScript(code, { defaultNs: this.defaultNsName })
      script = result.script
    } catch (err) {
      if (err instanceof ParseError) {
        errors.push({
          stage: 'parse',
          message: err.message,
          line: err.line,
          ...(err.code ? { code: err.code } : {}),
        })
      } else {
        errors.push({
          stage: 'parse',
          message: err instanceof Error ? err.message : String(err),
        })
      }
      return { ok: false, errors, warnings }
    }

    // ② 符号检查：callee ∈ 符号表（未知 → "函数不存在"）。
    // 只有无 receiver 的调用才查符号表（成员方法是对象方法，不在表内，见 §6.2）。
    // F2：命名空间调用按已注册库校验（未登记 specifier → 明确报错，不回退不静默）。
    for (const stmt of script.statements) {
      if (stmt.receiver) continue
      // 本机函数调用（local）：存在性已在 parse 期校验（§3.4 / D15），不查 stdlib 符号表
      if (stmt.local) continue
      const ns = stmt.namespace
      if (ns && ns !== this.defaultNsName) {
        const lib = this.libs[ns]
        if (!lib) {
          errors.push({
            stage: 'symbol',
            message: `namespace "${ns}" is not registered (missing registerLib or import specifier)`,
            stmtId: stmt.id,
          })
          continue
        }
        if (typeof lib[stmt.callee] !== 'function') {
          errors.push({
            stage: 'symbol',
            message: `function "${stmt.callee}" does not exist in namespace "${ns}"`,
            stmtId: stmt.id,
          })
        }
        continue
      }
      // 缺省命名空间调用（namespace 缺省或 === 声明的默认绑定名）：若默认绑定已注册
      // （libs[defaultNsName] 存在）→ 按注册库校验（修复 U10/R2 隐患：名为默认绑定名的
      // 第三方库不再被误判进内部符号表、绕过 registerLib 校验）；未注册（K5 引擎零函数
      // 知识路径）→ 回退 lang 层静态 stdlib 符号表兜底。
      const defaultLib = this.libs[this.defaultNsName]
      if (defaultLib && typeof defaultLib[stmt.callee] !== 'function') {
        errors.push({
          stage: 'symbol',
          message: `function "${stmt.callee}" does not exist in namespace "${this.defaultNsName}"`,
          stmtId: stmt.id,
        })
        continue
      }
      const fnSymbol = getFunctionSymbol(stmt.callee)
      if (!fnSymbol) {
        errors.push({
          stage: 'symbol',
          message: `function "${stmt.callee}" does not exist in the stdlib symbol table`,
          stmtId: stmt.id,
        })
      }
    }

    // ②.5 keep 指令校验（keep-syntax 设计 §7.4：纯静态，不依赖第三方签名）。
    // 引用目标必须是本语句 inputs 之一或 args 中的变量；keepHidden 必须是 boolean。
    for (const stmt of script.statements) {
      for (const msg of validateKeepDirectives(stmt)) {
        errors.push({ stage: 'keep', message: msg, stmtId: stmt.id })
      }
      // E4：keep* 前缀的未识别键（keeps 等拼写错误）→ warning（未知键会透传给 params）
      for (const key of Object.keys(stmt.args ?? {})) {
        if (key.startsWith('keep') && key !== 'keep' && key !== 'keepHidden') {
          warnings.push(
            `statement "${stmt.id}": unknown keep-prefixed option "${key}" (did you mean "keep"?)`,
          )
        }
      }
    }

    // ③ 引用预检：每条语句的 inputs 必须能在前面的语句或参数中找到
    const definedIds = new Set<string>()
    for (const p of script.params) {
      definedIds.add(p.name)
    }
    for (const stmt of script.statements) {
      for (const inputRef of stmt.inputs) {
        if (!definedIds.has(inputRef)) {
          errors.push({
            stage: 'reference',
            message: `statement "${stmt.id}" references undefined input "${inputRef}"`,
            stmtId: stmt.id,
          })
        }
      }
      // Phase 3：可引用的变量名在 outputs（非 stmt.id，因 id 现在是 sN）
      for (const outId of stmt.outputs) {
        definedIds.add(outId)
      }
    }

    // ④ 终端引用预检
    for (const terminal of script.terminalShapes ?? []) {
      if (!definedIds.has(terminal.id)) {
        errors.push({
          stage: 'reference',
          message: `terminal shape references undefined statement "${terminal.id}"`,
        })
      }
    }

    const ok = errors.length === 0
    return {
      ok,
      errors,
      warnings,
      script: ok ? {
        statements: script.statements.length,
        callees: script.statements.map((s) => s.callee),
      } : undefined,
    }
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
    this.executor.clear()
  }
}

// ── 工厂函数 ──

/**
 * Create a CadRuntime instance.
 * @param ports - the host-injected environment capabilities.
 * @param mode - the execution mode (default 'auto').
 * @param libs - the host-injected library namespaces (including `cad`, which the
 * root facade injects automatically; core does not assemble it by default).
 * @returns a new CadRuntime.
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode, libs?: Record<string, StdlibNamespace>): CadRuntime {
  return new CadRuntime(ports, mode, libs)
}
