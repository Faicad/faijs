/**
 * exec-context — ExecContext 接口 + Phase 1 实现（VM 执行方案）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.3 / §3.4
 *
 * ExecContext 是库函数（Phase 1 为内部适配命名空间）与引擎之间的平台 API：
 * - 双内核（occt / csg / sdf）同时暴露，地位对称（回答 v9 内联疑问）
 * - 链记账按 Shape 身份（getSolid/setSolid），Phase 1 作为 PartName 键控
 *   solidCache 之上的薄适配（shapeToName 反查）
 * - dependentsOf / touch：变更型库调用（装配）的传递下游查询与变更声明
 *   （Phase 1 装配仍走旧 executeAssemblyPassForStmt 路径，二者暂为占位）
 */

import type { CadStatement, PartScript } from '../lang/types'
import type { Shape } from '../mesh/types'
import type { BrepChainState } from '../brep/brep-chain'
import type { ShapeHandle, OcctKernel } from 'occt-wasm'
import { getSlot, ensureSlot } from '../stdlib/shape'
import type { PartName } from '../identity'
import { asPartName } from '../identity'
import type {
  HostPorts,
  ExecutionMode,
  CsgBackend,
  SdfBackend,
  FontProvider,
  TextureSampler,
  AssetResolver,
  EventSink,
} from './ports'

// ── Stdlib 命名空间（cad 对象） ──

/** 库函数统一形态：`(inputs..., args, exec) => Promise<unknown>`；geom 查询末参 exec。 */
export type StdlibFn = (...args: unknown[]) => Promise<unknown> | unknown

/** cad 命名空间：op 函数 + geom 查询函数 + asset。Phase 1 为内部适配命名空间。 */
export interface StdlibNamespace {
  [name: string]: StdlibFn
}

// ── ExecContext 接口（引擎侧平台 API，op 无关） ──

/**
 * 库函数执行上下文。
 *
 * Phase 1：kernels.csg/sdf 与 fonts/texture/assets 直接透传 HostPorts 的可选值；
 * getSolid/setSolid 经 shapeToName 反查 PartName 后读写 brepChain.solidCache。
 */
export interface ExecContext {
  /** 用户全局模式设置 */
  readonly mode: ExecutionMode

  /** 几何内核（两个同时存在，地位对称；mesh 模式或未初始化时 occt 为 null） */
  readonly kernels: {
    readonly occt: OcctKernel | null
    readonly csg: CsgBackend | undefined
    readonly sdf: SdfBackend | undefined
  }

  /** BREP 链记账（按 Shape 身份，Phase 1 经 shapeToName 反查 PartName 键控 solidCache） */
  getSolid(shape: Shape): ShapeHandle | undefined
  setSolid(shape: Shape, solid: ShapeHandle): void

  /** 面演化映射（布尔/变换的 *WithHistory 产物，供 $geom faceOrdinal 稳定性） */
  getFaceEvolution(shape: Shape): Map<number, number[]> | undefined
  setFaceEvolution(shape: Shape, evo: Map<number, number[]>): void

  /** 变更型库调用（装配）：查询某 Shape 的传递下游当前值（引擎按 deps 图计算） */
  dependentsOf(shape: Shape): Shape[]
  /** 变更型库调用：声明该 Shape 被原地修改（引擎据此把持有它的变量列入 changed） */
  touch(shape: Shape): void

  /** 平台能力（自现 HostPorts 演进，与具体 op 无关） */
  readonly fonts: FontProvider | undefined
  readonly texture: TextureSampler | undefined
  readonly assets: AssetResolver | undefined
  readonly events: EventSink
}

// ── ExecContextImpl（Phase 1 实现） ──

/**
 * brep 强制模式下的不支持错误（mesh-only op / 输入不在 BREP 链）。
 *
 * 由 adapter 的 runOp 抛出，CadRuntime 捕获后转换为 ExecutionResult.failedAt
 * （与旧解释器"brep 模式立即返回 E_BREP_UNSUPPORTED，不静默回退 mesh"的语义一致）。
 */
export class BrepUnsupportedError extends Error {
  readonly stmt?: CadStatement
  constructor(message: string, stmt?: CadStatement) {
    super(message)
    this.name = 'BrepUnsupportedError'
    this.stmt = stmt
  }
}

