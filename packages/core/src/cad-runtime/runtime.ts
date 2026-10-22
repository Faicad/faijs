/**
 * CadRuntime — 执行核心（L2 编排层）
 *
 * Direct-only execution: the runtime runs only the direct path
 * (extractMetadata → DirectExecutor → computeLiveShapes).
 *
 * 职责：
 * - 执行 .fai.js 源码文本，产出 ExecutionResult（纯计算，不碰 store/DOM）
 * - 管理 statementCache 作为实例成员
 * - 执行模式感知（auto / brep / mesh）
 *
 * 不做的事（留给 browser host）：
 * - undo 快照
 * - SceneMutator.createPart / commitGeometry
 * - scriptStore 写入
 * - group/assembly 重建
 * - window.dispatchEvent / toast
 */

import type { TerminalShape } from '../lang/types'
import type { Shape } from '../mesh/types'
import { BREP_TESS } from '../mesh/types'
import type { BrepChainState } from '../brep/brep-chain'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { getActiveBrepEngine, hasBrepEngine, getActiveBrepEngineId, getMeshSolidBackend } from '../brep/engine/registry'
import { ensureOcctDefaultEngine } from '../brep/engine/adapters/occt'
import { MeshSolidRegistry } from '../brep/mesh-solid'
import { ParseError } from '../lang/parse-error'
import type { SecurityPolicy } from '../lang/security-scanner'
import type { HostPorts, ExecutionMode } from './ports'
import type { ExecutionStats, ExecutionFallbackReason } from './execution-stats'
export type { ExecutionStats, ExecutionPath, ExecutionFallbackReason } from './execution-stats'
import type { SelectorRuntimeData } from '../topology/build-selector-runtime'
import type { SelectorRuntime } from '../topology/types'
import { buildSolidTopologyRuntime, buildCompoundTopologyRuntime } from '../brep/brep-topology'
import type { SolidTopologyResult } from '../brep/brep-topology'
import type { ImportModel } from '../mesh/import-model'
import { buildTopologyFromMesh } from '../brep/brep-topology'
import type { BrepMeshResult } from '../brep/engine/types'
import { asPartName, type PartName, type StmtId } from '../identity'
import { DirectExecutor, type Namespaces, type DirectExecOpts } from './direct-executor'
import type { ExecBackendChoice } from './exec-backend'
import { ModuleRegistry, ModuleRegistryError, isRelativeSpecifier } from './module-registry'
import type { ModuleRunResult } from './module-registry'
import { computeLiveShapes, lineConsumes, blockConsumes, type KeepView } from './live-shapes'
import { extractMetadata, type UiMetadata, type OpDimMap } from '../lang/metadata-extractor'
import {
  configureBackends, CONTRACT_VERSION,
  assertContractVersion, type LibNamespace,
  type AssemblyKinematicsPose,
  configureTessellation, type TessellationDensity,
  configureTessellationTiming, getTessellationTiming, type TessellationTiming,
  setChainPreference,
} from '../runtime-state'
import { materializeTessellation } from '../brep/deferred-tess'
import { admitCompatLib } from './admit-compat-lib'
import {
  assertLibDecl,
  type LibDecl,
  type LibDescription,
  type LibFunctionView,
  type LibsUnderEngine,
} from './lib-decl'
import { hasDualOp, dualOpMetaOf } from '../define-op'
import { computeLibId } from './lib-id'
import { computeContentKey, stableFingerprint } from './content-key'
import { SCRIPT_UNIT_CONSTANTS } from '../units'
export { computeContentKey } from './content-key'
export { stableFingerprint } from './content-key'
import { isCompoundLike, brepOf, getSlot, ensureSlot, hasMeshSolid, type CompoundShape } from '../shape'
import type { AssemblyBehavior, AssemblyDecl } from '../extra/ops/compound'
import type { PartNaming } from '../topology/naming/types'
import { buildPartNaming, type PartNamingInput } from '../topology/naming/build-naming'
import { faceRowToHint } from '../topology/naming/geom-hint'
import { HASH_UPPER_BOUND } from '../brep/face-evolution'
import { scanDeterminism, type DeterminismViolation, type DeterminismPolicy } from '../lang/determinism-scanner'


// ── 装配变换死代码已删除 ──
// v8: applyPrecomputedTransform / eulerDegToMatrix3 / propagateTransform 已删除。
// 装配 pass 委托 executeDoAssemble（唯一真源），约束只存 face 数据、由 api/assembly 实时求解。

// ── 类型定义 ──

/**
 * A single validation error produced by CadRuntime.check.
 */
export interface CheckError {
  /**
   * The stage that produced the error.
   *
   * `'keep'` is **legacy**: keep directives are no longer validated as a
   * separate stage — misplaced keep (inside an argument object, or a
   * namespace-qualified `cad.keep(a)`) is rejected during extraction as
   * `E_STATEMENT`, surfacing under `'parse'`. The member stays in the union
   * for type compatibility and is never emitted.
   */
  stage: 'parse' | 'symbol' | 'reference' | 'keep' | 'security' | 'dimension'
  message: string
  line?: number
  stmtId?: string
  /** Parse diagnostic code (e.g. E_CONTROL_FLOW, passed through from parser ParseError.code). */
  code?: string
  /** SecurityScanner rule ID (only when stage='security'; e.g. SEC_IDENT / SEC_SYNTAX / ...). */
  ruleId?: string
}

/**
 * The aggregated result of a CadRuntime.check dry run.
 */
export interface CheckResult {
  ok: boolean
  errors: CheckError[]
  warnings: string[]
  /** Structured context for AI self-correction. */
  script?: { statements: number; callees: string[] }
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
  /** partName 即 faijs 变量名（PartName，品牌型） */
  partName: PartName
  /** 拓扑来源（静态判定） */
  source: TopologySource
  /** 序列化的拓扑数据（可跨 Worker 传输） */
  data: SelectorRuntimeData
}

/**
 * The result of a CadRuntime execution, carrying geometry, chain state, and
 * host-consumable topology data.
 */
export interface ExecutionResult {
  /**
   * Statement output cache (PartName → Shape or compound; includes the dual
   * front/back outputs of a split). UI query entry point listing every shape
   * variable — unregistered compounds returned by third parties (structural
   * test isCompoundLike) enter as well.
   */
  outputs: Map<PartName, Shape | CompoundShape>
  /** BREP 链状态（含逐 part solid 句柄） */
  brepChain: BrepChainState
  /** 终端几何列表 */
  terminals: TerminalShape[]
  /** 信息/警告列表 */
  infos: string[]
  /** 失败信息（如果执行中途出错）；lineNo 为 DirectExecutor 路径新增（§4.2 E-add，宿主按现状读前三个字段不破裂）；code 为原始错误码（如有，如 E_TOPO_NOT_FOUND / E_ARGS_FORM） */
  failedAt?: { index: number; callee: string; message: string; lineNo?: number; code?: string }
  /** 逐终端的 BREP 实体（仅持有 solid 的终端出现在此表）。key 为终端 PartName。 */
  brepSolids?: Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }>
  /**
   * 拓扑数据 — 每个 part 的拓扑运行时。
   * key 为 PartName。
   * E13：由 ExecutionResult 携带，宿主从结果消费。
   * 拓扑来源静态判定：BREP 成功时 source='brep'，否则根据 part 类型判定。
   */
  topology?: Map<PartName, PartTopology>
  /**
   * 拓扑命名数据 — 每个 part 的命名行（§3.7 of
   *
   * 宿主拾取到 Reference（序号）后 O(1) 反查命名行 → captureTopoRef 造 TopoRef。
   * BREP/primitive 完整（faceNaming 有 origin+role），mesh 只给 hint（role=''）。
   * 与 topology 并列、选择器 manifest 不改动；命名数据不进 topology-store。
   */
  naming?: Map<PartName, PartNaming>
  /**
   * 装配/分组结构 — 每个 compound 变量（group/assembly 产物）的成员变量名列表。
   * key 为 compound 变量名（PartName），value 为成员变量名列表。
   */
  compounds?: Map<PartName, PartName[]>
  /**
   * compound 显示名（2026-10-22）：`g.setName('...')` 写入的结构壳 `meta.name`，
   * 与 `compounds` 同键。跨线程经 protocol 的 WireCompound.name 带出（weapp /
   * electron 消费端显示组名与普通零件同口径）。无 setName 时为 undefined。
   */
  compoundNames?: Map<PartName, string>
  /**
   * F3（2026-10-15）：`cad.assembly` 声明面 — 脚本里每个 assembly 语句的声明
   * （name / memberNames / constraints / joints / solver + compound 引用）。
   *
   * 此前的缺口：约束/关节声明只存在 compound 的 behavior 槽，而 `getSlot` 未公开
   * 导出 → 宿主持不到声明。本字段把声明面提到结果一级，宿主据此做**纯求解**
   * （禁烘焙：不调 asm.solve()/do_assemble()，位姿只以 transform 数据在宿主侧
   * 流动）。`group` 产物（无约束/关节）不进本字段；无 assembly 语句时为 undefined。
   */
  assemblies?: AssemblyDecl[]
  /** 被 touch 声明的原地修改 Shape 的持有变量名（装配变换后 collectResult 填充，去重） */
  changed?: PartName[]
  /**
   * 活跃但非几何的值（keep-syntax 设计 §5.2，UI 可选消费）。
   * DAG 叶子且非 shape/compound：第三方测量/查询函数返回的 number/普通对象等。
   * 不进 terminals（terminals 只含几何，零回归）。
   */
  activeValues?: Map<PartName, unknown>
  /**
   * P3：装配运动副 per-member 位姿（键 = 成员名；含恒等链根），仅在含 joints 的
   * assembly solve 语句执行后出现。宿主从本字段读取（动画/导出），不新增返回值
   * 消费语义（asm.solve() 保持 R0 语句形态，与 do_assemble 现状一致）。
   */
  kinematics?: Map<PartName, AssemblyKinematicsPose>
  /**
   * 文件声明单位（unit-system §10.6）：load 语句读出的「文件自己声明的单位」，
   * key 为 PartName。元数据（宿主写进 sourceUnit、导出目标判定），不参与几何
   * 运算——坐标已是基准值，按它再缩放 = 双重换算。
   */
  detectedUnits?: Map<PartName, string>

  /**
   * 多零件降级零件数（fileid-container-and-nesting §5.4）：本批次 load op 曾读入
   * 多零件文件（多 solid STEP / 多 object 3MF）并只取第一个零件时，记 part → 原文件
   * 零件数（≥2）。宿主据此弹「该文件包含 N 个零件，当前仅加载第一个」警告。
   */
  multiPartCounts?: Map<PartName, number>
  /**
   * 导入模型结构（方案 2026-10-06-step-3mf-multipart-import-plan.md §5.5）—
   * 每个执行了 `cad.load` 的 part 的 ImportModel（零件身份表 + 装配层级 +
   * Bambu 视图）。单/多零件均登记（单零件 parts 长度 1）。宿主据此批量建
   * part / 消费装配结构，不再自行解析文件。
   */
  importModels?: Map<PartName, ImportModel>
  /**
   * 执行路径观测（2026-10-19）：本轮走的是全量 / 增量 / 零变更，以及退化原因。
   *
   * **必填**：宿主需要它来判断「这次 update 是真增量，还是静默退化成全量」；
   * 可选字段会让新增构造点漏填而无人察觉（见 execution-stats.ts 文件头）。
   */
  execution: ExecutionStats
}

/**
 * Options controlling a single CadRuntime execution. All inputs are code text
 * or plain values — the engine's internal IR is never part of this surface.
 */
export interface ExecuteOptions {
  /** The parameter table. */
  params?: Record<string, unknown>
  /** 语句前钩子（用于 undo 逐语句快照）；参数为语句 id（sN）与语句下标 */
  beforeStatement?: (stmtId: string, index: number) => void
  /**
   * 增量执行起点（兼容旧签名）：从指定位置开始顺序执行，
   * 之前的语句不进执行循环（缺省 0 = 全量执行）。
   */
  startIndex?: number
  /**
   * 拓扑构建开关（Phase 2.6）：
   * - 'auto'（默认）：为"在 BREP 链上"的终端自动构建 BREP 真拓扑
   * - 'brep'：为所有在 BREP 链上的输出构建拓扑（含非终端）
   * - 'off'：不自动构建（只返回宿主 setTopology 注入的拓扑）
   */
  topology?: 'auto' | 'brep' | 'off'
  /**
   * 主模块 key（相对项目根的路径，如 `src/assembly.fai.js`；多文件 §4.5）。
   * 宿主执行某个文件时传入——主模块的相对 import 以此为解析基准；不传则视为
   * 位于项目根（存量单文件行为不变：无 key 时 `./x.fai.js` 相对根解析）。
   */
  entryKey?: string
  /**
   * 执行护栏（§6.3 / D8，v1 可选、默认关闭）：**整轮超时**（覆盖 execute/append/update
   * 全程，含全部函数体重放），超时抛 {@link ExecutionLimitError}（E_EXEC_LIMIT）。
   * 防 `while(true)` 死循环挂死 worker/UI；不传则无超时（现状行为不变）。
   */
  executionTimeoutMs?: number
}

// 执行护栏超时错误（§6.3 / D8）定义在独立叶子文件 execution-limit-error.ts，
// DirectExecutor（direct 路径单元循环内检查）与本文件共用；此处 import + re-export
// 保持宿主 import 面不变（module 路径 runWithFailureHandling 的 Promise.race 使用）。
export { ExecutionLimitError } from './execution-limit-error'
import { RuntimeConcurrentError } from './runtime-concurrent-error'
export { RuntimeConcurrentError } from './runtime-concurrent-error'

/**
 * 全局执行态锁（C1）：进程内同一时刻只允许一个 runtime 处于执行态。
 *
 * 进程级单例（`setCurrentStmt` / backends / 内核）决定了并发执行多 runtime 不可支持；
 * 旧行为是"互踩"（见 {@link CadRuntime.claimBackends} 文档），现在改为显式拒绝。
 *
 * **同实例的重入放行**：`update` 内部会经 `executeDirectText`/`appendDirectText` 落入
 * 同一调用栈——那已被"同一栈上串行"保证，不构成并发。跨实例一律拒绝。
 */
