/**
 * direct-executor — 无 IR 执行器（.fai.js 源码直通 JS VM）
 *
 * 方案：docs/plans/2026-09-06-no-ir-dual-channel-runtime.md §4.2（D1 / P2）
 *
 * 核心语义：源码文本按**执行单元**（顶层语句，行号即语句边界）直接交给 JS VM
 * 执行——没有语句模型、没有 deps、没有表达式折叠、没有 outputs 投影、没有 IR
 * 编译（不 import parser.ts / compile.ts）。共享 `ctx` 是唯一持久状态。
 *
 * 每单元的文本变换（机械、语义保持，非 IR 编译）：
 * - `const/let x = <call>` / `x = <call>` → `__ctx.x = <call>`；实参里的裸标识符
 *   （已声明变量/参数）→ `__ctx.<name>`；
 * - 调用前插 `await`（与 compile 发射对每个 ns 调用 await 的语义一致；同步 op
 *   被 await 是合法 JS）；
 * - keep/keepHidden 尾随键剥离（行内 keep 由 MetadataExtractor 的 metadata.keep
 *   表另存，§4.4 消费判定用——执行侧不传）；
 * - 顶层函数定义提升到 `__ctx.<name>`（函数体 cad 等经命名空间绑定注入）；
 * - import 行不执行（库装载在 runtime 层；`ns.<binding>` 经命名空间对象访问）。
 *
 * 错误定位：单行单元失败记 failedAt（{ index, callee, message } + lineNo）。
 *
 * 本文件是 P2 新增组件；ModuleExecutor 路径（旧）在 P6 门禁前保留双路径共存。
 */

import { parse as acornParse } from 'acorn'
import type { StdlibNamespace } from '../runtime-state'
import type { PartName } from '../identity'
import { asPartName } from '../identity'
import { ParseError } from '../lang/parse-error'
import { setCurrentStmt, setKeepSink, setName, getBackends, takePendingAssemblyTransforms, takePendingAssemblyKinematics, type AssemblyKinematicsPose, type ExecutionAnchor } from '../runtime-state'
import { ExecutionLimitError } from './execution-limit-error'
import { getSlot, ensureSlot, brepOf } from '../shape'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { applyTransform } from '../mesh/rigid-transform'
import { applyTransformBrep } from '../brep/brep-ops'

type ASTNode = any

// ── Namespaces ──

/**
 * 已装配的命名空间集合（标准库 `cad` + 宿主注册的库）。
 * DirectExecutor 经 ns.<binding>.<callee>() 调用——引擎不区分函数来自哪个库。
 */
export interface Namespaces {
  readonly cad: StdlibNamespace
  readonly [binding: string]: StdlibNamespace
}

// ── 结果类型 ──

/** 执行单元失败信息（与现状 failedAt 三字段兼容 + 新增 lineNo + 原始错误）。 */
export interface DirectExecFailedAt {
  index: number
  callee: string
  message: string
  lineNo?: number
  /** 原始错误对象（runtime 层据类型决定重新抛出还是吞入 failedAt）。 */
  error?: unknown
}

/** 单轮执行产出：ctx 快照 + 失败信息 + 已执行行号 + 块产出登记 + changed。 */
export interface DirectExecOutcome {
  /** 语句执行后 ctx 全部键 */
  ctxKeys: string[]
  /** 失败信息（无失败为 undefined） */
  failedAt?: DirectExecFailedAt
  /** 本轮新执行的行号（append 增量边界回显） */
  executedLines: number[]
  /**
   * 块单元产出登记（T1/A-6）：shape 名 → 块起始行号。
   * DirectExecutor 执行块单元前后对共享 ctx 做 diff，新增 shape 键
   * 登记于此——computeLiveShapes 用块起始行作 producerIdx 锚点
   * （块内产出不在 lines 里，无行级生产者）。
   */
  blockOutputs?: Map<string, number>
  /**
   * 变更登记（T2）：语句写值前后比对的产出——与 module 路径 exec.changed
   * 同语义。值变化的写入键收集于此（execute 全量重跑时旧值全 undefined →
   * 所有写入键都进 changed，与 module 路径行为一致）。
   */
  changed?: string[]
}

/** 单次执行的参数。 */
export interface DirectExecOpts {
  /** 参数表：执行前预置到 ctx（ExecuteOptions.params 同义；参数行不执行） */
  params?: Record<string, unknown>
  /** 单元序数起始（startIndex 语义：行号之前的单元不执行，产物假定已在 ctx） */
  startLine?: number
  /**
   * 多文件 import 预置（§4.5）：顶层 import 行不执行，绑定值由 runtime 装载模块后
   * 预置进 ctx（shape 值 / 模块函数 / 命名空间对象）。先于 params 注入，参数可覆盖。
   */
  imports?: Record<string, unknown>
  /**
   * 单元执行前钩子（undo 逐单元快照；§4.10 E4）：每执行一个单元触发一次。
   * 第一参数 = 单元 id（`'s'+行号`，与 StatementSummary.id 同构——宿主按 id
   * 定位 summaries 不破裂）；第二参数 = 行号。append 只对新单元触发。
   */
  beforeStatement?: (stmtId: string, lineNo: number) => void
  /**
   * 整轮执行超时（§6.3 / D8，E_EXEC_LIMIT）：单元循环内逐单元检查 deadline，
   * 超时抛 {@link ExecutionLimitError}。不传则无超时（现状行为不变）。
   */
  executionTimeoutMs?: number
}

interface TransformedUnit {
  lineNo: number
  /** 变换后的可执行语句文本（嵌入 async wrapper 的 body） */
  body: string
  /** 本单元写入的 ctx 键 */
  writes: string[]
  /** 本单元引用的变量名（append 前缀校验；来自实参裸标识符） */
  refs: string[]
  callee?: string
  /** 是否为控制流块单元（T1：for/if/while/do/switch/裸块等） */
  isBlock?: boolean
}

/** 函数体 keep 登记（键 = 单元行号）。 */
export interface ExecKeepRecord {
  kept: Set<PartName>
  hidden: Map<PartName, boolean>
}

// ── DirectExecutor ──

