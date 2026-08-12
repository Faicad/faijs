/**
 * 操作分派器共享类型
 *
 * 每个操作分派器接收一个 OpContext，内含语句、输入几何、参数等。
 * 分派器内部根据 brepChain 状态选择 BREP 或 Mesh 路径。
 *
 * 引擎选择策略（mode-aware，设计文档 §4.4）：
 * - `auto`（默认）：优先 BREP，断链后自动切 mesh + EventSink 通知
 * - `brep`：强制 BREP，断链即报错 E_BREP_UNSUPPORTED，不自动切换
 * - `mesh`：全部走 mesh 路径
 *
 * BREP 链活跃时走 OCCT 路径；断链后（auto 模式）或 mesh 模式下走 manifold-3d。
 */

import type { CadStatement, Vec3 } from '../../faijs/types'
import type { BrepChainState } from '../brep-chain'
import type { HostPorts, ExecutionMode } from '../../cad-runtime/ports'

// ── Shape ──

/**
 * 几何形状 — CAD 核心的基础数据类型。
 *
 * - positions: Float32Array — 顶点位置 (x,y,z 交替)
 * - indices: Uint32Array — 三角形索引
 *
 * 所有 ops 的输入输出都使用这个类型。
 * 定义在 L1 层（@/brep）供 L2（cad-runtime）和 L3（renderer）共享。
 */
export interface Shape {
  positions: Float32Array
  indices: Uint32Array
}

/** 操作执行上下文 */
export interface OpContext {
  /** 当前语句 */
  stmt: CadStatement
  /** 上游语句的输出几何（按 inputs 顺序） */
  inputGeometries: Shape[]
  /** 当前重放的输出缓存（statementId → Shape），用于 GeomRef 求值 */
  outputCache?: Map<string, Shape>
  /** 已解析的参数表 */
  args: Record<string, unknown>
  /** 参数表（本期可为空） */
  params?: Record<string, unknown>
  /** BREP 链状态（始终传入，断链后 brepActive=false） */
  brepChain?: BrepChainState
  /** Host 注入的环境能力（可选——P3 后 ops mesh 路径通过此接口调用 CSG/SDF） */
  ports?: HostPorts
  /** 执行模式（auto/brep/mesh，默认 auto） */
  mode?: ExecutionMode
}

/** 判断当前是否可以使用 BREP 路径 */
export function canUseBrep(ctx: OpContext): boolean {
  return !!ctx.brepChain?.brepActive && !!ctx.brepChain.kernel
}

export type { Vec3 }