let executingRuntimeId: number | null = null
/** 执行态持有者（诊断用：错误信息里给出被谁挡住）。 */
let executingEntry: string | null = null
/** runtime id 分配器（仅用于错误信息定位，不参与任何语义判定）。 */
let nextRuntimeId = 1

/**
 * Thrown by CadRuntime.append when a newly appended statement references a
 * variable that is not in the persistent context — its producer was never
 * executed (cross-file reference to an unloaded part, or ctx cleared by
 * dispose). The host should upgrade to a full `execute(code)`.
 */
export class AppendPrefixError extends Error {
  constructor(
    /** The source statement id (sN) whose reference is missing. */
    readonly statementId: string,
    /** The referenced variable missing from the persistent ctx. */
    readonly missingVar: string,
  ) {
    super(
      `[faijs] append: prefix missing — statement "${statementId}" references ` +
      `"${missingVar}" which is not in the persistent context; ` +
      `run execute(code) for a full execution`,
    )
    this.name = 'AppendPrefixError'
  }
}

// ── CadRuntime ──

/** Shape 形状守卫（positions/indices 结构） */
function isShapeLike(v: unknown): v is Shape {
  return !!v && typeof v === 'object' && 'positions' in v && 'indices' in v
}

/** SelectorRuntime → SelectorRuntimeData：剥离 Map 字段（跨 Worker 传输用）。 */
function runtimeToData(rt: SelectorRuntime): SelectorRuntimeData {
  const {
    referenceMap: _referenceMap,
    referenceByNormalizedSelector: _referenceByNormalizedSelector,
    referenceByDisplaySelector: _referenceByDisplaySelector,
    faceReferenceByRowIndex: _faceReferenceByRowIndex,
    edgeReferenceByRowIndex: _edgeReferenceByRowIndex,
    vertexReferenceByRowIndex: _vertexReferenceByRowIndex,
    occurrenceIdByRowIndex: _occurrenceIdByRowIndex,
    faceReferenceMap: _faceReferenceMap,
    edgeReferenceMap: _edgeReferenceMap,
    vertexReferenceMap: _vertexReferenceMap,
    ...data
  } = rt
  return data as SelectorRuntimeData
}

export type { DeterminismPolicy }

/**
 * CadRuntime 构造选项（第 4 参；缺省全部可选）。
 *
 * direct 是唯一执行路径。security 透传给 DirectExecutor 与 extractMetadata
 * （A1/A2/A3 缺省 'strict'）。determinism 在 execute/append 前 对源码做 B 档
 * taint 扫描（缺省 'error'，见 docs/reproducibility-contract.md §3）。
 */
export interface CadRuntimeOptions {
  /** 安全策略档位（缺省 'strict'；透传给 DirectExecutor 与 extractMetadata） */
  security?: SecurityPolicy
  /**
   * 执行后端（缺省 'vm'；静态选定，无运行时回退）。'interpreter' 为无
   * `new Function`/eval 的 AST 解释器后端，供禁 eval 环境（weapp / 严格 CSP）
   * 使用。
   */
  execBackend?: ExecBackendChoice
  /**
   * 确定性扫描档位（缺省 'error'）。执行前对 .fai.js 源码及其 import 的项目模块
   * / @faicad/* 库源码做 B 档 taint 扫描，违规按档位处理。库源码经
   * `ports.libLoader.loadSource` 获取（宿主未提供则跳过库扫描）。
   */
  determinism?: DeterminismPolicy
  /**
   * 全局三角化密度（宿主可调，proposal 2026-10-07）。缺省 2π/64 rad /
   * 0.1 mm。对应 OpenSCAD $fa（angularDeflection，弧度）/ $fs
   * （linearDeflection，mm）。per-primitive `segments` 仍优先于全局配置。
   */
  tessellation?: TessellationDensity
  /**
   * BREP 显示 mesh 三角化时机（方案 2026-10-21-weapp-tessellation-defer-plan）。
   * - `'eager'`（缺省）：每个 BREP op 产出即三角化（历史行为）。
   * - `'defer'`：op 产出不三角化（空 mesh + 延迟描述符）；结果收尾时只对**终端**
   *   按需物化，中间产物永不物化。物化参数与 eager 路径一致 ⇒ 拓扑 mesh 与显示
   *   mesh 同源（红线不破）。链切换（mesh-only op 消费 BREP 输入）与
   *   `topoMode:'brep'` 场景在分派/收尾处自动物化（方案 §2.2 兜底）。
   */
  tessellationTiming?: TessellationTiming
}

/**
 * CadRuntime is the execution core of the L2 orchestration layer.
 *
 * It executes a .fai.js source text and produces an ExecutionResult
 * (pure computation that touches neither the scene store nor the DOM), manages
 * the statementCache as an instance member, resolves shape references
 * internally, and is execution-mode aware (auto/brep/mesh). Hosts own undoing,
 * scene mutation, script-store writes, group/assembly rebuilding, and event
 * dispatch.
 */
export class CadRuntime {
  /** The host-injected environment capabilities. */
  readonly ports: HostPorts
  /** The execution mode (auto/brep/mesh). */
  readonly mode: ExecutionMode
  /** direct 是唯一执行路径。保留属性以兼容外部读取。 */
  readonly executorMode = 'direct' as const

  /** 语句缓存（实例级，不再是模块单例）。key = 可命中的 PartName（stmt.id 即其首输出名） */
  private statementCache = new Map<PartName, {
    statementKey: string
    outputContentKey: string
    // P2：多零件 load 的输出是 CompoundShape（无 mesh）——整体缓存，
    // 宿主经 getCachedOutput 取回 compound 逐 part 渲染。
    output: Shape | CompoundShape
  }>()

  /** 场景代码累积（三接口收敛：append 只传新行，faijs 累积全文使 id 按位置稳定 + DAG/keep 分析可见全场景）。 */
  private accumulatedCode: string | null = null
  /** 已累积场景的语句 id 集（append 据此判定「新增语句」）。 */
  private accumulatedIds = new Set<StmtId>()

  // P0 增量闸门用：上次成功执行的指纹快照
  private lastParamsFingerprint: string | null = null
  private lastLibIdsFingerprint: string | null = null
  private lastHadKinematics = false

  /**
   * PartName → OCCT 实体句柄，跨 execute 存活，持有所有权（顶替释放/删除/dispose 的唯一操作对象）。
   * op 层通过 brepChain.solidCache 读写——该引用指向此持久 Map（见 ensureBrepChain）。
   */
  private solidCache = new Map<PartName, BrepHandle>()

  /** 面演化映射缓存（PartName → FaceEvolution），随 solidCache 一并持久。 */
  private faceEvolutionCache = new Map<PartName, Map<number, number[]>>()

  /** 拓扑命名 RoleTable 缓存（PartName → RoleTable，§2.3），与 faceEvolutionCache 同生命周期。 */
  private roleTableCache = new Map<PartName, unknown>()

  /** OCCT 内核引用（环境级单例，initOcctWasm() 幂等；mesh 模式为 null）。供顶替释放用。 */
  private kernel: BrepEngineApi | null = null

  /**
   * 网格实体句柄注册表（PartName → BrepHandle，方案 2026-10-01 §3.2）。
   *
   * **与 `solidCache` 并列且互不干扰**：网格零件永不进 BREP 链，BREP 实体也永不
   * 进本表。释放语义与 solidCache 对齐（覆盖不释放、delete/clear 释放）。
   */
  private readonly meshSolidRegistry = new MeshSolidRegistry()

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
  private topologyCache = new Map<PartName, PartTopology>()

  /** 无 IR 执行器（DirectExecutor，T5 后唯一执行路径） */
  private readonly directExecutor: DirectExecutor

  /** 实例 id（仅用于 C1 并发错误信息里的定位，不参与任何语义判定）。 */
  private readonly runtimeId = nextRuntimeId++

  /** 安全策略档位（透传给 extractMetadata 与 DirectExecutor；缺省 'strict'） */
  private readonly securityPolicy: SecurityPolicy
  /** 确定性扫描档位（缺省 'error'；execute/append 前对源码做 B 档 taint 扫描）。 */
  private readonly determinismPolicy: DeterminismPolicy
  /** warn 档位下收集的确定性警告，合并进最终 ExecutionResult.infos。 */
  private determinismWarnings: string[] = []

  /**
   * Reserved binding names — only `'cad'`. Once the engine registers `cad`
   * (inside `createRuntime`), any subsequent `registerLib('cad', ...)` from
   * the host is rejected. The `_cadReserved` flag is set by `createRuntime`
   * immediately after the internal registration so the guard can distinguish
   * the engine's own first registration from a host's attempt to override.
   */
  private static readonly RESERVED_BINDINGS = new Set(['cad'])
  /**
   * Reserved marker for the `cad` binding: set right after the engine's own
   * registration so the guard can tell it apart from a host override attempt.
   * @internal
   */
  _cadReserved = false

  /** 宿主注册库（含 cad：由根门面 createRuntime 包装注入；注入编译产物 fn 的第二参 ns） */
  private readonly libs: Record<string, LibNamespace>
  /** 库内容身份表 (binding → content hash)，增量 key 用（B2，§7.3） */
  private readonly libIds = new Map<string, string>()
  /** import specifier → binding 映射（registerLib 的 packageName 声明；check ①.5 校验 specifier） */
  private readonly specifierToBinding = new Map<string, string>()
  /** 库级定位声明与来源（binding → { packageName, decl }），describeLib / libsUnder 读。 */
  private readonly libDecls = new Map<string, { packageName?: string; decl?: LibDecl }>()
  private readonly namespaces: Namespaces
  /** 默认命名空间绑定名（U10/R2）：根门面经 registerLib(binding, ns, {default: true}) 显式声明；
   *  缺省 'cad'（与 parser 缺省 defaultNs 一致）。namespace 字段缺省的语句归属该绑定。 */
  private defaultNsName = 'cad'

  /**
   * Register a library namespace. A version mismatch throws (no silent
   * degradation); afterwards compiled products may use the library via
   * `ns.<binding>.<callee>`. `cad` is registered the same way: the root facade
   * injects it through registerLib('cad', createApiNamespace(), { default: true }).
   * @param binding - the namespace binding name.
   * @param ns - the namespace object to register.
   * @param options - `{ default: true }` declares this binding as the default
   *   namespace (host-declared default binding name, U10/R2).
   */
  /**
   * Register a library namespace under a statement-level binding.
   *
   * Third-party libraries (no defineOp / no contractVersion) are admitted
   * through compatOp so bare functions cannot silently bypass the statement
   * boundary contract (B4, §4.3.3). The `autoLift` option controls this:
   *   - `true`  → bare functions are lifted via compatOp (brep-only, B4).
   *   - `false` → no lifting (the library's functions are used as-is; the
   *     built-in cad surface uses this since its ops already carry
   *     `DUAL_OP_META`).
   *   - omitted → inferred: `!hasDualOp(ns)`. Libraries that already declare
   *     dual-ops (cad) auto-lift `false`;
   *     all-bare-function libraries (sheetmetal, faijs-gears, faijs-fasteners) auto-lift `true`.
   *
   * The engine's built-in L3 surface is registered without `autoLift` by the
   * facade: inferred `false` (all ops carry `DUAL_OP_META`).
   * @param binding - the name scripts use to reach the namespace (e.g. 'cad').
   * @param ns - the library's export object.
   * @param options - registration hints. `packageName` declares the npm package
   *   backing this binding so `check()` can validate script import specifiers
   *   against registered libraries (specifier mismatch = hard check error).
   *   `lib` / `peers` carry the library-level `faijs.lib` declaration (定位属性)
   *   and its `peerDependencies`; they are validated at assembly time
   *   (`assertLibDecl`) and feed `fn.engines ?? lib.platform` resolution.
   *   Engine constraints are resolved at admission, i.e. only on the lifted path,
   *   so two unhonourable shapes are rejected: (a) any declaration while admitted
   *   WITHOUT lifting, (b) a non-empty `lib.platform` when the library also
   *   exports a dual-op without its own `engines`.
   */
  registerLib(binding: string, ns: LibNamespace, options?: { default?: boolean; autoLift?: boolean; packageName?: string; lib?: unknown; peers?: Readonly<Record<string, string>> }): void {
    // Reserved binding guard (2026-10-13): `cad` is the only reserved name.
    // The engine's own first registration (from `createRuntime`) sets the
    // `_cadReserved` flag; any subsequent attempt to register or override
    // `cad` from the host is rejected.
    if (CadRuntime.RESERVED_BINDINGS.has(binding) && this._cadReserved) {
      throw new Error(
        `E_CAD_RESERVED: "${binding}" is an engine-built-in reserved namespace. ` +
        'Hosts cannot register or override it. Use a different binding name ' +
        'for your custom library.',
      )
    }
    assertContractVersion(ns as unknown as { contractVersion?: number })
    // 库级定位声明：装配期校验（形态 / 引擎 id / 单向 peer 约束）后再解析函数级有效引擎。
    //
    // 来源两条：调用方显式传入（`lib` / `peers`），或按 `packageName` 走 loader 的既有
    // 读盘通道（`libMetaFor`，与自动装载同源同一次读盘）。显式传入优先——那是宿主覆盖
    // 声明的手段。少了这条回落，`registerLib(ns, { packageName })` 这条同样合法的装配
    // 路径会静默丢掉库自身 `package.json` 里的定位声明，`describeLib` 于是对调用方撒谎
    // ——「声明了却不生效」正是本批要消灭的那类 bug。
    const pkgName = options?.packageName
    const fromLoader =
      options?.lib === undefined && pkgName !== undefined
        ? this.ports.libLoader?.libMetaFor?.(pkgName)
        : undefined
    const decl = assertLibDecl(
      options?.lib ?? fromLoader?.lib,
      options?.peers ?? fromLoader?.peers,
      options?.packageName ?? binding,
    )
    // B4: admit bare (non-dual-op) library functions through compatOp when
    // autoLift is true (or inferred true — the library has no dual-op).
    // Hard ordering: assertLibConforms runs inside admitCompatLib BEFORE
    // wrapping — DUAL_OP_META hangs on the function object with
    // enumerable:false, and wrapping first would let bare functions silently
    // skip the strict validation pass (R8).
    // Naming (2026-09-23): library authors no longer declare face naming; every
    // bare function is admitted with the default unmodeled provenance (see
    // admit-compat-lib.ts).
    const lift = options?.autoLift ?? !hasDualOp(ns as unknown as Record<string, unknown>)
    // 引擎约束（库级 `faijs.lib.platform` 与函数级 `fn.engines`）只在**提升通路**上落地：
    // admitCompatLib 包装裸函数并把解析后的有效引擎写进 op 元数据，分派侧只读元数据。
    // 于是有两种「声明了却无法兑现」的形态，都在装配期当场拒绝——静默放行会让声明变成
    // 空话，而这正是本批要消灭的那类 bug。
    const nsEntries = Object.entries(ns as unknown as Record<string, unknown>)
    /**
     * **裸函数**上的 `fn.engines`（`typeof v === 'function'` 且不带 `DUAL_OP_META`）。
     *
     * dual-op 的引擎声明长在 op 自己的元数据里，由分派侧直接读——它**不经过**提升
     * 通路，所以与本开关无关，不能算进下面的「死声明」判定。把两者混在一起会误拒
     * 自带元数据的宿主命名空间：内置 `cad` 正是这种形态（46 个平台 op 各有
     * `engines`，而它以 `autoLift=false` 注册）。
     */
    const bareDeclared = nsEntries
      .filter(([, v]) => {
        if (typeof v !== 'function' || dualOpMetaOf(v) !== undefined) return false
        const e = (v as { engines?: readonly unknown[] }).engines
        return e !== undefined && e.length > 0
      })
      .map(([name]) => name)
    const libPlatform = decl?.platform ?? []
    if (!lift) {
      // 不提升 ⇒ 裸函数不是 op，没有元数据可挂 ⇒ 它的 `fn.engines` 与库级 `platform`
      // 都是死声明（dual-op 不在此列，见上）。
      if (libPlatform.length > 0 || bareDeclared.length > 0) {
        const what = [
          ...(libPlatform.length > 0 ? [`faijs.lib.platform = [${libPlatform.join('/')}]`] : []),
          ...(bareDeclared.length > 0 ? [`fn.engines on ${bareDeclared.join(', ')}`] : []),
        ].join(' and ')
        throw new Error(
          `[faijs] lib '${options?.packageName ?? binding}': ${what} declared, but the library is admitted ` +
            'WITHOUT lifting (autoLift=false) — the effective engine set is resolved at admission, which only ' +
            'exists on the lifted path. Register with autoLift: true (or declare faijs.autoLift: true), or drop ' +
            'the engine declarations.',
        )
      }
    } else if (libPlatform.length > 0) {
      // 提升通路只包装裸函数：dual-op 自带元数据、注入不进去，所以它们必须自己声明 engines。
      const uncovered = nsEntries
        .filter(([, v]) => {
          const meta = dualOpMetaOf(v)
          return meta !== undefined && meta.engines === undefined
        })
        .map(([name]) => name)
      if (uncovered.length > 0) {
        throw new Error(
          `[faijs] lib '${options?.packageName ?? binding}': faijs.lib.platform = [${libPlatform.join('/')}] ` +
            `cannot cover dual-op function(s) ${uncovered.join(', ')} — a library-level platform is injected ` +
            'at admission, which only wraps bare functions; ops keep their own metadata. Declare `engines` ' +
            'on those ops (or drop the library-level platform).',
        )
      }
    }
    const admitted = lift
      ? (admitCompatLib(ns as unknown as Record<string, unknown>, decl?.platform) as LibNamespace)
      : ns
    this.libs[binding] = admitted
    this.libDecls.set(binding, { packageName: options?.packageName, decl })
    this.libIds.set(binding, computeLibId(binding, ns as unknown as Record<string, unknown>))
    if (options?.packageName) {
      this.specifierToBinding.set(options.packageName, binding)
    }
    if (options?.default === true) {
      this.defaultNsName = binding
    }
    this.directExecutor.setNamespaces({ ...this.libs } as Namespaces)
  }