/** DirectExecutor 构造选项：执行期可访问的已装配命名空间集合。 */
export interface DirectExecutorOptions {
  /** 已装配命名空间（cad + registerLib 注册库）；单元经 __ns.<binding> 访问 */
  namespaces: Namespaces
  /**
   * 身份槽 → PartName 键控缓存同步（T3；与 ModuleExecutor.setSolid 同语义）。
   * 语句执行后把 shape 身份槽里的 BREP solid 写入 runtime solidCache——
   * buildBrepTopology/directBrepSolids 依赖此缓存命中。
   */
  setSolid?: (partName: PartName, solid: BrepHandle) => void
  /** 身份槽 → faceEvolutionCache 同步（T3；与 ModuleExecutor.setFaceEvolution 同语义）。 */
  setFaceEvolution?: (partName: PartName, evo: unknown) => void
  /** 身份槽 → roleTableCache 同步（T3；与 ModuleExecutor.setRoleTable 同语义）。 */
  setRoleTable?: (partName: PartName, roleTable: unknown) => void
}

/**
 * DirectExecutor executes `.fai.js` source text directly in the JS VM. Each
 * top-level statement is transformed mechanically (ctx hoisting + await
 * insertion + keep stripping) and run in an async wrapper against a shared
 * persistent `ctx`. No statement model, no deps, no folding, no IR.
 */
export class DirectExecutor {
  /** 持久变量容器（跨 execute/append/update 存活；与 ModuleExecutor.ctx 同角色） */
  readonly ctx: Record<string, unknown> = {}
  private executedLines = new Set<number>()
  private namespaces: Namespaces
  /** T3：身份槽同步钩子（runtime 注入） */
  private readonly setSolidHook?: (partName: PartName, solid: BrepHandle) => void
  private readonly setFaceEvolutionHook?: (partName: PartName, evo: unknown) => void
  private readonly setRoleTableHook?: (partName: PartName, roleTable: unknown) => void
  /** 当前完整源码（append 拼接用） */
  private fullCode = ''
  /** 函数体 keep 登记（exec.keep/exec.keepHidden 执行期登记；键 = 单元行号） */
  private readonly keepByLine = new Map<number, ExecKeepRecord>()
  /** 当前正在执行的单元行号（keep 登记归属锚点） */
  private activeLine: number | undefined
  /** P3：装配运动副位姿（成员名 → pose），collectDirectResult 消费。 */
  private kinematicsOut = new Map<PartName, AssemblyKinematicsPose>()

  /** P3：读取装配运动副位姿快照（collectDirectResult 用；空 Map 表示无 joints）。 */
  get kinematicsSnapshot(): Map<PartName, AssemblyKinematicsPose> {
    return this.kinematicsOut
  }

  constructor(options: DirectExecutorOptions) {
    this.namespaces = options.namespaces
    this.setSolidHook = options.setSolid
    this.setFaceEvolutionHook = options.setFaceEvolution
    this.setRoleTableHook = options.setRoleTable
  }

  /**
   * 热更新命名空间集合（registerLib 后）。
   * @param namespaces - 新的命名空间集合（含 cad 与全部注册库绑定）。
   */
  setNamespaces(namespaces: Namespaces): void {
    this.namespaces = namespaces
  }

  /**
   * 函数体 keep 登记读（computeLiveShapes 的 KeepView.functionBody 输入；行号键）。
   * @param lineNo - 单元行号（exec.keep 执行期登记的归属锚点）。
   * @returns 该行号的函数体 keep 登记；无登记返回 undefined。
   */
  getKeepByLine(lineNo: number): ExecKeepRecord | undefined {
    return this.keepByLine.get(lineNo)
  }

  /**
   * 全部 keep 登记（调试/测试）。
   * @returns 已登记的行号列表（升序）。
   */
  listKeepLines(): number[] {
    return [...this.keepByLine.keys()].sort((a, b) => a - b)
  }

  /**
   * 读持久 ctx 变量。
   * @param name - 变量名。
   * @returns 当前值；未定义返回 undefined。
   */
  getCtxVar(name: string): unknown {
    return this.ctx[name]
  }

  /**
   * 写持久 ctx 变量（参数预置等）。
   * @param name - 变量名。
   * @param value - 待写入值。
   */
  setCtxVar(name: string, value: unknown): void {
    this.ctx[name] = value
  }

  /**
   * 持久 ctx 的全部键（append/执行结果组装扫描用）。
   * @returns 当前 ctx 键数组。
   */
  listCtxKeys(): string[] {
    return Object.keys(this.ctx)
  }

  /**
   * 已执行单元行号（append 增量边界回显）。
   * @returns 已执行行号升序数组。
   */
  get executedUnitLines(): number[] {
    return [...this.executedLines].sort((a, b) => a - b)
  }

  /** 块单元产出登记（T1/A-6）：shape 名 → 块起始行号；execute 前后 ctx diff 生成。 */
  private blockOutputs = new Map<string, number>()

  /** 变更登记（T2）：语句写值前后比对的产出——与 module 路径 exec.changed 同语义。 */
  private changedSet = new Set<string>()

  /** 本机函数形参表（local ABI，§3.4/§3.6）：函数名 → 形参名序。transformFunction
   *  定义时登记；emitCall 对末尾纯对象实参按名解包（splitPositionalOptions 语义）。 */
  private fnParams = new Map<string, string[]>()

  /** 清空 ctx 与状态（execute 全量 / dispose 用）。函数体 keep 登记一并清——全量重跑
   *  后行号键表只应含本场景的登记；不清理会泄漏上一场景的同行号登记（对拍红线）。 */
  reset(): void {
    for (const key of Object.keys(this.ctx)) delete this.ctx[key]
    this.executedLines.clear()
    this.fullCode = ''
    this.keepByLine.clear()
    this.kinematicsOut.clear()
    this.blockOutputs.clear()
    this.changedSet.clear()
    this.fnParams.clear()
  }

  /**
   * 全量执行（R3 update 语义同：清 ctx 重跑）。
   * @param code - .fai.js 源码文本（扁平 op 行 / 容器体）。
   * @param opts - 参数与起始行。
   * @returns 执行产出（ctx 键快照 / failedAt / 已执行行号）。
   */
  async execute(code: string, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    this.reset()
    this.fullCode = code
    return this.runCode(code, opts)
  }