/** ExecContextImpl 构造选项。 */
export interface ExecContextImplOptions {
  mode: ExecutionMode
  brepChain: BrepChainState
  ports: HostPorts
  /** 整场景 DAG（doAssemble 装配 pass 与下游传播需要） */
  script: PartScript
  /** 当前重放输出缓存（split 多输出写入 / 装配 pass 读写） */
  outputCache: Map<PartName, Shape>
  /** 已解析参数表（适配层透传，op 不直接消费） */
  params: Record<string, unknown>
  /** 语句前钩子（undo 逐语句快照；仅 new_shape 语句触发，与旧解释器一致） */
  beforeStatement?: (stmt: CadStatement, index: number) => void
  /** 写回持久 ctx 变量的回调（装配变换后 outputCache → ctx 同步） */
  setCtxVar?: (name: string, value: unknown) => void
}

export class ExecContextImpl implements ExecContext {
  readonly mode: ExecutionMode
  readonly brepChain: BrepChainState
  readonly ports: HostPorts
  readonly script: PartScript
  readonly outputCache: Map<PartName, Shape>
  readonly params: Record<string, unknown>
  readonly beforeStatement?: (stmt: CadStatement, index: number) => void

  /** Shape 身份 → PartName 反查（getSolid/setSolid 与 geom 查询的桥接） */
  readonly shapeToName = new WeakMap<object, PartName>()

  /** 被 touch 声明的原地修改 Shape 集合（collectResult 据此填 ExecutionResult.changed） */
  readonly touchedShapes = new Set<Shape>()

  /** 当前执行语句（ModuleExecutor 在调用 fn 前设置） */
  currentStmt?: CadStatement

  private readonly setCtxVar?: (name: string, value: unknown) => void

  constructor(options: ExecContextImplOptions) {
    this.mode = options.mode
    this.brepChain = options.brepChain
    this.ports = options.ports
    this.script = options.script
    this.outputCache = options.outputCache
    this.params = options.params
    this.beforeStatement = options.beforeStatement
    this.setCtxVar = options.setCtxVar
  }

  get kernels(): ExecContext['kernels'] {
    return {
      occt: this.brepChain.kernel,
      csg: this.ports.csg,
      sdf: this.ports.sdf,
    }
  }

  get fonts(): FontProvider | undefined {
    return this.ports.fonts
  }

  get texture(): TextureSampler | undefined {
    return this.ports.texture
  }

  get assets(): AssetResolver | undefined {
    return this.ports.assets
  }

  get events(): EventSink {
    return this.ports.events
  }

  getSolid(shape: Shape): ShapeHandle | undefined {
    return getSlot(shape)?.solid
  }

  setSolid(shape: Shape, solid: ShapeHandle): void {
    ensureSlot(shape).solid = solid
  }

  getFaceEvolution(shape: Shape): Map<number, number[]> | undefined {
    return getSlot(shape)?.faceEvolution
  }

  setFaceEvolution(shape: Shape, evo: Map<number, number[]>): void {
    ensureSlot(shape).faceEvolution = evo
  }

  /**
   * 查询某 Shape 的传递下游当前值（inputs-based，含 visited 防环）。
   * 装配变换只沿几何 inputs 链传播；$param 级联属 Phase 3 范畴。
   */
  dependentsOf(shape: Shape): Shape[] {
    const visited = new Set<Shape>()
    const result: Shape[] = []
    const visit = (s: Shape): void => {
      if (visited.has(s)) return
      visited.add(s)
      const name = this.shapeToName.get(s)
      if (name === undefined) return
      for (const stmt of this.script.statements) {
        if (!stmt.inputs.includes(name)) continue
        const outNames: PartName[] = [asPartName(stmt.id)]
        for (const outId of stmt.outputs ?? []) outNames.push(asPartName(outId))
        for (const outName of outNames) {
          const outShape = this.outputCache.get(outName)
          if (outShape) {
            result.push(outShape)
            visit(outShape)
          }
        }
      }
    }
    visit(shape)
    return result
  }

  /**
   * 声明某 Shape 被原地修改（引擎据此把持有它的变量列入 ExecutionResult.changed）。
   */
  touch(shape: Shape): void {
    this.touchedShapes.add(shape)
  }

  /** 写持久 ctx 变量（装配/库函数把变换结果同步回 ctx，使 collectResult 读到最终几何）。 */
  setVariable(name: string, value: unknown): void {
    this.setCtxVar?.(name, value)
  }
}