  /** The runtime's default namespace binding name (host-declared; 'cad' by default). */
  get defaultNs(): string {
    return this.defaultNsName
  }

  /**
   * 库调用方查询面（2026-10-14 §3.3 第 3 项）：回答「这个库需要什么内核」。
   *
   * 返回该库的库级定位（`role` / `conformsTo` / `platform`）+ 逐函数的**有效**引擎
   * 与产物名。`engines` 是装配期已解析的值（`fn.engines ?? lib.platform ?? 中立`），
   * 所以「未写 `fn.engines` 的函数回报继承来的库级平台」是自动成立的——同一份声明
   * 只有一个视图，不存在两处各自维护。
   *
   * @param binding - the statement-level binding name used at registration.
   * @returns the library description, or `undefined` when no such binding is registered.
   */
  describeLib(binding: string): LibDescription | undefined {
    const ns = this.libs[binding]
    if (!ns) return undefined
    const meta = this.libDecls.get(binding)
    const functions: LibFunctionView[] = []
    for (const [name, value] of Object.entries(ns)) {
      if (typeof value !== 'function') continue
      const opMeta = dualOpMetaOf(value)
      functions.push({
        name,
        engines: opMeta?.engines,
        outputs: opMeta?.outputs,
      })
    }
    return {
      binding,
      packageName: meta?.packageName,
      role: meta?.decl?.role ?? 'library',
      conformsTo: meta?.decl?.conformsTo,
      platform: meta?.decl?.platform ?? [],
      functions,
    }
  }

  /**
   * 库调用方查询面（2026-10-14 §3.3 第 3 项）：回答「给定引擎，这个库的哪些函数可以调用」。
   *
   * 判定与 `backend-dispatch.ts#decidePath` 的静态规则同源（中立 op = 全引擎可调；
   * 声明了 `engines` 的 op 只在该集合内可调），因此拒绝项与实际执行前的拒绝**必然一致**。
   * 只在确实被拒时给出 `reason`，可调项不带噪音字段。
   *
   * @param engineId - the BREP engine id to test against (e.g. `'occt'` / `'brepkit'`).
   * @returns callable / statically-rejected split for the given engine.
   */
  libsUnder(engineId: string): LibsUnderEngine {
    const callable: LibsUnderEngine['callable'] = []
    const rejected: LibsUnderEngine['rejected'] = []
    for (const [binding, ns] of Object.entries(this.libs)) {
      for (const [name, value] of Object.entries(ns ?? {})) {
        if (typeof value !== 'function') continue
        const engines = dualOpMetaOf(value)?.engines
        if (engines === undefined || engines.length === 0 || engines.includes(engineId as never)) {
          callable.push({ binding, name })
        } else {
          rejected.push({
            binding,
            name,
            reason: `requires engine ${engines.join('/')} (requested=${engineId})`,
          })
        }
      }
    }
    return { engineId, callable, rejected }
  }

  /**
   * P4/P6 (unit-system D8): 汇总已注册 op 的量纲声明（callee → { paramDims, retDim }），
   * 供 extractMetadata 的 dimension pass 消费。键 = 脚本面 callee 名（含命名空间内成员名，
   * 如 `cad.box`）。未声明量纲的 op / 非 op 函数跳过。lang/ 不依赖 op 注册表——由本运行时
   * 在此注入，符合 D8「校验器怎么拿到声明」分层。
   */
  private buildOpDims(): OpDimMap {
    const out: OpDimMap = {}
    for (const [binding, ns] of Object.entries(this.libs)) {
      if (!ns || typeof ns !== 'object') continue
      for (const [name, value] of Object.entries(ns)) {
        if (typeof value !== 'function') continue
        const meta = dualOpMetaOf(value)
        if (!meta || (!meta.paramDims && !meta.retDim && !meta.spec)) continue
        out[`${binding}.${name}`] = {
          paramDims: meta.paramDims,
          retDim: meta.retDim,
          ...(meta.slotMap ? { slotMap: meta.slotMap } : {}),
          ...(meta.spec ? { spec: meta.spec } : {}),
          ...(meta.dimCheck ? { dimCheck: meta.dimCheck } : {}),
        }
      }
    }
    return out
  }

  /**
   * Public accessor for the op dimension declarations built by {@link buildOpDims}
   * (unit-system G4): hosts need the same callee → { paramDims, retDim, slotMap }
   * map the dimension pass consumes so they can serialize with correct unit
   * literals without keeping a second copy of the table.
   *
   * @returns the op dimension map (paramDims / retDim / slotMap per op name).
   */
  getOpDims(): OpDimMap {
    return this.buildOpDims()
  }

  constructor(
    ports: HostPorts,
    mode: ExecutionMode = 'auto',
    libs: Record<string, LibNamespace> = {},
    options: CadRuntimeOptions = {},
  ) {
    this.ports = ports
    this.mode = mode
    this.libs = libs
    this.namespaces = { ...libs } as Namespaces
    this.securityPolicy = options.security ?? 'strict'
    this.determinismPolicy = options.determinism ?? 'error'
    if (options.tessellation) configureTessellation(options.tessellation)
    if (options.tessellationTiming) configureTessellationTiming(options.tessellationTiming)

    // P6/D7: register script-side unit constants (MM, INCH, DEGREE, …) on globalThis.
    // Both the VM backend (new Function resolves free identifiers from the global scope)
    // and the interpreter backend (env.ts reads globalThis[name] for S4_SAFE_GLOBALS)
    // need these values. Idempotent — safe to call across multiple runtime instances.
    const g = globalThis as Record<string, unknown>
    for (const [name, value] of Object.entries(SCRIPT_UNIT_CONSTANTS)) {
      if (!(name in g)) g[name] = value
    }

    this.directExecutor = new DirectExecutor({
      namespaces: this.namespaces,
      setSolid: (partName, solid, shape) => { this.setSolidAndTess(partName, solid, shape) },
      setFaceEvolution: (partName, evo) => { this.faceEvolutionCache.set(partName, evo as Map<number, number[]>) },
      setRoleTable: (partName, roleTable) => { this.roleTableCache.set(partName, roleTable) },
      security: this.securityPolicy,
      ...(options.execBackend !== undefined ? { execBackend: options.execBackend } : {}),
    })

    // P2：装配全局 backends（api 层经 getBackends() 取资源）。
    this.claimBackends()
  }

