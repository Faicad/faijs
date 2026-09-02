/**
 * module-executor — JS VM 模块加载与增量调度（VM 执行方案 Phase 1）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.2
 *
 * ModuleExecutor 是 VM 执行的核心：
 * - `ctx` 持久变量容器（跨 execute/append/update 存活）
 * - `load(code)` 用 data:/Blob URL 动态 import 编译产物（零 import，两平台同构）
 * - `executeAll/executeIds/executeFrom` 按 deps 拓扑序调度
 * - `reconcileCtx` 回收"定义语句已不在脚本中"的变量并释放其内核资源
 * - `cache` 记录每语句 statementKey + outputContentKey（plan 增量判定）
 */

import type { CompiledStatementMeta } from '../lang/compile'
import type { StatementIR, ScriptIR } from '../lang/types'
import { withoutKeepDirectives, type InternalKeepRecord } from '../lang/keep'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { PartName, StmtId } from '../identity'
import { asPartName } from '../identity'
import { computeContentKey } from './content-key'
import { getSlot, hasBrep, brepOf, ensureSlot, isCompoundLike } from '../shape'
import { setCurrentStmt, setName, getBackends, takePendingAssemblyTransforms, enterFunctionBrep, exitFunctionBrep, takeFunctionBrepDomain, type StdlibNamespace } from '../runtime-state'
import { applyTransform } from '../mesh/rigid-transform'
import { applyTransformBrep } from '../brep/brep-ops'
import type { EventSink } from './ports'

// ── 编译产物语句（从模块文本 import 得到） ──

/**
 * 已装配的命名空间集合（标准库 `cad` + 宿主注册的库）。
 * 编译产物 `fn(ctx, ns)` 经 ns.<binding>.<callee>() 调用——引擎不区分函数来自哪个库。
 */
export interface Namespaces {
  readonly cad: StdlibNamespace
  readonly [binding: string]: StdlibNamespace
}

/**
 * 执行记账（P5：exec 上下文删除后，ModuleExecutor 只需 beforeStatement + outputCache）。
 * beforeStatement：undo 逐语句快照钩子；outputCache：语句产物缓存（collectResult 消费）。
 */
export interface ExecBookkeeping {
  beforeStatement?: (stmtId: string, index: number) => void
  outputCache: Map<PartName, Shape>
  /** 变更声明（P6：引擎比对推导 + 装配应用记录），collectResult 消费。 */
  changed: Set<PartName>
}

/** 编译产物中的单条语句（模块文本 `{ id, deps, fn }`）。 */
export interface CompiledStatement {
  id: StmtId
  deps: StmtId[]
  fn: (ctx: Record<string, unknown>, ns: Namespaces) => Promise<void>
}

