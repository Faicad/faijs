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
import type { CadStatement, PartScript } from '../lang/types'
import type { Shape } from '../mesh/types'
import type { ShapeHandle } from 'occt-wasm'
import type { PartName, StmtId } from '../identity'
import { asPartName } from '../identity'
import { computeContentKey } from './content-key'
import { getSlot } from '../stdlib/shape'
import type { ExecContextImpl, StdlibNamespace } from './exec-context'

// ── 编译产物语句（从模块文本 import 得到） ──

/** 编译产物中的单条语句（模块文本 `{ id, deps, fn }`）。 */
export interface CompiledStatement {
  id: StmtId
  deps: StmtId[]
  fn: (ctx: Record<string, unknown>, cad: StdlibNamespace, exec: ExecContextImpl) => Promise<void>
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
  private sourceById = new Map<StmtId, CadStatement>()
  private metaById = new Map<StmtId, CompiledStatementMeta>()
  private script: PartScript = { params: [], statements: [] }
  private lastCode = ''
  private readonly cad: StdlibNamespace
  private readonly releaseSolid?: (partName: PartName) => void
  private readonly getSolid?: (partName: PartName) => ShapeHandle | undefined
  private readonly releaseHandle?: (handle: ShapeHandle) => void
  private readonly setSolid?: (partName: PartName, solid: ShapeHandle) => void
  private readonly setFaceEvolution?: (partName: PartName, evo: Map<number, number[]>) => void

  constructor(cad: StdlibNamespace, options?: ModuleExecutorOptions) {
    this.cad = cad
    this.releaseSolid = options?.releaseSolid
    this.getSolid = options?.getSolid
    this.releaseHandle = options?.releaseHandle
    this.setSolid = options?.setSolid
    this.setFaceEvolution = options?.setFaceEvolution
  }

  /** 更新脚本 + 编译元数据（ctx 保持存活）。 */
  setCompiled(script: PartScript, compiled: CompiledStatementMeta[]): void {
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
  async executeAll(exec: ExecContextImpl): Promise<void> {
    await this.executeIds([...this.stmts.keys()], exec)
  }

  /**
   * 只执行指定语句（append：前缀已在持久 ctx）。
   *
   * 与旧解释器一致的防护：beforeStatement 仅对 new_shape 语句触发；
   * void/same_shape（do_assemble/add_constraint）不触发（do_assemble 的 fn 内部委托 exec.doAssemble）。
   */
  async executeIds(ids: StmtId[], exec: ExecContextImpl): Promise<void> {
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
      exec.currentStmt = source
      if (source && source.hasAssignment) {
        exec.beforeStatement?.(source, this.script.statements.indexOf(source))
      }
      await compiled.fn(this.ctx, this.cad, exec)
      this.afterStatement(compiled, exec)
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
  async executeFrom(staleIds: Set<StmtId>, exec: ExecContextImpl): Promise<void> {
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
  }

  // ── 缓存访问（plan / collectResult 用） ──

  /** 读取某语句的 statementKey 缓存。 */
  getCachedKey(id: StmtId): { key: string; outputContentKey: string } | undefined {
    return this.cache.get(id)
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
    this.stmts.clear()
    this.lastCode = ''
  }

  // ── 内部 ──

  /** 语句执行后：ctx → outputCache 同步 + 身份槽 → solidCache/faceEvolutionCache 同步 + statementKey 缓存。 */
  private afterStatement(compiled: CompiledStatement, exec: ExecContextImpl): void {
    const source = this.sourceById.get(compiled.id)
    const meta = this.metaById.get(compiled.id)
    const writes = meta?.writes ?? []
    for (const w of writes) {
      const v = this.ctx[w]
      if (v !== undefined) {
        if (typeof v === 'object' && v !== null) {
          exec.shapeToName.set(v, asPartName(w))
          // 身份槽 → PartName 键控缓存同步（runtime 的 brepSolids/顶替释放/buildBrepTopology 依赖）
          const slot = getSlot(v)
          if (slot?.solid) this.setSolid?.(asPartName(w), slot.solid)
          if (slot?.faceEvolution) this.setFaceEvolution?.(asPartName(w), slot.faceEvolution)
        }
        exec.outputCache.set(asPartName(w), v as Shape)
      }
    }
    const key = meta ? this.computeKey(meta, source) : ''
    const outputContentKey = this.computeOutputContentKey(compiled)
    this.cache.set(compiled.id, { key, outputContentKey })
  }

  /**
   * statementKey = op | JSON(args) | 各依赖的 outputContentKey（参数语句 = 参数值）。
   * 供 plan() 在重算前用当前 cache 计算预期 key 做增量判定。
   */
  computeKey(meta: CompiledStatementMeta, source: CadStatement | undefined): string {
    const primary = meta.writes[0]
    if (!source) {
      const p = this.script.params.find((pp) => pp.name === primary)
      return `param|${JSON.stringify(p?.value)}`
    }
    const parts = [source.op]
    parts.push(JSON.stringify(source.args))
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
