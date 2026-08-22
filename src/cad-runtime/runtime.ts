/**
 * CadRuntime — 执行核心（L2 编排层）
 *
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
import {
  MESH_ONLY_OPS,
} from '../brep/brep-chain'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { executeStatement as dispatchStatement } from '../ops/dispatcher'
import { parseScript, ParseError } from '../lang/parser'
import { validateStatementArgs } from '../lang/args-schema'
import { canUseBrep } from '../ops/types'
import { executeAssemblyPassForStmt } from '../ops/assemble'
import type { HostPorts, ExecutionMode } from './ports'
import type { SelectorRuntimeData } from '../topology/build-selector-runtime'
import type { SelectorRuntime } from '../topology/types'
import { buildSolidTopologyRuntime } from '../brep/brep-topology'
import type { SolidTopologyResult } from '../brep/brep-topology'
import { buildTopologyFromMesh } from '../brep/brep-topology'
import type { Mesh as WasmMesh } from 'occt-wasm'


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
  /** partName（终端语句 id，faijs 变量名） */
  partName: string
  /** 拓扑来源（静态判定） */
  source: TopologySource
  /** 序列化的拓扑数据（可跨 Worker 传输） */
  data: SelectorRuntimeData
}

export interface ExecutionResult {
  /** 语句输出缓存（stmtId → Shape） */
  outputs: Map<string, Shape>
  /** BREP 链状态（含逐 part solid 句柄） */
  brepChain: BrepChainState
  /** 终端几何列表 */
  terminals: TerminalShape[]
  /** 信息/警告列表 */
  infos: string[]
  /** 失败信息（如果执行中途出错） */
  failedAt?: { index: number; op: string; message: string }
  /** 逐终端的 BREP 实体（仅持有 solid 的终端出现在此表）。 */
  brepSolids?: Map<string, { solid: ShapeHandle; kernel: OcctKernel }>
  /**
   * 拓扑数据 — 每个 part 的拓扑运行时。
   * E13：由 ExecutionResult 携带，宿主从结果消费。
   * 拓扑来源静态判定：BREP 成功时 source='brep'，否则根据 part 类型判定。
   */
  topology?: Map<string, PartTopology>
}

export interface ExecuteOptions {
  /** 参数表 */
  params?: Record<string, unknown>
  /** 跨 part 输入几何（ShapeRef → Shape） */
  inputGeometryMap?: Map<string, Shape>
  /** 整场景 DAG（用于跨 part 引用解析） */
  sceneScript?: PartScript
  /** partTransform（世界→局部坐标偏移 + 单位缩放） */
  partTransform?: { position: [number, number, number]; scale?: [number, number, number] }
  /** 语句前钩子（用于 undo 逐语句快照） */
  beforeStatement?: (stmt: CadStatement, index: number) => void
  /**
   * 增量执行起点（Persistent SolidCache 方案）：从指定位置开始顺序执行，
   * 之前的语句不进执行循环（缺省 0 = 全量执行）。
   */
  startIndex?: number
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

// ── contentKey 计算（从 execute-validator 迁移，逻辑不变） ──

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

  /**
   * Persistent SolidCache（docs/plans/2026-08-18-brepchain-persistent-solid-cache.md）：
   * statementId → OCCT 实体句柄，跨 execute 存活，持有所有权（顶替释放/删除/dispose 的唯一操作对象）。
   * op 层通过 brepChain.solidCache 读写——该引用指向此持久 Map（见 ensureBrepChain）。
   */
  private solidCache = new Map<string, ShapeHandle>()

  /** 面演化映射缓存（statementId → FaceEvolution），随 solidCache 一并持久。 */
  private faceEvolutionCache = new Map<string, Map<number, number[]>>()

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
  private topologyCache = new Map<string, PartTopology>()