  /**
   * 认领全局 backends 配置（P2 修复）：全局 backends 是单例，任何 runtime 创建都会
   * 覆盖它——后创建的实例（如预览用 mesh runtime）会把 mode/kernel getter 指向自己，
   * 先前 runtime 的后续 execute 会被静默劫持（dispatch 走错槽、缓存键漂移、
   * 顶替释放旧 BREP 句柄后拓扑重建撞上悬空句柄）。因此除构造外，每个执行入口
   * （execute，所有执行路径的汇聚点）都必须先重新认领本实例的配置。
   *
   * ⚠️ 并发交错执行多个 runtime **仍会互踩**——这条限制现在由全局执行态锁强制
   * （{@link withExecutionLock}）：第二个 runtime 在他人执行态时抛
   * {@link RuntimeConcurrentError}（E_RUNTIME_CONCURRENT），不再"尽力而为"。
   * 用户已裁决不允许并发（开发计划 §4.7 C1）。
   * ⚠️ getter 的 this 指向所在对象字面量，用箭头闭包捕获实例（避免 no-this-alias）。
   */
  private claimBackends(): void {
    const brepChainOf = (): BrepChainState | null => this.brepChain
    const portsOf = (): HostPorts => this.ports
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: {
        mode: this.mode,
        get brepEngineId() {
          return getActiveBrepEngineId()
        },
        get hostEnv() {
          return portsOf().hostEnv
        },
      },
      kernel: {
        get brep() {
          return brepChainOf()?.kernel ?? null
        },
        get csg() {
          return portsOf().csg
        },
        get sdf() {
          return portsOf().sdf
        },
        get meshSolid() {
          // 网格实体后端来自 mesh 引擎槽（与 BREP 槽独立注册）——换 BREP 引擎
          // 不影响网格零件能力，反之亦然（R2 双槽位正交）。
          return getMeshSolidBackend() ?? undefined
        },
      },
      fonts: this.ports.fonts,
      texture: this.ports.texture,
      assets: this.ports.assets,
      events: this.ports.events,
      cad: this.namespaces.cad,
    })
    // 网格实体注册表在装配后认领后端（释放句柄要用它；未装配则 null）。
    this.meshSolidRegistry.setBackend(getMeshSolidBackend())
  }

  /**
   * 确保持久 BREP 链存在（惰性初始化）。
   * 引擎从注册表取当前 BREP 引擎（宿主装配时注册）；无引擎或 mesh 模式 → kernel 为 null。
   * OCCT 是内置默认引擎：宿主未注册任何引擎时，非 mesh 模式自动装配 OCCT——
   * 现有宿主无需改动即恢复默认 BREP 行为；换引擎仍是静态的（装配期注册其它引擎即可）。
   */
  private async ensureBrepChain(): Promise<BrepChainState> {
    if (this.brepChain) return this.brepChain
    if (this.mode !== 'mesh') {
      await ensureOcctDefaultEngine()
    }
    const engine = this.mode === 'mesh' || !hasBrepEngine()
      ? null
      : await getActiveBrepEngine()
    const kernel = engine?.primitives ?? null
    this.kernel = kernel
    this.brepChain = {
      solidCache: this.solidCache,
      kernel,
      faceEvolutionCache: this.faceEvolutionCache,
      roleTableCache: this.roleTableCache,
      meshShapeCache: new Map<PartName, BrepMeshResult>(),
    }
    return this.brepChain
  }

  // ── 公开入口：execute / append / update（输入一律是代码文本，IR 在引擎内部） ──

  /**
   * 取全局执行态锁并运行 `fn`（C1）。跨实例并发 → 抛 {@link RuntimeConcurrentError}；
   * 本实例重入（update 内部落到 executeDirectText/appendDirectText）放行。
   *
   * 刻意**同步**取锁（不在取锁前 await）：这样 `runtimeA.execute(...)` 尚未 await 时
   * 紧接着调 `runtimeB.execute(...)` 必然被拒绝，行为可确定、可测试。
   * @param entry - 入口名（execute / append / update），仅用于错误信息。
   * @param fn - 实际执行体。
   * @returns fn 的结果；无论成功失败都释放锁（finally）。
   */
  private async withExecutionLock<T>(entry: string, fn: () => Promise<T>): Promise<T> {
    if (executingRuntimeId !== null && executingRuntimeId !== this.runtimeId) {
      throw new RuntimeConcurrentError(executingRuntimeId, this.runtimeId, entry)
    }
    const reentrant = executingRuntimeId === this.runtimeId
    if (!reentrant) {
      executingRuntimeId = this.runtimeId
      executingEntry = entry
    }
    try {
      return await fn()
    } finally {
      if (!reentrant) {
        executingRuntimeId = null
        executingEntry = null
      }
    }
  }

  /** 当前执行态持有者的入口名（诊断；无持有者时 null）。 */
  static get executingEntry(): string | null {
    return executingEntry
  }

  /**
   * Full execution from code text: parse → execute every statement.
   * @param code - the .fai.js source text.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   * @throws {RuntimeConcurrentError} when another CadRuntime is already executing (C1).
   */
  async execute(code: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    return this.withExecutionLock('execute', () => this.executeDirectText(code, opts))
  }

  /**
   * Append new statements (incremental execution): only execute the new code
   * text on the persistent ctx; prefix validation enforces that references
   * must already exist (AppendPrefixError otherwise).
   * @param code - the new .fai.js source text to append.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   * @throws {RuntimeConcurrentError} when another CadRuntime is already executing (C1).
   */
  async append(code: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    return this.withExecutionLock('append', () => this.appendDirectText(code, opts))
  }

  /**
   * 确定性扫描门（B 档 taint）：执行前对源码做静态扫描，违规按 determinismPolicy 处理。
   *
   * 扫描范围：主文件 + @faicad/* 库源码（经 libLoader.loadSource，若宿主提供）。
   * 项目内相对 import 模块的扫描由 ModuleRegistry.load 内部完成（构造时传入 policy）。
   *
   * @returns ExecutionResult（违规 + policy='error' 时），null（通过或 warn/off）。
   *          warn 档位下警告收集到 this.determinismWarnings，由调用方合并进 infos。
   */
  private async runDeterminismGate(code: string, meta: UiMetadata): Promise<ExecutionResult | null> {
    if (this.determinismPolicy === 'off') return null
    this.determinismWarnings = []
    const hints = this.extractDeterminismHints(meta)
    const violations: DeterminismViolation[] = scanDeterminism(code, {
      defaultNs: this.defaultNsName,
      extraNamespaces: hints.namespaces,
      extraCallees: hints.callees,
    }).violations
    // 库源码扫描（@faicad/* 非引擎；经 libLoader.loadSource，宿主未提供则跳过）
    const loadSource = this.ports.libLoader?.loadSource
    if (loadSource) {
      for (const imp of meta.imports ?? []) {
        const spec = imp.packageName ?? imp.specifier ?? ''
        if (!spec.startsWith('@faicad/')) continue
        if (spec === '@faicad/faijs' || spec.startsWith('@faicad/faijs/')) continue
        let src: string | undefined
        try {
          src = await loadSource(spec)
        } catch {
          // 库源码不可读 → 跳过（不阻断执行；库违规由库作者负责）
        }
        if (src) {
          // scanLibrarySource strict：库源码含 TS 语法 → 显式抛错（不静默跳过）
          violations.push(...this.scanLibrarySource(src, hints).violations)
        }
      }
    }
    if (violations.length === 0) return null
    const formatted = violations.map((v) => `[determinism] line ${v.lineNo} [${v.source}]: ${v.message}`)
    if (this.determinismPolicy === 'warn') {
      this.determinismWarnings = formatted
      return null
    }
    // 'error'
    const first = violations[0]
    return {
      outputs: new Map(),
      brepChain: this.brepChain!,
      terminals: [],
      infos: [],
      failedAt: {
        index: -1,
        callee: 'determinism',
        message: formatted[0],
        lineNo: first.lineNo,
        code: 'E_DETERMINISM',
      },
      // 策略拦截先于任何单元执行：既非增量也非退化（不是闸门）。
      execution: { path: 'full', replayedUnits: 0, skippedUnits: 0 },
    }
  }

  /** 从 meta.imports 提取扫描提示：namespace import → extraNamespaces，named import → extraCallees。 */
  private extractDeterminismHints(meta: UiMetadata): { namespaces: string[]; callees: string[] } {
    const namespaces: string[] = []
    const callees: string[] = []
    for (const imp of meta.imports ?? []) {
      if (imp.kind === 'namespace' && imp.localName) namespaces.push(imp.localName)
      if (imp.kind === 'named') callees.push(...imp.bindings)
    }
    return { namespaces, callees }
  }

  /** 扫描库源码（契约：输入必须是编译后的纯 JS；含 TS 语法/解析失败 → 显式报错，无剥离、无回退）。 */
  private scanLibrarySource(src: string, hints: { namespaces: string[]; callees: string[] }): { violations: DeterminismViolation[] } {
    return {
      violations: scanDeterminism(src, {
        defaultNs: this.defaultNsName,
        extraNamespaces: hints.namespaces,
        extraCallees: hints.callees,
        strict: true, // 库源码非法（含 TS 语法）→ 抛错，不静默跳过
      }).violations,
    }
  }

  /**
   * Direct-mode full execution: the code text runs on the DirectExecutor
   * and outputs/terminals are assembled from the persistent ctx +
   * extractMetadata + computeLiveShapes.
   */
  private async executeDirectText(
    code: string,
    opts?: ExecuteOptions,
    /** update 闸门退化时带上原因；普通 execute/append 不传。 */
    fallbackReason?: ExecutionFallbackReason,
  ): Promise<ExecutionResult> {
    const de = this.directExecutor
    // P2 修复：执行前重新认领全局 backends（本实例配置为准）。
    this.claimBackends()
    this.accumulatedCode = code
    // 脚本链偏好（cad.useMeshChain）随全量执行从零声明。增量重放（updateIncremental
    // → replayFrom）与 append 不重置——前缀/累积代码是权威，其声明的偏好沿用；
    // update 把 useMeshChain 语句改掉/删掉时由 updateIncremental 的前缀扫描兜底。
    setChainPreference(null)
    // NOTE（2026-10-21，量纲执行期门禁待办）：此处**不传** opDims，所以量纲 pass
    // 不在 execute 路径运行，只有 `check()`（dry-run，见本文件 check()）会拦裸数字。
    // 实测把 opDims 接上后全仓 703 个测试失败（133 文件）——现有语料普遍写裸数字
    // （`cad.box(20, 20, 20)` 之类），与「带量纲槽位不准裸数字」的契约直接冲突。
    // 迁移量级与是否连带改动宿主 codegen 需产品决策，故暂不改变执行期行为。
    const meta = extractMetadata(code, { defaultNs: this.defaultNsName, security: this.securityPolicy, namespaces: Object.keys(this.libs) })
    const determinismFailure = await this.runDeterminismGate(code, meta)
    if (determinismFailure) return determinismFailure
    const libLoadFailure = await this.autoLoadLibsFromImports(meta.imports)
    if (libLoadFailure) return libLoadFailure
    // 多文件（§4.5）：相对 import 依赖装载 → 绑定 seed；装载错误 → failedAt 短路。
    const moduleLoad = await this.loadDirectModuleImports(meta, opts?.entryKey)
    if (!('seed' in moduleLoad)) return moduleLoad
    await this.ensureBrepChain()
    const outcome = await de.execute(code, {
      imports: moduleLoad.seed,
      params: opts?.params,
      ...(opts?.startIndex !== undefined ? { startLine: opts.startIndex } : {}),
      ...(opts?.beforeStatement ? { beforeStatement: opts.beforeStatement } : {}),
      ...(opts?.executionTimeoutMs !== undefined ? { executionTimeoutMs: opts.executionTimeoutMs } : {}),
    })
    if (outcome.failedAt) {
      return this.directFailedAtOrThrow(outcome.failedAt, meta, {
        path: 'full',
        ...(fallbackReason ? { reason: fallbackReason } : {}),
        replayedUnits: outcome.executedLines.length,
        skippedUnits: 0,
      })
    }
    const execution: ExecutionStats = {
      path: 'full',
      ...(fallbackReason ? { reason: fallbackReason } : {}),
      replayedUnits: outcome.executedLines.length,
      skippedUnits: 0,
    }
    const result = this.collectDirectResult(meta, opts, execution)
    if (this.determinismWarnings.length > 0) result.infos.push(...this.determinismWarnings)
    this.recordFingerprints(opts)
    return result
  }

  /** E6：DirectExecutor 失败行 → 场景语句序数（meta.lines 下标）；不在 lines → undefined。 */
  private directStmtOrdinal(meta: UiMetadata, lineNo: number | undefined): number | undefined {
    if (lineNo === undefined) return undefined
    const idx = meta.lines.findIndex((l) => l.line === lineNo)
    return idx < 0 ? undefined : idx
  }

  /**
   * Direct-mode failedAt handling (T5 direct-only path): all execution errors
   * from DirectExecutor's catch block are statement-level failures → keep in
   * failedAt (no re-throw). This includes OpError / BrepUnsupportedError /
   * MeshUnsupportedError (engine capability failures), TypeError (no_such_op),
   * and business parameter errors (e.g. E_ARGS_FORM, E_CHAMFER_NO_EDGES,
   * E_TOPO_NOT_FOUND). ParseError is re-thrown by DirectExecutor (not here).
   * The original error's `code` (e.g. E_TOPO_NOT_FOUND) is surfaced on
   * failedAt.code so hosts can programmatically distinguish error kinds.
   */
  private directFailedAtOrThrow(
    failedAt: { index: number; callee: string; message: string; lineNo?: number; error?: unknown },
    meta: UiMetadata,
    execution: ExecutionStats,
  ): ExecutionResult {
    const index = this.directStmtOrdinal(meta, failedAt.lineNo) ?? failedAt.index
    const rawCode = failedAt.error instanceof Error ? (failedAt.error as { code?: unknown }).code : undefined
    const code = typeof rawCode === 'string' ? rawCode : undefined
    return {
      outputs: this.directShapes(),
      brepChain: this.brepChain!,
      terminals: [],
      infos: [],
      failedAt: { index, callee: failedAt.callee, message: failedAt.message, lineNo: failedAt.lineNo, code },
      execution,
    }
  }

  /**
   * Direct-mode update: R3 语义——清 ctx 全量重跑新文本
   * （DirectExecutor.update 即 execute；无需 oldCode 差量）。
   */
  private async updateDirectText(_oldCode: string, newCode: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    this.accumulatedCode = newCode
    return this.executeDirectText(newCode, opts)
  }

  /**
   * Direct-mode append: DirectExecutor 共享 ctx 只执行新单元
   * （行号即边界）；prefix 校验保留 AppendPrefixError 语义（引用不在持久 ctx → 抛错，
   * 宿主升级为全量 execute）。
   */
  private async appendDirectText(code: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    const de = this.directExecutor
    if (!de) throw new Error('[faijs] direct executor is unavailable in module mode')
    this.claimBackends()
    const fullCode = this.accumulatedCode === null ? code : `${this.accumulatedCode}\n${code}`
    this.accumulatedCode = fullCode
    // Append never reconciles：持久 ctx 中先前已执行语句必须原样保留；缺引用的新单元
    // 在 DirectExecutor 内会静默拿到 undefined —— 这里按 module 路径语义前置抛错。
    // 先做 prefix 校验（skipSecurity=true，预检不触发安全扫描），再做 A1 安全扫描。
    const missing = de.missingPrefixVar(code)
    if (missing) throw new AppendPrefixError(`s${missing.unitLine}`, missing.varName)
    // looseVars: true (same semantics as the deleted module append path): references to
    // 已执行产出/其它文件的变量作为外部 var 透传，由 missingPrefixVar 前置校验决定成败。
    // A1 安全扫描需把 ctx 已有键 + 已注册命名空间都作为 knownNames（避免 SEC_FREE_IDENT 误杀 append 场景）。
    const appendKnownNames = [...Object.keys(this.libs), ...de.listCtxKeys()]
    const meta = extractMetadata(fullCode, { defaultNs: this.defaultNsName, looseVars: true, security: this.securityPolicy, namespaces: appendKnownNames, nsNames: Object.keys(this.libs) })
    const determinismFailure = await this.runDeterminismGate(fullCode, meta)
    if (determinismFailure) return determinismFailure
    const libLoadFailure = await this.autoLoadLibsFromImports(meta.imports)
    if (libLoadFailure) return libLoadFailure
    // 多文件（§4.5）：相对 import 依赖装载 → 绑定 seed（覆盖刷新 ctx 中旧 import 绑定）。
    const moduleLoad = await this.loadDirectModuleImports(meta, opts?.entryKey)
    if (!('seed' in moduleLoad)) return moduleLoad
    await this.ensureBrepChain()
    const outcome = await de.append(code, {
      imports: moduleLoad.seed,
      params: opts?.params,
      ...(opts?.beforeStatement ? { beforeStatement: opts.beforeStatement } : {}),
      ...(opts?.executionTimeoutMs !== undefined ? { executionTimeoutMs: opts.executionTimeoutMs } : {}),
    })
    if (outcome.failedAt) {
      return this.directFailedAtOrThrow(outcome.failedAt, meta, {
        path: 'full',
        replayedUnits: outcome.executedLines.length,
        skippedUnits: 0,
      })
    }
    // append 语义是「共享 ctx，只跑新单元」；它不经过 update，故按 full 记账
    // （path 描述的是「是否复用了前缀 ctx 做差量重放」，append 的差分由调用方给定）。
    const result = this.collectDirectResult(meta, opts, {
      path: 'full',
      replayedUnits: outcome.executedLines.length,
      skippedUnits: 0,
    })
    if (this.determinismWarnings.length > 0) result.infos.push(...this.determinismWarnings)
    this.recordFingerprints(opts)
    return result
  }

  /** Direct-mode 失败结果的 outputs 部分：持久 ctx 中已产出的 shape/compound。 */
  private directShapes(): Map<PartName, Shape | CompoundShape> {
    const de = this.directExecutor!
    const outputs = new Map<PartName, Shape | CompoundShape>()
    for (const name of de.listCtxKeys()) {
      const v = de.getCtxVar(name)
      if (isShapeLike(v) || isCompoundLike(v)) outputs.set(asPartName(name), v as Shape | CompoundShape)
    }
    return outputs
  }

  /**
   * 多文件装载（direct 模式，§4.5）：项目内相对 import 依赖经 ModuleRegistry 装载
   * （每依赖独立 ctx 执行 + 绑定校验），返回 seed（绑定名 → 值，供 DirectExecutor
   * opts.imports 预置）。装载错误 → failedAt 短路结果（不抛穿）。
   */
  private async loadDirectModuleImports(
    meta: UiMetadata,
    baseKey?: string,
  ): Promise<{ seed: Record<string, unknown> } | ExecutionResult> {
    const loader = this.ports.projectLoader
    if (!loader) return { seed: {} }
    if (!(meta.imports ?? []).some((imp) => isRelativeSpecifier(imp.specifier))) return { seed: {} }
    const registry = new ModuleRegistry(loader, (code, imports) => this.runDirectModule(code, imports), this.securityPolicy, this.determinismPolicy)
    try {
      const seed = await registry.resolveImports(meta.imports ?? [], baseKey)
      return { seed }
    } catch (err) {
      if (err instanceof ModuleRegistryError) {
        return {
          outputs: new Map(),
          brepChain: this.brepChain!,
          terminals: [],
          infos: [],
          failedAt: {
            index: -1,
            callee: err.callee ?? 'import',
            message: err.message,
            lineNo: err.lineNo,
          },
          // 依赖装载失败发生在主模块执行之前 → 一个单元都没跑。
          execution: { path: 'full', replayedUnits: 0, skippedUnits: 0 },
        }
      }
      throw err
    }
  }

  /** 依赖模块执行（direct）：独立 DirectExecutor + 独立 ctx；失败抛 ModuleRegistryError。 */
  private async runDirectModule(code: string, imports: Record<string, unknown>): Promise<ModuleRunResult> {
    // A3：子模块固定 strict 策略（不接受降档）
    // BREP kernel 必须在依赖执行前就绪——模块装载排在 ensureBrepChain 之前，
    // 否则子模块里的 BREP op 会以 "no OCCT kernel" 失败。
    await this.ensureBrepChain()
    // 钩子必须复用主 executor 的那套：子模块产出的 BREP solid 要登记进本实例的
    // solidCache，否则主模块的 brepSolids 查不到它们（装配体 STEP 导不出精确曲面）。
    const de = new DirectExecutor({
      namespaces: { ...this.libs } as Namespaces,
      setSolid: (partName, solid, shape) => { this.setSolidAndTess(partName, solid, shape) },
      setFaceEvolution: (partName, evo) => { this.faceEvolutionCache.set(partName, evo as Map<number, number[]>) },
      setRoleTable: (partName, roleTable) => { this.roleTableCache.set(partName, roleTable) },
      security: 'strict',
    })
    const outcome = await de.execute(code, { imports })
    if (outcome.failedAt) {
      throw new ModuleRegistryError(
        'MODULE_EXEC_FAILED',
        `dependency module failed at line ${outcome.failedAt.lineNo ?? '?'}: ${outcome.failedAt.message}`,
        { lineNo: outcome.failedAt.lineNo, callee: outcome.failedAt.callee },
      )
    }
    return de
  }

  /**
   * Direct-mode result assembly：ctx → outputs / statementCache / terminals /
   * brepSolids / compounds（与 collectResult 的 mesh 面同构；输入换源为
   * DirectExecutor ctx + UiMetadata + computeLiveShapes，§4.2/§4.4）。
   */
  private collectDirectResult(
    meta: UiMetadata,
    opts: ExecuteOptions | undefined,
    execution: ExecutionStats,
  ): ExecutionResult {
    const de = this.directExecutor!
    const outputs = new Map<PartName, Shape | CompoundShape>()
    const shapeVarNames = new Set<PartName>()
    const compounds = new Map<PartName, PartName[]>()
    const compoundNames = new Map<PartName, string>()
    // F3：cad.assembly 声明面（behavior.kind === 'assembly' 的 compound）
    const assemblies: AssemblyDecl[] = []
    for (const name of de.listCtxKeys()) {
      const v = de.getCtxVar(name)
      if (!isShapeLike(v) && !isCompoundLike(v)) continue
      outputs.set(asPartName(name), v as Shape | CompoundShape)
      shapeVarNames.add(asPartName(name))
      if (isCompoundLike(v)) {
        const behavior = getSlot(v)?.behavior as AssemblyBehavior | undefined
        compounds.set(asPartName(name), (behavior?.memberNames ?? []).map(asPartName))
        // 组显示名（2026-10-22）：结构壳 setName 写入 meta.name，随结果过线。
        const cname = (v as CompoundShape).meta?.name
        if (typeof cname === 'string' && cname.length > 0) compoundNames.set(asPartName(name), cname)
        // F3：只收 assembly 声明（group 无约束/关节，进声明面会让消费方对空约束集求解）
        if (behavior?.kind === 'assembly') {
          assemblies.push({
            ...(behavior.name !== undefined ? { name: behavior.name } : {}),
            memberNames: behavior.memberNames,
            constraints: behavior.constraints,
            joints: behavior.joints ?? [],
            ...(behavior.solver !== undefined ? { solver: behavior.solver } : {}),
            compound: v as CompoundShape,
          })
        }
      }
    }
    // T3-cond：DAG 叶子终端判定换 computeLiveShapes（§4.4）——输入换源：
    // 候选 = ctx 键；脚本级 keep 声明读 metadata.keep（`a.keep()` 语句，与行号无关）；
    // 函数体 exec.keep 登记读 DirectExecutor.keepByLine（行号键，与 KeepView 对齐）。
    const keepView: KeepView = {
      declared: () => meta.keep,
      functionBody: (lineNo) => de.getKeepByLine(lineNo),
    }
    let terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepView,
      shapeVarNames,
      ...(de.getBlockOutputs().size > 0 ? { blockOutputs: de.getBlockOutputs() } : {}),
      // P25 §3.7.4：修改类裸调用原地写回的 producer 精确化（行号 → 写回变量名）
      ...(de.getInplaceWrites().size > 0 ? { inplaceWrites: de.getInplaceWrites() } : {}),
      explicitTerminals: meta.terminalShapes,
    })
    // 显式 return 优先（与 collectResult 同）：非显式分支按值判定补 compound kind。
    if (!meta.terminalShapes || meta.terminalShapes.length === 0) {
      terminals = terminals.map((t) => {
        const v = de.getCtxVar(String(t.id))
        return isCompoundLike(v) ? { ...t, kind: 'compound' } : t
      })
    }
    // 延迟三角化（方案 2026-10-21-weapp-tessellation-defer-plan §2）：'defer' 模式下
    // BREP op 产出为空 mesh + BREP_LAZY_TESS 描述符，**先**物化需要消费 mesh 的终端，
    // 再算 statementCache 内容 key（key 必须基于真实 mesh）与构建拓扑（拓扑 mesh 与
    // 显示 mesh 同源，红线不破）。可见终端必物化；隐藏终端在 topoMode 'off'（不显示
    // 不建拓扑）时跳过，按需经 getCachedOutput 物化。中间产物（非终端）永不物化。
    const topoMode = opts?.topology ?? 'auto'
    if (getTessellationTiming() === 'defer') {
      this.materializeDeferredTessellations(terminals, shapeVarNames, topoMode)
    }
    // statementCache 同步（E8 getCachedOutput）：direct 无语句 key——用行级身份键填
    // content key，宿主继续从实例缓存读几何。必须位于物化之后（key 反映真实 mesh）。
    for (const name of shapeVarNames) {
      const v = de.getCtxVar(String(name))
      if (isShapeLike(v)) {
        const shape = v as Shape
        // 非实体导入（C6 线框/面/壳）不携带显示网格——positions/indices 为
        // undefined 是已知限制（load-nonsolid.test.ts），content key 退化为
        // 占位值而不是崩溃。
        const hasMesh = shape.positions instanceof Float32Array && shape.indices instanceof Uint32Array
        this.statementCache.set(name, {
          statementKey: `direct:${String(name)}`,
          outputContentKey: hasMesh
            ? computeContentKey(shape.positions, shape.indices)
            : `direct:nomesh:${String(name)}`,
          output: shape,
        })
      } else if (isCompoundLike(v)) {
        // P2（2026-10-06-step-3mf-multipart-import-plan.md §7）：多零件 load 的
        // 输出是 compound（无 positions/indices）——必须整体缓存，否则宿主经
        // `getCachedOutput` 指令取不到多零件几何（探针实测：返回 undefined →
        // "load produced no geometry"）。content key 退化为占位（compound 无
        // 单一网格可哈希）。
        this.statementCache.set(name, {
          statementKey: `direct:${String(name)}`,
          outputContentKey: `direct:compound:${String(name)}`,
          output: v as CompoundShape,
        })
      }
    }
    const brepSolids = this.directBrepSolids(terminals, compounds)
    // 网格零件落位（方案 2026-10-01 §3.3）：load 的 mesh 路径在 op 内完成规范化 +
    // 近似拓扑构建，把「句柄」与「拓扑数据」登记为 pending；此处收编。
    this.applyPendingMeshSolids(de.meshSolidSnapshot, de.meshTopologySnapshot)
    // T3：拓扑——宿主注入（mesh/primitive，setTopology 缓存）原样带出 + BREP 真拓扑
    // 自动构建（与 collectResult 的 topology='auto'/'brep' 面同构）。solidCache 已由
    // DirectExecutor 的 setSolid 钩子同步（逐单元执行后写入），此处 buildBrepTopology
    // 命中缓存构建拓扑。
    const topology = new Map<PartName, PartTopology>(this.topologyCache)
    if (topoMode !== 'off') {
      const buildFor = (partName: PartName): void => {
        const existing = topology.get(partName)
        if (existing) {
          // 陈旧 mesh 条目遮蔽（2026-10-22 mesh-chain-switch）：上一轮该零件是
          // **网格零件**（近似拓扑 source='mesh' 已入 topologyCache），本轮重放后它
          // 已回到 BREP 链（如删掉 `cad.useMeshChain` 语句 → executeDirectText 重跑
          // 为 auto）——若直接 `return`，结果里 source 还是上一轮的 'mesh'，与当前
          // 链事实不符（单一真源）。当前 ctx 变量不再是网格实体 → 重建为 brep 拓扑。
          const v = de.getCtxVar(String(partName))
          const stillMesh = v != null && typeof v === 'object' && hasMeshSolid(v as Shape)
          if (existing.source !== 'mesh' || stillMesh) return
        }
        const v = de.getCtxVar(String(partName))
        // 多零件 load（compound）：成员各带 BREP solid（fromBrep(shape,{solid})，
        // 装配变换经 brepOf(child) 读回），但 compound 终端无单一 solidCache 键
        // ——buildBrepTopology 必 miss。按成员合并构建 occurrence-aware 拓扑，
        // 否则多 solid STEP 导入后该终端无拓扑 → 宿主面拾取/装配 overlay 缺失
        // （assembly-dropdown 多文件回归）。
        if (isCompoundLike(v)) {
          const rt = this.buildCompoundBrepTopology(v as CompoundShape)
          if (rt) topology.set(partName, { partName, source: 'brep', data: runtimeToData(rt) })
          return
        }
        const rt = this.buildBrepTopology(partName)
        if (rt) {
          const data = runtimeToData(rt)
          topology.set(partName, { partName, source: 'brep', data })
          // §3.6 行 hint 快照：与 `setTopology` 同构，但从「宿主调才写」改为
          // 「执行时自写」。原因：BREP 路径宿主不一定调 setTopology（实测
          // weapp worker / animation 都不调），槽里 faceHints 就是空的 → 解析侧
          // （buildShapeResolutionContext 的 BREP 分支）只能拿 kernel 现场，而
          // brepkit 的 uvBounds 对平面返回 ±1e6 哨兵、surfaceCenterOfMass 退化
          // 成参数原点求值 → 非居中模型上 center 全错 → 兜底打分全拒 →
          // `topo ref (face) not found in the current shape`。
          // 行数据与 handle 同一次 execute 产出，同帧不陈旧。
          if (v && typeof v === 'object') {
            ensureSlot(v).faceHints = (data.faces ?? []).map((f) => faceRowToHint(f))
          }
        }
      }
      if (topoMode === 'brep') {
        for (const name of shapeVarNames) {
          const v = de.getCtxVar(String(name))
          if (isShapeLike(v) || isCompoundLike(v)) buildFor(name)
        }
      } else {
        for (const t of terminals) buildFor(t.id)
      }
    }
    // T3：命名——与 topology 同 set（与 collectResult 的 naming 面同构）
    const naming = new Map<PartName, PartNaming>()
    for (const [partName, partTopo] of topology) {
      const input = this.buildNamingInput(partName, partTopo)
      if (input) naming.set(partName, buildPartNaming(input))
    }
    // T2：activeValues —— 镜像 collectActiveValues，输入换 meta.lines + lineConsumes/
    // blockConsumes。候选 = ctx 中非 shape/compound 键（第三方测量/查询函数返回的
    // number/普通对象）。DAG 叶子且非几何 → activeValues（不进 terminals，零回归）。
    const activeValues = this.collectDirectActiveValues(meta, keepView, shapeVarNames)
    // T2：changed —— DirectExecutor 逐单元写值前后比对（与 module 路径 exec.changed 同语义）。
    const deChanged = de.getChanged()
    return {
      outputs,
      brepChain: this.brepChain!,
      terminals,
      infos: [],
      brepSolids: brepSolids.size > 0 ? brepSolids : undefined,
      topology: topology.size > 0 ? topology : undefined,
      naming: naming.size > 0 ? naming : undefined,
      compounds: compounds.size > 0 ? compounds : undefined,
      compoundNames: compoundNames.size > 0 ? compoundNames : undefined,
      assemblies: assemblies.length > 0 ? assemblies : undefined,
      kinematics: de.kinematicsSnapshot.size > 0 ? de.kinematicsSnapshot : undefined,
      detectedUnits: de.detectedUnitsSnapshot.size > 0 ? de.detectedUnitsSnapshot : undefined,
      multiPartCounts: de.multiPartCountSnapshot.size > 0 ? de.multiPartCountSnapshot : undefined,
      importModels: de.importModelsSnapshot.size > 0 ? de.importModelsSnapshot : undefined,
      changed: deChanged ? deChanged.map(asPartName) : undefined,
      activeValues: activeValues.size > 0 ? activeValues : undefined,
      execution,
    }
  }

  /** 块起始行 → lines 中第一个 >= 该行的下标（与 live-shapes.blockIdxOf 同逻辑）。 */
  private static blockIdxOfLine(lines: UiMetadata['lines'], blockLine: number): number {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].line >= blockLine) return i
    }
    return lines.length
  }

  /**
   * T2：Direct-mode activeValues 收集——镜像 collectActiveValues（module 路径），
   * 输入换 meta.lines + lineConsumes/blockConsumes。
   *
   * 判定与 computeLiveShapes 同构：变量 v 的最后写者行（lines 下标 + blockOutputs）
   * 之后没有语句/块消费 v → DAG 叶子。叶子且非 shape/compound → activeValues。
   * 几何叶子走 terminals（跳过，零回归）。
   */
  private collectDirectActiveValues(
    meta: UiMetadata,
    keepView: KeepView,
    shapeVarNames: Set<PartName>,
  ): Map<PartName, unknown> {
    const de = this.directExecutor!
    const active = new Map<PartName, unknown>()
    // lastProducer：lines 中最后写者下标（与 computeLiveShapes 同逻辑）
    const lastProducer = new Map<string, number>()
    for (let i = 0; i < meta.lines.length; i++) {
      const line = meta.lines[i]
      if (!line.hasAssignment) continue
      for (const out of line.outputs) lastProducer.set(String(out), i)
    }
    // 候选 = ctx 中非 shape/compound 键
    for (const name of de.listCtxKeys()) {
      const v = de.getCtxVar(name)
      if (v === undefined || isShapeLike(v) || isCompoundLike(v)) continue
      // producerIdx：lines 中最后写者下标，或 blockOutputs 的块行号锚点
      const lineIdx = lastProducer.get(name)
      const blockLine = de.getBlockOutputs().get(name)
      let producerIdx: number | undefined
      let producerLine: number
      if (lineIdx !== undefined && blockLine !== undefined) {
        // 取较大者：块在 lines 之后时块是最后写者
        const blockIdx = CadRuntime.blockIdxOfLine(meta.lines, blockLine)
        producerIdx = blockIdx > lineIdx ? blockIdx : lineIdx
        producerLine = blockIdx > lineIdx ? blockLine : (meta.lines[lineIdx]?.line ?? 0)
      } else if (lineIdx !== undefined) {
        producerIdx = lineIdx
        producerLine = meta.lines[lineIdx]?.line ?? 0
      } else if (blockLine !== undefined) {
        producerIdx = CadRuntime.blockIdxOfLine(meta.lines, blockLine)
        producerLine = blockLine
      } else {
        // 无生产者（宿主注入 / 跨文件引用）→ 不进 activeValues（与 module 路径一致）
        continue
      }
      if (producerIdx === undefined) continue
      // 消费判定：producer 之后的 lines + blocks
      let consumed = false
      for (let i = producerIdx + 1; i < meta.lines.length; i++) {
        if (lineConsumes(meta.lines[i], asPartName(name), keepView, shapeVarNames)) {
          consumed = true
          break
        }
      }
      if (!consumed && meta.blocks.length > 0) {
        if (blockConsumes(meta.blocks, name, producerLine)) consumed = true
      }
      if (!consumed) active.set(asPartName(name), v)
    }
    return active
  }

  /** Direct-mode 逐终端 BREP solid 提取（终端 + 装配成员；无 kernel → 空）。 */
  private directBrepSolids(
    terminals: TerminalShape[],
    compounds: Map<PartName, PartName[]>,
  ): Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }> {
    const brepSolids = new Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }>()
    if (!this.kernel) return brepSolids
    for (const t of terminals) {
      const s = this.solidCache.get(t.id)
      if (s !== undefined && this.kernel) brepSolids.set(t.id, { solid: s, kernel: this.kernel })
    }
    for (const members of compounds.values()) {
      for (const m of members) {
        if (brepSolids.has(m)) continue
        const s = this.solidCache.get(m)
        if (s !== undefined && this.kernel) brepSolids.set(m, { solid: s, kernel: this.kernel })
      }
    }
    return brepSolids
  }

  /**
   * P 四（4.2）：execute 阶段自动装载未注册的库。
   *
   * import 表（UiMetadata.imports）驱动的自动装载。
   */
  private async autoLoadLibsFromImports(
    imports: ReadonlyArray<{ kind?: string; localName?: string; packageName?: string; specifier?: string }>,
  ): Promise<ExecutionResult | undefined> {
    const loader = this.ports.libLoader
    if (!loader) return undefined
    for (const imp of imports) {
      if (imp.kind !== 'namespace') continue // named/default import 不作语句级绑定，不在此装载
      // 相对 specifier 属多文件通道（§4.5），不是库——留给 ModuleRegistry 处理，
      // 否则会被当作裸包名送进 libLoader 而报"不在白名单"。
      if (isRelativeSpecifier(imp.specifier ?? '')) continue
      if (!imp.localName) continue
      if (this.libs[imp.localName]) continue  // 已注册（宿主注入或此前自动装载）→ 不覆盖
      let ns: LibNamespace
      try {
        ns = await loader.loadLib(imp.packageName ?? imp.specifier ?? '')
      } catch (err) {
        return {
          outputs: new Map(),
          brepChain: this.brepChain!,
          terminals: [],
          infos: [],
          failedAt: {
            index: -1,
            callee: imp.localName,
            message: `import specifier "${imp.specifier}" cannot be auto-loaded: ${err instanceof Error ? err.message : String(err)}`,
          },
          // 库装载先于执行 → 一个单元都没跑。
          execution: { path: 'full', replayedUnits: 0, skippedUnits: 0 },
        }
      }
      const resolved = imp.packageName ?? imp.specifier ?? ''
      // 库级定位声明（§3.3 第 1 项）：来源是库自身 package.json 的 `faijs.lib` +
      // `peerDependencies`，与下面逐函数的实现事实是**两个不同维度**（`autoLiftFor`
      // 与 `libMetaFor` 同源同一次读盘）。此处只搬运原始值，校验与解析在
      // registerLib → assertLibDecl / admitCompatLib 里做，装配期一次完成。
      const libMeta = loader.libMetaFor?.(resolved)
      this.registerLib(imp.localName, ns, {
        autoLift: loader.options?.autoLiftFor?.(resolved) ?? loader.options?.autoLift ?? !hasDualOp(ns as unknown as Record<string, unknown>),
        packageName: imp.packageName,
        lib: libMeta?.lib,
        peers: libMeta?.peers,
      })
    }
    return undefined
  }


  /**
   * 构建一个 part 的命名输入（§3.7）。
   *
   * - BREP：roleTableCache 反查 {origin, role} + subShapeHashes 序号对照 + 面/边行 hint；
   * - primitive：assignPrimitiveFaceRoles 按固定面序给语义 role（§5.2，与 BREP 同一套命名器）；
   * - mesh：只填 hint（role=''，§5.3）。
   */
  private buildNamingInput(partName: PartName, partTopo: PartTopology): PartNamingInput | undefined {
    const faces = (partTopo.data.faces ?? []) as Array<{
      surfaceType?: string; normal?: readonly number[] | null; center?: readonly number[] | null; area?: number
    }>
    const edges = (partTopo.data.edges ?? []) as Array<{
      length?: number; center?: readonly number[] | null
    }>
    const edgeFaceOrdinals = this.edgeFaceOrdinalsOf(partTopo.data)

    if (partTopo.source === 'brep') {
      const roleTable = this.roleTableCache.get(partName) as PartNamingInput['roleTable']
      const solid = this.solidCache.get(partName)
      let ordinalToHash: readonly number[] | undefined
      if (solid !== undefined && this.kernel) {
        ordinalToHash = Array.from(this.kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND))
      } else if (this.kernel) {
        // compound 终端（多零件 load / 装配）：无单一 solidCache 键——按 children
        // 声明序逐成员 subShapeHashes 拼接（与 buildCompoundTopologyRuntime 的合并
        // 面序同源：buildAssemblySelectorManifest 按 parts 数组序拼 face 行，序号
        // 对齐合并拓扑的 ordinal）。任一成员无 BREP solid → 放弃（保持 undefined，
        // 面/边行 role 显式 null，不伪造）。
        const v = this.directExecutor.getCtxVar(partName)
        if (isCompoundLike(v)) {
          const merged: number[] = []
          for (const child of (v as CompoundShape).children ?? []) {
            const cs = brepOf(child) as BrepHandle | undefined
            if (cs === undefined) {
              merged.length = 0
              break
            }
            merged.push(...Array.from(this.kernel.subShapeHashes(cs, 'face', HASH_UPPER_BOUND)))
          }
          if (merged.length > 0) ordinalToHash = merged
        }
      }
      return {
        source: 'brep',
        partName,
        faces,
        edges,
        roleTable,
        ordinalToHash,
        edgeFaceOrdinals,
      }
    }
    if (partTopo.source === 'primitive') {
      // Phase 1.8（D6）：primitive 不再派生伪拓扑 role——拓扑身份是 BREP 专有能力，
      // primitive/mesh 一致只填 hint（naming 行 origin/role 显式 null）。
      return { source: partTopo.source, partName, faces, edges, edgeFaceOrdinals }
    }
    return { source: partTopo.source, partName, faces, edges, edgeFaceOrdinals }
  }

  /**
   * 从 SelectorRuntimeData 的 edgeFaceRows 提取每条边的两邻面序号（1 起；§3.7）。
   * mesh 无邻接 → undefined（edgeNaming.faces=null，只能 hint 兜底，§5.3）。
   */
  private edgeFaceOrdinalsOf(data: SelectorRuntimeData): ReadonlyArray<readonly [number, number] | null> | undefined {
    const edgeFaceRows = data.proxy?.edgeFaceRows
    const edges = (data.edges ?? []) as Array<{ faceStart?: number; faceCount?: number }>
    if (!Array.isArray(edgeFaceRows) && !(edgeFaceRows instanceof Uint32Array)) return undefined
    const rows = edgeFaceRows as ArrayLike<number>
    const out: Array<readonly [number, number] | null> = []
    for (const edge of edges) {
      const start = edge.faceStart ?? 0
      const count = edge.faceCount ?? 0
      if (count < 2) {
        out.push(null)
        continue
      }
      const a = rows[start]
      const b = rows[start + 1]
      if (a === undefined || b === undefined) {
        out.push(null)
        continue
      }
      out.push([a + 1, b + 1])
    }
    return out
  }

  // ── 语义入口：update / append（增量执行） ──

  /**
   * Update from the two code texts (before/after an edit): the diff is derived
   * from the passed codes themselves — the engine's persistent ctx is only an
   * execution cache, never the diff authority. Changed statements (paired by
   * positional id, S-2) plus their downstream closure are recomputed in
   * topological order; when nothing changed, the result is assembled from the
   * persistent ctx with zero execution.
   * @param oldCode - the .fai.js source text before the edit.
   * @param newCode - the .fai.js source text after the edit.
   * @param opts - optional execution options.
   * @returns promise resolving to the ExecutionResult.
   * @throws {RuntimeConcurrentError} when another CadRuntime is already executing (C1).
   */
  async update(oldCode: string, newCode: string, opts?: ExecuteOptions): Promise<ExecutionResult> {
    return this.withExecutionLock('update', () => this.updateIncremental(oldCode, newCode, opts))
  }

  // ── 公开：缓存访问 ──

  /**
   * Get the output geometry from the statement cache (keyed by PartName).
   * @param partName - the part name to look up.
   * @returns the cached shape, or undefined.
   */
  getCachedOutput(partName: PartName): Shape | CompoundShape | undefined {
    const entry = this.statementCache.get(partName)
    const out = entry?.output
    // 'defer' 模式：宿主迟取的懒 shape（隐藏终端 / 导入件）在此物化（幂等）。
    // 物化后同步 meshShapeCache，使后续 buildBrepTopology 命中同一份 mesh。
    if (out && typeof out === 'object' && 'positions' in out && isShapeLike(out)) {
      const shape = out as Shape
      if (materializeTessellation(shape)) {
        this.brepChain?.meshShapeCache?.set(partName, shape[BREP_TESS] as BrepMeshResult)
        // content key 现在基于真实 mesh，回写 statementCache（与 collectDirectResult 同口径）
        if (entry && shape.positions instanceof Float32Array && shape.indices instanceof Uint32Array) {
          this.statementCache.set(partName, {
            statementKey: entry.statementKey,
            outputContentKey: computeContentKey(shape.positions, shape.indices),
            output: shape,
          })
        }
      }
    }
    return out
  }

  /**
   * Get a statement cache's full entry (statementKey / outputContentKey / output;
   * used by tests and host diagnostics).
   * @param partName - the part name to look up.
   * @returns the cached entry, or undefined.
   */
  getStatementCacheEntry(
    partName: PartName,
  ): { statementKey: string; outputContentKey: string; output: Shape | CompoundShape } | undefined {
    return this.statementCache.get(partName)
  }

  /**
   * Write an entry into the statement cache (keyed by PartName).
   * @param partName - the part name to store under.
   * @param _stmt - unused (T5: direct path has no StatementIR).
   * @param output - the shape output.
   * @param outputContentKey - the output's content key.
   */
  writeToStatementCache(
    partName: PartName,
    _stmt: unknown,
    output: Shape | CompoundShape,
    outputContentKey: string,
  ): void {
    this.statementCache.set(partName, {
      statementKey: `direct:${String(partName)}`,
      outputContentKey,
      output,
    })
  }

  /** 清除语句缓存（含 statementCache + DirectExecutor ctx 变量） */
  clearStatementCache(): void {
    this.statementCache.clear()
    this.directExecutor.reset()
  }

  // ── 公开：拓扑数据缓存 ──

  /**
   * Write an entry into the topology data cache. Hosts call this after a
   * successful BREP execution (building source='brep' topology via
   * buildSolidTopologyRuntime), on file load (source='mesh' via
   * buildSelectorRuntime), and on primitive creation (source='primitive' via the
   * primitive topology builder). The topology returned by execute()'s
   * ExecutionResult includes these cached entries.
   * @param partName - the part name to store under.
   * @param source - the topology source (brep/primitive/mesh).
   * @param data - the serialized topology data.
   */
  setTopology(partName: PartName, source: TopologySource, data: SelectorRuntimeData): void {
    this.topologyCache.set(partName, { partName, source, data })
    // §3.6：mesh/primitive 面 hint 快照——从拓扑行提炼写入对应 Shape 槽，
    // op 解析 TopoRef 时经输入 Shape 的命名槽走 geometric-fallback。
    const v = this.directExecutor.getCtxVar(partName)
    if (v && typeof v === 'object') {
      const hints = (data.faces ?? []).map((f) => faceRowToHint(f))
      ensureSlot(v).faceHints = hints
    }
  }

  /**
   * 收编 load op 登记的网格实体句柄 + 近似拓扑（方案 2026-10-01 §3.3）。
   *
   * **顶替防护**：PartName 会被重写（`let a = cad.load({…})` 之后
   * `a = cad.boxBrep(…)`）。登记前必须核对「当前 ctx 变量槽里挂的就是这个句柄」
   * （即 `fromMeshSolid` 确实为**当前**这个输出跑过）——否则会把网格实体身份写到一个
   * BREP 实体上，破坏 `solid`/`meshSolid` 互斥不变量。核不上就整条跳过（旧句柄由
   * 链释放兜底）。
   *
   * @param solids - 待收编的 网格实体句柄（PartName → handle）。
   * @param topologies - 待收编的 近似拓扑数据（PartName → SelectorRuntimeData）。
   */
  private applyPendingMeshSolids(
    solids: Map<PartName, unknown>,
    topologies: Map<PartName, unknown>,
  ): void {
    const de = this.directExecutor
    const accepted = new Set<PartName>()
    for (const [part, handle] of solids) {
      const v = de.getCtxVar(String(part))
      if (!v || typeof v !== 'object') continue
      if (getSlot(v)?.meshSolid !== handle) continue
      this.meshSolidRegistry.set(part, handle as BrepHandle)
      accepted.add(part)
    }
    for (const [part, data] of topologies) {
      if (!accepted.has(part)) continue
      this.setTopology(part, 'mesh', data as SelectorRuntimeData)
    }
  }

  /**
   * Get the topology data for a part.
   * @param partName - the part name to look up.
   * @returns the part topology, or undefined.
   */
  getTopology(partName: PartName): PartTopology | undefined {
    return this.topologyCache.get(partName)
  }

  /**
   * Delete the topology data for a part.
   * @param partName - the part name to delete.
   */
  deleteTopology(partName: PartName): void {
    this.topologyCache.delete(partName)
  }

  /**
   * 网格实体句柄注册表的只读视图（诊断 / 宿主判定用）。
   *
   * 与 `brepChain.solidCache` 平行：宿主想判定"某 part 是不是网格零件"，用
   * `shape.hasMeshSolid(shape)`；想拿句柄做网格语义操作，从这里取。
   * @returns the runtime's mesh solid registry.
   */
  get meshSolids(): MeshSolidRegistry {
    return this.meshSolidRegistry
  }

  /**
   * T3 身份槽同步：写 `solidCache`，并把 shape 自带的**显示 mesh 三角化结果**写入
   * `brepChain.meshShapeCache`（规则 1「一份 mesh」——拓扑只由用户看到的那份 mesh 生成）。
   *
   * shape 的 BREP_TESS 槽缺失（变换类 op、导入存活对象、非 BREP 产物）时**清掉旧键**：
   * 此时旧 mesh 已不对应当前 solid，留着会让 buildBrepTopology 拿"新 solid + 旧 mesh"
   * 错配面行区间；清掉后它回退到兜底三角化（正确但多一次计算）。
   *
   * @param partName 终端变量名（solidCache/meshShapeCache 的键）。
   * @param solid    该 part 当前的 BREP 句柄。
   * @param shape    承载该 solid 的 Shape（可能缺 BREP_TESS 槽）。
   */
  private setSolidAndTess(partName: PartName, solid: BrepHandle, shape?: Shape): void {
    this.solidCache.set(partName, solid)
    const cache = this.brepChain?.meshShapeCache
    if (!cache) return
    const tess = shape?.[BREP_TESS] as BrepMeshResult | undefined
    if (tess) cache.set(partName, tess)
    else cache.delete(partName)
  }

  /**
   * 延迟三角化物化（'defer' 模式，方案 2026-10-21-weapp-tessellation-defer-plan §2）。
   *
   * 在 collectDirectResult 的 statementCache 同步与拓扑构建**之前**调用：对需要消费
   * mesh 的 shape 用**创建时记录的参数**物化（materializeTessellation），并把物化结果
   * 写进 meshShapeCache（PartName 键）——buildBrepTopology 因此命中**显示 mesh 同一份
   * 三角化**（架构红线：拓扑 mesh === 显示 mesh，不做"同参数再算一次"）。
   *
   * 物化集合：
   * - `topoMode:'brep'`（对全部 shape 建拓扑，含中间产物）→ 全部 shape 物化（杜绝
   *   buildSolidTopologyRuntime 兜底三角化：其参数硬编码 2π/32，与显示参数不同源）。
   * - `topoMode:'auto'/'off'` → 只物化**终端**：可见终端必物化（显示 + 拓扑）；
   *   隐藏终端在 'auto' 下物化（拓扑为全部终端构建），在 'off' 下跳过（不显示不建
   *   拓扑，mesh 留空，宿主按需经 getCachedOutput 物化）。
   * - 中间产物（非终端）永不物化——这是 'defer' 的主要收益（face.fai.js 全量执行
   *   三角化次数 ~30 → 13）。
   *
   * 幂等：已物化 shape 的 BREP_LAZY_TESS 已删除，materializeTessellation 直接 no-op；
   * 增量 update 中未变化终端复用上一轮物化结果，本轮零新增三角化。
   *
   * @param terminals    本轮的终端列表（含 hidden 标记）。
   * @param shapeVarNames 全部 shape 变量名（topoMode 'brep' 时全量物化）。
   * @param topoMode     拓扑开关（决定隐藏终端是否物化）。
   */
  private materializeDeferredTessellations(
    terminals: TerminalShape[],
    shapeVarNames: Set<PartName>,
    topoMode: 'auto' | 'brep' | 'off',
  ): void {
    const de = this.directExecutor!
    if (topoMode === 'brep') {
      for (const name of shapeVarNames) {
        const v = de.getCtxVar(String(name))
        if (isShapeLike(v)) this.materializeOne(v as Shape, name)
      }
      return
    }
    const hiddenIds = new Set<PartName>(terminals.filter((t) => t.hidden).map((t) => t.id))
    const terminalIds = new Set<PartName>(terminals.map((t) => t.id))
    for (const name of shapeVarNames) {
      if (!terminalIds.has(name)) continue
      if (topoMode === 'off' && hiddenIds.has(name)) continue
      const v = de.getCtxVar(String(name))
      if (isShapeLike(v)) this.materializeOne(v as Shape, name)
    }
  }

  /** 物化单个 shape 并同步 meshShapeCache（PartName 键）；无延迟描述符时 no-op。 */
  private materializeOne(shape: Shape, partName: PartName): void {
    const brepTess = materializeTessellation(shape)
    if (brepTess) this.brepChain?.meshShapeCache?.set(partName, brepTess)
  }

  /**
   * 从 BREP solid 构建拓扑数据（接口分离 P0）。
   *
   * 宿主不再直接 import faijs 内部构建函数（buildSolidTopologyRuntime），
   * 而是通过此方法从 runtime 获取 BREP 拓扑。
   *
   * 按 PartName 直接查持久 solidCache + brepChain.meshShapeCache（均为 PartName key），
   * 不再需要 scopedId 投影。单一真源：solidCache（PartName → BrepHandle）。
   *
   * @param partName 终端变量名（PartName，在 brepChain.solidCache 中查找）
   * @returns SelectorRuntime，或 null（无可用 BREP solid）
   */
  buildBrepTopology(partName: PartName): SelectorRuntime | null {
    const brepChain = this.brepChain
    if (!brepChain?.kernel) return null

    // partName 即该变量的首输出变量名，按 PartName 查持久 solidCache
    const solid = brepChain.solidCache.get(partName)
    if (solid === undefined) return null

    // 规则 1：优先从 brepChain.meshShapeCache 复用执行链产出的三角化结果
    // （与显示 mesh 完全同一份 mesh，不二次 meshShape）
    const cachedMesh = brepChain.meshShapeCache?.get(partName)
    if (cachedMesh && brepChain.kernel) {
      return buildTopologyFromMesh(brepChain.kernel, solid, cachedMesh)
    }

    // 无缓存（非执行链路径，如 STEP 导入后直接构建拓扑）→ 执行完整构建（含 meshShape 三角化）
    const result: SolidTopologyResult = buildSolidTopologyRuntime(brepChain.kernel, solid)
    return result.runtime
  }

  /**
   * 多零件 compound 终端的合并 BREP 拓扑（见 buildCompoundTopologyRuntime）。
   *
   * 读 compound 的**当前** children（装配变换已把新 solid 写回 child 槽位，
   * brepOf(child) 返回最新句柄——比 buildBrepTopology 读持久 solidCache 更不
   * 会陈旧），按声明序合并为单个 occurrence-aware runtime。
   */
  private buildCompoundBrepTopology(v: CompoundShape): SelectorRuntime | null {
    if (!this.brepChain?.kernel) return null
    const children = (v.children ?? []) as Shape[]
    if (children.length === 0) return null
    return buildCompoundTopologyRuntime(this.brepChain.kernel, children) ?? null
  }

  // ── 公开：dryRun 校验 ──

  /**
   * dryRun：acorn 语法门禁 + 元数据提取（T5 后唯一路径）。
   *
   * extractMetadata 全量解析（语法 + 引用），不查符号表。未知 callee 放行，
   * 试执行见 execute 的 failedAt。
   *
   * @param code .fai.js 文本
   * @returns CheckResult
   */
  check(code: string): CheckResult {
    try {
      const meta = extractMetadata(code, { defaultNs: this.defaultNsName, security: this.securityPolicy, namespaces: Object.keys(this.libs), opDims: this.buildOpDims() })
      const dimWarnings = (meta.dimWarnings ?? []).map((w) => `line ${w.line}: ${w.message}`)
      return {
        ok: true,
        errors: [],
        warnings: dimWarnings,
        script: {
          statements: meta.lines.length,
          callees: meta.lines.map((l) => l.callee),
        },
      }
    } catch (err) {
      if (err instanceof ParseError) {
        const stage = err.code === 'E_SECURITY' ? 'security'
          : err.code === 'E_DIM_BARE_NUMBER' || err.code === 'E_DIM_MISMATCH' || err.code === 'E_DIM_UNKNOWN_UNIT' ? 'dimension'
          : 'parse'
        return {
          ok: false,
          errors: [{ stage, message: err.message, line: err.line, ...(err.code ? { code: err.code } : {}), ...(err.ruleId ? { ruleId: err.ruleId } : {}) }],
          warnings: [],
        }
      }
      return {
        ok: false,
        errors: [{ stage: 'parse', message: err instanceof Error ? err.message : String(err) }],
        warnings: [],
      }
    }
  }

  // ── P0 增量：releasePartCaches / updateIncremental ──

  /**
   * 派生缓存失效（P0-4）：重放前对 `replayKeys`（经 `asPartName()` 转换）逐一清理
   * 所有派生缓存，确保重放后几何/拓扑/mesh 不命中旧值。
   *
   * 清理清单（§4.4）：
   * - `solidCache`：先 `kernel.release(handle)`，再删键（参照 dispose 的 try/catch）；
   * - `brepChain.meshShapeCache`：删键（跨轮保留，不清会返回旧 solid 的三角化）；
   * - `faceEvolutionCache` / `roleTableCache`：删键（与 runtime 同 Map 引用，删键即生效）；
   * - `topologyCache` / `statementCache`：删键（collectDirectResult 按新几何重新填充）。
   */
  private releasePartCaches(partNames: PartName[]): void {
    for (const name of partNames) {
      // solidCache: release OCCT handle first, then delete key
      const handle = this.solidCache.get(name)
      if (handle !== undefined) {
        try { this.kernel?.release(handle) } catch { /* already released */ }
        this.solidCache.delete(name)
      }
      // brepChain.meshShapeCache
      this.brepChain?.meshShapeCache?.delete(name)
      // 网格实体句柄（网格零件）：释放 + 删键（与 solidCache 同语义）
      this.meshSolidRegistry.delete(name)
      // faceEvolutionCache / roleTableCache (same Map refs as runtime's)
      this.faceEvolutionCache.delete(name)
      this.roleTableCache.delete(name)
      // topologyCache / statementCache
      this.topologyCache.delete(name)
      this.statementCache.delete(name)
    }
  }

  /**
   * 前缀重放式 update 增量执行（P0-5）。
   *
   * 流程：
   * 1. 保守闸门 G0–G8 判定——任一命中则退化为全量 `executeDirectText`；
   * 2. 公共前缀扫描定位首个变更行 → 物理行；
   * 3. `unitRanges(newCode)` 映射物理行 → 单元起始行 `startLine`；
   * 4. `releasePartCaches(replayKeys)` 失效派生缓存；
   * 5. `directExecutor.replayFrom(newCode, startLine, opts)` 重放后缀区间；
   * 6. `outcome.failedAt` → 降级全量（§4.7）；
   * 7. `collectDirectResult` 组装结果。
   *
   * @param oldCode - 变更前文本（不信任，G3 校验与内部 accumulatedCode 一致）。
   * @param newCode - 变更后文本。
   * @param opts - 执行选项。
   * @returns ExecutionResult。
   */
  private async updateIncremental(
    oldCode: string,
    newCode: string,
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    const de = this.directExecutor
    this.claimBackends()

    // ── 保守闸门 G0–G8 ──

    // G1: 本实例从未执行过
    if (this.accumulatedCode === null) {
      return this.executeDirectText(newCode, opts, 'first-run')
    }

    // G3: 宿主传入的 oldCode 与内部基准不一致
    if (oldCode.trim() !== this.accumulatedCode.trim()) {
      return this.executeDirectText(newCode, opts, 'old-code-mismatch')
    }

    // 切分行数组（两侧均按 \r?\n 切分）
    const oldLines = this.accumulatedCode.split(/\r?\n/)
    const newLines = newCode.split(/\r?\n/)

    // G2: 存在删除（new 比旧短）
    if (newLines.length < oldLines.length) {
      return this.executeDirectText(newCode, opts, 'lines-decreased')
    }

    // G0: 非标准解析基线
    const { ranges, lineOffset } = de.unitRanges(newCode)
    if (lineOffset !== 0) {
      return this.executeDirectText(newCode, opts, 'non-standard-baseline')
    }

    // G6: params 变化
    const paramsFp = stableFingerprint(opts?.params ?? null)
    if (paramsFp !== this.lastParamsFingerprint) {
      return this.executeDirectText(newCode, opts, 'params-changed')
    }

    // G7: 注册库集合变化
    const libIdsEntries = [...this.libIds.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )
    const libIdsFp = stableFingerprint(libIdsEntries)
    if (libIdsFp !== this.lastLibIdsFingerprint) {
      return this.executeDirectText(newCode, opts, 'libs-changed')
    }

    // G5: 上一轮产生了装配运动学位姿
    if (this.lastHadKinematics) {
      return this.executeDirectText(newCode, opts, 'kinematics')
    }

    // G4: 含相对 import 的多文件场景
    const meta = extractMetadata(newCode, { defaultNs: this.defaultNsName, security: this.securityPolicy, namespaces: Object.keys(this.libs) })
    if ((meta.imports ?? []).some((imp) => isRelativeSpecifier(imp.specifier))) {
      return this.executeDirectText(newCode, opts, 'relative-imports')
    }

    // ── 公共前缀扫描 ──
    // 逐行 trim 比较；空行/纯空白行等价
    let firstDiff = -1
    const maxLen = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxLen; i++) {
      const a = oldLines[i] ?? ''
      const b = newLines[i] ?? ''
      if (a.trim() !== b.trim()) {
        firstDiff = i
        break
      }
    }

    // 零变更路径（§4.6）
    if (firstDiff === -1) {
      return this.zeroChangePath(newCode, meta, opts)
    }

    // ── 映射物理行 → 单元起始行 ──
    const physicalLine = firstDiff + 1
    const adjusted = physicalLine - lineOffset
    let startLine: number | undefined
    // 找包含该行的单元（物理行落在块单元内部 → 块起始行）
    for (const r of ranges) {
      if (r.lineNo <= adjusted && adjusted <= r.endLine) {
        startLine = r.lineNo
        break
      }
    }
    if (startLine === undefined) {
      // 找首个 lineNo > physical 的单元（纯追加场景）
      for (const r of ranges) {
        if (r.lineNo > adjusted) {
          startLine = r.lineNo
          break
        }
      }
    }
    // 映射结果为空（改动只落在末尾注释/空行，其后无任何单元）
    if (startLine === undefined) {
      return this.zeroChangePath(newCode, meta, opts)
    }

    // ── 计算 replayKeys（与 DirectExecutor.replayFrom 同逻辑，用于 releasePartCaches） ──
    const allUnitsParsed = de.unitRangesWithWrites(newCode)
    // ── 前缀污染检测：旧代码的后缀写过、新代码前缀仍要用的键 ─────────────────────
    // 前缀之所以能"保留不跑"，前提是它在**新代码下的值**等于旧前缀跑出来的值。这条
    // 前提会被一种常见写法打破：旧代码在 startLine 之后**改写了一个前缀变量**——
    //   A: [1: `let part0 = cad.box(…)`, 2: `cad.translate(part0, …)`]   ← 裸调用原地写回
    //   B: [1: `let part0 = cad.box(…)`, 2: `let part1 = …`, 3: `let part2 = union(…)`]
    // 第 1 行是新代码的前缀（跳过），可 ctx 里的 part0 已经被 A 的第 2 行平移过 ——
    // 重放出来就是一个**被平移两次 / 平移了但新代码不该平移**的几何（对拍实测错位）。
    // 显式重赋值链（`part0 = cad.translate(part0, …)`）同样中招，不是裸调用独有的。
    //
    // 修法不是"看到污染就全量"，而是把起点回退到**被污染键的 producer 行**：那里重新
    // 算出干净值，其后的行全部重放，增量收益仍然保留（回退量 = 改动点到 producer 的距离）。
    // 找不到 producer（理论上不可能：键写在旧后缀里、又被新前缀写 ⇒ 新前缀有 producer）
    // 时退回全量——报错好于算错。
    const newPrefixWrites = new Set<string>()
    for (const u of allUnitsParsed) {
      if (u.lineNo < startLine) for (const w of u.writes) newPrefixWrites.add(w)
    }
    // 旧的单元表必须按旧文本解析。注意副作用：解析会重建变换期地图（inplaceWrites /
    // fnParams），而这一步之后 replayFrom 还会用新文本再解析一次，所以最终生效的是
    // 新代码那一份 —— 顺序不能反过来。
    const oldUnitsParsed = de.unitRangesWithWrites(this.accumulatedCode)
    const oldSuffixWrites = new Set<string>()
    for (const u of oldUnitsParsed) {
      if (u.lineNo >= startLine) for (const w of u.writes) oldSuffixWrites.add(w)
    }
    const polluted = [...oldSuffixWrites].filter((w) => newPrefixWrites.has(w))
    if (polluted.length > 0) {
      const producerLines: number[] = []
      for (const u of allUnitsParsed) {
        if (u.lineNo >= startLine) continue
        if (u.writes.some((w) => polluted.includes(w))) producerLines.push(u.lineNo)
      }
      if (producerLines.length === 0) {
        return this.executeDirectText(newCode, opts, 'prefix-polluted')
      }
      startLine = Math.min(startLine, ...producerLines)
    }
    const replayUnits = allUnitsParsed.filter((u) => u.lineNo >= startLine)
    const suffixWrites = new Set<string>()
    for (const u of replayUnits) for (const w of u.writes) suffixWrites.add(w)
    const prefixWrites = new Set<string>()
    for (const u of allUnitsParsed) {
      if (u.lineNo < startLine!) for (const w of u.writes) prefixWrites.add(w)
    }
    const replayKeys: string[] = []
    for (const w of suffixWrites) {
      if (!prefixWrites.has(w)) replayKeys.push(w)
    }

    // ── ctx 收敛：新代码不再产出的键必须消失（2026-10-19 切工程缺陷）──────────
    // 重放只跑 `[startLine, ∞)`，**没有任何一步删除旧代码写过、新代码不写的 ctx 键**。
    // 持久 ctx 因此跨工程存活着上一个工程的产出，`collectDirectResult` 扫
    // `listCtxKeys()` 会把它们当 outputs/terminals 带出去：
    //   · 宿主侧表现 1：切换工程后旧工程的零件还留在画面上（旧模型的 mesh 被当终端渲染）；
    //   · 宿主侧表现 2：这些"新代码里没有 producer 行"的变量会污染 live-shapes 的
    //     消费关系，严重时新工程的终端被判定成"已被消费" → 一条终端都不剩（空画面）。
    // 判据用「上一轮代码的写键 − 新代码的写键」，不是 ctx 键全集：params / import
    // seed 由宿主预置、不属任何 code 的 writes，混进来会被误删。
    const newWrites = new Set<string>()
    for (const unit of allUnitsParsed) for (const w of unit.writes) newWrites.add(w)
    const staleKeys = [...de.currentWrittenKeys].filter((key) => !newWrites.has(key))
    if (staleKeys.length > 0) {
      // 先释放派生缓存（solid / topology / statement）再删 ctx：句柄所有权在
      // releasePartCaches，只删 ctx 键会把内核资源留在缓存里。
      this.releasePartCaches(staleKeys.map((key) => asPartName(key)))
      de.deleteCtxVars(staleKeys)
    }

    // ── 派生缓存失效 ──
    this.releasePartCaches(replayKeys.map((k) => asPartName(k)))

    // ── 脚本链偏好：前缀声明核对（cad.useMeshChain） ──
    // 增量重放跳过前缀（其效果由上次执行保留）。useMeshChain 语句本身被改掉/删掉时，
    // 新代码前缀不再声明该偏好 → 清除，否则重放会沿用陈旧的链（新代码已不要求它）。
    // 文本扫描的保守边界：前缀注释里出现同名调用不算声明（偏好不因此被保留）。
    const prefixHasChainDecl = newLines.slice(0, Math.max(0, startLine - 1)).some((l) => l.includes('useMeshChain'))
    if (!prefixHasChainDecl) setChainPreference(null)

    // ── 重放 ──
    // G4 already checked: no relative imports → moduleLoad.seed = {}
    const libLoadFailure = await this.autoLoadLibsFromImports(meta.imports)
    if (libLoadFailure) return libLoadFailure

    const execOpts: DirectExecOpts = {
      params: opts?.params,
      ...(opts?.beforeStatement ? { beforeStatement: opts.beforeStatement } : {}),
      ...(opts?.executionTimeoutMs !== undefined ? { executionTimeoutMs: opts.executionTimeoutMs } : {}),
    }

    // ExecutionLimitError / ParseError / security scan errors propagate
    // (not degraded — only failedAt triggers degradation below)
    const outcome = await de.replayFrom(newCode, startLine, execOpts)

    // ── 失败降级（§4.7）──
    if (outcome.failedAt) {
      de.reset()
      return this.executeDirectText(newCode, opts, 'replay-failed')
    }

    // ── 组装结果 ──
    this.accumulatedCode = newCode
    // skippedUnits 用「全文单元数 − 实际重放数」：块单元的行号可能重复（同一块内
    // 多条语句），所以按 units 长度算，不按行号差算。
    const result = this.collectDirectResult(meta, opts, {
      path: 'incremental',
      startLine,
      replayedUnits: outcome.executedLines.length,
      skippedUnits: Math.max(0, allUnitsParsed.length - outcome.executedLines.length),
    })
    // Record fingerprints after successful execution
    this.recordFingerprints(opts)
    return result
  }

  /**
   * 零变更路径（§4.6）：不执行任何语句，但需重新 collectDirectResult。
   */
  private async zeroChangePath(
    newCode: string,
    meta: UiMetadata,
    opts?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    const de = this.directExecutor
    this.claimBackends()
    this.accumulatedCode = newCode
    const libLoadFailure = await this.autoLoadLibsFromImports(meta.imports)
    if (libLoadFailure) return libLoadFailure
    await this.ensureBrepChain()
    de.clearRoundState()
    // 零变更：一个单元都没执行，全部单元都是复用。
    const totalUnits = de.unitRanges(newCode).ranges.length
    return this.collectDirectResult(meta, opts, {
      path: 'noop',
      reason: 'zero-change',
      replayedUnits: 0,
      skippedUnits: totalUnits,
    })
  }

  /**
   * 记录指纹快照（每次成功执行结束时调用）。
   */
  private recordFingerprints(opts?: ExecuteOptions): void {
    this.lastParamsFingerprint = stableFingerprint(opts?.params ?? null)
    const libIdsEntries = [...this.libIds.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )
    this.lastLibIdsFingerprint = stableFingerprint(libIdsEntries)
    this.lastHadKinematics = this.directExecutor.kinematicsSnapshot.size > 0
  }

  // ── 公开：释放 ──

  /**
   * Dispose the runtime, releasing all acquired OCCT handles and clearing every
   * cache. The instance is unusable afterwards.
   */
  dispose(): void {
    // 所有权在持久 solidCache：释放全部 OCCT handle（§9 决策 2）
    for (const [, handle] of this.solidCache) {
      try { this.kernel?.release(handle) } catch { /* 已释放 */ }
    }
    this.solidCache.clear()
    // 网格实体句柄（独立注册表，与 solidCache 并列）一并释放
    this.meshSolidRegistry.clear()
    this.faceEvolutionCache.clear()
    this.roleTableCache.clear()
    this.statementCache.clear()
    this.topologyCache.clear()
    this.brepChain = null
    this.kernel = null
    this.directExecutor.reset()
  }
}

