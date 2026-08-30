/**
 * CadRuntime — 执行核心（L2 编排层）
 *
 * Phase 1（VM 执行方案）：内部从"解释器主循环 + dispatcher switch"换成
 * compileToModule + ModuleExecutor。对外签名、ExecutionResult、ScriptIR、
 * partN_vM 命名全部不变。
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

import type { ScriptIR, StatementIR, TerminalShape } from '../lang/types'
import type { Shape } from '../mesh/types'
import type { BrepChainState } from '../brep/brep-chain'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { getBrepEngine, hasBrepEngine, getActiveBrepEngineId } from '../brep/engine/registry'
import { ensureOcctDefaultEngine } from '../brep/engine/adapters/occt'
import { parseScript, ParseError } from '../lang/parser'
import { getFunctionSymbol } from '../lang/symbol-table'
import { validateKeepDirectives } from '../lang/keep'
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
  assertContractVersion, BrepUnsupportedError, type StdlibNamespace,
} from '../runtime-state'
import { assertLibConforms } from '../define-op'
import { computeContentKey } from './content-key'
export { computeContentKey } from './content-key'
import type { Namespaces } from './module-executor'
import { isCompoundLike, getSlot, type CompoundShape } from '../shape'
import { computeLeafTerminals, consumes, type DagRuntimeView } from './terminal-dag'


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
  failedAt?: { index: number; op: string; message: string }
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
 * Options controlling a single CadRuntime execution.
 */
export interface ExecuteOptions {
  /** The parameter table. */
  params?: Record<string, unknown>
  /** 跨 part 输入几何（PartName → Shape） */
  inputGeometryMap?: Map<PartName, Shape>
  /** 整场景 DAG（用于跨 part 引用解析） */
  sceneScript?: ScriptIR
  /** partTransform（世界→局部坐标偏移 + 单位缩放） */
  partTransform?: { position: [number, number, number]; scale?: [number, number, number] }
  /** 语句前钩子（用于 undo 逐语句快照） */
  beforeStatement?: (stmt: StatementIR, index: number) => void
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
}

/**
 * Options for CadRuntime.executeCode, extending ExecuteOptions with the
 * execution-subset controls used by hosts that only see code text.
 */
export interface ExecuteCodeOptions extends ExecuteOptions {
  /**
   * Execution subset: source statement ids (sN) or output variable names
   * (partN); omitted means full execution. Subset semantics filter the matching
   * statements (preserving order) then run the full execute pipeline (the
   * host's executePart/recomputePart "recompute only this part's statements").
   */
  stmtIds?: (StmtId | PartName)[]
  /**
   * 增量追加语义（等价 runtime.append）：stmtIds 只含新增语句，
   * 前缀依赖须已在持久 ctx（对应宿主 appendStatement）。
   */
  incremental?: boolean
  /**
   * 跨 part 引用的整场景代码文本（IR 剥离配套：宿主不能构造 sceneScript IR，
   * 传 sceneCode 文本，内部 parseScript 后作为 sceneScript 传递）。
   */
  sceneCode?: string
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

  /**
   * Persistent SolidCache（docs/plans/2026-08-18-brepchain-persistent-solid-cache.md）：
   * PartName → OCCT 实体句柄，跨 execute 存活，持有所有权（顶替释放/删除/dispose 的唯一操作对象）。
   * op 层通过 brepChain.solidCache 读写——该引用指向此持久 Map（见 ensureBrepChain）。
   */
  private solidCache = new Map<PartName, BrepHandle>()

  /** 面演化映射缓存（PartName → FaceEvolution），随 solidCache 一并持久。 */
  private faceEvolutionCache = new Map<PartName, Map<number, number[]>>()

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
  private readonly namespaces: Namespaces

