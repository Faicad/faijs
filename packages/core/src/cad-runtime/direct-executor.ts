/**
 * direct-executor — 无 IR 执行器（.fai.js 源码直通 JS VM）
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
 * - keep/keepHidden **只能独立成句**（`a.keep()` / `a.keepHidden()`）：语言层据此登记
 *   声明（metadata.keep），执行层把它变成 no-op——`Shape` 是纯数据接口，照常发射会
 *   `__ctx.a.keep is not a function`。写在 op 参数对象里的写法由语言层直接报
 *   `E_STATEMENT`，执行侧不再有任何"尾随键剥离"（那段代码从来没存在过）；
 * - 顶层函数定义提升到 `__ctx.<name>`（函数体 cad 等经命名空间绑定注入；函数体
 *   引用到的顶层变量/函数经 call-time 守卫 + `let { ... } = __ctx` 解构注入——
 *   约束 1：读顶层 call-time 取值，函数体内赋值写本地副本不落顶层）；
 * - import 行不执行（库装载在 runtime 层；`ns.<binding>` 经命名空间对象访问）。
 *
 * 错误定位：单行单元失败记 failedAt（{ index, callee, message } + lineNo）。
 *
 * 本文件是 P2 新增组件；ModuleExecutor 路径（旧）在 P6 门禁前保留双路径共存。
 */