  /**
   * append 增量执行：共享 ctx 只执行新单元（行号 > 旧行集合）。
   * 前置缺失（引用不在 ctx 的变量）由调用方校验（AppendPrefixError 语义保留在 runtime）。
   * @param code - 新增语句文本。
   * @param opts - 参数与起始行（可选）。
   * @returns 执行产出（ctx 键快照 / failedAt / 本轮新执行行号）。
   */
  async append(code: string, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    const fullCode = this.fullCode === '' ? code : `${this.fullCode}\n${code}`
    this.fullCode = fullCode
    return this.runCode(fullCode, opts)
  }

  /**
   * update：参数/文本变更 → 全量重跑（R3；用户接受）。
   * @param _oldCode - 变更前文本（签名兼容保留；全量重跑不使用）。
   * @param newCode - 变更后文本。
   * @param opts - 参数与起始行（可选）。
   * @returns 执行产出（ctx 键快照 / failedAt / 已执行行号）。
   */
  async update(_oldCode: string, newCode: string, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    return this.execute(newCode, opts)
  }

  // ── 主流程 ──

  private async runCode(code: string, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    // import 预置（§4.5：顶层 import 行不执行，绑定值先入 ctx），随后参数预置可覆盖
    for (const [k, v] of Object.entries(opts?.imports ?? {})) this.ctx[k] = v
    // 参数预置（ExecuteOptions.params → ctx；参数行不执行，与现状语义一致）
    for (const [k, v] of Object.entries(opts?.params ?? {})) this.ctx[k] = v

    // keep 登记 sink（函数体 exec.keep / exec.keepHidden 执行期登记 → 行号键表；
    // 替代 ModuleExecutor.internalKeep 的 StmtId 键——DirectExecutor 无语句模型）
    setKeepSink((_stmtId, names, hidden) => this.registerKeepByLine(names, hidden))
    try {
      const units = this.parseAndTransform(code)
      const executedLines: number[] = []
      let failedAt: DirectExecFailedAt | undefined

      // 整轮超时（§6.3 / D8，E_EXEC_LIMIT）：单元循环内逐单元检查 deadline。
      // 自由 JS 块内部的单条死循环不在单元间插桩范围内 → 仍会卡死（R-7：v2 用
      // Worker 终止块内执行）；本次交付覆盖"逐单元执行"路径的超时护栏。
      const timeoutMs = opts?.executionTimeoutMs
      const deadline = timeoutMs !== undefined && timeoutMs > 0 ? Date.now() + timeoutMs : undefined

      let order = 0
      for (const unit of units) {
        const idx = order++
        if (opts?.startLine !== undefined && unit.lineNo < opts.startLine) continue
        if (this.executedLines.has(unit.lineNo)) continue
        if (deadline !== undefined && Date.now() >= deadline) {
          throw new ExecutionLimitError(timeoutMs ?? 0)
        }
        opts?.beforeStatement?.(`s${unit.lineNo}`, unit.lineNo)
        try {
          this.activeLine = unit.lineNo
          // T2：changed 跟踪——执行前捕获写键旧值（与 module 路径 oldWrites 同语义）。
          const oldWrites = new Map<string, unknown>()
          for (const w of unit.writes) oldWrites.set(w, this.ctx[w])
          // 块单元：执行前后做 ctx diff，登记新增 shape 键 → blockOutputs
          // （块内产出不在 lines 里，computeLiveShapes 用块起始行作 producerIdx）。
          const ctxBefore = unit.isBlock ? new Set(Object.keys(this.ctx)) : null
          await this.runUnit(unit)
          // T2：changed 登记——执行后比对写键值变化（与 module 路径 exec.changed.add 同语义）。
          for (const [w, old] of oldWrites) {
            if (old !== this.ctx[w]) this.changedSet.add(w)
          }
          if (ctxBefore) {
            // 块产出登记：新增键 + 块内重写键（writes 收集了所有 __ctx.<name> = 赋值）
            for (const key of Object.keys(this.ctx)) {
              if (!ctxBefore.has(key)) {
                this.blockOutputs.set(key, unit.lineNo)
                this.changedSet.add(key)
                // T3：块产出的新键也需同步身份槽 → solidCache
                const bv = this.ctx[key]
                if (bv !== null && typeof bv === 'object') {
                  setName(bv, asPartName(key))
                  const bslot = getSlot(bv)
                  if (bslot?.solid) this.setSolidHook?.(asPartName(key), bslot.solid as BrepHandle)
                  if (bslot?.faceEvolution) this.setFaceEvolutionHook?.(asPartName(key), bslot.faceEvolution)
                  if (bslot?.roleTable) this.setRoleTableHook?.(asPartName(key), bslot.roleTable)
                }
              }
            }
            for (const w of unit.writes) this.blockOutputs.set(w, unit.lineNo)
          }
          for (const w of unit.writes) {
            const v = this.ctx[w]
            if (v !== null && typeof v === 'object') {
              setName(v, asPartName(w))
              // T3：身份槽 → PartName 键控缓存同步（与 ModuleExecutor.afterStatement
              // 的 slot→solidCache/faceEvolutionCache/roleTableCache 同步同语义）。
              // buildBrepTopology/directBrepSolids/buildNamingInput 依赖此缓存命中。
              const slot = getSlot(v)
              if (slot?.solid) this.setSolidHook?.(asPartName(w), slot.solid as BrepHandle)
              if (slot?.faceEvolution) this.setFaceEvolutionHook?.(asPartName(w), slot.faceEvolution)
              if (slot?.roleTable) this.setRoleTableHook?.(asPartName(w), slot.roleTable)
            }
          }
          // T3/T4: Assembly transform propagation — same semantics as
          // ModuleExecutor.applyPendingAssemblyTransforms: take pending transforms
          // from runtime-state, apply to member shapes (mesh in-place + BREP slot +
          // solidCache), record changed. Direct path has no deps graph for
          // downstream recompute, but since execution is sequential, downstream
          // statements naturally re-read the already-transformed members.
          this.applyPendingAssemblyTransforms()

          this.executedLines.add(unit.lineNo)
          executedLines.push(unit.lineNo)
        } catch (err) {
          if (err instanceof ParseError) throw err
          // DirectExecutor swallows ALL execution errors into failedAt
          // (including TypeError for no_such_op). The runtime layer
          // (executeDirectText etc.) inspects failedAt.error to decide
          // whether to re-throw business errors (matching module path's
          // runWithFailureHandling: only OpError / BrepUnsupportedError /
          // MeshUnsupportedError stay in failedAt; others are re-thrown).
          failedAt = {
            index: idx,
            callee: unit.callee ?? '',
            message: err instanceof Error ? err.message : String(err),
            lineNo: unit.lineNo,
            error: err,
          }
          break
        } finally {
          this.activeLine = undefined
        }
      }
      return {
        ctxKeys: Object.keys(this.ctx),
        failedAt,
        executedLines,
        blockOutputs: this.blockOutputs,
        changed: this.changedSet.size > 0 ? [...this.changedSet] : undefined,
      }
    } finally {
      // 任何路径（含 ExecutionLimitError / ParseError 中断）都清 sink，防泄漏到下一执行
      setKeepSink(undefined)
    }
  }

