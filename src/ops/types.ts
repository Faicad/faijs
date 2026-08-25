/**
 * 操作分派器共享类型
 *
 * 每个操作分派器接收一个 OpContext，内含语句、输入几何、参数等。
 * 分派器内部根据 brepChain 状态选择 BREP 或 Mesh 路径。
 *
 * 引擎选择策略（mode-aware）：
 * - `auto`（默认）：优先 BREP，逐 part 判定——每个输入 part 都须持有 BREP 实体才走 BREP 路径
 * - `brep`：强制 BREP，任一输入无 solid 即报错 E_BREP_UNSUPPORTED
 * - `mesh`：全部走 mesh 路径
 *
 * BREP 状态是「逐 part」的：一个 part 是否为 BREP 由 solidCache 中是否有它的句柄决定。
 * 不再有全局 brepActive 标志——兄弟 part 互不污染。
 */

import type { CadStatement, Vec3 } from '../lang/types'
import type { BrepChainState } from '../brep/brep-chain'
import type { HostPorts, ExecutionMode } from '../cad-runtime/ports'
import type { PartName } from '../identity'

// ── Shape ──

/**
 * 几何形状 — CAD 核心的基础数据类型。
 *
 * - positions: Float32Array — 顶点位置 (x,y,z 交替)
 * - indices: Uint32Array — 三角形索引
 *
 * 所有 ops 的输入输出都使用这个类型。
 * F3 修复：Shape 定义在 mesh/types.ts（更底层），ops/types.ts 从此处 import。
 */
import type { Shape } from '../mesh/types'
export type { Shape }

/** 操作执行上下文 */
export interface OpContext {
  /** 当前语句 */
  stmt: CadStatement
  /** 上游语句的输出几何（按 inputs 顺序） */
  inputGeometries: Shape[]
  /** 当前重放的输出缓存（PartName → Shape），用于 GeomRef 求值 */
  outputCache?: Map<PartName, Shape>
  /** 已解析的参数表 */
  args: Record<string, unknown>
  /** 参数表（本期可为空） */
  params?: Record<string, unknown>
  /** BREP 链状态（始终传入；BREP 是否可用由「输入是否各有 solid」决定，逐 part 判定） */
  brepChain?: BrepChainState
  /** Host 注入的环境能力（可选——P3 后 ops mesh 路径通过此接口调用 CSG/SDF） */
  ports?: HostPorts
  /** 执行模式（auto/brep/mesh，默认 auto） */
  mode?: ExecutionMode
}

/**
 * 判断当前是否可以使用 BREP 路径（逐 part 判定）。
 *
 * 规则：
 * - mode === 'mesh' → false
 * - kernel 不存在 → false
 * - 每个输入 part 都必须持有存活的 BREP 实体（solidCache.has(id)），才走 BREP 路径
 *
 * 空 inputs（如 box/cylinder）→ .every 返回 true → 默认走 BREP
 * mesh-only op（knurl/sdf）永远走 mesh，不调用此函数做 BREP 路径判定
 */
export function canUseBrep(ctx: OpContext): boolean {
  if (ctx.mode === 'mesh') return false
  const bc = ctx.brepChain
  if (!bc?.kernel) return false
  // 每个输入 part 都必须持有存活的 BREP 实体，才走 BREP 路径（逐 part 判定）
  return ctx.stmt.inputs.every((id) => bc.solidCache.has(id))
}

export type { Vec3 }
