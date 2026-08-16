/**
 * CadRuntime — 执行核心（L2 编排层）
 *
 *
 * 职责：
 * - 执行 PartScript 语句序列，产出 ExecutionResult（纯计算，不碰 store/DOM）
 * - 管理 statementCache / brepSolidCache 作为实例成员（不再是模块级单例）
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
import {
  initBrepChainState,
  releaseBrepChainState,
  breakBrepChain,
  MESH_ONLY_OPS,
} from '../brep/brep-chain'
import { executeStatement as dispatchStatement } from '../ops/dispatcher'
import { parseScript, ParseError } from '../lang/parser'
import { validateStatementArgs } from '../lang/args-schema'
import type { HostPorts, ExecutionMode } from './ports'
import type { SelectorRuntimeData } from '../topology/build-selector-runtime'
import type { SelectorRuntime } from '../topology/types'

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
  /** partId（终端语句 id） */
  partId: string
  /** 拓扑来源（静态判定） */
  source: TopologySource
  /** 序列化的拓扑数据（可跨 Worker 传输） */
  data: SelectorRuntimeData
}

export interface ExecutionResult {
  /** 语句输出缓存（stmtId → Shape） */
  outputs: Map<string, Shape>
  /** BREP 链状态（含终端 solid 句柄） */
  brepChain: BrepChainState
  /** 终端几何列表 */
  terminals: TerminalShape[]
  /** 信息/警告列表 */
  infos: string[]
  /** 失败信息（如果执行中途出错） */
  failedAt?: { index: number; op: string; message: string }
  /** 终端 BREP solid（如果链未断裂） */
  brepSolid?: { solid: ShapeHandle; kernel: OcctKernel }
  /**
   * 拓扑数据 — 每个 part 的拓扑运行时。
   * E13：由 ExecutionResult 携带，宿主从结果消费。
   * 拓扑来源静态判定：BREP 成功时 source='brep'，否则根据 part 类型判定。
   */
  topology?: Map<string, PartTopology>
}

export interface ReplayOptions {
  /** 参数表 */
  params?: Record<string, unknown>
  /** 跨 part 输入几何（ShapeRef → Shape） */
  inputGeometryMap?: Map<string, Shape>
  /** 整场景 DAG（用于跨 part 引用解析） */
  sceneScript?: PartScript
  /** partTransform（世界→局部坐标偏移） */
  partTransform?: { position: [number, number, number] }
  /** 语句前钩子（用于 undo 逐语句快照） */
  beforeStatement?: (stmt: CadStatement, index: number) => void
}

// ── statementKey 计算（从 ScriptEngine.ts 移出，逻辑不变） ──

function computeStatementKey(
  stmt: CadStatement,
  getInputContentKey: (id: string) => string | undefined,
): string {
  const parts: string[] = [stmt.op]
  parts.push(JSON.stringify(stmt.args))
  for (const inputId of stmt.inputs) {
    const ck = getInputContentKey(inputId)
    parts.push(ck ?? 'missing')
  }
  return parts.join('|')
}

// ── contentKey 计算（从 replay-validator.ts 移出，逻辑不变） ──