  /**
   * Append 前缀校验（runtime 层 AppendPrefixError 语义保留，E2）：把待 append 的
   * 新语句拼到 fullCode 后解析，对「尚未执行」的单元逐个校验 refs——引用必须已由
   * 持久 ctx（先前执行产出）或本批更早单元产出。缺引用
   * → 返回首个 {unitLine, varName}。
   * @param code - 待 append 的新语句文本（runtime 传新行）。
   * @returns 首个缺失引用；无缺失返回 undefined。
   */
  missingPrefixVar(code: string): { unitLine: number; varName: string } | undefined {
    const fullCode = this.fullCode === '' ? code : `${this.fullCode}\n${code}`
    const units = this.parseAndTransform(fullCode)
    const available = new Set<string>(Object.keys(this.ctx))
    for (const unit of units) {
      if (!this.executedLines.has(unit.lineNo)) {
        for (const ref of unit.refs) {
          if (!available.has(ref)) return { unitLine: unit.lineNo, varName: ref }
        }
      }
      for (const w of unit.writes) available.add(w)
    }
    return undefined
  }

  /**
   * 应用待处理装配变换（R11②，P1）：取走 takePendingAssemblyTransforms 的全部登记，
   * 对 compound 成员做 mesh 顶点烘焙 + BREP 刚体变换（p' = R·(p−pivot) + pivot + translation），
   * 差异：direct 模式无 DAG → 不做 computeDownstream 下游失效重算。
   * T3/T4：变换后同步身份槽 → solidCache（setSolidHook）并登记 changedSet。
   */
  private applyPendingAssemblyTransforms(): void {
    const pending = takePendingAssemblyTransforms()
    const pendingKin = takePendingAssemblyKinematics()
    if (pending.length === 0 && pendingKin.length === 0) return
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
        // BREP 刚体变换（可选）：新 solid 写身份槽 + solidCache（T3）
        const solid = brepOf(member) as BrepHandle | undefined
        if (kernel && solid) {
          const transformed = applyTransformBrep(kernel, solid, t.quaternion, t.pivot, t.translation)
          try { kernel.release(solid) } catch { /* 已释放 */ }
          ensureSlot(member).solid = transformed
          if (name) this.setSolidHook?.(asPartName(name), transformed)
        }
        if (name) this.changedSet.add(name)
      }
    }
    // P3：装配运动副位姿（joints 驱动）——成员名 → pose，collectDirectResult 消费。
    // 与 transforms 独立收集：全部成员恒等时 transforms 为空但 kinematics 非空。
    for (const { compound, kinematics } of pendingKin) {
      const behavior = getSlot(compound)?.behavior as { memberNames?: string[] } | undefined
      if (!behavior?.memberNames) continue
      const memberNames = behavior.memberNames
      for (const name of memberNames) {
        const pose = kinematics[name]
        if (pose) this.kinematicsOut.set(asPartName(name), pose)
      }
    }
  }

  /** 单单元执行：变换文本嵌入 async fn，以 __ctx/__ns 实参调用。 */
  private async runUnit(unit: TransformedUnit): Promise<void> {
    const src = `return (async () => {\n${unit.body}\n})()`
    const fn = new Function('__ctx', '__ns', src)
    // 执行锚点：库函数体 exec.keep / primitive 命名读 getCurrentStmt()?.outputs
    // ——用 ExecutionAnchor 轻量锚点（行号 + 写键）。
    const anchor: ExecutionAnchor = {
      id: `s${unit.lineNo}`,
      outputs: unit.writes.map((w) => w as PartName),
      hasAssignment: unit.writes.length > 0,
    }
    setCurrentStmt(anchor)
    try {
      await fn(this.ctx, this.namespaces)
    } finally {
      setCurrentStmt(undefined)
    }
  }

  /** 行号 → 函数体 keep 登记（exec.keep/exec.keepHidden；与 live-shapes KeepView 对齐）。 */
  private registerKeepByLine(names: PartName[], hidden: boolean): void {
    if (this.activeLine === undefined) return
    let rec = this.keepByLine.get(this.activeLine)
    if (!rec) {
      rec = { kept: new Set(), hidden: new Map() }
      this.keepByLine.set(this.activeLine, rec)
    }
    for (const n of names) {
      rec.kept.add(n)
      rec.hidden.set(n, hidden)
    }
  }

  // ── 解析与变换 ──

  /**
   * 顶层 import/export 之外的容器体（扁平/容器归一）：优先把源码整体按 ESM module
   * 解析——顶层 `import` 声明在模块作用域合法（多文件 §4.5：import 行不执行，绑定由
   * runtime 经 opts.imports 预置 ctx）；无 export default 的扁平代码取顶层语句为单元。
   * 兼容回退：非容器旧文本（顶层 return/await 的 AI 手写体）按原封装
   * `export default async (...) => { ... }` 解析（函数作用域放行）。
   */
  private parseBody(code: string): { nodes: ASTNode[]; lineOffset: number; parseText: string } {
    const parseAs = (text: string): ASTNode => {
      return acornParse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true }) as unknown as ASTNode
    }
    let ast: ASTNode
    try {
      ast = parseAs(code)
    } catch (err) {
      const e = err as { message?: string; loc?: { line?: number } }
      // 容器体已在顶层 → 原样上抛；扁平旧文本走封装回退（函数作用域允许 return/await）
      if (!code.includes('export default')) {
        const parseCode = `export default async (__nsArg) => {\n${code}\n}`
        let wrappedAst: ASTNode
        try {
          wrappedAst = parseAs(parseCode)
        } catch {
          throw new ParseError(
            `SyntaxError: ${e.message ?? String(err)}`,
            (e.loc?.line ?? 1) - 1,
            'E_SYNTAX',
            err,
          )
        }
        const decl = wrappedAst.body.find((n: ASTNode) => n.type === 'ExportDefaultDeclaration')
        const arrow = decl?.declaration
        if (arrow?.type === 'ArrowFunctionExpression' && arrow.body?.type === 'BlockStatement') {
          return { nodes: arrow.body.body as ASTNode[], lineOffset: 1, parseText: parseCode }
        }
      }
      throw new ParseError(`SyntaxError: ${e.message ?? String(err)}`, (e.loc?.line ?? 1), 'E_SYNTAX', err)
    }
    const exportDecl = ast.body.find((n: ASTNode) => n.type === 'ExportDefaultDeclaration')
    if (exportDecl) {
      const arrow = exportDecl.declaration
      if (arrow?.type !== 'ArrowFunctionExpression' || arrow.body?.type !== 'BlockStatement') {
        throw new ParseError('expected async arrow container body', 1, 'E_SYNTAX')
      }
      return { nodes: arrow.body.body as ASTNode[], lineOffset: 0, parseText: code }
    }
    // 扁平 ESM：顶层语句（含 import 声明，unit 生成时跳过）即单元边界。
    return { nodes: ast.body as ASTNode[], lineOffset: 0, parseText: code }
  }

  /** 解析并变换全部顶层单元。 */
  private parseAndTransform(code: string): TransformedUnit[] {
    const { nodes, lineOffset, parseText } = this.parseBody(code)
    const declared = new Set<string>() // 累积：参数名 + outputs + 函数名
    const units: TransformedUnit[] = []
    for (const node of nodes) {
      if (node.type === 'ImportDeclaration') continue // import 行不执行
      const rawLine = (node?.loc?.start?.line ?? 1) - lineOffset
      const unit = this.transformTopNode(node, parseText, declared, rawLine)
      if (unit) units.push(unit)
    }
    return units
  }

  private transformTopNode(
    node: ASTNode,
    code: string,
    declared: Set<string>,
    lineNo: number,
  ): TransformedUnit | null {
    switch (node.type) {
      case 'FunctionDeclaration':
        return this.transformFunction(node, code, declared, lineNo)
      case 'VariableDeclaration':
        return this.transformVariable(node, code, declared, lineNo)
      case 'ExpressionStatement':
        return this.transformExpressionStatement(node, code, declared, lineNo)
      case 'ReturnStatement':
        // 容器/自由 JS 的顶层 return（AI 手写 .fai.js）：return 只表达 UI meta /
        // 显式终端，不构成执行单元（几何产物都写在 ctx）。忽略执行。
        return null
      case 'IfStatement':
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'SwitchStatement':
      case 'TryStatement':
      case 'BlockStatement':
      case 'LabeledStatement':
        return this.transformBlock(node, code, declared, lineNo)
      default:
        // 其余控制流/未知节点（ThrowStatement/BreakStatement/ContinueStatement 等）
        // 也按块单元处理——整段文本执行，不分析语义。
        return this.transformBlock(node, code, declared, lineNo)
    }
  }

  /**
   * 控制流块单元（T1/A-6）：for/if/while/do/switch/裸块等顶层块整块执行。
   * - 块起始行 = 单元行号；执行文本 = 原代码整段（node.start..node.end）。
   * - 块内**顶层**声明提升到 __ctx（`const p = cad.box(...)` → `__ctx.p = ...`）；
   *   块内**嵌套块与函数体跳过**（局部作用域，不提升）。
   * - 对外部变量的词法引用按 hoistText 处理（已含 ctx 键）。
   * - 块产物通过执行前后 ctx diff 登记（runCode 里处理），writes 为空（无法静态确定）。
   */
  private transformBlock(
    node: ASTNode,
    code: string,
    declared: Set<string>,
    lineNo: number,
  ): TransformedUnit {
    const rawText = code.slice(node.start, node.end)
    const body = this.hoistBlockText(rawText, declared)
    // 收集块内所有 __ctx.<name> = 赋值的写入键（块产出 + 块内重写），
    // 供 runCode 登记 blockOutputs（块内重写的变量也用块起始行作 producerIdx）。
    const writes: string[] = []
    const re = /__ctx\.(\w+)\s*=/g
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      if (!writes.includes(m[1])) writes.push(m[1])
    }
    return { lineNo, body, writes, refs: [], isBlock: true }
  }

  /**
   * 块文本提升（T1/v1）：对块整段文本做词法级标识符提升——
   * - `const/let x = expr` → `__ctx.x = expr`（词边界替换关键字 + LHS）；
   * - 自由标识符引用 → `__ctx.<name>`（已声明变量 + ctx 键）。
   *
   * v1 限制（R-5）：不做嵌套作用域精确区分——嵌套块/函数体内的局部变量
   * 也会被提升到 `__ctx`，在功能上等价于"块内所有变量都在 ctx 上"（多写了一些
   * ctx 键，不会导致错误）。v2 可加 AST walk 精确跳过嵌套作用域。
   *
   * 实现策略：先收集块内所有声明名（acorn 扫描 VariableDeclarator + 函数名），
   * 再做两步文本替换：① 声明 LHS 提升写 __ctx 赋值；② 自由引用提升走 hoistText。
   */
  private hoistBlockText(text: string, declared: Set<string>): string {
    // 收集块内所有声明名（用于引用提升与声明改写）
    const names = new Set<string>(declared)
    for (const key of Object.keys(this.ctx)) names.add(key)

    // 排除命名空间名称（cad + registerLib 注册的库绑定）——它们在 __ns 上而非 __ctx
    const nsNames = new Set<string>(Object.keys(this.namespaces).filter((k) => k !== 'contractVersion'))

    let ast: ASTNode
    try {
      ast = acornParse(text, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
        ranges: true,
      }) as unknown as ASTNode
    } catch {
      // 块文本不是合法 module（含 break/continue/return）→ 用函数体解析
      try {
        ast = acornParse(`(function(){ ${text} })`, {
          ecmaVersion: 'latest',
          sourceType: 'module',
          locations: true,
          ranges: true,
        }) as unknown as ASTNode
      } catch {
        // 解析失败 → 原样返回（执行时会自然报错）
        return text
      }
    }

    // 扫描全部 VariableDeclarator + FunctionDeclaration 名
    const walk = (n: ASTNode): void => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier') {
        names.add(n.id.name)
      }
      if (n.type === 'FunctionDeclaration' && n.id?.type === 'Identifier') {
        names.add(n.id.name)
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'parent' || k === 'type') continue
        const v = n[k]
        if (Array.isArray(v)) for (const item of v) walk(item)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    walk(ast)

    // 从提升集合中移除命名空间名（cad 等留在 __ns）
    for (const nsName of nsNames) names.delete(nsName)

    // 声明 LHS 改写 + 自由引用提升（词法级，两步替换）
    let out = text
    // ① const/let x = ... → __ctx.x = ...（去关键字 + LHS 加 __ctx.）
    out = out.replace(/\b(?:const|let)\s+(\w+)\s*=/g, '__ctx.$1 =')
    // ② 自由引用提升（与 hoistText 同逻辑，但含块内声明名；排除命名空间名）
    for (const name of names) {
      out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), `__ctx.${name}`)
    }
    // ③ 命名空间名 → __ns.<name> + await 调用
    // 块内 cad.xxx(...) 调用需要 await（与扁平行式 emitCall 的 await 语义一致）。
    // 分两步：先替换调用形态 `<ns>.<member>(` → `await __ns.<ns>.<member>(`，
    // 再替换裸引用 `<ns>`（非成员访问）→ `__ns.<ns>`。
    for (const nsName of nsNames) {
      // 调用形态：`cad.box(` → `await __ns.cad.box(`
      out = out.replace(
        new RegExp(`(?<![.\\w])\\b${nsName}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g'),
        `await __ns.${nsName}.$1(`,
      )
      // 裸成员访问（非调用）：`cad.foo` → `__ns.cad.foo`（非调用不加 await）
      out = out.replace(
        new RegExp(`(?<![.\\w])\\b${nsName}\\s*\\.`, 'g'),
        `__ns.${nsName}.`,
      )
    }
    // __ctx.__ctx.x → __ctx.x（双前缀修正：LHS 改写后 name 又被提升替换）
    out = out.replace(/__ctx\.__ctx\./g, '__ctx.')
    // __ns.__ns.cad → __ns.cad（命名空间双前缀修正）
    out = out.replace(/__ns\.__ns\./g, '__ns.')
    // await await __ns → await __ns（双重 await 修正：块内已有 await 的调用）
    out = out.replace(/await\s+await\s+__ns\./g, 'await __ns.')
    return out
  }

  /** 顶层函数提升：`__ctx.<name> = async function <name>(...) { 命名空间绑定; 体 }`。 */
  private transformFunction(node: ASTNode, code: string, declared: Set<string>, lineNo: number): TransformedUnit {
    const name = node.id?.name
    if (!name) throw new ParseError('function declaration must have a name', lineNo, 'E_STATEMENT')
    const params = (node.params ?? []).map((p: ASTNode) => p?.name).filter((x: unknown): x is string => typeof x === 'string')
    const bodyText = code.slice(node.body.start + 1, node.body.end - 1)
    const nsNames = Object.keys(this.namespaces).filter((k) => k !== 'contractVersion')
    const binds = nsNames.map((n) => `  const ${n} = __ns.${n}`).join('\n')
    const body = [
      `__ctx.${name} = async function ${name}(${params.join(', ')}) {`,
      binds,
      bodyText,
      '}',
    ].join('\n')
    // 本机函数体引用其它本机函数/变量走 __ctx（与顶层一致）
    declared.add(name)
    this.fnParams.set(name, params)
    return { lineNo, body, writes: [name], refs: [], callee: name }
  }

  /** const/let 行：参数（字面量）直接进 ctx；op 行变换调用；派生常量求值。 */
  private transformVariable(node: ASTNode, code: string, declared: Set<string>, lineNo: number): TransformedUnit {
    if (node.kind !== 'const' && node.kind !== 'let') {
      throw new ParseError(`only 'const' or 'let' declarations allowed, got '${node.kind}'`, lineNo, 'E_STATEMENT')
    }
    if (node.declarations.length !== 1) {
      throw new ParseError('multi-declarator const statements are not supported yet', lineNo, 'E_STATEMENT')
    }
    const d = node.declarations[0]
    const dLine = (d?.loc?.start?.line ?? lineNo)
    // 解构 op 行：const { front: a } = cad.fai_split(...)
    if (d?.id?.type === 'ObjectPattern') {
      const props = d.id.properties as ASTNode[]
      const keys: string[] = []
      const binds: string[] = []
      for (const prop of props) {
        if (prop.type !== 'Property') throw new ParseError('unsupported destructuring property', dLine, 'E_STATEMENT')
        keys.push(String(prop.key?.name ?? prop.key?.value))
        binds.push(String(prop.value?.name))
      }
      let init = d.init
      if (init?.type === 'AwaitExpression') init = init.argument
      const call = this.emitCall(init, code, declared, dLine)
      const writes = binds.map((b) => `__ctx.${b} = ${b}`)
      const pair = keys.map((k, i) => `${k}: ${binds[i]}`).join(', ')
      const body = [`const { ${pair} } = ${call}`, ...writes].join('\n')
      for (const b of binds) declared.add(b)
      return { lineNo, body, writes: binds, refs: this.collectRefs(init), callee: this.calleeOf(init) }
    }
    if (d?.id?.type !== 'Identifier') {
      throw new ParseError('expected identifier on left side of const declaration', dLine, 'E_STATEMENT')
    }
    const name = d.id.name
    let init = d.init
    if (init?.type === 'AwaitExpression') init = init.argument

    if (init?.type === 'CallExpression') {
      const call = this.emitCall(init, code, declared, dLine)
      declared.add(name)
      return { lineNo, body: `__ctx.${name} = ${call}`, writes: [name], refs: this.collectRefs(init), callee: this.calleeOf(init) }
    }
    if (init) {
      // 参数行（字面量/数组/对象）或派生常量：求值后写入 ctx（引用走 __ctx 提升）
      const exprText = this.hoistText(code.slice(init.start, init.end), declared)
      declared.add(name)
      return { lineNo, body: `__ctx.${name} = ${exprText}`, writes: [name], refs: [], callee: undefined }
    }
    throw new ParseError('unsupported const declaration', dLine, 'E_STATEMENT')
  }

  /** 表达式语句：裸重赋值 / 命名空间裸调用 / 成员方法调用。 */
  private transformExpressionStatement(
    node: ASTNode,
    code: string,
    declared: Set<string>,
    lineNo: number,
  ): TransformedUnit {
    const expr = node.expression
    if (expr?.type === 'AssignmentExpression' && expr.operator === '=' && expr.left?.type === 'Identifier') {
      const varName = expr.left.name
      if (!declared.has(varName)) throw new ParseError(`unknown variable "${varName}" in re-assignment`, lineNo, 'E_REFERENCE')
      let init = expr.right
      if (init?.type === 'AwaitExpression') init = init.argument
      if (init?.type === 'CallExpression') {
        const call = this.emitCall(init, code, declared, lineNo)
        return { lineNo, body: `__ctx.${varName} = ${call}`, writes: [varName], refs: this.collectRefs(init), callee: this.calleeOf(init) }
      }
      // 变量→变量重赋值 / 表达式重赋值（`bp = bp2` / `x = a + b`）：合法 JS，
      // 直接提升自由标识符写回 ctx（A-15 最后写者语义）。
      const rhsText = this.hoistText(code.slice(init?.start ?? expr.right.start, expr.right.end), declared)
      return { lineNo, body: `__ctx.${varName} = ${rhsText}`, writes: [varName], refs: [], callee: undefined }
    }
    if (expr?.type === 'CallExpression') {
      const call = this.emitCall(expr, code, declared, lineNo)
      // 命名空间裸调用 / 成员方法 / 本机函数副作用调用：都 await（无写入）
      return { lineNo, body: `await ${call}`, writes: [], refs: this.collectRefs(expr), callee: this.calleeOf(expr) }
    }
    throw new ParseError('bare expression statements not allowed', lineNo, 'E_STATEMENT')
  }

  /** 调用发射：<ns>.<fn>(args) / <receiver>.<method>(args) / <localFn>(args) → await 形态。 */
  private emitCall(callNode: ASTNode, code: string, declared: Set<string>, lineNo: number): string {
    if (callNode?.type !== 'CallExpression') {
      throw new ParseError('expected call expression', lineNo, 'E_STATEMENT')
    }
    const callee = callNode.callee
    let head: string
    if (callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.property?.type === 'Identifier') {
      const objName = callee.object.name
      // 优先 __ctx：本机 shape/模块产物（含 import 预置的 shape 与模块命名空间）都是
      // ctx 键（isMemberOnCtx）或 declared；注册库绑定（cad/第三方 ns）不在 ctx → __ns。
      head = declared.has(objName) || this.ctxHas(objName)
        ? `await __ctx.${objName}.${callee.property.name}`
        : `await __ns.${objName}.${callee.property.name}`
    } else if (callee?.type === 'Identifier') {
      if (declared.has(callee.name) || this.hasCtxFn(callee.name)) {
        head = `await __ctx.${callee.name}`
      } else {
        // 本机函数尚未在 declared（append 前缀场景由调用方校验）→ 仍按 ctx 函数调用
        head = `await __ctx.${callee.name}`
      }
    } else {
      throw new ParseError('expected <ns>.<op>(...) or local function call', lineNo, 'E_STATEMENT')
    }
    const args = this.emitCallArgs(callNode, code, declared, lineNo)
    return `${head}(${args.join(', ')})`
  }

  /** 实参发射：本机函数调用（裸 Identifier 且已在 fnParams 登记）应用 §3.4/§3.6 的
   *  「位置 + 按名」ABI（splitPositionalOptions 语义：末尾纯对象实参的键按形参名映射剩余
   *  形参，位置实参占前 M 位）；命名空间/成员调用保持对象实参原样传递。 */
  private emitCallArgs(callNode: ASTNode, code: string, declared: Set<string>, lineNo: number): string[] {
    const callee = callNode.callee
    const fnName = callee?.type === 'Identifier' ? callee.name : undefined
    if (fnName && this.fnParams.has(fnName)) {
      return this.emitLocalCallArgs(callNode, fnName, code, declared, lineNo)
    }
    return (callNode.arguments ?? []).map((a: ASTNode) => this.transformArg(a, code, declared, lineNo))
  }

  /** 本机函数调用 ABI 解包：位置实参原样占前 M 位；末尾纯对象（无 spread）的键按形参名
   *  补到剩余位，缺失形参补 undefined；多余位置实参原样保留（JS 宽松实参语义）。 */
  private emitLocalCallArgs(callNode: ASTNode, fnName: string, code: string, declared: Set<string>, lineNo: number): string[] {
    const params = this.fnParams.get(fnName) ?? []
    const rawArgs = callNode.arguments ?? []
    const last = rawArgs[rawArgs.length - 1]
    const canSplit = !!last && last.type === 'ObjectExpression'
      && (last.properties ?? []).every((p: ASTNode) => p.type === 'Property')
    const values = canSplit ? rawArgs.slice(0, -1) : rawArgs
    const named = new Map<string, ASTNode>()
    if (canSplit) {
      for (const prop of (last as { properties: ASTNode[] }).properties as ASTNode[]) {
        const key = prop.key?.type === 'Identifier' ? prop.key.name
          : prop.key?.type === 'Literal' ? String(prop.key.value)
          : null
        if (key === null) throw new ParseError('invalid object key', lineNo, 'E_VALUE')
        named.set(key, prop.shorthand ? { type: 'Identifier', name: key } as ASTNode : (prop as { value: ASTNode }).value)
      }
    }
    const out: string[] = values.map((v: ASTNode) => this.transformArg(v, code, declared, lineNo))
    for (let i = values.length; i < params.length; i++) {
      const p = params[i]
      const v = named.get(p)
      out.push(v !== undefined ? this.transformArg(v, code, declared, lineNo) : 'undefined')
    }
    return out
  }

  private hasCtxFn(name: string): boolean {
    return typeof this.ctx[name] === 'function'
  }

  private ctxHas(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.ctx, name)
  }

  /** 实参变换：Literal → JSON；Identifier → __ctx.name；调用递归；对象/数组递归；
   *  表达式 → 自由标识符提升（文本级，词边界替换已声明名）。 */
  private transformArg(node: ASTNode, code: string, declared: Set<string>, lineNo: number): string {
    if (!node) return 'undefined'
    switch (node.type) {
      case 'Literal':
        return JSON.stringify(node.value)
      case 'Identifier':
        return `__ctx.${node.name}`
      case 'CallExpression':
        return this.emitCall(node, code, declared, lineNo)
      case 'ArrayExpression': {
        const items = (node.elements ?? []).map((el: ASTNode) =>
          el === null ? 'null' : el?.type === 'SpreadElement'
            ? `...${this.transformArg(el.argument, code, declared, lineNo)}`
            : this.transformArg(el, code, declared, lineNo))
        return `[${items.join(', ')}]`
      }
      case 'ObjectExpression': {
        const parts: string[] = []
        for (const prop of node.properties ?? []) {
          if (prop.type === 'SpreadElement') {
            parts.push(`...${this.transformArg(prop.argument, code, declared, lineNo)}`)
            continue
          }
          const key = prop.key?.type === 'Identifier' ? prop.key.name
            : prop.key?.type === 'Literal' ? JSON.stringify(String(prop.key.value))
            : null
          if (key === null) throw new ParseError('invalid object key', lineNo, 'E_VALUE')
          parts.push(prop.shorthand
            ? `${key}: __ctx.${key}`
            : `${key}: ${this.transformArg(prop.value, code, declared, lineNo)}`)
        }
        return `{ ${parts.join(', ')} }`
      }
      case 'UnaryExpression':
        return `${node.operator}(${this.transformArg(node.argument, code, declared, lineNo)})`
      case 'BinaryExpression':
      case 'LogicalExpression':
        // Parenthesize both operands: the AST emission drops the source's
        // parentheses, so without explicit parens JS operator precedence
        // reinterprets nested arithmetic (e.g. -((a+b)/2+c) → -a+b/2+c).
        return `(${this.transformArg(node.left, code, declared, lineNo)} ${node.operator} ${this.transformArg(node.right, code, declared, lineNo)})`
      case 'ConditionalExpression':
        return `(${this.transformArg(node.test, code, declared, lineNo)} ? ${this.transformArg(node.consequent, code, declared, lineNo)} : ${this.transformArg(node.alternate, code, declared, lineNo)})`
      case 'MemberExpression':
        return this.hoistText(code.slice(node.start, node.end), declared)
      default:
        return this.hoistText(code.slice(node.start, node.end), declared)
    }
  }

  /** 文本级自由标识符提升：把已声明变量名 + 当前 ctx 键（import 预置/先前执行产出）
   *  替换为 __ctx.<name>（词边界）。含 ctx 键 → append 跨文件引用（D6）与模块命名空间
   *  成员（cfg.OUTX）在实参文本中同样可解析。 */
  private hoistText(text: string, declared: Set<string>): string {
    let out = text
    const names = new Set<string>(declared)
    for (const key of Object.keys(this.ctx)) names.add(key)
    for (const name of names) {
      out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), `__ctx.${name}`)
    }
    return out
  }

  private calleeOf(callNode: ASTNode | undefined): string | undefined {
    if (!callNode || callNode.type !== 'CallExpression') return undefined
    const c = callNode.callee
    if (c?.type === 'MemberExpression' && c.property?.type === 'Identifier') return c.property.name
    if (c?.type === 'Identifier') return c.name
    return undefined
  }

  /**
   * 返回块产出登记（T1）：shape 名 → 块起始行号。
   * runtime 的 collectDirectResult 用此传给 computeLiveShapes 的 blockOutputs。
   * @returns 块产出登记的只读视图（Map 迭代序 = 插入序）。
   */
  getBlockOutputs(): Map<string, number> {
    return new Map(this.blockOutputs)
  }

  /**
   * 返回变更登记（T2）：写键值变化的产出。
   * runtime 的 collectDirectResult 用此填充 ExecutionResult.changed。
   * @returns 变更键名数组（undefined 表示无变更）。
   */
  getChanged(): string[] | undefined {
    return this.changedSet.size > 0 ? [...this.changedSet] : undefined
  }

  /** 收集调用实参里的裸标识符（append 前缀校验输入）。 */
  private collectRefs(callNode: ASTNode | undefined): string[] {
    const refs = new Set<string>()
    if (!callNode || callNode.type !== 'CallExpression') return []
    const walk = (n: ASTNode): void => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'Identifier') {
        if (!['undefined', 'NaN', 'Infinity'].includes(n.name)) refs.add(n.name)
        return
      }
      if (n.type === 'MemberExpression') {
        walk(n.object)
        if (n.computed) walk(n.property)
        return
      }
      if (n.type === 'CallExpression') {
        // 嵌套调用内不视为本语句 input 引用（只读查询），与现状 collectStatementRefs 语义对齐——
        // 但 keep/依赖仍需要……现状是递归含 call args；这里保守按参数收集：
        for (const a of n.arguments ?? []) walk(a)
        return
      }
      if (n.type === 'Property') {
        walk(n.value)
        return
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'parent' || k === 'type') continue
        const v = n[k]
        if (Array.isArray(v)) for (const item of v) walk(item)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    for (const a of callNode.arguments ?? []) walk(a)
    return [...refs]
  }
}