  /**
   * Register a third-party library namespace. A version mismatch throws (no
   * silent degradation); afterwards compiled products may use the new library
   * via `ns.<binding>.<callee>`. `cad` is registered the same way: the root
   * facade injects it through registerLib('cad', createInternalStdlib()).
   * @param binding - the namespace binding name.
   * @param ns - the namespace object to register.
   */
  registerLib(binding: string, ns: StdlibNamespace): void {
    assertContractVersion(ns as unknown as { contractVersion?: number })
    // D-4 strict assembly check: every exported dual-op must be structurally
    // valid; a library exporting dual-ops must carry a matching contractVersion.
    assertLibConforms(ns as unknown as Record<string, unknown>)
    this.libs[binding] = ns
    this.executor.setNamespaces({ ...this.libs } as Namespaces)
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
      meshShapeCache: new Map<PartName, BrepMeshResult>(),
    }
    return this.brepChain
  }

  // ── 核心方法：execute（全量执行） ──

  /**
   * Execute a ScriptIR and return an ExecutionResult. Pure computation: it only
   * produces geometry and touches neither the scene tree/store nor the DOM; the
   * browser host consumes and lands the result. VM path: compileToModule →
   * executor.load → reconcileCtx → prepareCtx → executeAll (from startIndex when
   * > 0) → collectResult.
   * @param script - the parsed ScriptIR to execute.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async execute(
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
    this.reconcile(script, statements, opts?.sceneScript)
    await this.prepareCtx(script, opts)
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
   * Update parameters: plan() derives the changed statements →
   * reconcileCtx → executeFrom recomputes the stale set. When stale is empty
   * (no change) it assembles the result from the persistent ctx and returns
   * with zero execution; otherwise it runs executeFrom(staleIds), the stale set
   * being closed over deps and executed in topological order.
   * @param script - the parsed ScriptIR to update against.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async update(script: ScriptIR, opts?: ExecuteOptions): Promise<ExecutionResult> {
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
    this.reconcile(script, statements, opts?.sceneScript)
    await this.prepareCtx(script, opts)
    const exec = this.createBookkeeping(script, opts)
    const { staleCompiledIds } = this.planCompiled(script, statements)
    if (staleCompiledIds.size === 0) {
      return this.collectResult(script, exec, opts)
    }
    return this.runWithFailureHandling(script, exec, async () => {
      await this.executor.executeFrom(staleCompiledIds, exec)
    }, opts)
  }

  /**
   * Append statements: only the newly added statements execute (the prefix is
   * already in the persistent ctx). Each new statement gets the same guards as
   * execute — hasAssignment filter / beforeStatement hook / brep-mode guard /
   * replacement-release pre-capture — and a complete ExecutionResult is returned
   * (unexecuted statements are assembled from ctx). Precondition: a new
   * statement's inputs must be outputs of previously executed successful active
   * statements, guaranteed by the persistent ctx; if an input is genuinely
   * missing (after an unsynced dispose/delete) that is a signal the caller
   * should run a full execute instead — append does not validate prefix
   * integrity.
   * @param script - the parsed ScriptIR containing the appended statements.
   * @param newIds - the source statement ids to execute.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async append(script: ScriptIR, newIds: StmtId[], opts?: ExecuteOptions): Promise<ExecutionResult> {
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
    this.reconcile(script, statements, opts?.sceneScript)
    await this.prepareCtx(script, opts)
    const exec = this.createBookkeeping(script, opts)
    // 调用方传入的 newIds 是源语句的 outputs 中的 partName → 翻译为编译产物 id（s1..sN）
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
   * Source-code execution entry point (the IR-stripping companion): the host
   * only sees code text and never touches ScriptIR. After parseScript(code) it
   * dispatches three ways: (1) no stmtIds → execute (full); (2) stmtIds +
   * incremental → append (execute only the given statements, prefix deps in the
   * persistent ctx); (3) stmtIds subset → filter the statement subset then
   * execute (host executePart/recomputePart). The ExecutionResult structure is
   * identical to execute/append.
   * @param code - the .faijs source text.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   */
  async executeCode(code: string, opts?: ExecuteCodeOptions): Promise<ExecutionResult> {
    const { script } = parseScript(code)
    let execOpts: ExecuteOptions | undefined = opts
    if (opts?.sceneCode !== undefined) {
      const { script: sceneScript } = parseScript(opts.sceneCode)
      const { sceneCode: _sceneCode, ...rest } = opts
      execOpts = { ...rest, sceneScript }
    }
    const stmtIds = opts?.stmtIds
    if (!stmtIds || stmtIds.length === 0) {
      return this.execute(script, execOpts)
    }
    if (opts?.incremental) {
      return this.append(script, stmtIds as StmtId[], execOpts)
    }
    const wanted = new Set(stmtIds.map(String))
    const subset = script.statements.filter(
      (s) => wanted.has(String(s.id)) || s.outputs.some((o) => wanted.has(String(o))),
    )
    if (subset.length === 0) {
      throw new Error(
        `[CadRuntime.executeCode] no statement matches stmtIds [${stmtIds.join(', ')}]`,
      )
    }
    return this.execute({ ...script, statements: subset }, execOpts)
  }

  /**
   * Dependency analysis producing the set of statements that need recompute
   * (public signature unchanged).
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

  // ── 内部：VM 执行编排 ──

  /** reconcileCtx：删除"定义语句已不在脚本中"的 ctx 变量并释放其内核资源。 */
  private reconcile(
    script: ScriptIR,
    statements: CompiledStatementMeta[],
    sceneScript?: ScriptIR | null,
  ): void {
    const activeIds = new Set(statements.map((s) => s.id))
    const writeSets = new Map(statements.map((s) => [s.id, s.writes.map(asPartName)]))
    // executePart 传过滤后的 partScript（只含本 part 语句），但持久 ctx 里
    // 其它 part 的变量仍是场景 DAG 的活跃成员——不能把它们当作"不在脚本中"
    // 而释放（否则跨 part 引用（装配 fixed part）的 solid 会被误释放）。
    // 有 sceneScript 时把其全部语句并入活跃集，仅真正从 sceneScript 删除的
    // 语句（undo delete）才会被回收。
    if (sceneScript) {
      for (const stmt of sceneScript.statements) {
        activeIds.add(stmt.id)
        writeSets.set(stmt.id, stmt.outputs.map(asPartName))
      }
    }
    this.executor.reconcileCtx(activeIds, writeSets)
  }

  /** 创建执行记账（outputCache 预填 + keep 装配 + shapeToName 预填）。 */
  private createBookkeeping(script: ScriptIR, opts: ExecuteOptions | undefined): ExecBookkeeping {
    const outputCache = new Map<PartName, Shape>()
    for (const meta of this.executor.getMetas()) {
      for (const w of meta.writes) {
        const v = this.executor.getCtxVar(w)
        if (isShapeLike(v)) outputCache.set(asPartName(w), v as Shape)
      }
    }
    // keep()（import 入口）统一装配到 ModuleExecutor.internalKeep
    setKeepSink((stmtId, names, hidden) => this.executor.registerKeep(stmtId as StmtId, names, hidden))
    // 预填 shapeToName：持久 ctx 中所有活跃 Shape → 变量名（keep() 反查依赖）。
    // append/update 只重放新增语句，已执行语句的 Shape 需在此补齐。
    for (const meta of this.executor.getMetas()) {
      for (const w of meta.writes) {
        const v = this.executor.getCtxVar(w)
        if (v !== null && typeof v === 'object') setName(v, asPartName(w))
      }
    }
    return { outputCache, beforeStatement: opts?.beforeStatement, changed: new Set<PartName>() }
  }

  /**
   * 跨 part 引用准备：把 inputGeometryMap 与 sceneScript 解析出的外部 Shape 注入持久 ctx，
   * 使编译产物 fn 的 `ctx.<var>` 直接命中（旧解释器经 resolveShapeRef 兜底）。
   * 必须在 reconcileCtx 之后调用（否则被当作非活跃变量回收）。
   */
  private async prepareCtx(script: ScriptIR, opts?: ExecuteOptions): Promise<void> {
    if (opts?.inputGeometryMap) {
      for (const [name, shape] of opts.inputGeometryMap) {
        if (this.executor.getCtxVar(name) === undefined) this.executor.setCtxVar(name, shape)
      }
    }
    const sceneScript = opts?.sceneScript
    if (!sceneScript) return
    const localDefs = new Set<string>()
    for (const p of script.params) localDefs.add(p.name)
    for (const meta of this.executor.getMetas()) for (const w of meta.writes) localDefs.add(w)
    for (const meta of this.executor.getMetas()) {
      if (meta.sourceIndex === undefined) continue
      const stmt = script.statements[meta.sourceIndex]
      for (const ref of stmt.refs ?? []) {
        if (localDefs.has(ref)) continue
        if (this.executor.getCtxVar(ref) !== undefined) continue
        const shape = await this.resolveShapeRef(asPartName(ref), new Map(), sceneScript)
        this.executor.setCtxVar(ref, shape)
      }
    }
  }

  /** 执行并捕获 brep 强制模式失败（BrepUnsupportedError → ExecutionResult.failedAt）。 */
  private async runWithFailureHandling(
    script: ScriptIR,
    exec: ExecBookkeeping,
    run: () => Promise<void>,
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    try {
      await run()
    } catch (err) {
      if (err instanceof BrepUnsupportedError) {
        const index = err.stmt ? script.statements.indexOf(err.stmt) : -1
        return {
          outputs: exec.outputCache,
          brepChain: this.brepChain!,
          terminals: [],
          infos: [],
          failedAt: { index, op: err.stmt?.callee ?? '', message: err.message },
        }
      }
      throw err
    }
    return this.collectResult(script, exec, opts)
  }

  /** 从持久 ctx 组装完整 ExecutionResult（outputs / statementCache / brepSolids / topology / compounds / activeValues）。 */
  private collectResult(script: ScriptIR, exec: ExecBookkeeping, opts?: ExecuteOptions): ExecutionResult {
    const outputs = new Map<PartName, Shape | CompoundShape>()
    for (const meta of this.executor.getMetas()) {
      for (const w of meta.writes) {
        const v = this.executor.getCtxVar(w)
        // keep-syntax §5.1：outputs 含所有 shape 变量（mesh + compound，结构判定）
        if (isShapeLike(v) || isCompoundLike(v)) outputs.set(asPartName(w), v as Shape | CompoundShape)
      }
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
    const shapeVarNames = new Set<PartName>()
    for (const meta of this.executor.getMetas()) {
      for (const w of meta.writes) {
        const v = this.executor.getCtxVar(w)
        if (isShapeLike(v) || isCompoundLike(v)) shapeVarNames.add(asPartName(w))
      }
    }
    // 运行时视图：函数体 exec.keep 登记（ModuleExecutor.internalKeep，C1 判定）——
    // 省略 view 会退回纯静态（union 的 exec.keepHidden 将不生效，输入被误消费）
    const view: DagRuntimeView = {
      value: (name) => this.executor.getCtxVar(name),
      internalKeep: (stmt) => this.executor.getInternalKeep(stmt.id),
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
    for (const meta of this.executor.getMetas()) {
      for (const w of meta.writes) {
        const v = this.executor.getCtxVar(w)
        if (isCompoundLike(v)) {
          const behavior = getSlot(v)?.behavior as { memberNames?: string[] } | undefined
          compounds.set(asPartName(w), (behavior?.memberNames ?? []).map(asPartName))
        }
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
        for (const meta of this.executor.getMetas()) {
          for (const w of meta.writes) {
            const v = this.executor.getCtxVar(w)
            if (isShapeLike(v)) buildFor(asPartName(w))
          }
        }
      } else {
        // auto 模式：为"在 BREP 链上"的终端构建拓扑
        for (const t of terminals) {
          buildFor(t.id)
        }
      }
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
      compounds: compounds.size > 0 ? compounds : undefined,
      changed: changed.length > 0 ? changed : undefined,
      activeValues: activeValues.size > 0 ? activeValues : undefined,
    }
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

  // ── 内部：跨 part 引用解析 ──

  /**
   * 解析跨 part 的语句引用。
   *
   * 查找顺序：
   * 1. localCache（本 part 的 outputCache）
   * 2. statementCache（实例级缓存）
   * 3. sceneScript 中查找并重放该部分
   *
   * 不再 import ScriptEngine / useScriptStore——循环依赖消除。
   */
  private async resolveShapeRef(
    partName: PartName,
    localCache: Map<PartName, Shape>,
    sceneScript?: ScriptIR,
  ): Promise<Shape> {
    // 1. 本地缓存
    const local = localCache.get(partName)
    if (local) return local

    // 2. statementCache
    const cached = this.statementCache.get(partName)
    if (cached) return cached.output

    // 3. sceneScript：编译 + 临时执行器全量执行后取该 part 的几何（VM 路径，替代旧 dispatchStatement 子重放）
    if (!sceneScript) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] statement "${partName}" not found (no sceneScript provided)`,
      )
    }
    const stmt = sceneScript.statements.find((s) => s.outputs.includes(partName))
    if (!stmt) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] statement "${partName}" not found in sceneScript`,
      )
    }

    const { code, statements } = compileToModule(sceneScript)
    const subExecutor = new ModuleExecutor(this.namespaces, {
      releaseSolid: (p) => {
        const h = this.solidCache.get(p)
        if (h) {
          try { this.kernel?.release(h) } catch { /* 已释放 */ }
          this.solidCache.delete(p)
        }
      },
      getSolid: (p) => this.solidCache.get(p),
      releaseHandle: (h) => {
        try { this.kernel?.release(h) } catch { /* 已释放 */ }
      },
      setSolid: (p, s) => this.solidCache.set(p, s),
      setFaceEvolution: (p, e) => this.faceEvolutionCache.set(p, e),
    })
    subExecutor.setCompiled(sceneScript, statements)
    await subExecutor.load(code)
    await this.ensureBrepChain()
    // P5：子重放只需 outputCache 记账（beforeStatement 无钩子）
    const exec: ExecBookkeeping = { outputCache: new Map(), changed: new Set() }
    await subExecutor.executeAll(exec)

    const shape = subExecutor.getCtxVar(partName)
    if (isShapeLike(shape)) return shape as Shape
    throw new Error(
      `[CadRuntime.resolveShapeRef] statement "${partName}" not reached during sceneScript execution`,
    )
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
   * @param code .faijs 文本
   * @returns CheckResult
   */
  check(code: string): CheckResult {
    const errors: CheckError[] = []
    const warnings: string[] = []

    // ① parse（acorn 闸门；零知识解析）
    let script: ScriptIR
    try {
      const result = parseScript(code)
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
      const ns = stmt.namespace
      if (ns && ns !== 'cad') {
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