// ── 工厂函数 ──

import { createApiNamespace } from '../api/api-namespace'

/**
 * Create a CadRuntime with the built-in `cad` namespace auto-registered as the
 * default library.
 *
 * This is the single public `createRuntime` entry point. Hosts get "engine +
 * standard library" in one call. The `cad` binding name is **reserved** —
 * passing `libs.cad` throws (cad is engine-built-in and cannot be overridden).
 * Hosts may still register third-party libraries under any other name.
 *
 * @param ports - the host-injected environment capabilities.
 * @param mode - the execution mode (default 'auto').
 * @param libs - the host-injected library namespaces. Must NOT contain `cad`.
 * @param options - optional runtime options (e.g. `execBackend`, `tessellation`).
 * @returns a new CadRuntime with `cad` registered as the default namespace.
 * @throws if `libs.cad` is present (cad is a reserved binding name).
 */
export function createRuntime(ports: HostPorts, mode?: ExecutionMode, libs?: Record<string, LibNamespace>, options?: CadRuntimeOptions): CadRuntime {
  if (libs && 'cad' in libs) {
    throw new Error(
      'E_CAD_RESERVED: "cad" is an engine-built-in reserved namespace. ' +
      'Hosts cannot override or replace it. Use a different name for your ' +
      'custom library, or omit libs.cad to use the built-in cad namespace.',
    )
  }
  const rt = new CadRuntime(ports, mode, libs, options)
  rt.registerLib('cad', createApiNamespace(), {
    default: true,
    packageName: '@faicad/faijs',
  })
  // Mark `cad` as reserved — any subsequent `registerLib('cad', ...)` from the
  // host will be rejected by the guard at the top of registerLib.
  rt._cadReserved = true
  return rt
}

/**
 * Create a bare CadRuntime without auto-registering the built-in `cad` namespace.
 *
 * For hosts that want a pure engine (e.g. only using the parser / runtime
 * framework with a custom op set). `CadRuntime` itself can also be constructed
 * directly via `new CadRuntime(...)` — this function is the named factory
 * counterpart to avoid creating another same-name variant.
 *
 * @param ports - the host-injected environment capabilities.
 * @param mode - the execution mode (default 'auto').
 * @param libs - the host-injected library namespaces (no cad auto-registration).
 * @param options - optional runtime options.
 * @returns a new CadRuntime without cad registered.
 */
export function createBareRuntime(ports: HostPorts, mode?: ExecutionMode, libs?: Record<string, LibNamespace>, options?: CadRuntimeOptions): CadRuntime {
  if (libs && 'cad' in libs) {
    throw new Error(
      'E_CAD_RESERVED: "cad" is an engine-built-in reserved namespace. ' +
      'Hosts cannot register or override it. Use a different name for your ' +
      'custom library, or use createRuntime() to get the built-in cad namespace.',
    )
  }
  return new CadRuntime(ports, mode, libs, options)
}
