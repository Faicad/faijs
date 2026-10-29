/**
 * smlib-kernel/handleRegistry — GC-less 内核句柄统一登记表 + per-statement 作用域栈。
 *
 * 对照设计文档 `docs/plans/2026-10-29-smlib-memory-architecture-design.md` §3-§6。
 *
 * 核心：
 * - owned（SmBrep*）：内核独立拥有，faijs 用 `SmApiDeleteBrepEx` 真删。
 * - borrowed（SmFace ptr / SmEdge ptr）：借用自某 owned solid 的子形状，不独立拥有内存；
 *   owner 释放时级联失效（治考古报告 §3.4 悬垂指针 UAF）。
 * - per-statement 作用域栈：op 内临时 owned 句柄在语句返回时自动释放（§5）。
 *
 * 本文件中立面：不直接调 wasm；`LifecyclePolicy` 由 smlibKernel 闭包注入真删/缓存清理。
 */

import type { BrepHandle } from '../brep/engine/types'

// ── 类型 ──

/** 句柄种类：owned solid vs borrowed face/edge。 */
export type HandleKind = 'solid' | 'face' | 'edge'

/** 登记表条目（内部数据结构）。 */
export interface HandleEntry {
  ptr: number
  kind: HandleKind
  /** borrowed 条目的 owner；owned 条目为 null。 */
  owner: number | null
  /** 是否仍指向活对象。owner 释放 → 级联 false。 */
  alive: boolean
  /** 是否逃逸出当前语句作用域（存入 solidCache / meshSolidRegistry）。 */
  escaped: boolean
  /** 创建时所在作用帧 id（诊断用）。 */
  createdInScope: number
}

/**
 * GC-less 内核句柄登记表（smlib 专用）。
 *
 * 替换 smlibKernel 旧的模块级 `solidHandles` / `faceHandles` / `edgeHandles` 三个 Set。
 * 统一 owned/borrowed 两类条目；owner 释放时级联失效 borrowed 条目。
 */
export interface HandleRegistry {
  /** 登记一个新的 owned solid 句柄。自动 track 进当前作用帧。 */
  registerOwned(ptr: number): BrepHandle

  /** 登记一个 borrowed face/edge 句柄，绑定 owner（upsert：同 ptr 后写赢）。 */
  registerBorrowed(ptr: number, owner: number, kind: 'face' | 'edge'): void

  /** 声明句柄从当前作用域逃逸：语句产物存入 solidCache，popScope 时不释放。 */
  escape(ptr: number): void

  /** 声明句柄已被内核原地消耗（booleanOp 成功路径 pb/pa），从登记表删除但不调 delete。 */
  markConsumedByKernel(ptr: number): void

  /** 受控真释放一个 owned 句柄。级联失效其 borrowed + 清 triCache（经 policy）。 */
  releaseOwned(ptr: number): void

  /** 轮末/作用域末清扫：释放登记表中不在 keep 集合的 owned 句柄（含 compound keep 传播由调用方处理）。 */
  releaseAllExcept(keep: ReadonlySet<number>): void

  /** 按 ptr 查表；包括已 alive=false 的条目（调用方可区分"从未登记" vs "已释放"）。 */
  lookup(ptr: number): HandleEntry | null

  /** 句柄种类判别（仅当 alive=true；已释放或未登记 → null）。 */
  kindOf(ptr: number): HandleKind | null

  /** 断言句柄可用；不可用则 throw 带上下文（无回退）。 */
  assertAlive(ptr: number, what: string): void

  /** 诊断用：当前 alive 的 owned 句柄数。 */
  aliveOwnedCount(): number

  /** 诊断用：当前登记总条目数（含 borrowed / 含 dead）。 */
  totalEntries(): number
}

/**
 * per-statement RAII 作用域栈。
 * runtime 在调度每条 fai.js 语句前 push，语句完成后 pop。
 */
export interface ScopeStack {
  /** 进入一条语句：压一个空帧。 */
  push(statementId: string): void

  /**
   * 结束一条语句：释放本帧内所有未逃逸的 owned 句柄。
   * escapePtrs = 本语句真正存入 solidCache / meshSolidRegistry 的产物句柄集合。
   */
  pop(escapePtrs: ReadonlySet<number>): void