  constructor(ports: HostPorts, mode: ExecutionMode = 'auto') {
    this.ports = ports
    this.mode = mode
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
      meshShapeCache: new Map<string, WasmMesh>(),
    }
    return this.brepChain
  }

  // ── 核心方法：execute（原 replay，改名对齐 roadmap §3.6） ──


  /**
   * 执行 PartScript，返回 ExecutionResult。
   *
   * 纯计算：只产出几何，不碰场景树/store/DOM。
   * browser host 负责消费 ExecutionResult 并落地。
   *
   * Persistent SolidCache（docs/plans/2026-08-18-brepchain-persistent-solid-cache.md）：
   * - 复用实例持久 BREP 链（solidCache 跨 execute 存活），不再每次新建；
   * - `opts.startIndex`：从指定位置开始顺序执行，之前的语句不进执行循环
   *   （缺省 0 = 全量执行，行为与旧 execute 一致）。
   */
  async execute(
    script: PartScript,
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    const infos: string[] = []
    const outputCache = new Map<string, Shape>()
    const start = opts?.startIndex ?? 0

    // 复用持久 BREP 链（mesh 模式 kernel 为 null）
    const brepChain = await this.ensureBrepChain()

    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }

    const paramsMap = this.buildParamsMap(script, opts)

    // 增量执行（startIndex > 0）：把前缀语句的输出从持久 statementCache 补进 outputCache，
    // 使 ExecutionResult.outputs 覆盖全部语句（3d_editor 提交链消费完整结果的前提），
    // 并让后续语句的输入解析直接命中持久缓存。
    if (start > 0) {
      for (let i = 0; i < start; i++) {
        const s = script.statements[i]
        const cached = this.statementCache.get(s.id)
        if (cached) outputCache.set(s.id, cached.output)
        for (const outId of s.outputs ?? []) {
          const oc = this.statementCache.get(outId)
          if (oc) outputCache.set(outId, oc.output)
        }
      }
    }

    for (let i = start; i < script.statements.length; i++) {
      const stmt = script.statements[i]
      // void / same_shape 语句不产出新几何，不进入 dispatcher
      // do_assemble 在这里执行装配变换 pass
      const rt = stmt.returnType ?? 'new_shape'
      if (rt === 'void' || rt === 'same_shape') {
        // do_assemble: 执行装配变换 pass
        if (stmt.op === 'do_assemble') {
          await this.executeAssemblyPass(stmt, outputCache, script)
        }
        // add_constraint: 约束已收集，不产出几何
        continue
      }

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

      // 检查 mesh-only op（逐 part 设计：不翻转全局状态，只发事件）
      if (MESH_ONLY_OPS.has(stmt.op)) {
        // mesh-only op 永远走 mesh，不写 solidCache → 输出 part 自动失去 BREP
        // brep 模式：报错，不自动切换
        if (this.mode === 'brep') {
          return {
            outputs: outputCache,
            brepChain,
            terminals: [],
            infos,
            failedAt: { index: i, op: stmt.op, message: `E_BREP_UNSUPPORTED: op "${stmt.op}" has no BREP implementation` },
          }
        }
        // auto 模式：发逐 part 事件（mesh 模式不发——kernel 从未存在，无 BREP 可丢失）
        if (this.mode === 'auto') {
          this.ports.events.emit('part-brep-lost', {
            partId: stmt.id,
            op: stmt.op,
            reason: 'mesh-only op output',
          })
        }
      } else if (this.mode === 'brep' && !canUseBrep({ stmt, inputGeometries, args: stmt.args as Record<string, unknown>, brepChain, mode: this.mode })) {
        // brep 模式：任一引用了无 solid 输入的 BREP op 也必须报错（逐 part 强制）
        return {
          outputs: outputCache,
          brepChain,
          terminals: [],
          infos,
          failedAt: { index: i, op: stmt.op, message: `E_BREP_UNSUPPORTED: input of "${stmt.op}" is not BREP` },
        }
      }

      // 顶替释放预捕获：dispatch 前捕获本语句将要写入的 key 集合（{id} ∪ outputs）的旧 handle。
      // 必须在 dispatch 之前捕获——op 执行时已用 solidCache.set 覆盖 map 条目，事后拿不到旧引用。
      const writeKeys = [stmt.id, ...(stmt.outputs ?? [])]
      const oldHandles = writeKeys
        .map((k) => this.solidCache.get(k))
        .filter((h): h is ShapeHandle => !!h)

      // 执行语句
      // BREP 路径异常 = bug，直接冒泡报错，禁止 try-catch 回退 mesh
      const result = await dispatchStatement(stmt, inputGeometries, outputCache, paramsMap, brepChain, this.ports, this.mode)
      outputCache.set(stmt.id, result)

      // 写入 statementCache（含 outputs[] 持久化——split 的 front/back 均可直接命中，见 §3.5）
      const contentKey = computeContentKey(result.positions, result.indices)
      const getInputContentKey = (id: string) => this.statementCache.get(id)?.outputContentKey
      const stmtKey = computeStatementKey(stmt, getInputContentKey)
      this.statementCache.set(stmt.id, {
        statementKey: stmtKey,
        outputContentKey: contentKey,
        output: result,
      })
      for (const outId of stmt.outputs ?? []) {
        if (outId === stmt.id) continue // stmt.id 已写入（split 的 stmt.id === outputs[0]）
        const outShape = outputCache.get(outId)
        if (outShape) {
          this.statementCache.set(outId, {
            statementKey: stmtKey + `|out:${outId}`,
            outputContentKey: computeContentKey(outShape.positions, outShape.indices),
            output: outShape,
          })
        }
      }

      // 顶替释放：执行成功后才释放预捕获的旧 handle（失败时缓存保持执行前状态，天然回滚）
      for (const old of oldHandles) {
        try { this.kernel?.release(old) } catch { /* 已释放 */ }
      }
    }

    // 提取终端几何
    const terminals = script.terminalShapes ?? []

    // 逐终端提取 BREP solid（逐 part 设计）
    const brepSolids = new Map<string, { solid: ShapeHandle; kernel: OcctKernel }>()
    if (brepChain.kernel) {
      if (terminals.length > 0) {
        // 有终端声明：逐终端检查 solidCache
        for (const t of terminals) {
          const s = brepChain.solidCache.get(t.id)
          if (s && brepChain.kernel) {
            brepSolids.set(t.id, { solid: s, kernel: brepChain.kernel })
          }
        }
      } else {
        // 无终端声明：取最后一条有赋值且 returnType=new_shape 的语句
        const newShapeStmts = script.statements.filter(
          (s) => s.hasAssignment && (s.returnType ?? 'new_shape') === 'new_shape',
        )
        if (newShapeStmts.length > 0) {
          const lastStmt = newShapeStmts[newShapeStmts.length - 1]
          const finalSolid = brepChain.solidCache.get(lastStmt.id)
          if (finalSolid && brepChain.kernel) {
            brepSolids.set(lastStmt.id, { solid: finalSolid, kernel: brepChain.kernel })
          }
        }
      }

      // 装配成员 solid 提取：assembly 终端本身不持有 solid，但其 members
      // （被 do_assemble 变换过的 part）在 solidCache 中有更新后的 solid。
      // 遍历所有 assembly 语句，把其 members 的 solid 也提取到 brepSolids，
      // 使下游（3d_editor 导出缓存）能拿到装配后位置的 BREP solid。
      for (const stmt of script.statements) {
        if (stmt.op !== 'assembly') continue
        const members = stmt.args?.members
        if (!Array.isArray(members)) continue
        for (const m of members) {
          if (typeof m !== 'string') continue
          // 只添加尚未在 brepSolids 中的 member（避免覆盖终端提取的结果）
          if (brepSolids.has(m)) continue
          const s = brepChain.solidCache.get(m)
          if (s && brepChain.kernel) {
            brepSolids.set(m, { solid: s, kernel: brepChain.kernel })
          }
        }
      }
    }

    return {
      outputs: outputCache,
      brepChain,
      terminals,
      infos,
      brepSolids: brepSolids.size > 0 ? brepSolids : undefined,
      topology: this.topologyCache.size > 0 ? new Map(this.topologyCache) : undefined,
    }
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

  // ── 语义入口：update / append（Persistent SolidCache 增量执行） ──

  /**
   * 更新参数：plan() 算变更语句 → 从第一个受影响语句开始顺序执行到末尾。
   *
   * - stale 为空（无变化）→ 从持久缓存组装结果直接返回，零执行；
   * - 否则 `execute(script, { startIndex: 第一个 stale 语句的 index })`——startIndex 之前的语句不进执行循环。
   *
   * 注意：受影响的语句不一定是「从变更点开始的连续段」（独立 part 并存时会连带重执行无关语句），
   * 这是刻意的保守选择——顺序执行天然保证拓扑序，结果正确；后续可用 stale 集合精确化执行范围。
   */
  async update(script: PartScript, opts?: ExecuteOptions): Promise<ExecutionResult> {
    const { stale } = this.plan(script)
    if (stale.length === 0) return this.collectFromCache(script)
    const changeIndex = script.statements.indexOf(stale[0])
    return this.execute(script, { ...opts, startIndex: changeIndex })
  }

  /**
   * 追加语句：只执行新增语句（不遍历脚本前缀，不关心前缀状态）。
   *
   * 对每条新语句应用与 execute 相同的防护：returnType 过滤 / beforeStatement 钩子 /
   * 输入解析（持久缓存命中）/ mesh-only 检查 / 顶替释放预捕获。返回完整 ExecutionResult
   * （未执行语句从持久缓存组装，见 collectFromCache）。
   *
   * 契约前提：新增语句的输入必然是此前已执行成功的活跃语句的输出，持久缓存保证其存在；
   * 若输入真缺失（dispose/删除后未同步），是调用方应先 execute 全量的信号——append 不做前缀完整性验证。
   */
  async append(script: PartScript, newIds: string[], opts?: ExecuteOptions): Promise<ExecutionResult> {
    const infos: string[] = []
    const brepChain = await this.ensureBrepChain()
    // 与 execute 一致：partTransform 随执行期上下文写入链（世界→局部坐标偏移）。
    // 含世界坐标 args 的 op（drill clickPosition / split bbCenter）依赖它做坐标转换。
    if (opts?.partTransform?.position) {
      brepChain.partTransform = {
        position: opts.partTransform.position,
        scale: opts.partTransform.scale,
      }
    }
    // 从持久 statementCache 预填所有既有语句的 mesh 输出（含 outputs[]），
    // 使新增语句的输入解析直接命中持久缓存，无需子重放。
    const outputCache = new Map<string, Shape>()
    for (const s of script.statements) {
      const cached = this.statementCache.get(s.id)
      if (cached) outputCache.set(s.id, cached.output)
      for (const outId of s.outputs ?? []) {
        const oc = this.statementCache.get(outId)
        if (oc) outputCache.set(outId, oc.output)
      }
    }
    const paramsMap = this.buildParamsMap(script, opts)

    const byId = new Map(script.statements.map((s) => [s.id, s]))
    for (const id of newIds) {
      const stmt = byId.get(id)
      if (!stmt) throw new Error(`[CadRuntime] append: unknown statement "${id}"`)
      // 与 execute 主循环一致的防护：void/same_shape 语句不产出几何（do_assemble / add_constraint 等）
      const rt = stmt.returnType ?? 'new_shape'
      if (rt === 'void' || rt === 'same_shape') {
        // do_assemble: 执行装配变换 pass（与 execute 主循环一致）
        if (stmt.op === 'do_assemble') {
          const transformedIds = await this.executeAssemblyPass(stmt, outputCache, script)
          // 把变换后的几何同步到 statementCache，使 collectFromCache 能正确返回
          // 变换后的几何（append 走 collectFromCache 组装结果，与 execute 直接返回 outputCache 不同）
          for (const partId of transformedIds) {
            const transformed = outputCache.get(partId)
            if (transformed) {
              const contentKey = computeContentKey(transformed.positions, transformed.indices)
              this.statementCache.set(partId, {
                statementKey: (this.statementCache.get(partId)?.statementKey ?? '') + '|asm-transform',
                outputContentKey: contentKey,
                output: transformed,
              })
            }
          }
        }
        continue
      }
      const index = script.statements.indexOf(stmt)
      opts?.beforeStatement?.(stmt, index)

      // 解析输入：outputCache（含持久缓存预填）→ resolveShapeRef（跨 part 兜底）
      const inputGeometries: Shape[] = []
      for (const inputRef of stmt.inputs) {
        let geo = outputCache.get(inputRef) ?? opts?.inputGeometryMap?.get(inputRef)
        if (!geo) {
          geo = await this.resolveShapeRef(inputRef, outputCache, script)
          outputCache.set(inputRef, geo)
        }
        inputGeometries.push(geo)
      }

      // mesh-only / brep 模式检查（与 execute 一致）
      if (MESH_ONLY_OPS.has(stmt.op)) {
        if (this.mode === 'brep') {
          return {
            outputs: outputCache,
            brepChain,
            terminals: [],
            infos,
            failedAt: { index, op: stmt.op, message: `E_BREP_UNSUPPORTED: op "${stmt.op}" has no BREP implementation` },
          }
        }
        if (this.mode === 'auto') {
          this.ports.events.emit('part-brep-lost', {
            partId: stmt.id,
            op: stmt.op,
            reason: 'mesh-only op output',
          })
        }
      } else if (this.mode === 'brep' && !canUseBrep({ stmt, inputGeometries, args: stmt.args as Record<string, unknown>, brepChain, mode: this.mode })) {
        return {
          outputs: outputCache,
          brepChain,
          terminals: [],
          infos,
          failedAt: { index, op: stmt.op, message: `E_BREP_UNSUPPORTED: input of "${stmt.op}" is not BREP` },
        }
      }

      // 顶替释放预捕获（与 execute 相同，见 §3.3）：dispatch 前捕获 {id} ∪ outputs 旧 handle
      const writeKeys = [stmt.id, ...(stmt.outputs ?? [])]
      const oldHandles = writeKeys
        .map((k) => this.solidCache.get(k))
        .filter((h): h is ShapeHandle => !!h)

      const result = await dispatchStatement(stmt, inputGeometries, outputCache, paramsMap, brepChain, this.ports, this.mode)
      outputCache.set(stmt.id, result)

      // 写入 statementCache（含 outputs[] 持久化，见 §3.5）
      const contentKey = computeContentKey(result.positions, result.indices)
      const getInputContentKey = (id: string) => this.statementCache.get(id)?.outputContentKey
      const stmtKey = computeStatementKey(stmt, getInputContentKey)
      this.statementCache.set(stmt.id, {
        statementKey: stmtKey,
        outputContentKey: contentKey,
        output: result,
      })
      for (const outId of stmt.outputs ?? []) {
        if (outId === stmt.id) continue
        const outShape = outputCache.get(outId)
        if (outShape) {
          this.statementCache.set(outId, {
            statementKey: stmtKey + `|out:${outId}`,
            outputContentKey: computeContentKey(outShape.positions, outShape.indices),
            output: outShape,
          })
        }
      }

      // 顶替释放：执行成功后才释放旧 handle（失败时缓存保持执行前状态）
      for (const old of oldHandles) {
        try { this.kernel?.release(old) } catch { /* 已释放 */ }
      }
    }

    return this.collectFromCache(script)
  }

  /**
   * 从持久缓存组装完整 ExecutionResult（update 无变化短路与 append 复用，§9 决策 7）。
   *
   * outputs 覆盖所有语句（含 outputs[]），brepSolids 从持久 solidCache 查终端，
   * 不依赖本次执行——这是 3d_editor 提交链（terminalToScopedId → commitGeometry）消费完整结果的前提。
   */
  private collectFromCache(script: PartScript): ExecutionResult {
    const outputs = new Map<string, Shape>()
    for (const s of script.statements) {
      const cached = this.statementCache.get(s.id)
      if (cached) outputs.set(s.id, cached.output)
      for (const outId of s.outputs ?? []) {
        const oc = this.statementCache.get(outId)
        if (oc) outputs.set(outId, oc.output)
      }
    }

    const terminals = script.terminalShapes ?? []
    const brepSolids = new Map<string, { solid: ShapeHandle; kernel: OcctKernel }>()
    if (this.kernel) {
      if (terminals.length > 0) {
        for (const t of terminals) {
          const s = this.solidCache.get(t.id)
          if (s && this.kernel) brepSolids.set(t.id, { solid: s, kernel: this.kernel })
        }
      } else {
        // 无终端声明：取最后一条有赋值且 returnType=new_shape 的语句
        const newShapeStmts = script.statements.filter(
          (s) => s.hasAssignment && (s.returnType ?? 'new_shape') === 'new_shape',
        )
        if (newShapeStmts.length > 0) {
          const lastStmt = newShapeStmts[newShapeStmts.length - 1]
          const finalSolid = this.solidCache.get(lastStmt.id)
          if (finalSolid && this.kernel) brepSolids.set(lastStmt.id, { solid: finalSolid, kernel: this.kernel })
        }
      }

      // 装配成员 solid 提取（与 execute 中一致）
      for (const stmt of script.statements) {
        if (stmt.op !== 'assembly') continue
        const members = stmt.args?.members
        if (!Array.isArray(members)) continue
        for (const m of members) {
          if (typeof m !== 'string') continue
          if (brepSolids.has(m)) continue
          const s = this.solidCache.get(m)
          if (s && this.kernel) {
            brepSolids.set(m, { solid: s, kernel: this.kernel })
          }
        }
      }
    }

    return {
      outputs,
      brepChain: this.brepChain ?? createEmptyBrepChain(),
      terminals,
      infos: [],
      brepSolids: brepSolids.size > 0 ? brepSolids : undefined,
      topology: this.topologyCache.size > 0 ? new Map(this.topologyCache) : undefined,
    }
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

    // 从 sceneScript 的开头重放到该语句（缓存缺失兜底：子重放复用同一持久链，不再新建 brepChain）
    resolvingStack.add(statementId)
    const subOutputCache = new Map<string, Shape>()
    const brepChain = await this.ensureBrepChain()

    try {
      for (const s of sceneScript.statements) {
        // void / same_shape 语句不产出几何，跳过子重放
        const srt = s.returnType ?? 'new_shape'
        if (srt === 'void' || srt === 'same_shape') continue
        const inputGeometries: Shape[] = []
        for (const inputRef of s.inputs) {
          let geo = subOutputCache.get(inputRef) ?? localCache.get(inputRef)
          if (!geo) {
            geo = await this.resolveShapeRef(inputRef, subOutputCache, sceneScript, resolvingStack)
          }
          inputGeometries.push(geo)
        }
        // 顶替释放预捕获（子重放复用持久链，覆盖前必须释放旧 handle，避免泄漏）
        const writeKeys = [s.id, ...(s.outputs ?? [])]
        const oldHandles = writeKeys
          .map((k) => this.solidCache.get(k))
          .filter((h): h is ShapeHandle => !!h)
        const result = await dispatchStatement(s, inputGeometries, subOutputCache, {}, brepChain, this.ports, this.mode)
        subOutputCache.set(s.id, result)
        // 写入持久 statementCache（含 outputs[]），使后续引用直接命中、不再子重放
        const contentKey = computeContentKey(result.positions, result.indices)
        const getInputContentKey = (id: string) => this.statementCache.get(id)?.outputContentKey
        const stmtKey = computeStatementKey(s, getInputContentKey)
        this.statementCache.set(s.id, {
          statementKey: stmtKey,
          outputContentKey: contentKey,
          output: result,
        })
        for (const outId of s.outputs ?? []) {
          if (outId === s.id) continue
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

        if (s.id === statementId) {
          resolvingStack.delete(statementId)
          return result
        }
      }
    } finally {
      // 不复用持久链的释放（releaseBrepChainState 会清空持久 solidCache）——子重放结果已写入持久缓存
      resolvingStack.delete(statementId)
    }

    throw new Error(
      `[CadRuntime.resolveShapeRef] statement "${statementId}" not reached during sceneScript execution`,
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

  /**
   * 执行装配变换 pass。
   *
   * 从 do_assemble 语句的 assemblyTarget 找到对应的 assembly 语句，
   * 从 assembly 语句的 args.constraints 中读取约束数据，
   * 委托 executeDoAssemble 执行变换（唯一真源）。
   *
   * executeDoAssemble 同时处理：
   * - Mesh 变换（outputCache 顶点烘焙）
   * - BREP 变换（solidCache 刚体变换，通过传入 brepChain）
   * - 下游 mesh 传播（通过传入 script）
   *
   * 约束只存 face 数据（center/normal），不存 transform（v8 红线 R7）。
   * 每次重放从 face 数据实时 solveFaceMate 求解，结果确定、可重复。
   *
   * @returns 被变换的 part name 集合（moving parts + 下游传播的 parts）
   */
  private async executeAssemblyPass(
    doAssembleStmt: CadStatement,
    outputCache: Map<string, Shape>,
    script: PartScript,
  ): Promise<Set<string>> {
    // 委托独立函数 executeAssemblyPassForStmt（与 3d_editor executeScript 共用同一入口）
    return Promise.resolve(
      executeAssemblyPassForStmt(doAssembleStmt, outputCache, script, this.brepChain ?? undefined)
    )
  }

  /** plan() — 依赖分析，得出需要重算的语句集合 */
  plan(script: PartScript): { stale: CadStatement[]; reused: Map<string, string> } {
    const stale: CadStatement[] = []
    const staleIds = new Set<string>()
    const reused = new Map<string, string>()

    for (const stmt of script.statements) {
      // void / same_shape 语句不产出几何，不参与增量分析
      const rt = stmt.returnType ?? 'new_shape'
      if (rt === 'void' || rt === 'same_shape') continue

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
  setTopology(partName: string, source: TopologySource, data: SelectorRuntimeData): void {
    this.topologyCache.set(partName, { partName, source, data })
  }

  /** 获取拓扑数据 */
  getTopology(partName: string): PartTopology | undefined {
    return this.topologyCache.get(partName)
  }

  /** 删除拓扑数据 */
  deleteTopology(partName: string): void {
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
  buildBrepTopology(stmtId: string): SelectorRuntime | null {
    const brepChain = this.brepChain
    if (!brepChain?.kernel) return null

    const solid = brepChain.solidCache.get(stmtId)
    if (!solid) return null

    // 规则 1：优先从 brepChain.meshShapeCache 复用执行链产出的三角化结果
    // （与显示 mesh 完全同一份 mesh，不二次 meshShape）
    const cachedMesh = brepChain.meshShapeCache?.get(stmtId)
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
    kernel: null,  // mesh 模式无 BREP 能力
  }
}