function hashTypedArray(arr: Float32Array | Uint32Array): string {
  let hash = 0x811c9dc5
  const len = arr.length
  for (let i = 0; i < len; i++) {
    hash ^= arr[i]
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= len
  hash = Math.imul(hash, 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function computeContentKey(positions: Float32Array, indices: Uint32Array): string {
  const posHash = hashTypedArray(positions)
  const idxHash = hashTypedArray(indices)
  return `${posHash}_${idxHash}_${positions.length}_${indices.length}`
}

// ── CadRuntime ──

const MAX_RECURSION_DEPTH = 50

export class CadRuntime {
  readonly ports: HostPorts
  readonly mode: ExecutionMode

  /** 语句缓存（实例级，不再是模块单例） */
  private statementCache = new Map<string, {
    statementKey: string
    outputContentKey: string
    output: Shape
  }>()

  /** BREP solid 缓存：partId → { solid, kernel }（实例级，公开供外部只读访问） */
  readonly brepSolidCache = new Map<string, { solid: ShapeHandle; kernel: OcctKernel }>()

  /**
   * 拓扑数据缓存：partId → PartTopology（实例级）
   * E13：宿主不再直接 import faijs 拓扑构建函数，而是从 ExecutionResult.topology 消费。
   * 拓扑构建由宿主在 replay 后调用 setTopology 注入（BREP 路径）或由加载时注入（mesh/primitive 路径）。
   */
  private topologyCache = new Map<string, PartTopology>()

  constructor(ports: HostPorts, mode: ExecutionMode = 'auto') {
    this.ports = ports
    this.mode = mode
  }

  // ── 核心方法：replay ──

  /**
   * 执行 PartScript，返回 ExecutionResult。
   *
   * 纯计算：只产出几何，不碰场景树/store/DOM。
   * browser host 负责消费 ExecutionResult 并落地。
   */
  async replay(
    script: PartScript,
    opts?: ReplayOptions,
  ): Promise<ExecutionResult> {
    const infos: string[] = []
    const outputCache = new Map<string, Shape>()

    // 创建 BREP 链（mesh 模式不创建）
    const brepChain = this.mode === 'mesh'
      ? createEmptyBrepChain()
      : await initBrepChainState()

    if (opts?.partTransform?.position) {
      brepChain.partTransform = { position: opts.partTransform.position }
    }

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

    for (let i = 0; i < script.statements.length; i++) {
      const stmt = script.statements[i]
      if (stmt.isMarker) continue

      // beforeStatement 钩子（undo 逐语句快照用）
      opts?.beforeStatement?.(stmt, i)

      // 解析输入
      const inputGeometries: Shape[] = []
      for (const inputRef of stmt.inputs) {
        let geo = outputCache.get(inputRef) ?? opts?.inputGeometryMap?.get(inputRef)
        if (!geo) {
          geo = await this.resolveShapeRef(inputRef, outputCache, opts?.sceneScript)
          // 缓存跨 part 解析结果，供后续语句复用
          outputCache.set(inputRef, geo)
        }
        inputGeometries.push(geo)
      }

      // 检查是否需要断链（mesh-only op）—— 静态判定，不是运行时 try-catch
      if (this.mode !== 'mesh' && brepChain.brepActive && MESH_ONLY_OPS.has(stmt.op)) {
        this.handleBrepBreak(brepChain, stmt.id, stmt.op, `mesh-only op: ${stmt.op}`, infos)
        if (this.mode === 'brep') {
          // brep 模式：断链即报错，不自动切换
          return {
            outputs: outputCache,
            brepChain,
            terminals: [],
            infos,
            failedAt: { index: i, op: stmt.op, message: `E_BREP_UNSUPPORTED: op "${stmt.op}" has no BREP implementation` },
          }
        }
      }

      // 执行语句
      // BREP 路径异常 = bug，直接冒泡报错，禁止 try-catch 回退 mesh
      const result = await dispatchStatement(stmt, inputGeometries, outputCache, paramsMap, brepChain, this.ports, this.mode)
      outputCache.set(stmt.id, result)

      // 写入 statementCache
      const contentKey = computeContentKey(result.positions, result.indices)
      const getInputContentKey = (id: string) => this.statementCache.get(id)?.outputContentKey
      const stmtKey = computeStatementKey(stmt, getInputContentKey)
      this.statementCache.set(stmt.id, {
        statementKey: stmtKey,
        outputContentKey: contentKey,
        output: result,
      })
    }

    // 提取终端几何
    const terminals = script.terminalShapes ?? []
    const nonMarkerStmts = script.statements.filter((s) => !s.isMarker)

    // 提取终端 BREP solid
    let brepSolid: { solid: ShapeHandle; kernel: OcctKernel } | undefined
    if (brepChain.brepActive && brepChain.kernel && nonMarkerStmts.length > 0) {
      const lastStmt = nonMarkerStmts[nonMarkerStmts.length - 1]
      const finalSolid = brepChain.solidCache.get(lastStmt.id)
      if (finalSolid && brepChain.kernel) {
        brepSolid = { solid: finalSolid, kernel: brepChain.kernel }
      }
    }

    return {
      outputs: outputCache,
      brepChain,
      terminals,
      infos,
      brepSolid,
      topology: this.topologyCache.size > 0 ? new Map(this.topologyCache) : undefined,
    }
  }

  // ── 内部：断链处理 ──

  private handleBrepBreak(
    brepChain: BrepChainState,
    stmtId: string,
    op: string,
    reason: string,
    infos: string[],
  ): void {
    breakBrepChain(brepChain, stmtId, op)
    infos.push(`brep-chain-broken: ${reason} (op: ${op}, stmt: ${stmtId})`)
    // 经 EventSink 通知（替代 window.dispatchEvent）
    this.ports.events.emit('brep-chain-broken', {
      partId: '', // 由调用方填充
      op,
      reason,
    })
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
    statementId: string,
    localCache: Map<string, Shape>,
    sceneScript?: PartScript,
    resolvingStack: Set<string> = new Set(),
  ): Promise<Shape> {
    // 环检测
    if (resolvingStack.has(statementId)) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] circular reference: ${statementId} ` +
        `(stack: ${Array.from(resolvingStack).join(' → ')})`,
      )
    }
    if (resolvingStack.size >= MAX_RECURSION_DEPTH) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] max recursion depth (${MAX_RECURSION_DEPTH}) exceeded for "${statementId}"`,
      )
    }

    // 1. 本地缓存
    const local = localCache.get(statementId)
    if (local) return local

    // 2. statementCache
    const cached = this.statementCache.get(statementId)
    if (cached) return cached.output

    // 3. sceneScript 中查找
    if (!sceneScript) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] statement "${statementId}" not found (no sceneScript provided)`,
      )
    }

    // 在 sceneScript 中查找包含该 statementId 的位置
    const stmt = sceneScript.statements.find((s) => s.id === statementId)
    if (!stmt) {
      throw new Error(
        `[CadRuntime.resolveShapeRef] statement "${statementId}" not found in sceneScript`,
      )
    }

    // 从 sceneScript 的开头重放到该语句（简化实现：重放整个 DAG 直到目标语句）
    resolvingStack.add(statementId)
    const subOutputCache = new Map<string, Shape>()
    // mesh 模式不初始化 OCCT（避免 initOcctWasm 失败）
    const brepChain = this.mode === 'mesh'
      ? createEmptyBrepChain()
      : await initBrepChainState()

    try {
      for (const s of sceneScript.statements) {
        if (s.isMarker) continue
        const inputGeometries: Shape[] = []
        for (const inputRef of s.inputs) {
          let geo = subOutputCache.get(inputRef) ?? localCache.get(inputRef)
          if (!geo) {
            geo = await this.resolveShapeRef(inputRef, subOutputCache, sceneScript, resolvingStack)
          }
          inputGeometries.push(geo)
        }
        const result = await dispatchStatement(s, inputGeometries, subOutputCache, {}, brepChain, this.ports, this.mode)
        subOutputCache.set(s.id, result)

        if (s.id === statementId) {
          resolvingStack.delete(statementId)
          releaseBrepChainState(brepChain)
          return result
        }
      }
    } finally {
      if (!localCache.has(statementId)) {
        // 确保释放
        releaseBrepChainState(brepChain)
      }
    }

    resolvingStack.delete(statementId)
    throw new Error(
      `[CadRuntime.resolveShapeRef] statement "${statementId}" not reached during sceneScript replay`,
    )
  }

  // ── 公开：缓存访问 ──

  /** 获取语句缓存中的输出几何 */
  getCachedOutput(statementId: string): Shape | undefined {
    return this.statementCache.get(statementId)?.output
  }

  /** 写入语句缓存 */
  writeToStatementCache(
    statementId: string,
    stmt: CadStatement,
    output: Shape,
    outputContentKey: string,
  ): void {
    const getInputContentKey = (id: string) => this.statementCache.get(id)?.outputContentKey
    const stmtKey = computeStatementKey(stmt, getInputContentKey)
    this.statementCache.set(statementId, {
      statementKey: stmtKey,
      outputContentKey,
      output,
    })
  }

  /** 清除语句缓存 */
  clearStatementCache(): void {
    this.statementCache.clear()
  }

  /** plan() — 依赖分析，得出需要重算的语句集合 */
  plan(script: PartScript): { stale: CadStatement[]; reused: Map<string, string> } {
    const stale: CadStatement[] = []
    const staleIds = new Set<string>()
    const reused = new Map<string, string>()

    for (const stmt of script.statements) {
      if (stmt.isMarker) continue

      const inputStale = stmt.inputs.some((id) => staleIds.has(id))
      if (inputStale) {
        stale.push(stmt)
        staleIds.add(stmt.id)
        continue
      }

      const getInputContentKey = (id: string) =>
        reused.get(id) ?? this.statementCache.get(id)?.outputContentKey
      const newKey = computeStatementKey(stmt, getInputContentKey)
      const cached = this.statementCache.get(stmt.id)

      if (cached && cached.statementKey === newKey) {
        reused.set(stmt.id, cached.outputContentKey)
      } else {
        stale.push(stmt)
        staleIds.add(stmt.id)
      }
    }

    return { stale, reused }
  }

  // ── 公开：BREP solid 缓存 ──

  /** 获取终端 BREP solid（供 STEP 导出） */
  getBrepSolid(partId: string): { solid: ShapeHandle; kernel: OcctKernel } | undefined {
    return this.brepSolidCache.get(partId)
  }

  /** 写入 BREP solid 缓存 */
  setBrepSolid(partId: string, solid: ShapeHandle, kernel: OcctKernel): void {
    // 释放旧 solid
    const old = this.brepSolidCache.get(partId)
    if (old) {
      try { old.kernel.release(old.solid) } catch { /* 已释放 */ }
    }
    this.brepSolidCache.set(partId, { solid, kernel })
  }

  /** 删除 BREP solid 缓存 */
  deleteBrepSolid(partId: string): void {
    const entry = this.brepSolidCache.get(partId)
    if (entry) {
      try { entry.kernel.release(entry.solid) } catch { /* 已释放 */ }
    }
    this.brepSolidCache.delete(partId)
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
   * replay() 返回的 ExecutionResult.topology 会包含这些缓存数据。
   */
  setTopology(partId: string, source: TopologySource, data: SelectorRuntimeData): void {
    this.topologyCache.set(partId, { partId, source, data })
  }

  /** 获取拓扑数据 */
  getTopology(partId: string): PartTopology | undefined {
    return this.topologyCache.get(partId)
  }

  /** 删除拓扑数据 */
  deleteTopology(partId: string): void {
    this.topologyCache.delete(partId)
  }

  // ── 公开：终端几何提取 ──

  /**
   * 取终端几何用于导出。
   *
   * BREP 链活跃时返回 solid 句柄（供 STEP 导出）；
   * 否则返回 mesh Shape（供 STL 导出）。
   */
  getTerminalGeometry(
    partId: string,
    result: ExecutionResult,
  ): { shape: Shape; solid?: ShapeHandle; kernel?: OcctKernel } | null {
    const solid = this.brepSolidCache.get(partId)
    if (solid) {
      // 简化：直接返回 solid 信息，shape 由调用方从 outputs 取
      return { shape: result.outputs.get(partId) ?? null as unknown as Shape, solid: solid.solid, kernel: solid.kernel }
    }
    // 无 solid → mesh 路径
    const shape = result.outputs.get(partId)
    if (!shape) return null
    return { shape }
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
      if (stmt.isMarker) continue
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
      const validationErrors = validateStatementArgs(resolvedStmt)
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
      if (stmt.isMarker) continue
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
        statements: script.statements.filter((s) => !s.isMarker).length,
        ops: script.statements.filter((s) => !s.isMarker).map((s) => s.op),
      } : undefined,
    }
  }

  // ── 公开：释放 ──

  dispose(): void {
    // 释放所有 BREP solid
    for (const [, entry] of this.brepSolidCache) {
      try { entry.kernel.release(entry.solid) } catch { /* 已释放 */ }
    }
    this.brepSolidCache.clear()
    this.statementCache.clear()
    this.topologyCache.clear()
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

// ── 辅助 ──

/** 创建空的 BREP 链（mesh 模式用） */
function createEmptyBrepChain(): BrepChainState {
  return {
    solidCache: new Map(),
    brepActive: false,  // mesh 模式不激活 BREP
    kernel: null,
    breakReason: { stmtId: '__mesh_mode__', op: '__mode__' },
  }
}