  /** 把一个 owned 句柄登记进当前帧（registerOwned 内部自动调用）。 */
  track(ptr: number): void

  /** 当前帧 id（诊断用）；无帧时 null。 */
  currentScopeId(): number | null

  /** 排空所有残留帧（失败/异常路径兜底）。 */
  drain(escapePtrs: ReadonlySet<number>): void
}

/**
 * 跨引擎生命周期策略（strategy pattern）。
 * GC-less（smlib）传入真删除 + triCache 清理；GC 型引擎不使用本注册表。
 */
export interface LifecyclePolicy {
  /** 是否需要 faijs 手工 GC。 */
  readonly requiresManualGc: boolean

  /** 真删除一个 owned 内核对象 + 清该句柄的 triCache。 */
  deallocOwned(ptr: number): void
}

// ── 实现 ──

interface ScopeFrame {
  statementId: string
  scopeId: number
  transients: Set<number>
}

/**
 * GC-less 内核句柄登记表实现。
 *
 * 单一 Map<ptr, HandleEntry> 替代旧的三个模块级 Set（solidHandles/faceHandles/edgeHandles）。
 * owner 释放时级联失效其名下 borrowed 条目，治考古报告 §3.4 的悬垂指针 UAF。
 */
export class HandleRegistryImpl implements HandleRegistry {
  private entries = new Map<number, HandleEntry>()
  /** ownerPtr → 其名下所有 borrowed ptr。 */
  private ownerIndex = new Map<number, Set<number>>()
  private scopeStack: ScopeStackImpl
  private policy: LifecyclePolicy

  constructor(policy: LifecyclePolicy) {
    this.policy = policy
    this.scopeStack = new ScopeStackImpl(this)
  }

  /** 暴露给 runtime 驱动 per-statement 作用域。 */
  get scope(): ScopeStack {
    return this.scopeStack
  }

  registerOwned(ptr: number): BrepHandle {
    if (!ptr) return ptr as BrepHandle
    // upsert：同地址后写赢（malloc 复用）。若旧条目是 dead borrowed，覆盖之。
    this.entries.set(ptr, {
      ptr,
      kind: 'solid',
      owner: null,
      alive: true,
      escaped: false,
      createdInScope: this.scopeStack.currentScopeId() ?? -1,
    })
    this.scopeStack.track(ptr)
    return ptr as BrepHandle
  }

  registerBorrowed(ptr: number, owner: number, kind: 'face' | 'edge'): void {
    if (!ptr) return
    // upsert：同 ptr 后写赢，alive=true，绑定新 owner。
    this.entries.set(ptr, {
      ptr,
      kind,
      owner,
      alive: true,
      escaped: false,
      createdInScope: -1,
    })
    let set = this.ownerIndex.get(owner)
    if (!set) {
      set = new Set()
      this.ownerIndex.set(owner, set)
    }
    set.add(ptr)
  }

  escape(ptr: number): void {
    const e = this.entries.get(ptr)
    if (e) e.escaped = true
  }

  markConsumedByKernel(ptr: number): void {
    const e = this.entries.get(ptr)
    if (!e) return
    // 若该 ptr 是某 borrowed 的 owner，连带失效（内核释放 brep 会连带析构 face/edge）。
    this.cascadeInvalidateBorrowed(ptr)
    this.entries.delete(ptr)
  }

  releaseOwned(ptr: number): void {
    const e = this.entries.get(ptr)
    if (!e) {
      // 未登记：可能是已被 markConsumedByKernel，或本就不是 owned。静默返回（幂等）。
      return
    }
    if (!e.alive) {
      throw new Error(
        `[smlib-kernel] double-free: owned ptr=0x${ptr.toString(16)} already released ` +
          `(kind=${e.kind}, scope=${e.createdInScope})`,
      )
    }
    if (e.kind !== 'solid') {
      throw new Error(
        `[smlib-kernel] releaseOwned called on borrowed ptr=0x${ptr.toString(16)} (kind=${e.kind}, owner=${e.owner})`,
      )
    }
    // 真删（经 policy：SmApiDeleteBrepEx + 清 triCache）。
    this.policy.deallocOwned(ptr)
    // 级联失效 borrowed。
    this.cascadeInvalidateBorrowed(ptr)
    // 保留 tombstone（alive=false）：让后续 lookup 能识别 UAF、double-free 能 throw。
    // registerOwned upsert 同地址时覆盖。
    e.alive = false
  }

