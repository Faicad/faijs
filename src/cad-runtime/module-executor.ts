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
import type { ShapeHandle, OcctKernel } from 'occt-wasm'
import type { PartName, StmtId } from '../identity'
import { asPartName } from '../identity'
import { computeContentKey } from './content-key'
import { getSlot, hasBrep, brepOf, ensureSlot } from '../stdlib/shape'
import { setCurrentStmt, setName, getBackends, takePendingAssemblyTransforms, type StdlibNamespace } from '../runtime-state'
import { applyTransform } from '../stdlib/compound'
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
  beforeStatement?: (stmt: StatementIR, index: number) => void
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

// ── ModuleExecutor ──

export interface ModuleExecutorOptions {
  /** 释放某 PartName 的 OCCT 句柄（reconcileCtx 删除变量时调用；无句柄则 no-op） */
  releaseSolid?: (partName: PartName) => void
  /** 读取某 PartName 当前持有的 OCCT 句柄（顶替释放预捕获用） */
  getSolid?: (partName: PartName) => ShapeHandle | undefined
  /** 释放一个已捕获的 OCCT 句柄（顶替释放：同 id 重算成功后释放旧 handle） */
  releaseHandle?: (handle: ShapeHandle) => void
  /** 同步身份槽 solid → PartName 键控 solidCache（runtime 既有逻辑依赖） */
  setSolid?: (partName: PartName, solid: ShapeHandle) => void
  /** 同步身份槽 faceEvolution → PartName 键控 faceEvolutionCache */
  setFaceEvolution?: (partName: PartName, evo: Map<number, number[]>) => void
}

export class ModuleExecutor {
  /** 持久变量容器（跨增量执行存活） */
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
  private namespaces: Namespaces
  private readonly releaseSolid?: (partName: PartName) => void
  private readonly getSolid?: (partName: PartName) => ShapeHandle | undefined
  private readonly releaseHandle?: (handle: ShapeHandle) => void
  private readonly setSolid?: (partName: PartName, solid: ShapeHandle) => void
  private readonly setFaceEvolution?: (partName: PartName, evo: Map<number, number[]>) => void

  constructor(namespaces: Namespaces, options?: ModuleExecutorOptions) {
    this.namespaces = namespaces
    this.releaseSolid = options?.releaseSolid
    this.getSolid = options?.getSolid
    this.releaseHandle = options?.releaseHandle
    this.setSolid = options?.setSolid
    this.setFaceEvolution = options?.setFaceEvolution
  }

  /** 热更新命名空间集合（P7：registerLib 后装配新库）。 */
  setNamespaces(namespaces: Namespaces): void {
    this.namespaces = namespaces
  }

  /** 更新脚本 + 编译元数据（ctx 保持存活）。 */
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

  /** 加载编译产物（同 code 跳过重载——编译产物缓存）。 */
  async load(code: string): Promise<void> {
    if (code === this.lastCode) return
    const mod = await importModule(code)
    this.stmts = new Map(mod.statements.map((s) => [s.id, s]))
    this.lastCode = code
  }

  /** 全量执行（按 deps 拓扑序 = 语句表顺序）。 */
  async executeAll(exec: ExecBookkeeping): Promise<void> {
    await this.executeIds([...this.stmts.keys()], exec)
  }

  /**
   * 只执行指定语句（append：前缀已在持久 ctx）。
   *
   * 与旧解释器一致的防护：beforeStatement 仅对 new_shape 语句触发；
   * void/same_shape（do_assemble/add_constraint）不触发（do_assemble 的 fn 内部委托 exec.doAssemble）。
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
        .filter((h): h is ShapeHandle => !!h)
      // P6：changed 由引擎比对推导（替代旧的 touch 声明机制）
      const oldWrites = new Map<string, unknown>()
      for (const w of meta?.writes ?? []) oldWrites.set(w, this.ctx[w])
      setCurrentStmt(source) // P5：新 keep() 归属当前语句
      // keep 登记先清空本条记录：重执行的语句重新登记（执行中累加，设计 §2.2）
      this.internalKeep.delete(id)
      if (source && source.hasAssignment) {
        exec.beforeStatement?.(source, this.script.statements.indexOf(source))
      }
      await compiled.fn(this.ctx, this.namespaces)
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
   * 从变更点起重执行（update：plan 得出 stale 集）。
   * stale 集对 deps 封闭（依赖 stale 的语句必 stale），按拓扑序执行。
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
   * ctx 回收：删除"定义语句已不在脚本中"的变量并释放其内核资源
   * （undo 删除语句后的必需动作）。
   */
  reconcileCtx(activeStmtIds: Set<StmtId>, writeSets: Map<StmtId, PartName[]>): void {
    const activeWrites = new Set<string>()
    for (const [id, writes] of writeSets) {
      if (activeStmtIds.has(id)) {
        for (const w of writes) activeWrites.add(w)
      }
    }
    for (const key of Object.keys(this.ctx)) {
      if (!activeWrites.has(key)) {
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

  /** 读取某语句的 statementKey 缓存。 */
  getCachedKey(id: StmtId): { key: string; outputContentKey: string } | undefined {
    return this.cache.get(id)
  }

  /** 读取某语句的函数体 keep 登记（terminal-dag C1 判定用；无登记返回 undefined）。 */
  getInternalKeep(id: StmtId): InternalKeepRecord | undefined {
    return this.internalKeep.get(id)
  }

  /** 函数体 keep 登记（ModuleExecutor.internalKeep 落地；执行中累加）。 */
  registerKeep(id: StmtId, names: PartName[], hidden: boolean): void {
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

  /** 读取 ctx 变量。 */
  getCtxVar(name: string): unknown {
    return this.ctx[name]
  }

  /** 写 ctx 变量（装配变换 outputCache → ctx 同步）。 */
  setCtxVar(name: string, value: unknown): void {
    this.ctx[name] = value
  }

  /** 编译元数据（params + statements 顺序）。 */
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
          if (slot?.solid) this.setSolid?.(asPartName(w), slot.solid as ShapeHandle)
          if (slot?.faceEvolution) this.setFaceEvolution?.(asPartName(w), slot.faceEvolution)
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
    const kernel = getBackends().kernel.occt as OcctKernel | null
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
        const solid = brepOf(member) as ShapeHandle | undefined
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
      op: source.callee,
      reason: `${source.callee} has no BREP implementation`,
    })
  }

  /**
   * statementKey = op | JSON(args without keep) | 各依赖的 outputContentKey（参数语句 = 参数值）。
   * keep/keepHidden 两键排除（keep-syntax 设计 §7.2）：切换保留/隐藏状态零几何重算。
   * 供 plan() 在重算前用当前 cache 计算预期 key 做增量判定。
   */
  computeKey(meta: CompiledStatementMeta, source: StatementIR | undefined): string {
    const primary = meta.writes[0]
    if (!source) {
      const p = this.script.params.find((pp) => pp.name === primary)
      return `param|${JSON.stringify(p?.value)}`
    }
    const parts = [`${source.namespace ?? 'cad'}.${source.callee}`]
    parts.push(JSON.stringify(withoutKeepDirectives(source.args)))
    for (const dep of meta.deps) {
      const ck = this.cache.get(dep)?.outputContentKey
      parts.push(ck ?? 'missing')
    }
    return parts.join('|')
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
