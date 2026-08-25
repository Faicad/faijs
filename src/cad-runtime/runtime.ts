/**
 * CadRuntime — 执行核心（L2 编排层）
 *
 * Phase 1（VM 执行方案）：内部从"解释器主循环 + dispatcher switch"换成
 * compileToModule + ModuleExecutor。对外签名、ExecutionResult、PartScript、
 * partN_vM 命名、returnType 全部不变。
 *
 * 职责：
 * - 执行 PartScript 语句序列，产出 ExecutionResult（纯计算，不碰 store/DOM）
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

import type { PartScript, CadStatement, TerminalShape, Arg } from '../lang/types'
import type { Shape } from '../ops/types'
import type { BrepChainState } from '../brep/brep-chain'
import type { ShapeHandle, OcctKernel } from 'occt-wasm'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { executeStatement as dispatchStatement } from '../ops/dispatcher'
import { parseScript, ParseError } from '../lang/parser'
import { validateStatementArgs } from '../lang/args-schema'
import { SCHEMAS } from '../stdlib/schemas'
import type { HostPorts, ExecutionMode } from './ports'
import type { SelectorRuntimeData } from '../topology/build-selector-runtime'
import type { SelectorRuntime } from '../topology/types'
import { buildSolidTopologyRuntime } from '../brep/brep-topology'
import type { SolidTopologyResult } from '../brep/brep-topology'
import { buildTopologyFromMesh } from '../brep/brep-topology'
import type { Mesh as WasmMesh } from 'occt-wasm'
import { asPartName, type PartName, type StmtId } from '../identity'
import { compileToModule, type CompiledStatementMeta } from '../lang/compile'
import { ModuleExecutor } from './module-executor'
import { ExecContextImpl, BrepUnsupportedError } from './exec-context'
import { createInternalStdlib } from './internal-stdlib-adapter'
import { computeContentKey } from './content-key'
export { computeContentKey } from './content-key'


// ── 装配变换死代码已删除 ──
// v8: applyPrecomputedTransform / eulerDegToMatrix3 / propagateTransform 已删除。
// 装配 pass 委托 executeDoAssemble（唯一真源），约束只存 face 数据、实时 solveFaceMate 求解。

// ── 类型定义 ──

export interface CheckError {
  stage: 'parse' | 'schema' | 'reference'
  message: string
  line?: number
  stmtId?: string
}

export interface CheckResult {
  ok: boolean
  errors: CheckError[]
  warnings: string[]
  /** 供 AI 自我修正的结构化上下文 */
  script?: { statements: number; ops: string[] }
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

export interface ExecutionResult {
  /** 语句输出缓存（PartName → Shape；含 split 的 front/back 双输出） */
  outputs: Map<PartName, Shape>
  /** BREP 链状态（含逐 part solid 句柄） */
  brepChain: BrepChainState
  /** 终端几何列表 */
  terminals: TerminalShape[]
  /** 信息/警告列表 */
  infos: string[]
  /** 失败信息（如果执行中途出错） */
  failedAt?: { index: number; op: string; message: string }
  /** 逐终端的 BREP 实体（仅持有 solid 的终端出现在此表）。key 为终端 PartName。 */
  brepSolids?: Map<PartName, { solid: ShapeHandle; kernel: OcctKernel }>
  /**
   * 拓扑数据 — 每个 part 的拓扑运行时。
   * key 为 PartName。
   * E13：由 ExecutionResult 携带，宿主从结果消费。
   * 拓扑来源静态判定：BREP 成功时 source='brep'，否则根据 part 类型判定。
   */
  topology?: Map<PartName, PartTopology>
}

export interface ExecuteOptions {
  /** 参数表 */
  params?: Record<string, unknown>
  /** 跨 part 输入几何（PartName → Shape） */
  inputGeometryMap?: Map<PartName, Shape>
  /** 整场景 DAG（用于跨 part 引用解析） */
  sceneScript?: PartScript
  /** partTransform（世界→局部坐标偏移 + 单位缩放） */
  partTransform?: { position: [number, number, number]; scale?: [number, number, number] }
  /** 语句前钩子（用于 undo 逐语句快照） */
  beforeStatement?: (stmt: CadStatement, index: number) => void
  /**
   * 增量执行起点（兼容旧签名）：从指定位置开始顺序执行，
   * 之前的语句不进执行循环（缺省 0 = 全量执行）。
   */
  startIndex?: number
}

// ── CadRuntime ──