/** 动态 import 编译产物（Node: data: URL；浏览器: Blob URL）。 */
async function importModule(code: string): Promise<{ statements: CompiledStatement[] }> {
  const isNode = typeof process !== 'undefined' && !!process.versions?.node
  if (isNode) {
    const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    return import(/* @vite-ignore */ url)
  }
  const blob = new Blob([code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    return await import(/* @vite-ignore */ url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 收集一个值可到达的全部 BREP 句柄（函数返回值 keep 集，§5.6）：
 * shape → 身份槽 solid；compound → children 递归；数组 / 普通对象 → 递归。
 */
function collectBrepHandles(v: unknown, out: Set<unknown>): void {
  if (v === null || v === undefined) return
  if (typeof v !== 'object') return
  if (v instanceof Set || v instanceof Map) return
  // shape：身份槽持 OCCT 句柄
  const slot = getSlot(v as object)
  if (slot?.solid) out.add(slot.solid)
  // compound children / 数组 / 对象递归
  if (Array.isArray(v)) {
    for (const item of v) collectBrepHandles(item, out)
    return
  }
  if (isCompoundLike(v)) {
    for (const child of (v as { children: unknown[] }).children) collectBrepHandles(child, out)
    return
  }
  for (const k of Object.keys(v)) {
    // 跳过内部元数据字段（positions/indices/kind 等 mesh 数据不含句柄，无需遍历）
    if (k === 'positions' || k === 'indices' || k === 'kind') continue
    collectBrepHandles((v as Record<string, unknown>)[k], out)
  }
}

// ── ModuleExecutor ──

/**
 * Options for constructing a ModuleExecutor, providing the OCCT handle
 * callbacks the executor needs to integrate with the runtime's persistent
 * solid caches.
 */
export interface ModuleExecutorOptions {
  /** Release the OCCT handle for a PartName (called when reconcileCtx deletes a variable; no-op without a handle). */
  releaseSolid?: (partName: PartName) => void
  /** Read the OCCT handle currently held for a PartName (used for replacement-release pre-capture). */
  getSolid?: (partName: PartName) => BrepHandle | undefined
  /** Release a previously captured OCCT handle (replacement release: free the old handle after a same-id recompute succeeds). */
  releaseHandle?: (handle: BrepHandle) => void
  /** Sync an identity-slot solid into the PartName-keyed solidCache (relied on by existing runtime logic). */
  setSolid?: (partName: PartName, solid: BrepHandle) => void
  /** Sync an identity-slot faceEvolution into the PartName-keyed faceEvolutionCache. */
  setFaceEvolution?: (partName: PartName, evo: Map<number, number[]>) => void
  /** Sync an identity-slot roleTable into the PartName-keyed roleTableCache (§2.3 naming). */
  setRoleTable?: (partName: PartName, roleTable: unknown) => void
}

/**
 * ModuleExecutor loads JS VM modules and schedules incremental execution.
 *
 * It is the heart of the VM execution approach: it keeps the persistent `ctx`
 * variable container alive across execute/append/update calls, dynamically
 * imports compiled modules from data:/Blob URLs (zero imports, isomorphic on
 * both platforms), schedules all/selected/from statements in dependency
 * topological order, reclaims variables whose defining statements have left the
 * script, and caches each statement's key + output content key for incremental
 * planning.
 */
export class ModuleExecutor {
  /** Persistent variable container across incremental executions. */
  readonly ctx: Record<string, unknown> = {}

  private stmts = new Map<StmtId, CompiledStatement>()
  /** statementKey 缓存（增量判定；key = op|JSON(args)|deps 的 outputContentKey） */
  private cache = new Map<StmtId, { key: string; outputContentKey: string }>()
  /**
   * 函数体 keep 登记（keep-syntax 设计 §2.2）：
   * stmtId → { kept, hidden }。语句执行前清空本条记录，执行中累加；
   * 本轮未执行（缓存命中）→ 保留上一轮记录（keep 零重算的前提）。
   */
  readonly internalKeep = new Map<StmtId, InternalKeepRecord>()
  private sourceById = new Map<StmtId, StatementIR>()
  private metaById = new Map<StmtId, CompiledStatementMeta>()
  private script: ScriptIR = { params: [], statements: [] }
  private lastCode = ''
  /**
   * 默认命名空间绑定名（U10/R2）：与 runtime 的 registerLib(…, {default: true}) 声明同步；
   * statementKey/computeKey 中 namespace 缺省（undefined）的语句按该绑定名计 key。
   */
  private defaultNsName = 'cad'

  /** Sync the default namespace binding name (called by runtime.registerLib with {default:true}). */
  setDefaultNsName(name: string): void {
    this.defaultNsName = name
  }
  private namespaces: Namespaces
  /** 本机函数调用嵌套深度（§5.5）：> 0 表示当前在函数体内执行——keep 登记被抑制。 */
  private userFunctionDepth = 0
  private readonly releaseSolid?: (partName: PartName) => void
  private readonly getSolid?: (partName: PartName) => BrepHandle | undefined
  private readonly releaseHandle?: (handle: BrepHandle) => void
  private readonly setSolid?: (partName: PartName, solid: BrepHandle) => void
  private readonly setFaceEvolution?: (partName: PartName, evo: Map<number, number[]>) => void
  private readonly setRoleTable?: (partName: PartName, roleTable: unknown) => void

  constructor(namespaces: Namespaces, options?: ModuleExecutorOptions) {
    this.namespaces = namespaces
    this.releaseSolid = options?.releaseSolid
    this.getSolid = options?.getSolid
    this.releaseHandle = options?.releaseHandle
    this.setSolid = options?.setSolid
    this.setFaceEvolution = options?.setFaceEvolution
    this.setRoleTable = options?.setRoleTable
  }

  /**
   * Hot-update the assembled namespace set (after registerLib mounts a new
   * library).
   * @param namespaces - the new assembled namespaces.
   */
  setNamespaces(namespaces: Namespaces): void {
    this.namespaces = namespaces
  }

  /**
   * Update the script and its compiled metadata (ctx stays alive).
   * @param script - the parsed ScriptIR.
   * @param compiled - the compiled statement metadata.
   */
  setCompiled(script: ScriptIR, compiled: CompiledStatementMeta[]): void {
    this.script = script
    this.metaById = new Map(compiled.map((m) => [m.id, m]))
    this.sourceById = new Map()
    for (const meta of compiled) {
      if (meta.sourceIndex !== undefined) {
        this.sourceById.set(meta.id, script.statements[meta.sourceIndex])
      }
    }
  }

  /**
   * Load the compiled module, skipping a reload when the code is unchanged
   * (compiled-product cache).
   * @param code - the compiled module source.
   */
  async load(code: string): Promise<void> {
    if (code === this.lastCode) return
    const mod = await importModule(code)
    this.stmts = new Map(mod.statements.map((s) => [s.id, s]))
    this.lastCode = code
  }

  /**
   * Execute every statement in dependency topological order (i.e. statement
   * table order).
   * @param exec - the execution bookkeeping.
   */
  async executeAll(exec: ExecBookkeeping): Promise<void> {
    await this.executeIds([...this.stmts.keys()], exec)
  }

  /**
   * Execute only the given statements (append: the prefix is already in the
   * persistent ctx). As in the old interpreter, beforeStatement fires only for
   * new_shape statements; void/same_shape statements (do_assemble/add_constraint)
   * do not trigger it (do_assemble's fn delegates internally).
   * @param ids - the compiled statement ids to execute.
   * @param exec - the execution bookkeeping.
   */
  async executeIds(ids: StmtId[], exec: ExecBookkeeping): Promise<void> {
    for (const id of ids) {
      const compiled = this.stmts.get(id)
      if (!compiled) throw new Error(`[ModuleExecutor] unknown statement "${id}"`)
      const source = this.sourceById.get(id)
      const meta = this.metaById.get(id)
      // 顶替释放预捕获：fn 前捕获本语句写键（{id} ∪ outputs）的旧 handle；
      // 必须在 fn 之前捕获——op 执行时已用 solidCache.set 覆盖条目，事后拿不到旧引用。
      const oldHandles = (meta?.writes ?? [])
        .map((w) => this.getSolid?.(asPartName(w)))
        .filter((h): h is BrepHandle => !!h)
      // P6：changed 由引擎比对推导（替代旧的 touch 声明机制）
      const oldWrites = new Map<string, unknown>()
      for (const w of meta?.writes ?? []) oldWrites.set(w, this.ctx[w])
      setCurrentStmt(source) // P5：新 keep() 归属当前语句
      // keep 登记先清空本条记录：重执行的语句重新登记（执行中累加，设计 §2.2）
      this.internalKeep.delete(id)
      if (source && source.hasAssignment) {
        exec.beforeStatement?.(String(source.id), this.script.statements.indexOf(source))
      }
      // 本机函数调用（local）：进入函数 BREP 域（§5.6），提升 userFunctionDepth（keep 隔离，§5.5）。
      // 函数体执行期间：内部 keep 登记被抑制（registerKeep no-op）；体内瞬态句柄登记到域，
      // 结束后释放除返回值可到达句柄外的全部（finally 保证异常路径同样释放）。
      const isLocal = source?.local === true
      if (isLocal) {
        this.userFunctionDepth++
        enterFunctionBrep()
      }
      try {
        await compiled.fn(this.ctx, this.namespaces)
      } finally {
        if (isLocal) {
          this.releaseFunctionBrepDomain(compiled, meta)
          exitFunctionBrep()
          this.userFunctionDepth--
        }
      }
      await this.afterStatement(compiled, exec)
      for (const [w, old] of oldWrites) {
        if (old !== this.ctx[w]) exec.changed.add(asPartName(w))
      }
      // 顶替释放：执行成功后才释放旧 handle（失败时缓存保持执行前状态，天然回滚）
      for (const old of oldHandles) {
        this.releaseHandle?.(old)
      }
    }
  }

  /**
   * Re-execute from the change points on (update: plan derives the stale set).
   * The stale set is closed over deps (a statement depending on a stale one is
   * itself stale) and runs in topological order.
   * @param staleIds - the set of stale statement ids to recompute.
   * @param exec - the execution bookkeeping.
   */
  async executeFrom(staleIds: Set<StmtId>, exec: ExecBookkeeping): Promise<void> {
    const ordered: StmtId[] = []
    const visited = new Set<StmtId>()
    const visit = (id: StmtId): void => {
      if (visited.has(id)) return
      visited.add(id)
      const meta = this.metaById.get(id)
      if (meta) {
        for (const dep of meta.deps) {
          if (staleIds.has(dep)) visit(dep)
        }
      }
      ordered.push(id)
    }
    for (const id of staleIds) visit(id)
    await this.executeIds(ordered, exec)
  }

  /**
   * Reclaim ctx variables whose defining statement is no longer in the script
   * and release their kernel resources (a required action after undoing a
   * statement deletion). Variables in `referencedVars` are kept even when not
   * written by an active statement (cross-file references to other files'
   * parts).
   * @param activeStmtIds - the ids of statements still considered active.
   * @param writeSets - mapping of statement id to the variable names it writes.
   * @param referencedVars - variable names still referenced by the active
   * script; these survive reclaim.
   */
  reconcileCtx(
    activeStmtIds: Set<StmtId>,
    writeSets: Map<StmtId, PartName[]>,
    referencedVars?: Set<string>,
  ): void {
    const activeWrites = new Set<string>()
    for (const [id, writes] of writeSets) {
      if (activeStmtIds.has(id)) {
        for (const w of writes) activeWrites.add(w)
      }
    }
    for (const key of Object.keys(this.ctx)) {
      if (!activeWrites.has(key) && !(referencedVars?.has(key) ?? false)) {
        this.releaseSolid?.(asPartName(key))
        delete this.ctx[key]
      }
    }
    // keep 登记同步修剪：语句已不在脚本中（undo 删除）→ 其 keep 声明失效
    for (const id of [...this.internalKeep.keys()]) {
      if (!activeStmtIds.has(id)) this.internalKeep.delete(id)
    }
  }

  // ── 缓存访问（plan / collectResult 用） ──

  /** 清除所有缓存（key 缓存 + ctx 变量）。测试用：CadRuntime.clearStatementCache 调用。 */
  clearCache(): void {
    for (const key of Object.keys(this.ctx)) {
      this.releaseSolid?.(asPartName(key))
      delete this.ctx[key]
    }
    this.cache.clear()
    this.script = { params: [], statements: [] }
    this.metaById.clear()
    this.stmts.clear()
    this.sourceById.clear()
    this.internalKeep.clear()
    this.lastCode = ''
  }

  /**
   * Read a statement's statementKey cache entry.
   * @param id - the compiled statement id.
   * @returns the cached key and output content key, or undefined.
   */
  getCachedKey(id: StmtId): { key: string; outputContentKey: string } | undefined {
    return this.cache.get(id)
  }

  /**
   * Read a statement's function-body keep registration (used by the terminal-dag
   * C1 check); undefined when none exists.
   * @param id - the compiled statement id.
   * @returns the internal keep record, or undefined.
   */
  getInternalKeep(id: StmtId): InternalKeepRecord | undefined {
    return this.internalKeep.get(id)
  }

  /**
   * Register a function-body keep entry into ModuleExecutor.internalKeep,
   * accumulating during execution.
   * @param id - the compiled statement id.
   * @param names - the kept variable names.
   * @param hidden - whether the kept variables are hidden.
   */
  registerKeep(id: StmtId, names: PartName[], hidden: boolean): void {
    // 函数 BREP 域 / keep 隔离（§5.5 / D5）：本机函数体内嵌套 cad.* 的库内部
    // keep 登记一律抑制——保留语义由调用点 keep 表达，函数体不向顶层传播保留。
    if (this.userFunctionDepth > 0) return
    let rec = this.internalKeep.get(id)
    if (!rec) {
      rec = { kept: new Set(), hidden: new Map() }
      this.internalKeep.set(id, rec)
    }
    for (const n of names) {
      rec.kept.add(n)
      rec.hidden.set(n, hidden)
    }
  }

  /**
   * 函数 BREP 域释放（§5.6 / D13）：取走当前域的句柄登记表，收集本语句输出
   * （返回值）可到达的全部句柄为 keep 集，释放登记域内除 keep 集外的全部句柄。
   * 函数体内中间体的瞬态句柄在此一次性释放——单次调用内存有界，不逐轮释放。
   */
  private releaseFunctionBrepDomain(compiled: CompiledStatement, meta: CompiledStatementMeta | undefined): void {
    const domain = takeFunctionBrepDomain()
    if (domain.length === 0) return
    // keep 集：返回值（语句 writes 的 ctx 值，可能是 shape / compound / 数组 / 对象）可到达的句柄
    const kept = new Set<unknown>()
    for (const w of meta?.writes ?? []) {
      const v = this.ctx[w]
      collectBrepHandles(v, kept)
    }
    for (const h of domain) {
      if (kept.has(h)) continue
      try {
        this.releaseHandle?.(h as BrepHandle)
      } catch { /* 已释放 */ }
    }
  }

  /**
   * Read a ctx variable.
   * @param name - the variable name.
   * @returns the variable value.
   */
  getCtxVar(name: string): unknown {
    return this.ctx[name]
  }

  /**
   * Write a ctx variable (used to sync assembly transforms from outputCache
   * back into ctx).
   * @param name - the variable name.
   * @param value - the value to store.
   */
  setCtxVar(name: string, value: unknown): void {
    this.ctx[name] = value
  }

  /**
   * All variable names currently held in the persistent ctx (covers parts
   * executed by previous execute/append/update calls).
   * @returns the ctx variable names.
   */
  listCtxKeys(): string[] {
    return Object.keys(this.ctx)
  }

  /**
   * Returns the compiled metadata in params + statements order.
   * @returns the compiled statement metadata array.
   */
  getMetas(): CompiledStatementMeta[] {
    return [...this.metaById.values()]
  }

  /** 清空 ctx 与 statementKey 缓存（CadRuntime.dispose 用）。 */
  clear(): void {
    for (const key of Object.keys(this.ctx)) delete this.ctx[key]
    this.cache.clear()
    this.internalKeep.clear()
    this.stmts.clear()
    this.lastCode = ''
  }

  // ── 内部 ──

  /** 语句执行后：ctx → outputCache 同步 + 身份槽 → solidCache/faceEvolutionCache 同步 + statementKey 缓存 + 装配传播。 */
  private async afterStatement(compiled: CompiledStatement, exec: ExecBookkeeping): Promise<void> {
    const source = this.sourceById.get(compiled.id)
    const meta = this.metaById.get(compiled.id)
    const writes = meta?.writes ?? []
    for (const w of writes) {
      const v = this.ctx[w]
      if (v !== undefined) {
        if (typeof v === 'object' && v !== null) {
          setName(v, asPartName(w)) // P3：新 keep() 反查走 runtime-state 映射（P5 删 exec 侧）
          // 身份槽 → PartName 键控缓存同步（runtime 的 brepSolids/顶替释放/buildBrepTopology 依赖）
          const slot = getSlot(v)
          if (slot?.solid) this.setSolid?.(asPartName(w), slot.solid as BrepHandle)
          if (slot?.faceEvolution) this.setFaceEvolution?.(asPartName(w), slot.faceEvolution)
          if (slot?.roleTable) this.setRoleTable?.(asPartName(w), slot.roleTable)
        }
        exec.outputCache.set(asPartName(w), v as Shape)
      }
    }
    const key = meta ? this.computeKey(meta, source) : ''
    const outputContentKey = this.computeOutputContentKey(compiled)
    this.cache.set(compiled.id, { key, outputContentKey })

    // P4：引擎统一发 part-brep-lost（F1：库不再读 currentStmt / 不再 emit）
    // 语义：上游在 BREP 链上，但本语句产物不在链上 → BREP 链在此断开
    this.emitBrepLost(compiled.id, source)

    // P6：装配传播（求解在库，应用与失效在引擎）
    await this.applyPendingAssemblyTransforms(exec)
  }

  /**
   * P6：装配传播——取走全部待应用变换，引擎应用到成员（mesh 原地 + BREP 槽 + solidCache），
   * 记录 changed，并让依赖成员的下游语句失效重算（DAG 重放，替代 exec.dependentsOf 图遍历）。
   */
  private async applyPendingAssemblyTransforms(exec: ExecBookkeeping): Promise<void> {
    const pending = takePendingAssemblyTransforms()
    if (pending.length === 0) return
    const kernel = getBackends().kernel.brep as BrepEngineApi | null
    for (const { compound, transforms } of pending) {
      const behavior = getSlot(compound)?.behavior as { memberNames?: string[] } | undefined
      if (!behavior?.memberNames) continue
      const children = (compound as { children?: Shape[] }).children ?? []
      const memberNames = behavior.memberNames
      for (const t of transforms) {
        const member = children[t.index]
        const name = memberNames[t.index]
        if (!member || typeof member !== 'object') continue
        // mesh 原地变换（保留同一对象引用，ctx 与 compound.children 同步看到变更）
        Object.assign(member, applyTransform(member, t.quaternion, t.pivot, t.translation, t.rotationMatrix))
        // BREP 刚体变换（可选）：新 solid 写身份槽 + solidCache（替代旧 T6.5 反同步循环）
        const solid = brepOf(member) as BrepHandle | undefined
        if (kernel && solid) {
          const transformed = applyTransformBrep(kernel, solid, t.quaternion, t.pivot, t.translation)
          try { kernel.release(solid) } catch { /* 已释放 */ }
          ensureSlot(member).solid = transformed
          if (name) this.setSolid?.(asPartName(name), transformed)
        }
        if (name) exec.changed.add(asPartName(name))
      }
      // 下游失效重算：依赖成员名的语句（拓扑序由 executeFrom 按 deps 保证）
      const stale = this.computeDownstream(memberNames)
      if (stale.size > 0) await this.executeFrom(stale, exec)
    }
  }

  /** 找出依赖给定变量名的语句（装配成员 → 消费它的下游）。 */
  private computeDownstream(memberNames: string[]): Set<StmtId> {
    const names = new Set(memberNames)
    const stale = new Set<StmtId>()
    for (const [id, source] of this.sourceById) {
      if (source.inputs.some((n) => names.has(String(n)))) stale.add(id)
    }
    return stale
  }

  /**
   * 判定并发 part-brep-lost 事件。
   *
   * 判据：语句有几何输入且**全部**输入都在 BREP 链上，但输出**不在**链上
   * → BREP 链在此断开（mesh-only 函数或 fallthrough）。
   */
  private emitBrepLost(id: StmtId, source: StatementIR | undefined): void {
    if (!source || source.inputs.length === 0) return
    const sink = getBackends().events as EventSink | undefined
    if (!sink) return

    const inputsOnChain = source.inputs
      .map((n) => this.ctx[String(n)])
      .filter((v): v is Shape => !!v && typeof v === 'object')
    if (inputsOnChain.length === 0) return
    if (!inputsOnChain.every(hasBrep)) return          // 上游本就不在链上 → 非断开

    const out = this.ctx[this.metaById.get(id)?.writes[0] ?? '']
    if (out && typeof out === 'object' && hasBrep(out as Shape)) return   // 输出仍在链上

    sink.emit('part-brep-lost', {
      partName: asPartName(String(source.outputs[0] ?? '')),
      callee: source.callee,
      reason: `${source.callee} has no BREP implementation`,
    })
  }

  /**
   * Compute a statementKey = op | JSON(args without keep) | each dependency's
   * output content key (parameter statements use the parameter value). The
   * keep/keepHidden keys are excluded so toggling retain/hide state triggers no
   * geometric recompute. plan() uses this with the current cache to compute the
   * expected key for incremental decisions.
   *
   * 本机函数调用（local）：key 前缀 `local.<callee>#<bodyHash>`（§6.2 / P4 内容寻址）——
   * 编辑函数体文本 → 所有调用该函数的语句 key 变化 → 下游失效重算；不改函数体零重算。
   * @param meta - the compiled statement metadata.
   * @param source - the source statement, or undefined for parameter statements.
   * @returns the computed statement key string.
   */
  computeKey(meta: CompiledStatementMeta, source: StatementIR | undefined): string {
    const primary = meta.writes[0]
    if (!source) {
      const p = this.script.params.find((pp) => pp.name === primary)
      return `param|${JSON.stringify(p?.value)}`
    }
    const parts = [
      source.local
        ? `local.${source.callee}#${this.bodyHashOf(source.callee)}`
        : `${source.namespace ?? this.defaultNsName}.${source.callee}`,
    ]
    parts.push(JSON.stringify(withoutKeepDirectives(source.args)))
    for (const dep of meta.deps) {
      const ck = this.cache.get(dep)?.outputContentKey
      parts.push(ck ?? 'missing')
    }
    return parts.join('|')
  }

  /**
   * 按函数名查 bodyHash（setCompiled 已存 script；查不到 → 'missing'，增量会失效重算）。
   * @internal runtime.planUpdateStale 的 ownKey/oldKey 对比（§6.2 / P4）复用。
   * @param name 本机函数名。
   * @returns 函数体的内容哈希；`'missing'` 表示未知函数。
   */
  bodyHashOf(name: string): string {
    return this.script.functions?.find((f) => f.name === name)?.bodyHash ?? 'missing'
  }

  /** outputContentKey：shape 语句 = mesh 内容哈希；参数语句 = 参数值。 */
  private computeOutputContentKey(compiled: CompiledStatement): string {
    const primary = this.metaById.get(compiled.id)?.writes[0]
    if (primary !== undefined) {
      const v = this.ctx[primary]
      if (v && typeof v === 'object' && 'positions' in v && 'indices' in v) {
        const shape = v as Shape
        return computeContentKey(shape.positions, shape.indices)
      }
    }
    const source = this.sourceById.get(compiled.id)
    if (!source) {
      const p = this.script.params.find((pp) => pp.name === primary)
      return `param:${JSON.stringify(p?.value)}`
    }
    return ''
  }
}