  releaseAllExcept(keep: ReadonlySet<number>): void {
    // 收集要删的 owned 句柄（先快照，避免迭代中修改 Map）。
    const toDelete: number[] = []
    for (const [ptr, e] of this.entries) {
      if (!e.alive || e.kind !== 'solid') continue
      if (keep.has(ptr)) continue
      toDelete.push(ptr)
    }
    for (const ptr of toDelete) {
      // releaseOwned 内部做 double-free 守卫；toDelete 是刚快照的 alive 条目，不会重复。
      this.releaseOwned(ptr)
    }
  }

  lookup(ptr: number): HandleEntry | null {
    return this.entries.get(ptr) ?? null
  }

  kindOf(ptr: number): HandleKind | null {
    const e = this.entries.get(ptr)
    if (!e || !e.alive) return null
    return e.kind
  }

  assertAlive(ptr: number, what: string): void {
    const e = this.entries.get(ptr)
    if (!e) {
      throw new Error(`[smlib-kernel] ${what}: unknown handle ptr=0x${ptr.toString(16)} (not registered)`)
    }
    if (!e.alive) {
      throw new Error(
        `[smlib-kernel] ${what}: UAF ptr=0x${ptr.toString(16)} was released ` +
          `(kind=${e.kind}, owner=${e.owner}, scope=${e.createdInScope})`,
      )
    }
  }

  aliveOwnedCount(): number {
    let n = 0
    for (const e of this.entries.values()) {
      if (e.alive && e.kind === 'solid') n++
    }
    return n
  }

  totalEntries(): number {
    return this.entries.size
  }

  /** owner 释放/被消耗时，连带把其名下所有 borrowed 条目标 dead。 */
  private cascadeInvalidateBorrowed(ownerPtr: number): void {
    const set = this.ownerIndex.get(ownerPtr)
    if (!set) return
    for (const bptr of set) {
      const be = this.entries.get(bptr)
      if (be) be.alive = false
    }
    this.ownerIndex.delete(ownerPtr)
  }
}

/**
 * per-statement RAII 作用域栈实现。
 *
 * runtime 在每条 fai.js 语句前后 push/pop；op 内产生的 owned 句柄自动 track 进当前帧，
 * pop 时释放未 escape 的临时句柄。不改 op 文件——注入点在 registerOwned 与 runtime 调度层。
 */
export class ScopeStackImpl implements ScopeStack {
  private stack: ScopeFrame[] = []
  private nextScopeId = 0

  constructor(private registry: HandleRegistryImpl) {}

  push(statementId: string): void {
    this.stack.push({
      statementId,
      scopeId: this.nextScopeId++,
      transients: new Set(),
    })
  }

  track(ptr: number): void {
    const frame = this.stack[this.stack.length - 1]
    if (frame) frame.transients.add(ptr)
  }

  pop(escapePtrs: ReadonlySet<number>): void {
    const frame = this.stack.pop()
    if (!frame) return
    for (const ptr of frame.transients) {
      if (escapePtrs.has(ptr)) {
        this.registry.escape(ptr)
      } else {
        // 临时 owned：真删。已被 markConsumedByKernel 的条目 releaseOwned 幂等返回。
        this.registry.releaseOwned(ptr)
      }
    }
  }

  currentScopeId(): number | null {
    const frame = this.stack[this.stack.length - 1]
    return frame ? frame.scopeId : null
  }

  drain(escapePtrs: ReadonlySet<number>): void {
    while (this.stack.length > 0) this.pop(escapePtrs)
  }
}

/** GC-less 策略（smlib）：真删 + 清 triCache。 */
export class GcLessPolicy implements LifecyclePolicy {
  readonly requiresManualGc = true

  constructor(
    private deallocOwnedFn: (ptr: number) => void,
  ) {}

  deallocOwned(ptr: number): void {
    this.deallocOwnedFn(ptr)
  }
}