const MAX_RECURSION_DEPTH = 50

/** Shape 形状守卫（positions/indices 结构） */
function isShapeLike(v: unknown): v is Shape {
  return !!v && typeof v === 'object' && 'positions' in v && 'indices' in v
}

export class CadRuntime {
  readonly ports: HostPorts
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
  private solidCache = new Map<PartName, ShapeHandle>()

  /** 面演化映射缓存（PartName → FaceEvolution），随 solidCache 一并持久。 */
  private faceEvolutionCache = new Map<PartName, Map<number, number[]>>()

  /** OCCT 内核引用（环境级单例，initOcctWasm() 幂等；mesh 模式为 null）。供顶替释放用。 */
  private kernel: OcctKernel | null = null

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

  /** 内部适配命名空间（Phase 1 临时，Phase 2 由 src/stdlib 正式库函数替代） */
  private readonly stdlib = createInternalStdlib()

  constructor(ports: HostPorts, mode: ExecutionMode = 'auto') {
    this.ports = ports
    this.mode = mode
    this.executor = new ModuleExecutor(this.stdlib, {
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
  }

  /** 确保持久 BREP 链存在（惰性初始化）。mesh 模式 kernel 为 null（无 BREP 能力）。 */
  private async ensureBrepChain(): Promise<BrepChainState> {
    if (this.brepChain) return this.brepChain
    const kernel = this.mode === 'mesh' ? null : await initOcctWasm()
    this.kernel = kernel
    this.brepChain = {
      solidCache: this.solidCache,
      kernel,
      faceEvolutionCache: this.faceEvolutionCache,
      meshShapeCache: new Map<PartName, WasmMesh>(),
    }
    return this.brepChain
  }

  // ── 核心方法：execute（全量执行） ──

  /**
   * 执行 PartScript，返回 ExecutionResult。
   *
   * 纯计算：只产出几何，不碰场景树/store/DOM。
   * browser host 负责消费 ExecutionResult 并落地。
   *
   * VM 路径：compileToModule → executor.load → reconcileCtx → prepareCtx →
   * executeAll（startIndex > 0 时从该语句起）→ collectResult。
   */
  async execute(
    script: PartScript,
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
    await this.prepareCtx(script, opts)
    const exec = this.createExecContext(script, opts, brepChain)
    const start = opts?.startIndex ?? 0
    return this.runWithFailureHandling(script, exec, async () => {
      if (start > 0) {
        const ids = statements.slice(script.params.length + start).map((s) => s.id)
        await this.executor.executeIds(ids, exec)
      } else {
        await this.executor.executeAll(exec)
      }
    })
  }

  /** 构建参数表：opts.params 优先，脚本 params 兜底（execute / append 复用）。 */
  private buildParamsMap(script: PartScript, opts?: ExecuteOptions): Record<string, unknown> {
    const paramsMap: Record<string, unknown> = {}
    if (opts?.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        paramsMap[k] = v
      }
    }
    for (const p of script.params) {
      if (!(p.name in paramsMap)) {
        paramsMap[p.name] = p.value
      }
    }
    return paramsMap
  }

  // ── 语义入口：update / append（增量执行） ──

  /**
   * 更新参数：plan() 算变更语句 → reconcileCtx → executeFrom 重算 stale 集。
   *
   * - stale 为空（无变化）→ 从持久 ctx 组装结果直接返回，零执行；
   * - 否则 executeFrom(staleIds)（stale 集对 deps 封闭，按拓扑序执行）。
   */
  async update(script: PartScript, opts?: ExecuteOptions): Promise<ExecutionResult> {
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
    await this.prepareCtx(script, opts)
    const exec = this.createExecContext(script, opts, brepChain)
    const { staleCompiledIds } = this.planCompiled(script, statements)
    if (staleCompiledIds.size === 0) {
      return this.collectResult(script, exec)
    }
    return this.runWithFailureHandling(script, exec, async () => {
      await this.executor.executeFrom(staleCompiledIds, exec)
    })
  }

  /**
   * 追加语句：只执行新增语句（前缀已在持久 ctx）。
   *
   * 对每条新语句应用与 execute 相同的防护：returnType 过滤 / beforeStatement 钩子 /
   * brep 模式防护 / 顶替释放预捕获。返回完整 ExecutionResult（未执行语句从 ctx 组装）。
   *
   * 契约前提：新增语句的输入必然是此前已执行成功的活跃语句的输出，持久 ctx 保证其存在；
   * 若输入真缺失（dispose/删除后未同步），是调用方应先 execute 全量的信号——append 不做前缀完整性验证。
   */
  async append(script: PartScript, newIds: StmtId[], opts?: ExecuteOptions): Promise<ExecutionResult> {
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
    await this.prepareCtx(script, opts)
    const exec = this.createExecContext(script, opts, brepChain)
    // 调用方传入的 newIds 是源语句 id（varName）→ 翻译为编译产物 id（s1..sN）
    const sourceIdToCompiled = new Map<string, StmtId>()
    for (const meta of statements) {
      if (meta.sourceIndex === undefined) continue
      const stmt = script.statements[meta.sourceIndex]
      sourceIdToCompiled.set(stmt.id, meta.id)
      for (const outId of stmt.outputs ?? []) sourceIdToCompiled.set(outId, meta.id)
    }
    const compiledIds = newIds.map((id) => sourceIdToCompiled.get(String(id)) ?? (id as StmtId))
    return this.runWithFailureHandling(script, exec, async () => {
      await this.executor.executeIds(compiledIds, exec)
    })
  }

  /** plan() — 依赖分析，得出需要重算的语句集合（对外签名不变）。 */
  plan(script: PartScript): { stale: CadStatement[]; reused: Map<PartName, string> } {
    const { statements } = compileToModule(script)
    // 先同步 executor 的脚本元数据——plan 计算参数语句 key 依赖 executor.script 的 params
    this.executor.setCompiled(script, statements)
    const { staleCompiledIds, reused } = this.planCompiled(script, statements)
    const stale: CadStatement[] = []
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
    script: PartScript,
    statements: CompiledStatementMeta[],
  ): { staleCompiledIds: Set<StmtId>; reused: Map<PartName, string> } {
    const staleCompiledIds = new Set<StmtId>()
    const reused = new Map<PartName, string>()

    for (const meta of statements) {
      const source = meta.sourceIndex !== undefined ? script.statements[meta.sourceIndex] : undefined
      // void / same_shape 语句不产出几何，不参与增量分析
      if (source) {
        const rt = source.returnType ?? 'new_shape'
        if (rt === 'void' || rt === 'same_shape') continue
      }
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
  private reconcile(script: PartScript, statements: CompiledStatementMeta[]): void {
    const activeIds = new Set(statements.map((s) => s.id))
    const writeSets = new Map(statements.map((s) => [s.id, s.writes.map(asPartName)]))
    this.executor.reconcileCtx(activeIds, writeSets)
  }

  /** 创建 ExecContextImpl（当前重放输出缓存从持久 ctx 预填）。 */
  private createExecContext(
    script: PartScript,
    opts: ExecuteOptions | undefined,
    brepChain: BrepChainState,
  ): ExecContextImpl {
    const outputCache = new Map<PartName, Shape>()
    for (const meta of this.executor.getMetas()) {
      for (const w of meta.writes) {
        const v = this.executor.getCtxVar(w)
        if (isShapeLike(v)) outputCache.set(asPartName(w), v as Shape)
      }
    }
    const paramsMap = this.buildParamsMap(script, opts)
    return new ExecContextImpl({
      mode: this.mode,
      brepChain,
      ports: this.ports,
      script,
      outputCache,
      params: paramsMap,
      beforeStatement: opts?.beforeStatement,
      setCtxVar: (name, value) => this.executor.setCtxVar(name, value),
    })
  }

  /**
   * 跨 part 引用准备：把 inputGeometryMap 与 sceneScript 解析出的外部 Shape 注入持久 ctx，
   * 使编译产物 fn 的 `ctx.<var>` 直接命中（旧解释器经 resolveShapeRef 兜底）。
   * 必须在 reconcileCtx 之后调用（否则被当作非活跃变量回收）。
   */
  private async prepareCtx(script: PartScript, opts?: ExecuteOptions): Promise<void> {
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
    script: PartScript,
    exec: ExecContextImpl,
    run: () => Promise<void>,
  ): Promise<ExecutionResult> {
    try {
      await run()
    } catch (err) {
      if (err instanceof BrepUnsupportedError) {
        const index = err.stmt ? script.statements.indexOf(err.stmt) : -1
        return {
          outputs: exec.outputCache,
          brepChain: exec.brepChain,
          terminals: [],
          infos: [],
          failedAt: { index, op: err.stmt?.op ?? '', message: err.message },
        }
      }
      throw err
    }
    return this.collectResult(script, exec)
  }

  /** 从持久 ctx 组装完整 ExecutionResult（outputs / statementCache / brepSolids / topology）。 */
  private collectResult(script: PartScript, exec: ExecContextImpl): ExecutionResult {
    const outputs = new Map<PartName, Shape>()
    for (const meta of this.executor.getMetas()) {
      for (const w of meta.writes) {
        const v = this.executor.getCtxVar(w)
        if (isShapeLike(v)) outputs.set(asPartName(w), v as Shape)
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

    const terminals = script.terminalShapes ?? []
    const brepSolids = this.extractBrepSolids(script, terminals)

    return {
      outputs,
      brepChain: exec.brepChain,
      terminals,
      infos: [],
      brepSolids: brepSolids.size > 0 ? brepSolids : undefined,
      topology: this.topologyCache.size > 0 ? new Map(this.topologyCache) : undefined,
    }
  }

  /** 逐终端提取 BREP solid（含装配成员 solid）。 */
  private extractBrepSolids(
    script: PartScript,
    terminals: TerminalShape[],
  ): Map<PartName, { solid: ShapeHandle; kernel: OcctKernel }> {
    const brepSolids = new Map<PartName, { solid: ShapeHandle; kernel: OcctKernel }>()
    if (!this.kernel) return brepSolids

    if (terminals.length > 0) {
      for (const t of terminals) {
        const tKey = asPartName(t.id)
        const s = this.solidCache.get(tKey)
        if (s && this.kernel) brepSolids.set(tKey, { solid: s, kernel: this.kernel })
      }
    } else {
      const newShapeStmts = script.statements.filter(
        (s) => s.hasAssignment && (s.returnType ?? 'new_shape') === 'new_shape',
      )
      if (newShapeStmts.length > 0) {
        const lastStmt = newShapeStmts[newShapeStmts.length - 1]
        const finalSolid = this.solidCache.get(asPartName(lastStmt.id))
        if (finalSolid && this.kernel) {
          brepSolids.set(asPartName(lastStmt.id), { solid: finalSolid, kernel: this.kernel })
        }
      }
    }

    // 装配成员 solid 提取：assembly 终端本身不持有 solid，但其 members 在 solidCache 中有更新后的 solid
    for (const stmt of script.statements) {
      if (stmt.op !== 'assembly') continue
      const members = stmt.args?.members
      if (!Array.isArray(members)) continue
      for (const m of members) {
        if (typeof m !== 'string') continue
        const mId = asPartName(m)
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
    sceneScript?: PartScript,
    resolvingStack: Set<PartName> = new Set(),
  ): Promise<Shape> {
    // 环检测
    if (resolvingStack.has(partName)) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] circular reference: ${partName} ` +
        `(stack: ${Array.from(resolvingStack).join(' → ')})`,
      )
    }
    if (resolvingStack.size >= MAX_RECURSION_DEPTH) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] max recursion depth (${MAX_RECURSION_DEPTH}) exceeded for "${partName}"`,
      )
    }

    // 1. 本地缓存
    const local = localCache.get(partName)
    if (local) return local

    // 2. statementCache
    const cached = this.statementCache.get(partName)
    if (cached) return cached.output

    // 3. sceneScript 中查找
    if (!sceneScript) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] statement "${partName}" not found (no sceneScript provided)`,
      )
    }

    // 在 sceneScript 中查找产生该 partName 的语句（partName 即语句首输出名）
    const stmt = sceneScript.statements.find((s) => asPartName(s.id) === partName)
    if (!stmt) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] statement "${partName}" not found in sceneScript`,
      )
    }

    // 从 sceneScript 的开头重放到该语句（缓存缺失兜底：子重放复用同一持久链，不再新建 brepChain）
    resolvingStack.add(partName)
    const subOutputCache = new Map<PartName, Shape>()
    const brepChain = await this.ensureBrepChain()

    try {
      for (const s of sceneScript.statements) {
        // void / same_shape 语句不产出几何，跳过子重放
        const srt = s.returnType ?? 'new_shape'
        if (srt === 'void' || srt === 'same_shape') continue
        const inputGeometries: Shape[] = []
        for (const inputId of s.inputs) {
          let geo = subOutputCache.get(inputId) ?? localCache.get(inputId)
          if (!geo) {
            geo = await this.resolveShapeRef(inputId, subOutputCache, sceneScript, resolvingStack)
          }
          inputGeometries.push(geo)
        }
        // 顶替释放预捕获（子重放复用持久链，覆盖前必须先释放旧 handle，避免泄漏）
        const writeKeys: PartName[] = [asPartName(s.id), ...(s.outputs ?? [])]
        const oldHandles = writeKeys
          .map((k) => this.solidCache.get(k))
          .filter((h): h is ShapeHandle => !!h)
        const result = await dispatchStatement(s, inputGeometries, subOutputCache, {}, brepChain, this.ports, this.mode)
        const subPrimaryName = asPartName(s.id)
        subOutputCache.set(subPrimaryName, result)
        // 写入持久 statementCache（含 outputs[]），使后续引用直接命中、不再子重放
        const contentKey = computeContentKey(result.positions, result.indices)
        const getInputContentKey = (id: PartName) => this.statementCache.get(id)?.outputContentKey
        const stmtKey = this.computeLegacyStatementKey(s, getInputContentKey)
        this.statementCache.set(subPrimaryName, {
          statementKey: stmtKey,
          outputContentKey: contentKey,
          output: result,
        })
        for (const outId of s.outputs ?? []) {
          if (outId === subPrimaryName) continue
          const outShape = subOutputCache.get(outId)
          if (outShape) {
            this.statementCache.set(outId, {
              statementKey: stmtKey + `|out:${outId}`,
              outputContentKey: computeContentKey(outShape.positions, outShape.indices),
              output: outShape,
            })
          }
        }
        for (const old of oldHandles) {
          try { this.kernel?.release(old) } catch { /* 已释放 */ }
        }

        if (subPrimaryName === partName) {
          resolvingStack.delete(partName)
          return result
        }
      }
    } finally {
      // 不复用持久链的释放（releaseBrepChainState 会清空持久 solidCache）——子重放结果已写入持久缓存
      resolvingStack.delete(partName)
    }

    throw new Error(
      `[CadRuntime.resolveShapeRef] statement "${partName}" not reached during sceneScript execution`,
    )
  }

  /** 旧 statementKey 计算（跨 part 子重放用，逻辑与旧解释器一致）。 */
  private computeLegacyStatementKey(
    stmt: CadStatement,
    getInputContentKey: (id: PartName) => string | undefined,
  ): string {
    const parts: string[] = [stmt.op]
    parts.push(JSON.stringify(stmt.args))
    for (const inputId of stmt.inputs) {
      const ck = getInputContentKey(inputId)
      parts.push(ck ?? 'missing')
    }
    return parts.join('|')
  }

  // ── 公开：缓存访问 ──

  /** 获取语句缓存中的输出几何（key 为语句 id；内部查 PartName 键） */
  getCachedOutput(statementId: StmtId): Shape | undefined {
    return this.statementCache.get(asPartName(statementId))?.output
  }

  /** 写入语句缓存（key 为语句 id，内部按 PartName 键存储） */
  writeToStatementCache(
    statementId: StmtId,
    stmt: CadStatement,
    output: Shape,
    outputContentKey: string,
  ): void {
    const primaryKey = asPartName(statementId)
    const getInputContentKey = (id: PartName) => this.statementCache.get(id)?.outputContentKey
    const stmtKey = this.computeLegacyStatementKey(stmt, getInputContentKey)
    this.statementCache.set(primaryKey, {
      statementKey: stmtKey,
      outputContentKey,
      output,
    })
  }

  /** 清除语句缓存 */
  clearStatementCache(): void {
    this.statementCache.clear()
  }

  // ── 公开：拓扑数据缓存 ──

  /**
   * 写入拓扑数据缓存（E13）。
   *
   * 宿主在以下时机调用：
   * - BREP 执行成功后：用 buildSolidTopologyRuntime 构建 source='brep' 的拓扑
   * - 文件加载时：用 buildSelectorRuntime 构建 source='mesh' 的拓扑
   * - primitive 创建时：用 primitive 拓扑构建函数构建 source='primitive' 的拓扑
   *
   * execute() 返回的 ExecutionResult.topology 会包含这些缓存数据。
   */
  setTopology(partName: PartName, source: TopologySource, data: SelectorRuntimeData): void {
    this.topologyCache.set(partName, { partName, source, data })
  }

  /** 获取拓扑数据 */
  getTopology(partName: PartName): PartTopology | undefined {
    return this.topologyCache.get(partName)
  }

  /** 删除拓扑数据 */
  deleteTopology(partName: PartName): void {
    this.topologyCache.delete(partName)
  }

  /**
   * 从 BREP solid 构建拓扑数据（接口分离 P0）。
   *
   * 宿主不再直接 import faijs 内部构建函数（buildSolidTopologyRuntime），
   * 而是通过此方法从 runtime 获取 BREP 拓扑。
   *
   * 按 stmtId 直接查持久 solidCache + brepChain.meshShapeCache（均为 stmtId key），
   * 不再需要 scopedId 投影。单一真源：solidCache（stmtId → ShapeHandle）。
   *
   * @param stmtId 终端语句 id（在 brepChain.solidCache 中查找）
   * @returns SelectorRuntime，或 null（无可用 BREP solid）
   */
  buildBrepTopology(stmtId: StmtId): SelectorRuntime | null {
    const brepChain = this.brepChain
    if (!brepChain?.kernel) return null

    // stmtId 即其首输出 PartName（品牌桥），按 PartName 查持久 solidCache
    const partName = asPartName(stmtId)
    const solid = brepChain.solidCache.get(partName)
    if (!solid) return null

    // 规则 1：优先从 brepChain.meshShapeCache 复用执行链产出的三角化结果
    // （与显示 mesh 完全同一份 mesh，不二次 meshShape）
    const cachedMesh = brepChain.meshShapeCache?.get(partName)
    if (cachedMesh) {
      return buildTopologyFromMesh(solid, cachedMesh)
    }

    // 无缓存（非执行链路径，如 STEP 导入后直接构建拓扑）→ 执行完整构建（含 meshShape 三角化）
    const result: SolidTopologyResult = buildSolidTopologyRuntime(brepChain.kernel, solid)
    return result.runtime
  }

  // ── 公开：dryRun 校验 ──

  /**
   * dryRun：parse + schema 校验 + 引用预检，零几何副作用。
   *
   * 设计文档 §5.4：三通道归一——
   * browser bridge / AI 自检 / CI 离线校验 都用同一 check()。
   *
   * @param code .faijs 文本
   * @returns CheckResult
   */
  check(code: string): CheckResult {
    const errors: CheckError[] = []
    const warnings: string[] = []

    // ① parse（acorn 闸门）
    let script: PartScript
    try {
      const result = parseScript(code)
      script = result.script
    } catch (err) {
      if (err instanceof ParseError) {
        errors.push({
          stage: 'parse',
          message: err.message,
          line: err.line,
        })
      } else {
        errors.push({
          stage: 'parse',
          message: err instanceof Error ? err.message : String(err),
        })
      }
      return { ok: false, errors, warnings }
    }

    // ② schema 校验（含 unknown-key 报错）
    // 先解析 ParamRef（{ $param: 'name' } → 实际值），使 schema 能校验类型
    const paramValues = new Map<string, unknown>()
    for (const p of script.params) {
      paramValues.set(p.name, p.value)
    }
    for (const stmt of script.statements) {
      // 解析 ParamRef
      const resolvedArgs: Record<string, Arg> = {}
      for (const [key, value] of Object.entries(stmt.args)) {
        if (typeof value === 'object' && value !== null && '$param' in value) {
          const paramName = (value as { $param: string }).$param
          const resolved = paramValues.get(paramName)
          if (resolved === undefined) {
            errors.push({
              stage: 'reference',
              message: `statement "${stmt.id}" references undefined param "${paramName}" in field "${key}"`,
              stmtId: stmt.id,
            })
            resolvedArgs[key] = value
          } else {
            resolvedArgs[key] = resolved as Arg
          }
        } else {
          resolvedArgs[key] = value
        }
      }
      const resolvedStmt = { ...stmt, args: resolvedArgs }
      const validationErrors = validateStatementArgs(resolvedStmt, SCHEMAS)
      for (const ve of validationErrors) {
        errors.push({
          stage: 'schema',
          message: ve.message,
          stmtId: stmt.id,
        })
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
      definedIds.add(stmt.id)
      // 多输出 op（split）：outputs 也是可引用 id（设计文档 §3）
      for (const outId of stmt.outputs ?? []) {
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
        ops: script.statements.map((s) => s.op),
      } : undefined,
    }
  }

  // ── 公开：释放 ──

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
 * 创建 CadRuntime 实例。
 *
 * @param ports Host 注入的环境能力
 * @param mode 执行模式（默认 'auto'）
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime {
  return new CadRuntime(ports, mode)
}