import { parse as acornParse } from 'acorn'
import type { LibNamespace } from '../runtime-state'
import type { PartName } from '../identity'
import { asPartName } from '../identity'
import { ParseError } from '../lang/parse-error'
import { matchKeepStatement } from '../lang/keep-statement'
import { setCurrentStmt, setKeepSink, setName, nameOf, takePendingAssemblyTransforms, takePendingAssemblyKinematics, takePendingDetectedUnits, takePendingMultiPartCounts, takePendingMeshSolids, takePendingMeshTopologies, takePendingImportModels, type AssemblyKinematicsPose, type ExecutionAnchor } from '../runtime-state'
import type { ImportModel } from '../mesh/import-model'
import { getBrepApi } from '../brep/handle-bridge'
import { runtimeLineage } from '../topology/naming/lineage'
import { ExecutionLimitError } from './execution-limit-error'
import { assertSecure, isSafeGlobalIdent, type SecurityPolicy } from '../lang/security-scanner'
import { getSlot, ensureSlot, brepOf, isShape } from '../shape'
import { isMeshShape, type Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { applyTransform } from '../mesh/rigid-transform'
import { applyTransformBrep } from '../brep/brep-ops'
import type { TransformedUnit, ExecBackend, ExecBackendChoice } from './exec-backend'
import { VmBackend } from './exec-backends/vm-backend'
import { InterpBackend } from './exec-backends/interp-backend'

type ASTNode = any

/**
 * 几何值判定（isShape ∨ isMeshShape；与 define-op.isGeometryInput 同构）——
 * 裸调用原地写回（§3.7 规则 2）的运行时守卫：只有「返回值是几何 且 目标原值也是
 * 几何」才写回首参。projectView/volume 等返回纯数据的裸调用天然不写回。
 */
function isGeomValue(v: unknown): boolean {
  return isShape(v) || isMeshShape(v)
}

/**
 * 执行后端解析（静态选定，无运行时回退）。
 */
function resolveExecBackend(choice: ExecBackendChoice): ExecBackend {
  if (choice === 'interpreter') return new InterpBackend()
  return new VmBackend()
}

/**
 * F1（2026-10-15）：标识符提升的**保护区间**——字符串字面量 / 模板文本 / 注释。
 *
 * 根因：hoistBlockText ② 与 hoistText 用文本级 `\b<name>\b` 全局替换做标识符提升，
 * 不区分代码与字符串。for 循环体内与顶层标识符同名的字符串字面量被改写成
 * `__ctx.<name>`（`parent: 'carrier'` → `'__ctx.carrier'`），装配侧按「父级不存在」
 * 静默挂错父级——animation 钉子 `test/p2-child-ref.test.ts:83-105` 的上游根因。
 *
 * 区间来自 acorn AST（ranges 已开）：字符串 Literal 全区间、TemplateLiteral 的
 * quasis（模板**文本**部分；`${…}` 表达式是代码，不保护）、onComment 收集的注释
 * 区间。解析策略与 hoistBlockText 一致（module 直解 → `(function(){ … })` 回退，
 * 放行 break/continue/return）；回退包装的前缀长度逐区间扣减，保持原文本基准。
 * 两轮都解析失败（调用方传入的不是合法 JS 片段，如对象方法简写）时返回空数组
 * = 无保护，维持修复前行为。
 */
function collectHoistProtectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const comments: Array<[number, number]> = []
  const parseOpts = {
    ecmaVersion: 'latest' as const,
    sourceType: 'module' as const,
    locations: false,
    ranges: true,
    onComment: (_block: boolean, _text: string, start: number, end: number): void => {
      comments.push([start, end])
    },
  }
  let ast: ASTNode
  let shift = 0
  try {
    ast = acornParse(text, parseOpts) as unknown as ASTNode
  } catch {
    const wrapped = `(function(){ ${text} })`
    try {
      ast = acornParse(wrapped, parseOpts) as unknown as ASTNode
      shift = '(function(){ '.length
    } catch {
      return []
    }
  }
  const walk = (n: ASTNode): void => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'Literal' && typeof n.value === 'string') {
      ranges.push([n.start - shift, n.end - shift])
    } else if (n.type === 'TemplateLiteral') {
      for (const q of n.quasis ?? []) {
        if (typeof q?.start === 'number' && typeof q?.end === 'number') {
          ranges.push([q.start - shift, q.end - shift])
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'parent' || k === 'type') continue
      const v = n[k]
      if (Array.isArray(v)) for (const item of v) walk(item)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(ast)
  for (const [s, e] of comments) ranges.push([s - shift, e - shift])
  return ranges
}

/**
 * F1：带保护区间的顺序文本替换（标识符 / 命名空间提升专用）。
 *
 * `subs` 每条 { re, emit } 依次作用于 text（后者看到前者的输出，与既有顺序替换
 * 语义一致）；匹配整体落在保护区间（字符串 / 模板文本 / 注释）内时原样保留。
 * 保护区间按**当前** text 重算（前一条 sub 会改变偏移），text 未变时复用。
 * 无保护区间（解析失败）时退化为普通替换——与修复前完全一致。
 *
 * `re` 必须带 `g` 标志；`emit(groups)` 接收捕获组（$1 起），返回替换文本。
 */
function replaceOutsideProtected(
  text: string,
  subs: ReadonlyArray<{ re: RegExp; emit: (groups: string[]) => string }>,
): string {
  let out = text
  let ranges: Array<[number, number]> = []
  let rangesFor: string | null = null
  for (const sub of subs) {
    if (!sub.re.global) throw new Error('replaceOutsideProtected: sub.re must carry the g flag')
    if (rangesFor !== out) {
      ranges = collectHoistProtectedRanges(out)
      rangesFor = out
    }
    const rr = ranges
    out = out.replace(sub.re, (...args: unknown[]) => {
      const match = args[0] as string
      const groups = args.slice(1, -2) as string[]
      const offset = args[args.length - 2] as number
      for (const [s, e] of rr) {
        if (offset >= s && offset + match.length <= e) return match
      }
      return sub.emit(groups)
    })
  }
  return out
}

// ── Namespaces ──

/**
 * 已装配的命名空间集合（标准库 `cad` + 宿主注册的库）。
 * DirectExecutor 经 ns.<binding>.<callee>() 调用——引擎不区分函数来自哪个库。
 */
export interface Namespaces {
  readonly cad: LibNamespace
  readonly [binding: string]: LibNamespace
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
  /**
   * 原地写回登记（P25 §3.7.4 规则 2）：裸调用行 → 写回目标变量名。
   * 修改类裸调用（fai_drill(part0) 等）把结果写回首参——computeLiveShapes 用它
   * 做 producer 精确化（行号键，与 blockOutputs 同形态）。
   */
  inplaceWrites?: Map<number, string>
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

/** 单元行区间（P0 增量用：unitRanges 返回值）。 */
export interface UnitRange { lineNo: number; endLine: number }

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
   * `shape` 为承载该 solid 的 Shape：其内部 BREP_TESS 槽携带**显示 mesh 的那份**
   * 三角化结果，runtime 据此写 brepChain.meshShapeCache（规则 1「一份 mesh」）。
   * 变换类 op 不传（或传的 shape 无该槽）时，runtime 会清掉该 part 的旧缓存，
   * 避免"新 solid + 旧 mesh"错配。
   */
  setSolid?: (partName: PartName, solid: BrepHandle, shape?: Shape) => void
  /** 身份槽 → faceEvolutionCache 同步（T3；与 ModuleExecutor.setFaceEvolution 同语义）。 */
  setFaceEvolution?: (partName: PartName, evo: unknown) => void
  /** 身份槽 → roleTableCache 同步（T3；与 ModuleExecutor.setRoleTable 同语义）。 */
  setRoleTable?: (partName: PartName, roleTable: unknown) => void
  /** 安全策略档位（A2 接入点：parseAndTransform 第一行过 Scanner；缺省 'strict'） */
  security?: SecurityPolicy
  /**
   * 执行后端（静态选定，无运行时回退；缺省 'vm'）。'interpreter' 在禁 eval
   * 环境（weapp / 严格 CSP）使用。
   */
  execBackend?: ExecBackendChoice
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
  /** 安全策略档位（A2 接入点用） */
  private readonly securityPolicy: SecurityPolicy
  /** T3：身份槽同步钩子（runtime 注入） */
  private readonly setSolidHook?: (partName: PartName, solid: BrepHandle, shape?: Shape) => void
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
  /** 文件声明单位（load op 登记，PartName → UnitName），collectDirectResult 消费。 */
  private detectedUnitsOut = new Map<PartName, string>()
  /** 多零件降级零件数（load op 登记，PartName → count，§5.4），collectDirectResult 消费。 */
  private multiPartCountOut = new Map<PartName, number>()
  /** 网格实体句柄（load op 登记，PartName → handle，方案 2026-10-01 §3.3），collectDirectResult 消费。 */
  private meshSolidOut = new Map<PartName, unknown>()
  /** 近似拓扑数据（load op 登记，PartName → SelectorRuntimeData），collectDirectResult 消费。 */
  private meshTopologyOut = new Map<PartName, unknown>()
  /** 导入模型结构（load op 登记，PartName → ImportModel，方案 2026-10-06 §5.5），collectDirectResult 消费。 */
  private importModelsOut = new Map<PartName, ImportModel>()
  /**
   * 当前 code **产出的 ctx 键**（= 全部单元的 writes 并集，纯由代码文本决定）。
   *
   * 为什么需要它（2026-10-19 切工程双缺陷）：`replayFrom` 只重放 `[startLine, ∞)`
   * 的单元，**没有任何一步会删掉"旧代码写过、新代码不再写"的 ctx 键**。于是切换
   * 工程后旧工程的变量还活在持久 ctx 里 —— `collectDirectResult` 扫 `listCtxKeys()`
   * 会把它们当成 outputs/terminals 带出去（旧工程的模型留在场景树上），而且
   * 这些"没有 producer 行"的变量在 live-shapes 判定里还会干扰终端的消费关系。
   *
   * 判据是代码文本而不是"上一轮执行过什么"：全量执行 = 全文 writes，重放 = 前缀
   * writes ∪ 重放 writes，两者相同 —— 增量与全量因此天然对齐（对拍口径）。
   */
  private writtenKeys = new Set<string>()
  /** 执行后端（静态选定；缺省 vm） */
  private readonly execBackend: ExecBackend

  /** P3：读取装配运动副位姿快照（collectDirectResult 用；空 Map 表示无 joints）。 */
  get kinematicsSnapshot(): Map<PartName, AssemblyKinematicsPose> {
    return this.kinematicsOut
  }

  /** 文件声明单位快照（load op 语句执行后取走；空 Map 表示本批次无 load）。 */
  get detectedUnitsSnapshot(): Map<PartName, string> {
    return this.detectedUnitsOut
  }

  /** 多零件降级零件数快照（load op 语句执行后取走；空 Map 表示无多零件降级）。 */
  get multiPartCountSnapshot(): Map<PartName, number> {
    return this.multiPartCountOut
  }

  /** 网格实体句柄快照（load op 登记；PartName → handle）。 */
  get meshSolidSnapshot(): Map<PartName, unknown> {
    return this.meshSolidOut
  }

  /** 近似拓扑数据快照（load op 登记；PartName → SelectorRuntimeData）。 */
  get meshTopologySnapshot(): Map<PartName, unknown> {
    return this.meshTopologyOut
  }

  /** 导入模型结构快照（load op 登记；PartName → ImportModel）。 */
  get importModelsSnapshot(): Map<PartName, ImportModel> {
    return this.importModelsOut
  }

  constructor(options: DirectExecutorOptions) {
    this.namespaces = options.namespaces
    this.setSolidHook = options.setSolid
    this.setFaceEvolutionHook = options.setFaceEvolution
    this.setRoleTableHook = options.setRoleTable
    this.securityPolicy = options.security ?? 'strict'
    this.execBackend = resolveExecBackend(options.execBackend ?? 'vm')
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

  /**
   * 解析 code 的单元行区间与行偏移（P0 增量用：公共前缀扫描 → 单元行映射）。
   * 复用 `parseAndTransform` 的解析路径（含 `assertSecure`）。调用方据此
   * 将物理行号映射到单元起始行，再交给 `replayFrom`。
   * @param code - .fai.js 源码文本。
   * @returns `{ ranges, lineOffset }`：ranges = 每个单元的闭区间 `[lineNo, endLine]`；
   *   lineOffset = parseBody 得到的行偏移（非标准解析基线时 ≠ 0）。
   */
  unitRanges(code: string): { ranges: UnitRange[]; lineOffset: number } {
    const { nodes, lineOffset, parseText } = this.parseBody(code)
    const declared = new Set<string>()
    const ranges: UnitRange[] = []
    for (const node of nodes) {
      if (node.type === 'ImportDeclaration') continue
      const rawLine = (node?.loc?.start?.line ?? 1) - lineOffset
      // 仅取行区间（lineNo/endLine），注入内容不消费——候选全集传空集即可。
      const unit = this.transformTopNode(node, parseText, declared, rawLine, lineOffset, new Set<string>())
      if (unit) ranges.push({ lineNo: unit.lineNo, endLine: unit.endLine })
    }
    return { ranges, lineOffset }
  }

  /**
   * 解析 code 的全部单元（含 writes），供增量 replayKeys 计算（P0-5）。
   * 复用 `parseAndTransform` 的解析路径（含 `assertSecure`）。
   * @param code - .fai.js 源码文本。
   * @returns 每个单元的 `{ lineNo, endLine, writes }`。
   */
  unitRangesWithWrites(code: string): Array<{ lineNo: number; endLine: number; writes: string[] }> {
    const units = this.parseAndTransform(code)
    return units.map((u) => ({ lineNo: u.lineNo, endLine: u.endLine, writes: u.writes }))
  }

  /** 块单元产出登记（T1/A-6）：shape 名 → 块起始行号；execute 前后 ctx diff 生成。 */
  private blockOutputs = new Map<string, number>()

  /** 原地写回登记（P25 §3.7.4 规则 2）：裸调用行 → 写回目标变量名（行号键）。 */
  private readonly inplaceWrites = new Map<number, string>()

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
    this.inplaceWrites.clear()
    this.writtenKeys.clear()
  }

  /**
   * 本代码产出的 ctx 键（全部单元 writes 的并集）。
   * @returns 只读集合；增量路径据此删除"新代码不再产出"的旧键。
   */
  get currentWrittenKeys(): ReadonlySet<string> {
    return this.writtenKeys
  }

  /**
   * 删除 ctx 变量（增量路径的 stale 键收敛用）。
   *
   * 只删"执行器自己写进去的"键；params / import seed 不在 writtenKeys 里，调用方
   * 只会传 stale 键，因此不会误删宿主预置量。函数形参表一并清 —— 同一个变量名当
   * 函数用过又消失时，残留的形参表会让下一次同名调用按旧 ABI 解包实参。
   * @param keys - 待删除的变量名。
   */
  deleteCtxVars(keys: readonly string[]): void {
    for (const key of keys) {
      delete this.ctx[key]
      this.fnParams.delete(key)
      this.writtenKeys.delete(key)
    }
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

  /**
   * 前缀重放（P0 增量核心）：保留 `[1, startLine)` 的 ctx 与状态不变，
   * 从 `startLine` 开始重放到末尾。调用方需先用 `unitRanges` 做行映射
   * 并通过 G0 闸门（`lineOffset === 0`）。
   *
   * 步骤（§4.3）：
   * 1. 解析全部单元（含安全扫描）；
   * 2. `replayUnits = units.filter(u => u.lineNo >= startLine)`；
   * 3. 计算待清键 `replayKeys = suffixWrites − prefixWrites`（减去前缀写入键
   *    是正确性要求——重赋值链中前缀产出不能被删）；
   * 4. 清理重放区间相关状态（executedLines / keepByLine / blockOutputs / changedSet /
   *    kinematicsOut / ctx replayKeys / fullCode）；
   * 5. `runCode(code, opts, units)`——传入已解析 units 避免重复解析与重复安全扫描。
   *
   * `ExecutionLimitError` / `ParseError` / 安全扫描异常一律原样上抛，
   * 不触发失败降级；只有 `outcome.failedAt` 才由调用方降级（§4.7）。
   * @param code - 变更后的完整 .fai.js 源码文本。
   * @param startLine - 重放起始单元行号（含）。
   * @param opts - 执行参数。
   * @returns 执行产出。
   */
  async replayFrom(code: string, startLine: number, opts?: DirectExecOpts): Promise<DirectExecOutcome> {
    // 1. 解析全部单元（安全扫描对全文执行一次）
    const units = this.parseAndTransform(code)

    // 2. 区分前缀/后缀单元
    const replayUnits = units.filter((u) => u.lineNo >= startLine)

    // 3. 计算待清键
    const suffixWrites = new Set<string>()
    for (const u of replayUnits) for (const w of u.writes) suffixWrites.add(w)
    const prefixWrites = new Set<string>()
    for (const u of units) {
      if (u.lineNo < startLine) for (const w of u.writes) prefixWrites.add(w)
    }
    const replayKeys: string[] = []
    for (const w of suffixWrites) {
      if (!prefixWrites.has(w)) replayKeys.push(w)
    }

    // 4. 清理重放区间相关状态
    // 4a. executedLines 删除 >= startLine 的行
    for (const line of [...this.executedLines]) {
      if (line >= startLine) this.executedLines.delete(line)
    }
    // 4b. keepByLine 删除 >= startLine 的登记
    for (const line of [...this.keepByLine.keys()]) {
      if (line >= startLine) this.keepByLine.delete(line)
    }
    // 4c. blockOutputs 删除值 >= startLine 的条目
    for (const [key, line] of [...this.blockOutputs]) {
      if (line >= startLine) this.blockOutputs.delete(key)
    }
    // 4d. clearRoundState: changedSet + kinematicsOut
    this.clearRoundState()
    // 4e. ctx 删除 replayKeys 中的键
    for (const key of replayKeys) {
      delete this.ctx[key]
    }
    // 4f. fullCode 更新
    this.fullCode = code

    // 5. runCode（传入已解析 units 避免重复解析）
    return this.runCode(code, opts, units)
  }

  /**
   * 清空轮次状态（P0 增量用）：`changedSet` + `kinematicsOut`。
   * 在增量重放前调用，避免上一轮的 `changed` / kinematics 拗留被带入本轮结果。
   * 零变更路径（§4.6）也需调用——否则会把上一轮的 `changed` 原样带回。
   */
  clearRoundState(): void {
    this.changedSet.clear()
    this.kinematicsOut.clear()
  }

  // ── 主流程 ──

  private async runCode(code: string, opts?: DirectExecOpts, preParsedUnits?: TransformedUnit[]): Promise<DirectExecOutcome> {
    // §1.4/1.5 lineage: a fresh program execution owns a fresh blood-line graph.
    // Clearing here (not in execute/append/update individually) keeps every
    // runCode — including append/update replays of the full code — self-contained,
    // so N3 never misfires on an edited statement from a prior run.
    runtimeLineage.clear()
    // import 预置（§4.5：顶层 import 行不执行，绑定值先入 ctx），随后参数预置可覆盖
    for (const [k, v] of Object.entries(opts?.imports ?? {})) this.ctx[k] = v
    // 参数预置（ExecuteOptions.params → ctx；参数行不执行，与现状语义一致）
    for (const [k, v] of Object.entries(opts?.params ?? {})) this.ctx[k] = v

    // keep 登记 sink（函数体 exec.keep / exec.keepHidden 执行期登记 → 行号键表；
    // 替代 ModuleExecutor.internalKeep 的 StmtId 键——DirectExecutor 无语句模型）
    setKeepSink((_stmtId, names, hidden) => this.registerKeepByLine(names, hidden))
    try {
      // params/imports 预置键作为安全扫描器的 knownNames（避免 SEC_FREE_IDENT 误杀）
      const extraKnown = [
        ...Object.keys(opts?.params ?? {}),
        ...Object.keys(opts?.imports ?? {}),
        ...Object.keys(this.ctx), // append 场景：已执行产出变量名
      ]
      const units = preParsedUnits ?? this.parseAndTransform(code, extraKnown)
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
                  if (bslot?.solid !== undefined) this.setSolidHook?.(asPartName(key), bslot.solid as BrepHandle, bv as Shape)
                  if (bslot?.faceEvolution) this.setFaceEvolutionHook?.(asPartName(key), bslot.faceEvolution)
                  // 1.10 前置③：roleTable 权威落点在血缘图旁挂（part 键）。
                  const btable = runtimeLineage.tableOfPart(asPartName(key))
                  if (btable) this.setRoleTableHook?.(asPartName(key), btable)
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
              if (slot?.solid !== undefined) this.setSolidHook?.(asPartName(w), slot.solid as BrepHandle, v as Shape)
              if (slot?.faceEvolution) this.setFaceEvolutionHook?.(asPartName(w), slot.faceEvolution)
              // 1.10 前置③：roleTable 权威落点在血缘图旁挂（part 键），slot 字段已删。
              const rtable = runtimeLineage.tableOfPart(asPartName(w))
              if (rtable) this.setRoleTableHook?.(asPartName(w), rtable)
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
      // ctx 产出登记（writtenKeys = 本 code 的 writes 并集）：必须在返回结果前刷新，
      // 下一次 update 用它算 stale 键。按 `executedLines` 过滤而不是照抄全部单元：
      //   ① 重放路径里前缀单元"本轮"没执行，但它在上一轮执行过、ctx 里确实有产出，
      //      executedLines 里仍有它的行号 → 不会被漏算；
      //   ② 语句级失败时只算跑到的那几条，不会把没执行的单元的写键谎报成"ctx 里有"，
      //      否则下一次 update 会少删真正的 stale 键。
      this.writtenKeys.clear()
      for (const unit of units) {
        if (!this.executedLines.has(unit.lineNo)) continue
        for (const w of unit.writes) this.writtenKeys.add(w)
      }
      return {
        ctxKeys: Object.keys(this.ctx),
        failedAt,
        executedLines,
        blockOutputs: this.blockOutputs,
        inplaceWrites: this.inplaceWrites,
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
    // 预检：跳过安全扫描（append 场景由 runtime 层先做 missingPrefixVar，再做 A1 安全扫描）。
    const units = this.parseAndTransform(fullCode, undefined, true)
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
    // 引擎未初始化（纯 mesh 装配场景）→ kernel null，仅做 mesh 顶点烘焙。
    let kernel: BrepEngineApi | null = null
    try { kernel = getBrepApi() } catch { /* no engine -> mesh-only bake */ }
    for (const { compound, transforms } of pending) {
      const behavior = getSlot(compound)?.behavior as { memberNames?: string[] } | undefined
      if (!behavior?.memberNames) continue
      const children = (compound as { children?: Shape[] }).children ?? []
      const memberNames = behavior.memberNames
      for (const t of transforms) {
        const member = children[t.index]
        const name = memberNames[t.index]
        if (!member || typeof member !== 'object') continue
        // 变量名 = solidCache/faceEvolutionCache 的键（语句产出时 setName 登记，与
        // 逐单元 setSolid 同步同源）。装配 memberNames 是 CadQuery 风格的短名
        // （约束 DSL 引用用），不能当缓存键用——否则更新写空、变量名键仍指向
        // 已 release 的悬空句柄（导出阶段 buildBrepTopology → INVALID_SHAPE_ID）。
        const varName = nameOf(member) as string | undefined
        // mesh 原地变换（保留同一对象引用，ctx 与 compound.children 同步看到变更）
        Object.assign(member, applyTransform(member, t.quaternion, t.pivot, t.translation, t.rotationMatrix))
        // BREP 刚体变换（可选）：新 solid 写身份槽 + solidCache（T3）
        const solid = brepOf(member) as BrepHandle | undefined
        if (kernel && solid) {
          const transformed = applyTransformBrep(kernel, solid, t.quaternion, t.pivot, t.translation)
          try { kernel.release(solid) } catch { /* 已释放 */ }
          ensureSlot(member).solid = transformed
          const cacheKey = varName ?? name
          if (cacheKey) this.setSolidHook?.(asPartName(cacheKey), transformed)
        }
        // changed 以变量名键登记（宿主按变量名刷新 statementCache/场景）；成员名
        // 不同时也保留，兼容按成员名消费位姿的宿主（P3 kinematics 语义不变）。
        if (name) this.changedSet.add(name)
        if (varName && varName !== name) this.changedSet.add(varName)
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

  /** 单单元执行：委托注入的执行后端（锚点/keep-sink 在调用前设置）。 */
  private async runUnit(unit: TransformedUnit): Promise<void> {
    // 执行锚点：库函数体 exec.keep / primitive 命名读 getCurrentStmt()?.outputs
    // ——用 ExecutionAnchor 轻量锚点（行号 + 写键）。
    const anchor: ExecutionAnchor = {
      id: `s${unit.lineNo}`,
      outputs: unit.writes.map((w) => w as PartName),
      hasAssignment: unit.writes.length > 0,
    }
    setCurrentStmt(anchor)
    try {
      await this.execBackend.runUnit(unit, {
        ctx: this.ctx,
        namespaces: this.namespaces,
        isGeom: isGeomValue,
      })
    } finally {
      setCurrentStmt(undefined)
      // 文件声明单位（load op 登记的 pending 元数据）按本语句收编。
      const pendingUnits = takePendingDetectedUnits()
      for (const [part, unit] of pendingUnits) {
        this.detectedUnitsOut.set(part, unit)
      }
      // 多零件降级零件数（load op 登记的 pending 元数据，§5.4）按本语句收编。
      const pendingMulti = takePendingMultiPartCounts()
      for (const [part, count] of pendingMulti) {
        this.multiPartCountOut.set(part, count)
      }
      // 网格实体句柄 + 近似拓扑（load op 登记，方案 2026-10-01 §3.3）按本语句收编。
      // 句柄进 MeshSolidRegistry（runtime 侧）、拓扑进 topologyCache —— 由
      // collectDirectResult 落位（它持有 registry 与 ctx）。
      for (const [part, solid] of takePendingMeshSolids()) {
        this.meshSolidOut.set(part, solid)
      }
      for (const [part, data] of takePendingMeshTopologies()) {
        this.meshTopologyOut.set(part, data)
      }
      // 导入模型结构（load op 登记，方案 2026-10-06 §5.5）按本语句收编。
      for (const [part, model] of takePendingImportModels()) {
        this.importModelsOut.set(part, model)
      }
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
  private parseAndTransform(code: string, extraKnownNames?: string[], skipSecurity = false): TransformedUnit[] {
    // A2：安全门禁前置——在 parseBody 之前对原始 code 扫描。
    // extraKnownNames = params/imports 预置键 + ctx 已有键（append 场景）。
    // skipSecurity = true 仅用于 missingPrefixVar 预检（append 场景：先 prefix 校验，再 A1 安全扫描）。
    if (!skipSecurity) {
      const nsNames = Object.keys(this.namespaces).filter((k) => k !== 'contractVersion')
      const knownNames = extraKnownNames ? [...nsNames, ...extraKnownNames] : nsNames
      assertSecure(code, {
        policy: this.securityPolicy,
        knownNames,
        // S7 只保护命名空间名，不保护 ctx 中的普通变量（如 let bp = ...）
        nsNames,
        defaultNs: 'cad',
      })
    }
    const { nodes, lineOffset, parseText } = this.parseBody(code)
    // ── 变换期状态是"代码文本的纯函数"：解析前必须重建，不能累加 ──────────────
    // `inplaceWrites`（裸调用原地写回，行号键）与 `fnParams`（本机函数形参表）都在
    // transformTopNode/transformFunction 里 set，从不被 reset —— 唯一的清理点是
    // `reset()`（只跑在全量执行）。于是增量重放会留下**旧代码同一行号**的登记：
    //   · 旧代码第 2 行是 `cad.translate(part0, …)`（原地写回 part0），新代码第 2 行
    //     是 `let part1 = …`；残留的 inplaceWrites[2]=part0 会让 live-shapes 把
    //     part0 的 producer 认成第 2 行，与全量执行的结果不一致（对拍实测：几何错位）。
    //   · 旧代码的函数在新代码里消失后，同名调用若再出现会按旧形参表解包实参。
    // 两者都只由 code 决定，所以"先清后建"既正确又幂等（unitRanges /
    // unitRangesWithWrites / replayFrom 会反复解析同一份文本）。
    this.inplaceWrites.clear()
    this.fnParams.clear()
    const declared = new Set<string>() // 累积：参数名 + outputs + 函数名
    // 约束 1：函数体外层引用注入的候选全集（逐语句变换前一次预扫）。
    // 不能用逐语句累积的 declared——函数定义在顶层声明之前（前向引用）时该名
    // 尚未入集 → 漏注入 → vm 调用失败而 interp call-time 查 ctx 成功 → 双后端分叉。
    const allCtxNames = this.collectAllCtxNames(nodes)
    const units: TransformedUnit[] = []
    const seenLines = new Set<number>()
    for (const node of nodes) {
      if (node.type === 'ImportDeclaration') continue // import 行不执行
      const rawLine = (node?.loc?.start?.line ?? 1) - lineOffset
      if (seenLines.has(rawLine)) {
        throw new ParseError(
          `multiple statements on line ${rawLine}: faijs requires one statement per line (use newline instead of ';')`,
          rawLine,
          'E_SYNTAX',
        )
      }
      seenLines.add(rawLine)
      const unit = this.transformTopNode(node, parseText, declared, rawLine, lineOffset, allCtxNames)
      if (unit) units.push(unit)
    }
    return units
  }

  /**
   * 约束 1 候选全集预扫：本脚本全部声明名（含块内声明——vm 的块单元经
   * hoistBlockText 把块内 let/const/function 提升写 ctx，interp 的 root env
   * 块级写入同样落 ctx）∪ 现有 ctx 键（params/imports 预置键 + append 场景
   * 先前执行产出）。不下潜函数体——函数局部量永不入 ctx。
   * 命名空间名从候选剔除（函数体的 ns 绑定由 transformFunction 的 binds 提供）。
   */
  private collectAllCtxNames(nodes: ASTNode[]): Set<string> {
    const names = new Set<string>(Object.keys(this.ctx))
    const walk = (n: ASTNode): void => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'VariableDeclarator') {
        this.collectPatternNames(n.id, names)
      } else if (n.type === 'FunctionDeclaration') {
        if (n.id?.type === 'Identifier') names.add(n.id.name)
        return // 函数体内声明是函数局部量，不入 ctx
      } else if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
        return // 函数表达式/箭头函数体同样不下潜
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'parent' || k === 'type') continue
        const v = n[k]
        if (Array.isArray(v)) for (const item of v) walk(item)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    for (const node of nodes) walk(node)
    for (const k of Object.keys(this.namespaces)) {
      if (k !== 'contractVersion') names.delete(k)
    }
    return names
  }

  /** 解构模式绑定名收集（Identifier / ObjectPattern / ArrayPattern / AssignmentPattern / RestElement）。 */
  private collectPatternNames(pattern: ASTNode, names: Set<string>): void {
    if (!pattern || typeof pattern !== 'object') return
    switch (pattern.type) {
      case 'Identifier':
        names.add(pattern.name)
        return
      case 'ObjectPattern':
        for (const prop of pattern.properties ?? []) {
          if (prop.type === 'Property') this.collectPatternNames(prop.value, names)
          else if (prop.type === 'RestElement') this.collectPatternNames(prop.argument, names)
        }
        return
      case 'ArrayPattern':
        for (const el of pattern.elements ?? []) this.collectPatternNames(el, names)
        return
      case 'AssignmentPattern':
        this.collectPatternNames(pattern.left, names)
        return
      default:
        return
    }
  }

  private transformTopNode(
    node: ASTNode,
    code: string,
    declared: Set<string>,
    lineNo: number,
    lineOffset: number,
    allCtxNames: Set<string>,
  ): TransformedUnit | null {
    let unit: TransformedUnit | null
    switch (node.type) {
      case 'FunctionDeclaration':
        unit = this.transformFunction(node, code, declared, lineNo, allCtxNames)
        break
      case 'VariableDeclaration':
        unit = this.transformVariable(node, code, declared, lineNo)
        break
      case 'ExpressionStatement':
        unit = this.transformExpressionStatement(node, code, declared, lineNo)
        break
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
        unit = this.transformBlock(node, code, declared, lineNo)
        break
      default:
        // 其余控制流/未知节点（ThrowStatement/BreakStatement/ContinueStatement 等）
        // 也按块单元处理——整段文本执行，不分析语义。
        unit = this.transformBlock(node, code, declared, lineNo)
        break
    }
    // 统一填充 endLine（闭区间）——AST node.loc.end.line 是物理行号，减去
    // lineOffset 归一化到与 lineNo 相同的基准。
    if (unit) {
      const endLine = (node.loc?.end?.line ?? lineNo) - lineOffset
      unit.endLine = endLine
      // keep 声明换成 EmptyStatement：interp 后端执行 `unit.node`，而 shape 是纯数据
      // 接口（没有 keep 方法）。vm 后端执行 `unit.body`（已是注释），两后端由此同源。
      unit.node = matchKeepStatement(node?.expression) ? { type: 'EmptyStatement', loc: node.loc } : node
    }
    return unit
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
    return { lineNo, body, writes, refs: [], isBlock: true, endLine: 0 }
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
   * 再做文本替换（⓪ for-of 头 ① 声明 LHS ② 自由引用 ③ 命名空间绑定），全部经
   * replaceOutsideProtected 跳过字符串 / 模板文本 / 注释区间（F1，2026-10-15）。
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

    // ⓪ for-of/in 头部声明 + ① 声明 LHS 改写 + ② 自由引用提升 + ③ 命名空间绑定：
    // 统一走 replaceOutsideProtected（F1）——落在字符串 / 模板文本 / 注释区间内的
    // 匹配原样保留。修复前循环体内 `parent: 'carrier'` 被改写成 `'__ctx.carrier'`，
    // 装配侧静默挂错父级（animation 钉子 test/p2-child-ref.test.ts:83-105）。
    const subs: Array<{ re: RegExp; emit: (groups: string[]) => string }> = [
      // ⓪ for-of/in 头部声明：`for (const x of/in ...)` → `for (__ctx.x of/in ...)`。
      //    ① 的 `\w+\s*=` 形态匹配不到 of/in 头部，若不先行改写，② 会把声明名
      //    提升为 `const __ctx.x` → SyntaxError。双前缀由下方修正兜底。
      {
        re: /\bfor\s*\(\s*(?:const|let)\s+(\w+)\s+(of|in)\b/g,
        emit: (g) => `for (__ctx.${g[0]} ${g[1]} `,
      },
      // ① const/let x = ... → __ctx.x = ...（去关键字 + LHS 加 __ctx.）
      { re: /\b(?:const|let)\s+(\w+)\s*=/g, emit: (g) => `__ctx.${g[0]} =` },
    ]
    // ② 自由引用提升（与 hoistText 同逻辑，但含块内声明名；排除命名空间名）。
    //    合并为单趟交替替换：插入的 `__ctx.` 前缀不会让其它名字被二次匹配
    //    （`_`/`.` 都是词边界断点），与逐名顺序替换等价。
    if (names.size > 0) {
      subs.push({
        re: new RegExp(`\\b(${[...names].join('|')})\\b`, 'g'),
        emit: (g) => `__ctx.${g[0]}`,
      })
    }
    // ③ 命名空间名 → __ns.<name> + await 调用
    if (nsNames.size > 0) {
      const alt = [...nsNames].join('|')
      // 调用形态：`cad.box(` → `await __ns.cad.box(`
      subs.push({
        re: new RegExp(`(?<![.\\w])\\b(${alt})\\s*\\.\\s*(\\w+)\\s*\\(`, 'g'),
        emit: (g) => `await __ns.${g[0]}.${g[1]}(`,
      })
      // 裸成员访问（非调用）：`cad.foo` → `__ns.cad.foo`（非调用不加 await）
      subs.push({
        re: new RegExp(`(?<![.\\w])\\b(${alt})\\s*\\.`, 'g'),
        emit: (g) => `__ns.${g[0]}.`,
      })
    }
    let out = replaceOutsideProtected(text, subs)
    // __ctx.__ctx.x → __ctx.x（双前缀修正：LHS 改写后 name 又被提升替换）
    out = out.replace(/__ctx\.__ctx\./g, '__ctx.')
    // __ns.__ns.cad → __ns.cad（命名空间双前缀修正）
    out = out.replace(/__ns\.__ns\./g, '__ns.')
    // await await __ns → await __ns（双重 await 修正：块内已有 await 的调用）
    out = out.replace(/await\s+await\s+__ns\./g, 'await __ns.')
    return out
  }

  /** 顶层函数提升：`__ctx.<name> = async function <name>(...) { 命名空间绑定; 外层引用守卫+解构; 体 }`。 */
  private transformFunction(node: ASTNode, code: string, declared: Set<string>, lineNo: number, allCtxNames: Set<string>): TransformedUnit {
    const name = node.id?.name
    if (!name) throw new ParseError('function declaration must have a name', lineNo, 'E_STATEMENT')
    // 形参名单（fnParams / 遮蔽集用）；默认值等非 Identifier 形参不在此列。
    const params = (node.params ?? []).map((p: ASTNode) => p?.name).filter((x: unknown): x is string => typeof x === 'string')
    // 形参保留源文（含默认值表达式）——默认值在 call-time 求值。此前只取 p.name
    // 会把默认值静默剥离（`d = SIZE` 变成 `d`），与 interp 的 E_UNSUPPORTED_SYNTAX
    // 形成静默/报错分叉；保留原文后，默认值引用顶层变量在 call 时 ReferenceError
    // （默认值先于注入解构求值），两后端都失败（constraint 1 差分测试钉住）。
    let paramsText = (node.params ?? []).map((p: ASTNode) => code.slice(p.start, p.end)).join(', ')
    let bodyText = code.slice(node.body.start + 1, node.body.end - 1)
    const nsNames = Object.keys(this.namespaces).filter((k) => k !== 'contractVersion')
    // 约束 1 配套：函数体直接作用域内「返回 Promise 的调用」（顶层本机函数 /
    // 命名空间 op）注入 await——与 emitCall 给顶层调用行加 await 的语义一致。
    // 缺此注入时 vm 对 `fib(n-1) + fib(n-2)` 之类组合运算拿到 Promise（既有缺陷，
    // 旧测试只断言不失败未暴露）；interp 的 evalExpr 原生 await 无此问题。
    // 编辑点分两区：参数默认值（签名区）与函数体（体区），右→左插入保持偏移有效。
    const awaitCalls = this.collectFnAwaitEdits(node, allCtxNames, nsNames)
    awaitCalls.sort((a, b) => b.start - a.start)
    const bodyStart = node.body.start + 1
    const paramsStart = (node.params?.[0]?.start ?? bodyStart)
    for (const c of awaitCalls) {
      if (c.start < bodyStart) {
        const rel = c.start - paramsStart
        paramsText = `${paramsText.slice(0, rel)}await ${paramsText.slice(rel)}`
      } else {
        const rel = c.start - bodyStart
        bodyText = `${bodyText.slice(0, rel)}await ${bodyText.slice(rel)}`
      }
    }
    const binds = nsNames.map((n) => `  const ${n} = __ns.${n}`).join('\n')
    // 约束 1：函数体读顶层变量——把函数体引用到的顶层名注入 call-time 守卫 + let 解构。
    // 读：call-time 取当前值（与 interp 的 ctx 查找同语义，含前向引用）；
    // 写：解构用 let，函数体内赋值写本地副本，不落顶层（与 interp 的 function env
    // assign 写本地 vars 同语义）。
    const outerVars = this.collectFnBodyOuterRefs(node, allCtxNames, params, nsNames)
    const guards = outerVars.map(
      (v) => `  if (!Object.prototype.hasOwnProperty.call(__ctx, '${v}')) throw new ReferenceError('${v} is not defined')`,
    )
    const body = [
      `__ctx.${name} = async function ${name}(${paramsText}) {`,
      binds,
      ...guards,
      ...(outerVars.length > 0 ? [`  let { ${outerVars.join(', ')} } = __ctx`] : []),
      bodyText,
      '}',
    ].join('\n')
    // 本机函数体引用其它本机函数/变量走外层引用注入（call-time 读 __ctx，与顶层一致）
    declared.add(name)
    this.fnParams.set(name, params)
    return { lineNo, body, writes: [name], refs: [], callee: name, endLine: 0 }
  }

  /**
   * 约束 1 配套：收集函数体直接作用域内需要注入 await 的调用节点。
   * 资格：callee 是 Identifier 且属于候选全集（顶层本机函数），或 callee 是
   * MemberExpression 且 object 是命名空间名（cad.box 等）。已显式 await 的调用
   * 不重复注入（其参数里的调用仍递归处理）。不下潜嵌套函数——嵌套 sync function
   * 体内 await 是 SyntaxError，维持既有行为。参数默认值表达式同样覆盖
   * （默认值在 async 函数作用域求值，await 合法）。
   */
  private collectFnAwaitEdits(fnNode: ASTNode, allCtxNames: Set<string>, nsNames: string[]): ASTNode[] {
    const edits: ASTNode[] = []
    const ns = new Set<string>(nsNames)
    const qualifies = (call: ASTNode): boolean => {
      const callee = call.callee
      if (callee?.type === 'Identifier') return allCtxNames.has(callee.name)
      if (callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier') {
        return ns.has(callee.object.name)
      }
      return false
    }
    const walk = (n: ASTNode): void => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
        return
      }
      if (n.type === 'AwaitExpression') {
        // 已显式 await：调用本身不重复注入；实参/实参表达式里的调用仍递归处理
        const arg = n.argument
        if (arg?.type === 'CallExpression') {
          this.walkChildNodes(arg.callee, walk)
          for (const a of arg.arguments ?? []) walk(a)
        } else {
          walk(arg)
        }
        return
      }
      if (n.type === 'CallExpression') {
        if (qualifies(n)) edits.push(n)
        this.walkChildNodes(n.callee, walk)
        for (const a of n.arguments ?? []) walk(a)
        return
      }
      this.walkChildNodes(n, walk)
    }
    const stmts: ASTNode[] = fnNode.body?.type === 'BlockStatement' ? (fnNode.body.body ?? []) : []
    for (const s of stmts) walk(s)
    for (const p of fnNode.params ?? []) walk(p) // 参数默认值表达式（call-time 求值）
    return edits
  }  /** 遍历节点全部子节点（跳过元数据键），逐个交给 walk。 */
  private walkChildNodes(n: ASTNode, walk: (c: ASTNode) => void): void {
    if (!n || typeof n !== 'object') return
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'parent' || k === 'type') continue
      const v = n[k]
      if (Array.isArray(v)) for (const item of v) walk(item)
      else if (v && typeof v === 'object') walk(v)
    }
  }

  /**
   * 约束 1：函数体引用到的顶层名（注入候选）= 候选全集 ∩ 函数体引用集
   * − 本函数作用域遮蔽集 − 命名空间名。
   */
  private collectFnBodyOuterRefs(
    node: ASTNode,
    allCtxNames: Set<string>,
    params: string[],
    nsNames: string[],
  ): string[] {
    const shadow = new Set<string>(params)
    this.collectFnShadowNames(node.body, shadow)
    const referenced = new Set<string>()
    this.collectFnReferences(node.body, referenced)
    const ns = new Set<string>(nsNames)
    return [...referenced]
      .filter((v) => allCtxNames.has(v) && !shadow.has(v) && !ns.has(v))
      .sort()
  }

  /**
   * 本函数「函数作用域」遮蔽集：决定哪些名不注入（函数体内的同名绑定优先于
   * 注入的顶层解构）。收集规则：
   * - 函数体**顶层语句列表**直接声明的 let/const/function 名（函数级作用域）；
   * - 任意块深的 `var` 声明名（var 是函数级；若块内 var 与注入解构同名会
   *   SyntaxError，必须让位）；
   * - 任意块深的 function 声明名（vm 的 new Function 体是 sloppy 模式，块内
   *   function 声明经 Annex B 提升到函数级）；
   * - **不下潜嵌套函数体**：嵌套函数自己的声明只遮蔽它内部，不应阻止外层注入
   *   （否则嵌套函数本地遮蔽会让外层同名顶层引用解析失败）。
   * 块级 let/const 不入遮蔽集：它们是块作用域，与注入的函数级 `let { ... }`
   * 并存是合法遮蔽，语义正确。
   */
  private collectFnShadowNames(body: ASTNode, shadow: Set<string>): void {
    const stmts: ASTNode[] = body?.type === 'BlockStatement' ? (body.body ?? []) : []
    for (const stmt of stmts) {
      if (stmt.type === 'FunctionDeclaration') {
        if (stmt.id?.type === 'Identifier') shadow.add(stmt.id.name)
      } else if (stmt.type === 'VariableDeclaration' && (stmt.kind === 'let' || stmt.kind === 'const')) {
        for (const d of stmt.declarations ?? []) this.collectPatternNames(d.id, shadow)
      }
    }
    const walk = (n: ASTNode): void => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'FunctionDeclaration') {
        if (n.id?.type === 'Identifier') shadow.add(n.id.name)
        return // 不下潜嵌套函数体
      }
      if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') return
      if (n.type === 'VariableDeclaration' && n.kind === 'var') {
        for (const d of n.declarations ?? []) this.collectPatternNames(d.id, shadow)
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'parent' || k === 'type') continue
        const v = n[k]
        if (Array.isArray(v)) for (const item of v) walk(item)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    for (const stmt of stmts) walk(stmt)
  }

  /**
   * 函数体引用位置标识符收集（含嵌套函数体——嵌套函数引用的顶层名注入到外层
   * 函数作用域后经闭包可见）。排除声明/绑定位置与非 computed 成员属性、
   * 非 shorthand 对象键、label。
   */
  private collectFnReferences(n: ASTNode | null | undefined, refs: Set<string>): void {
    if (!n || typeof n !== 'object') return
    switch (n.type) {
      case 'Identifier':
        refs.add(n.name)
        return
      case 'MemberExpression':
        this.collectFnReferences(n.object, refs)
        if (n.computed) this.collectFnReferences(n.property, refs)
        return
      case 'Property':
        // shorthand `{ SIZE }`：key 同时是引用；computed `{ [SIZE]: 1 }`：key 是引用；
        // 普通键 `{ SIZE: 1 }`：key 不是引用。
        if (n.shorthand || n.computed) this.collectFnReferences(n.key, refs)
        this.collectFnReferences(n.value, refs)
        return
      case 'VariableDeclaration':
        for (const d of n.declarations ?? []) {
          this.walkFnPattern(d.id, refs) // 绑定名跳过；模式内默认值是引用
          this.collectFnReferences(d.init, refs)
        }
        return
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        for (const p of n.params ?? []) this.walkFnPattern(p, refs)
        this.collectFnReferences(n.body, refs)
        return
      case 'CatchClause':
        this.walkFnPattern(n.param, refs)
        this.collectFnReferences(n.body, refs)
        return
      case 'ForStatement':
        if (n.init?.type === 'VariableDeclaration') {
          for (const d of n.init.declarations ?? []) {
            this.walkFnPattern(d.id, refs)
            this.collectFnReferences(d.init, refs)
          }
        } else {
          this.collectFnReferences(n.init, refs)
        }
        this.collectFnReferences(n.test, refs)
        this.collectFnReferences(n.update, refs)
        this.collectFnReferences(n.body, refs)
        return
      case 'ForInStatement':
      case 'ForOfStatement':
        if (n.left?.type === 'VariableDeclaration') {
          for (const d of n.left.declarations ?? []) this.walkFnPattern(d.id, refs)
        } else {
          this.walkFnPattern(n.left, refs) // for (x of ...)——左值是赋值目标（引用）
        }
        this.collectFnReferences(n.right, refs)
        this.collectFnReferences(n.body, refs)
        return
      case 'LabeledStatement':
        this.collectFnReferences(n.body, refs)
        return
      case 'BreakStatement':
      case 'ContinueStatement':
        return // label 不是引用
      default:
        for (const k of Object.keys(n)) {
          if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'parent' || k === 'type') continue
          const v = n[k]
          if (Array.isArray(v)) for (const item of v) this.collectFnReferences(item, refs)
          else if (v && typeof v === 'object') this.collectFnReferences(v, refs)
        }
    }
  }

  /** 绑定模式遍历：绑定名跳过；模式内默认值表达式（AssignmentPattern.right）按引用收集。 */
  private walkFnPattern(n: ASTNode | null | undefined, refs: Set<string>): void {
    if (!n || typeof n !== 'object') return
    switch (n.type) {
      case 'Identifier':
        return // 绑定名，不是引用
      case 'AssignmentPattern':
        this.collectFnReferences(n.right, refs)
        this.walkFnPattern(n.left, refs)
        return
      case 'ObjectPattern':
        for (const prop of n.properties ?? []) {
          if (prop.type === 'Property') {
            if (prop.computed) this.collectFnReferences(prop.key, refs)
            this.walkFnPattern(prop.value, refs)
          } else if (prop.type === 'RestElement') {
            this.walkFnPattern(prop.argument, refs)
          }
        }
        return
      case 'ArrayPattern':
        for (const el of n.elements ?? []) this.walkFnPattern(el, refs)
        return
      case 'RestElement':
        this.walkFnPattern(n.argument, refs)
        return
      default:
        this.collectFnReferences(n, refs)
    }
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
      return { lineNo, body, writes: binds, refs: this.collectRefs(init), callee: this.calleeOf(init), endLine: 0 }
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
      return { lineNo, body: `__ctx.${name} = ${call}`, writes: [name], refs: this.collectRefs(init), callee: this.calleeOf(init), endLine: 0 }
    }
    if (init) {
      // 参数行（字面量/数组/对象）或派生常量：AST 变换后写入 ctx。
      // 用 transformArg 而非整段 hoistText——数组/对象/成员/条件/二元里的命名空间
      // 调用与 ctx 引用才能正确发射（约束 2：顶层值表达式不得绕过 AST 变换走上
      // 「文本同构」快路径）。
      const exprText = this.transformArg(init, code, declared, lineNo)
      declared.add(name)
      return { lineNo, body: `__ctx.${name} = ${exprText}`, writes: [name], refs: [], callee: undefined, endLine: 0 }
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
    // keep 独立声明（`a.keep()` / `a.keepHidden()`）：编译期指令，执行期必须是 no-op。
    // 语言层已登记声明（metadata.keep），这里什么都不做——不发射调用、不登记写回。
    if (matchKeepStatement(expr)) {
      return { lineNo, body: '/* keep directive */', writes: [], refs: [], callee: undefined, endLine: 0 }
    }
    if (expr?.type === 'AssignmentExpression' && expr.operator === '=' && expr.left?.type === 'Identifier') {
      const varName = expr.left.name
      if (!declared.has(varName)) throw new ParseError(`unknown variable "${varName}" in re-assignment`, lineNo, 'E_REFERENCE')
      let init = expr.right
      if (init?.type === 'AwaitExpression') init = init.argument
      if (init?.type === 'CallExpression') {
        const call = this.emitCall(init, code, declared, lineNo)
        return { lineNo, body: `__ctx.${varName} = ${call}`, writes: [varName], refs: this.collectRefs(init), callee: this.calleeOf(init), endLine: 0 }
      }
      // 变量→变量重赋值 / 表达式重赋值（`bp = bp2` / `x = a + b`）：合法 JS，
      // 走 AST 变换提升自由标识符写回 ctx（A-15 最后写者语义）。
      const rhsText = this.transformArg(expr.right, code, declared, lineNo)
      return { lineNo, body: `__ctx.${varName} = ${rhsText}`, writes: [varName], refs: [], callee: undefined, endLine: 0 }
    }
    if (expr?.type === 'CallExpression') {
      const call = this.emitCall(expr, code, declared, lineNo)
      // P25 §3.7 规则 2（双语义）：裸调用按返回值区分——只读查询（返回纯数据）
      // 放行不写回；修改类 op（返回几何 且 首位置实参/receiver 是几何变量）写回
      // 第一个 shape 位置实参（或成员 receiver）。静态选出候选写回目标，运行时
      // 双条件守卫兜底（__isGeom(__r) && __isGeom(__ctx.<target>)）——projectView/
      // volume 等返回非几何的调用永不写回。
      const target = this.writebackTarget(expr, declared)
      if (target !== undefined) {
        const body =
          `const __r = await ${call}; ` +
          `if (__isGeom(__r) && __isGeom(__ctx.${target})) __ctx.${target} = __r`
        this.inplaceWrites.set(lineNo, target)
        return { lineNo, body, writes: [target], refs: this.collectRefs(expr), callee: this.calleeOf(expr), endLine: 0 }
      }
      // 命名空间裸调用 / 成员方法 / 本机函数副作用调用：都 await（无写入）
      return { lineNo, body: `await ${call}`, writes: [], refs: this.collectRefs(expr), callee: this.calleeOf(expr), endLine: 0 }
    }
    throw new ParseError('bare expression statements not allowed', lineNo, 'E_STATEMENT')
  }

  /** 调用发射：<ns>.<fn>(args) / <receiver>.<method>(args) / <localFn>(args) → await 形态。 */
  private emitCall(callNode: ASTNode, code: string, declared: Set<string>, lineNo: number): string {    if (callNode?.type !== 'CallExpression') {
      throw new ParseError('expected call expression', lineNo, 'E_STATEMENT')
    }
    const callee = callNode.callee
    let head: string
    if (callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.property?.type === 'Identifier') {
      const objName = callee.object.name
      // 优先 __ctx：本机 shape/模块产物（含 import 预置的 shape 与模块命名空间）都是
      // ctx 键（isMemberOnCtx）或 declared；注册库绑定（cad/第三方 ns）不在 ctx → __ns。
      // 既非 declared/ctx 也非已装配命名空间的成员对象（如 Math）→ 保留裸全局调用，
      // 不误重写为 __ns.<name>（S4 白名单在 vm 包装内自然解析）。
      if (!declared.has(objName) && !this.ctxHas(objName) && !Object.hasOwn(this.namespaces, objName)) {
        const args = this.emitCallArgs(callNode, code, declared, lineNo)
        return `${code.slice(callee.start, callee.end)}(${args.join(', ')})`
      }
      head = declared.has(objName) || this.ctxHas(objName)
        ? `await __ctx.${objName}.${callee.property.name}`
        : `await __ns.${objName}.${callee.property.name}`
    } else if (callee?.type === 'Identifier') {
      if (declared.has(callee.name) || this.hasCtxFn(callee.name)) {
        head = `await __ctx.${callee.name}`
      } else if (isSafeGlobalIdent(callee.name)) {
        // 2026-10-06：免 import 安全全局**函数**（Number / parseInt / parseFloat /
        // isNaN / isFinite / String / Boolean / …）从 globalThis 解析，必须保持裸名调用。
        // 否则会发射成 `await __ctx.Number(...)` → 运行时 "`__ctx.Number` is not a function"。
        head = `await ${callee.name}`
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

  /**
   * 裸调用写回候选目标（P25 §3.7 规则 2 静态选择）：
   * - 成员方法调用 `obj.method(...)`：receiver 是 ctx 对象（declared 或 ctx 键）→ 写回 receiver；
   * - 命名空间/本机函数调用 `cad.op(a0, ...)`：首位置实参是已声明/ctx 标识符 → 写回 a0
   *   （多 shape 参数写回第一个——方案 §3.7.3）；
   * - 其他（首参非简单标识符、receiver 是 __ns 命名空间）→ 无候选（放行不写回）。
   *
   * 静态选择只定「候选」，写回是否真正发生由运行时双条件守卫决定
   * （__isGeom(__r) && __isGeom(__ctx.<target>)）——返回值非几何（projectView/volume）
   * 或目标原值非几何（模块命名空间 receiver）都不写回。
   *
   * @param callNode - 裸调用表达式。
   * @param declared - 已声明变量集（参数名 + 产出 + 函数名）。
   * @returns 写回目标变量名；无候选返回 undefined。
   */
  private writebackTarget(callNode: ASTNode, declared: Set<string>): string | undefined {
    if (callNode?.type !== 'CallExpression') return undefined
    const callee = callNode.callee
    if (callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier') {
      const obj = callee.object.name
      // 成员方法调用（receiver 是 ctx/declared 对象）→ 写回 receiver；命名空间调用
      // （cad.op → __ns）走首位置实参候选（emitCall 同判定：ctx 对象走 __ctx，否则 __ns）。
      if (declared.has(obj) || this.ctxHas(obj)) return obj
    }
    const first = callNode.arguments?.[0]
    if (first?.type === 'Identifier') {
      const name = first.name
      return declared.has(name) || this.ctxHas(name) ? name : undefined
    }
    return undefined
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
      case 'Identifier': {
        // P6/D7 + 2026-10-06：免 import 安全全局（单位常量 MM / INCH / DEGREE / … 以及
        // Math / JSON / Number / Infinity / …）从 globalThis 解析，保持裸名发射；否则会被
        // 写成 `__ctx.Math`（undefined），求值结果静默变错。
        // 已声明变量优先提升为 __ctx.<name>，使同名遮蔽（如 `let Math = 5`）仍按用户变量解析。
        if (declared.has(node.name)) return `__ctx.${node.name}`
        // ctx 键（import 预置 / append 跨文件产出）优先于命名空间——与 emitCall 的
        // `declared || ctxHas ? __ctx : __ns` 判定同序（约束 2：命名空间绑定不是顶层标识符）。
        if (this.ctxHas(node.name)) return `__ctx.${node.name}`
        if (node.name !== 'contractVersion' && Object.hasOwn(this.namespaces, node.name)) {
          return `__ns.${node.name}`
        }
        if (isSafeGlobalIdent(node.name)) return node.name
        return `__ctx.${node.name}`
      }
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
          if (prop.method === true || (prop.kind && prop.kind !== 'init')) {
            // 方法简写 / getter / setter：AST 没有「属性名: 函数值」的对等再现形态，
            // 保留原文本片段（内部 ctx/ns 引用仍走 hoistText 提升）。
            parts.push(this.hoistText(code.slice(prop.start, prop.end), declared))
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
        // 外层括号：AST 发射丢弃了源括号，一元运算符紧邻 `**` 左操作数时 JS 要求
        // 显式括号（`(-a) ** 2` 合法，`-a ** 2` 抛 SyntaxError）。
        return `(${node.operator}(${this.transformArg(node.argument, code, declared, lineNo)}))`
      case 'BinaryExpression':
      case 'LogicalExpression':
        // Parenthesize both operands: the AST emission drops the source's
        // parentheses, so without explicit parens JS operator precedence
        // reinterprets nested arithmetic (e.g. -((a+b)/2+c) → -a+b/2+c).
        return `(${this.transformArg(node.left, code, declared, lineNo)} ${node.operator} ${this.transformArg(node.right, code, declared, lineNo)})`
      case 'ConditionalExpression':
        return `(${this.transformArg(node.test, code, declared, lineNo)} ? ${this.transformArg(node.consequent, code, declared, lineNo)} : ${this.transformArg(node.alternate, code, declared, lineNo)})`
      case 'TemplateLiteral': {
        // AST 重建模板：默认分支的 hoistText 会把模板「文本部分」里的标识符也做词边界
        // 替换（`n=${n}` 的文本 n 与变量 n 同名 → `__ctx.n=${__ctx.n}`，求值错）。
        const quasis = node.quasis ?? []
        const exprs = node.expressions ?? []
        let out = '`'
        for (let i = 0; i < quasis.length; i++) {
          out += quasis[i].value.raw ?? quasis[i].value.cooked ?? ''
          if (i < exprs.length) out += '${' + this.transformArg(exprs[i], code, declared, lineNo) + '}'
        }
        return out + '`'
      }
      case 'SequenceExpression':
        // AST 序号表达式丢弃了源括号（node.start 不含 `(`），必须补回，
        // 否则 `x = (1, 2)` 被发射成 `x = 1, 2` → 只赋 1（两后端不一致）。
        return `(${(node.expressions ?? [])
          .map((e: ASTNode) => this.transformArg(e, code, declared, lineNo))
          .join(', ')})`
      case 'MemberExpression': {
        // 可选链保持文本兜底（递归会丢 `?.`）。
        if (node.optional) return this.hoistText(code.slice(node.start, node.end), declared)
        // 递归 object（而非整段 hoistText）：object 可能是命名空间调用（cad.box(…).x）
        // 或 ctx 成员链。始终给 object 加括号，保证 await/调用/二元结果的成员访问优先级
        // 正确——`await __ns.cad.box(x).y` 会先取 `.y` 再 await（错），
        // 必须 `(await __ns.cad.box(x)).y`（约束 2 的链式形态）。
        const objText = this.transformArg(node.object, code, declared, lineNo)
        if (node.computed) {
          return `(${objText})[${this.transformArg(node.property, code, declared, lineNo)}]`
        }
        return `(${objText}).${node.property.name}`
      }
      default:
        return this.hoistText(code.slice(node.start, node.end), declared)
    }
  }

  /** 文本级自由标识符提升：把已声明变量名 + 当前 ctx 键（import 预置/先前执行产出）
   *  替换为 __ctx.<name>（词边界）；命名空间绑定（cad + registerLib 注册库）替换为
   *  __ns.<binding>（调用形态前置 await），与 hoistBlockText 步骤 ③ 同语义。
   *
   *  含 ctx 键 → append 跨文件引用（D6）与模块命名空间成员（cfg.OUTX）在实参文本中
   *  同样可解析。命名空间分支不可省：该函数服务顶层**值表达式**（数组/对象/成员/条件/
   *  二元等非调用 RHS）与 transformArg 的 MemberExpression/default 兜底，这些位置不经过
   *  emitCall，若不在此发射 __ns.<binding>，裸名在 vm 包装（只注入 __ctx/__ns/__isGeom）
   *  内即是自由标识符 → ReferenceError（`cad is not defined`）；而执行同段文本的
   *  interpreter 后端靠 env 的 ns 查找能解析，形成两后端差分（约束 2）。 */
  private hoistText(text: string, declared: Set<string>): string {
    const names = new Set<string>(declared)
    for (const key of Object.keys(this.ctx)) names.add(key)
    // 命名空间绑定（排除 contractVersion / 已声明同名遮蔽 / 已由 import 预置进 ctx 的绑定）
    const nsNames = Object.keys(this.namespaces).filter((k) => k !== 'contractVersion' && !names.has(k))
    // 标识符 + 命名空间提升统一走 replaceOutsideProtected（F1）：字符串 / 模板文本 /
    // 注释区间内的匹配原样保留（修复前实参文本里的 `'carrier'` 会被改写成
    // `'__ctx.carrier'`，与 hoistBlockText 同根因）。
    const subs: Array<{ re: RegExp; emit: (groups: string[]) => string }> = []
    if (names.size > 0) {
      subs.push({
        re: new RegExp(`\\b(${[...names].join('|')})\\b`, 'g'),
        emit: (g) => `__ctx.${g[0]}`,
      })
    }
    if (nsNames.length > 0) {
      const alt = nsNames.join('|')
      // 调用形态：`cad.box(` → `await __ns.cad.box(`
      subs.push({
        re: new RegExp(`(?<![.\\w])\\b(${alt})\\s*\\.\\s*(\\w+)\\s*\\(`, 'g'),
        emit: (g) => `await __ns.${g[0]}.${g[1]}(`,
      })
      // 裸成员访问（非调用）：`cad.foo` → `__ns.cad.foo`（非调用不加 await）
      subs.push({
        re: new RegExp(`(?<![.\\w])\\b(${alt})\\s*\\.`, 'g'),
        emit: (g) => `__ns.${g[0]}.`,
      })
    }
    const out = replaceOutsideProtected(text, subs)
    // 双前缀修正（与 hoistBlockText 尾部一致）
    return out.replace(/__ns\.__ns\./g, '__ns.').replace(/await\s+await\s+__ns\./g, 'await __ns.')
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
   * 返回原地写回登记（P25 §3.7.4）：裸调用行 → 写回目标变量名。
   * runtime 的 collectDirectResult 用此传给 computeLiveShapes 的 inplaceWrites
   * （producer 精确化）。
   * @returns 原地写回登记的只读视图。
   */
  getInplaceWrites(): Map<number, string> {
    return new Map(this.inplaceWrites)
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
        // 2026-10-06：免 import 安全全局（Math / JSON / console / Infinity / undefined /
        // NaN / parseInt / … 以及单位常量 MM / INCH / …）由 globalThis 提供，不是 ctx 变量。
        // 原先只硬编码排除了 undefined/NaN/Infinity，导致 `cad.box(Math.PI, 1, 1)` 与
        // `cad.box(console, 1, 1)`（以及单位常量 `cad.box(MM, 1, 1)`）在 append 前缀校验里
        // 被误报为「缺失引用」→ AppendPrefixError。这里统一走 isSafeGlobalIdent。
        if (!isSafeGlobalIdent(n.name)) refs.add(n.name)
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
