/**
 * lineage.ts — 血缘图登记（计划 §4.3）。
 *
 * 每个 op 执行完登记一条 `LineageNode`：**谁（`StmtId`）用什么 op、吃了哪些
 * part、产出哪些 part、属哪个 provenance 类别**。两张表：
 *
 * | 表 | 键 → 值 | 用途 |
 * |---|---|---|
 * | `lineage` | `StmtId` → `LineageNode` | 从身份原点沿 DAG 前进 |
 * | `partToStmt` | `PartName` → `StmtId` | 从 part 名字反查是哪条语句造的 |
 *
 * ## 为什么这一层必须存在
 *
 * 现状把身份表达成 **hash**（`face-evolution.ts` 的内存指针哈希），于是每次查询都在
 * 付「对齐 hash」的利息：谁改了几何，谁的 hash 就变，身份就断。正确形态是
 * `(StmtId, RoleName)` 的**因果坐标**——`StmtId` 说「哪条语句产生」，`RoleName` 说
 * 「那条语句把它当作什么」。因果坐标不随几何变化，**也不需要知道中间过了几个 op**。
 *
 * ## 登记口只能有一个（但调用点有两个）
 *
 * 手写 op 走 `wrapBrepOne`（`define-op.ts`），生成投影走 `compatOp`
 * （`api/internal/compat-op.ts`）——**两条路径都必须登记**，否则 42 条投影永远无名。
 * 但两条路径共用一个 `register()`，规则才只有一处。
 *
 * ## 三条硬规则（这是「未来漏洞最少」的核心）
 *
 * | # | 规则 | 违反时 |
 * |---|---|---|
 * | **N1** | inputs 里任一 Shape 查不到 `PartName` → 报错 | `E_TOPO_UNTRACKED_INPUT` |
 * | **N2** | 当前语句锚点缺失，或与声明的 `stmt` 不符 → 报错 | `E_TOPO_NO_ANCHOR` |
 * | **N3** | 同一 `StmtId` 重复登记且**身份内容**不同 → 报错 | `E_TOPO_DUPLICATE_STMT` |
 *
 * **N1 为什么必须是错误而不是"默认成链根"**：op 内部常临时造 Shape（中间产物、
 * 工具件）。若给它们默认一个 origin，「看起来对但语义错」的身份就诞生了——
 * 引用能解析成功，但解析到**别的面**。这类错误不会在测试里暴露（测试用的参数恰好
 * 让两者重合），只会在用户改参数、改尺寸时暴露。**宁可在执行期就炸。**
 *
 * **N2 为什么现在才敢做**：它依赖 `getCurrentStmt()` 是"当前语句的权威读法"。
 * 这一点由约束 **C1（禁止并发多 runtime）** 保证（见 §4.7.1）——不是"全局态凑合能用"。
 *
 * ## 依赖注入，不读全局
 *
 * `register()` 收一个 `LineageDeps`（`nameOf` / `currentStmt`）而不是 import
 * `runtime-state`。理由有两条：其一，`topology/` 现有模块（如 `roles.ts`）都是
 * "把依赖当参数"的风格，读全局会破坏它；其二，N1/N2/N3 的测试不想去摆弄全局态。
 */

import type { PartName, StmtId } from '../../identity'
import type { HashEvolution } from '../../brep/face-evolution'
import { type RoleName } from './role-name'

// ── provenance 类别（封闭，计划 §4.4）──

/**
 * 新造面的获取方式（只有 `kernel` / `construct` 需要）。
 *
 * - `byAdjacency`：靠结果形状与输入的**邻接关系**推出哪个面是新造的
 *   （布尔/倒角等：新面必然与已知面相邻，而幸存面有自己的坐标）
 * - `explicit`：op 直接给出词汇表（构造类：底面 = profile、侧面 i = 第 i 条边扫掠）
 *
 * ⚠️ **不能靠内核的 `generated` 桶**（Phase 0.4 实测）：它与 `modified` 同构分段、
 * 键集相同，值是各输入面派生的**中间形**——`cut` 里 12 个 hash 结果里 0 存活，
 * `fillet`/`fuse` 里整桶为空。故 `byAdjacency` / `explicit` 是**必填**。
 */
export type NewFaceRule =
  | { readonly via: 'byAdjacency' }
  | { readonly via: 'explicit'; readonly vocab: readonly RoleName[] }

/**
 * 六个 provenance 类别（计划 §4.4，封闭集）。
 *
 * **继承面的处置完全由类别决定，op 不写**；只有 `construct` 和 `kernel` 会造新面，
 * 才有词汇这一项 ⇒ `identity` / `subdivide` / `replicate(k)` **零声明**。
 *
 * 本表是**类别归属**，不是接线状态（例：`sweep` 属 `construct` 类但未接线，见 §1 D10）。
 */
export type Provenance =
  /** 内核给历史：boolean / fillet / chamfer / shell / offset / 刚体变换 */
  | { readonly kind: 'kernel'; readonly newFaces: NewFaceRule }
  /** 输出面 ↔ 输入的构造规则：extrude / revolve / sweep / loft / primitives / sketch / import_brep */
  | { readonly kind: 'construct'; readonly newFaces: Extract<NewFaceRule, { via: 'explicit' }> }
  /** 1:1，第 i 面 → 第 i 面：copy / place / clone / locate / applyMatrix */
  | { readonly kind: 'identity' }
  /** 每输入面 → 若干片：split / section */
  | { readonly kind: 'subdivide' }
  /** 第 k 份第 i 面 ← 第 i 面：linearPattern / circularPattern / gridPattern / rectangularPattern / mirrorJoin */
  | { readonly kind: 'replicate'; readonly k: number }
  /** 显式记账：算不出来。应趋近于 0；审计测试必须列出全部并给出理由 */
  | { readonly kind: 'unmodeled'; readonly reason: string }

/** `Provenance` 的类别标签（封闭六值）。 */
export type ProvenanceKind = Provenance['kind']

/** 六个类别标签，供审计测试枚举（新增类别必须同步此处）。 */
export const PROVENANCE_KINDS = [
  'kernel',
  'construct',
  'identity',
  'subdivide',
  'replicate',
  'unmodeled',
] as const

// ── 节点 ──

/**
 * 血缘图的一个节点 = 一条语句的登记记录。
 *
 * `inputs`/`outputs` 是 `PartName`（不是 Shape）：Shape 是执行期的活对象，
 * 身份层必须只留**可序列化、可比较**的东西，否则节点会随 arena 释放而失去意义。
 */
export interface LineageNode {
  /** 该语句的 id（`ExecutionAnchor.id`），全局唯一。 */
  readonly stmt: StmtId
  /** op 名（如 `cad.fillet`）——用于报错信息与审计。 */
  readonly op: string
  /** 输入 part 名（`inputs.map(nameOf)` 的结果，已保证全部有名字）。 */
  readonly inputs: readonly PartName[]
  /** 产出 part 名（至少一个）。 */
  readonly outputs: readonly PartName[]
  /** provenance 类别 + 该类别的载荷。 */
  readonly provenance: Provenance
  /** `kind='kernel'` 时执行期记录的 hash 演化（`attachEvolution` 事后补上）。 */
  readonly evolution?: HashEvolution
}

/**
 * 登记入参（尚未解析成 `PartName` 的形态）。
 *
 * `inputs` 故意收 **Shape 句柄**而不是 `PartName`：N1 的判据就是
 * "这个 Shape 有没有名字"，若调用方先自己 map 成名字，就正好把
 * "查不到名字"这一步跳过/默认了——那正是 N1 要防的。
 */
export interface LineageDraft {
  /** 声明本条语句的 id（N2 会与当前锚点核对）。 */
  readonly stmt: StmtId
  /** op 名。 */
  readonly op: string
  /** 输入 Shape 句柄（N1 在 register 内解析）。 */
  readonly inputs: readonly object[]
  /** 产出 part 名（非空；调用方从锚点/nameOf 拿到）。 */
  readonly outputs: readonly [PartName, ...PartName[]]
  /** provenance 类别 + 载荷。 */
  readonly provenance: Provenance
}

/** 登记所需的外部读口（由调用点注入，见文件头「依赖注入」）。 */
export interface LineageDeps {
  /** Shape → PartName（`runtime-state` 的 `nameOf`）。 */
  readonly nameOf: (shape: object) => PartName | undefined
  /** 当前执行语句锚点（`runtime-state` 的 `getCurrentStmt`）。 */
  readonly currentStmt: () => { readonly id: string } | undefined
}

// ── 错误 ──

/** 血缘登记错误码（三条规则 N1/N2/N3）。 */
export type LineageErrorCode = 'E_TOPO_UNTRACKED_INPUT' | 'E_TOPO_NO_ANCHOR' | 'E_TOPO_DUPLICATE_STMT'

/** 血缘登记失败。带稳定错误码，禁止静默兜底。 */
export class LineageError extends Error {
  /** 稳定错误码（宿主/args 校验按码识别）。 */
  readonly code: LineageErrorCode
  /** 出错的语句 id（若能确定）。 */
  readonly stmt?: string

  /**
   * @param code - the stable error code.
   * @param message - what went wrong, with the offending statement named.
   * @param stmt - the statement id, when known.
   */
  constructor(code: LineageErrorCode, message: string, stmt?: string) {
    super(message)
    this.name = 'LineageError'
    this.code = code
    this.stmt = stmt
  }
}

// ── 结构化比较（不引 node:util——topology/ 要能进浏览器构建）──

/**
 * 两个 `RoleName` 是否相等（按值、递归）。
 *
 * 手写而不是 `JSON.stringify` 比较：键序会随写字面量的顺序变化
 * （`{index, op}` 与 `{op, index}` 是同一个值、不同的 JSON），
 * 而这两个函数是 N3「内容不同才报错」的判据——键序敏感会**误报冲突**。
 *
 * @param a - one role name.
 * @param b - the other role name.
 * @returns true when the two roles are structurally identical.
 */
export function roleNameEquals(a: RoleName, b: RoleName): boolean {
  switch (a.kind) {
    case 'semantic':
      return b.kind === 'semantic' && a.name === b.name
    case 'wall':
      return b.kind === 'wall' && a.index === b.index
    case 'imported':
      return b.kind === 'imported' && a.index === b.index
    case 'generated':
      return b.kind === 'generated' && a.op === b.op && a.index === b.index
    case 'hole':
      return b.kind === 'hole' && a.index === b.index && roleNameEquals(a.inner, b.inner)
    case 'replica':
      return b.kind === 'replica' && a.k === b.k && roleNameEquals(a.inner, b.inner)
    case 'splinter':
      return b.kind === 'splinter' && a.index === b.index && roleNameEquals(a.inner, b.inner)
  }
}

/**
 * 两条新造面规则是否相等（词汇表**逐项按序**比较——顺序是构造语义的一部分：
 * 侧面 i 对应第 i 条 profile 边，重排就是换了一个 role）。
 *
 * @param a - one rule.
 * @param b - the other rule.
 * @returns true when the two rules are structurally identical.
 */
export function newFaceRuleEquals(a: NewFaceRule, b: NewFaceRule): boolean {
  if (a.via === 'byAdjacency') return b.via === 'byAdjacency'
  if (b.via !== 'explicit') return false
  if (a.vocab.length !== b.vocab.length) return false
  for (let i = 0; i < a.vocab.length; i++) {
    if (!roleNameEquals(a.vocab[i], b.vocab[i])) return false
  }
  return true
}

/**
 * 两个 `Provenance` 是否相等（按值）。
 *
 * @param a - one provenance.
 * @param b - the other provenance.
 * @returns true when they are structurally identical.
 */
export function provenanceEquals(a: Provenance, b: Provenance): boolean {
  switch (a.kind) {
    case 'identity':
      return b.kind === 'identity'
    case 'subdivide':
      return b.kind === 'subdivide'
    case 'replicate':
      return b.kind === 'replicate' && a.k === b.k
    case 'unmodeled':
      return b.kind === 'unmodeled' && a.reason === b.reason
    case 'kernel':
      return b.kind === 'kernel' && newFaceRuleEquals(a.newFaces, b.newFaces)
    case 'construct':
      return b.kind === 'construct' && newFaceRuleEquals(a.newFaces, b.newFaces)
  }
}

/** 两个字符串数组是否逐项相等。 */
function sameNames(a: readonly PartName[], b: readonly PartName[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// ── 血缘图 ──

/**
 * 血缘图：两张表 + 一个登记函数。
 *
 * 实例化而非全局单例，是为了让 N1/N2/N3 的测试各用各的图、互不污染；
 * 执行期由 `runtime-state` 侧持有唯一实例（C1 保证单 runtime，不存在两图并存）。
 */
export class LineageGraph {
  private readonly nodes = new Map<StmtId, LineageNode>()
  private readonly partOwner = new Map<PartName, StmtId>()

  /**
   * 登记一条语句（N1/N2/N3 全在这里校验）。
   *
   * @param draft - the statement's lineage facts (inputs still as Shape handles).
   * @param deps - the injected readers (`nameOf` / `currentStmt`).
   * @returns the stored node.
   * @throws LineageError on N1 (untracked input), N2 (anchor mismatch), or N3 (conflicting re-register).
   */
  register(draft: LineageDraft, deps: LineageDeps): LineageNode {
    const stmt = draft.stmt

    // N2：当前锚点必须是本条语句，否则说明"我拿到的 stmt 不是正在跑的那条"。
    const anchor = deps.currentStmt()
    if (!anchor) {
      throw new LineageError(
        'E_TOPO_NO_ANCHOR',
        `${draft.op} 登记血缘时无当前语句锚点（getCurrentStmt() 为空）`,
        stmt,
      )
    }
    if (anchor.id !== stmt) {
      throw new LineageError(
        'E_TOPO_NO_ANCHOR',
        `${draft.op} 声明的语句 ${stmt} 与当前锚点 ${anchor.id} 不符`,
        stmt,
      )
    }

    // N1：输入 Shape 必须都有 PartName——**不许默认成链根**。
    const inputs: PartName[] = []
    for (let i = 0; i < draft.inputs.length; i++) {
      const name = deps.nameOf(draft.inputs[i])
      if (name === undefined) {
        throw new LineageError(
          'E_TOPO_UNTRACKED_INPUT',
          `${draft.op} 的第 ${i} 个输入 Shape 没有 PartName（op 内部临时造的件？）。` +
            `不允许默认成链根——那会产生"能解析但解析错面"的假身份。`,
          stmt,
        )
      }
      inputs.push(name)
    }

    const node: LineageNode = {
      stmt,
      op: draft.op,
      inputs,
      outputs: [...draft.outputs],
      provenance: draft.provenance,
    }

    // N3：同一语句重复登记，若**身份内容**不同即为冲突。
    // 注意比较范围刻意**不含 evolution**：它在执行期事后补（`attachEvolution`），
    // 若纳入比较，第二次登记会因"上次还没补 evolution"而误报冲突。
    const existing = this.nodes.get(stmt)
    if (existing && !sameIdentity(existing, node)) {
      throw new LineageError(
        'E_TOPO_DUPLICATE_STMT',
        `${stmt} 被重复登记且内容不同：` +
          `已登记 ${existing.op}(${existing.inputs.join(',')} → ${existing.outputs.join(',')}, ${existing.provenance.kind})，` +
          `本次为 ${node.op}(${node.inputs.join(',')} → ${node.outputs.join(',')}, ${node.provenance.kind})`,
        stmt,
      )
    }

    // PartName → StmtId：反查索引（名字 → 语句）。**最后写者胜**。
    //
    // 重赋值（`part0 = cad.translate(part0, …)`）是 faijs 的合法惯用法：后一条语句
    // 重新绑定同名 PartName，旧绑定随之失效。身份载体是 `(StmtId, RoleName)`，
    // PartName 只是反查索引，故覆盖更新即可——不报错。
    //
    // ⚠️ 曾经这里有一条 `E_TOPO_PART_REDEFINED` 守卫（把"两名同出"一律判为
    // "反查歧义"）。§1.4/1.5 接线后它当场误杀了重赋值（8 例回退，见
    // `api/dual-form-contract.test.ts`），已废除：线性程序里"两名同出"就是重赋值，
    // 是合法的；而当两条语句真的同时存活并引用时，"当前绑定"语义本就该取最新。

    // ⚠️ 幂等重登记必须**保留已补挂的 evolution**：既然 N3 刻意不比较它，
    // 那它就不是"本次登记的输入"，重登记时用不带 evolution 的新对象覆盖
    // 等于把先前记录的 hash 演化**静默丢掉**——而丢掉的正是 kernel 类推进 role
    // 所需的全部信息（重新算一遍几何也补不回来，因为演化只在执行那一刻可得）。
    this.nodes.set(stmt, existing?.evolution ? { ...node, evolution: existing.evolution } : node)
    for (const out of node.outputs) this.partOwner.set(out, stmt)
    return this.nodes.get(stmt)!
  }

  /**
   * 事后补挂 hash 演化（`kind='kernel'` 用）。
   *
   * 与 `register` 分开是因为演化记录发生在几何算完之后，而登记发生在调用边界；
   * 合成一个操作会让 N3 的"内容比较"必须处理"evolution 可能晚到"的时序问题。
   *
   * @param stmt - the statement whose evolution to attach.
   * @param evolution - the hash evolution produced by this statement.
   * @throws LineageError when the statement was never registered.
   */
  attachEvolution(stmt: StmtId, evolution: HashEvolution): void {
    const node = this.nodes.get(stmt)
    if (!node) {
      throw new LineageError(
        'E_TOPO_NO_ANCHOR',
        `为未登记的语句 ${stmt} 挂 hash 演化——必须先 register`,
        stmt,
      )
    }
    this.nodes.set(stmt, { ...node, evolution })
  }

  /** 按语句 id 取节点。 */
  node(stmt: StmtId): LineageNode | undefined {
    return this.nodes.get(stmt)
  }

  /** 按 part 名反查产出它的语句 id。 */
  stmtOf(part: PartName): StmtId | undefined {
    return this.partOwner.get(part)
  }

  /** 按 part 名反查产出它的节点。 */
  nodeOfPart(part: PartName): LineageNode | undefined {
    const stmt = this.partOwner.get(part)
    return stmt === undefined ? undefined : this.nodes.get(stmt)
  }

  /** 已登记的语句数。 */
  get size(): number {
    return this.nodes.size
  }

  /** 清空（每次执行开始时调用——一次执行内 `StmtId` 稳定）。 */
  clear(): void {
    this.nodes.clear()
    this.partOwner.clear()
  }
}

/**
 * 判断两节点是否"身份内容"相同（N3 用；刻意不含 `evolution`）。
 *
 * @param a - the stored node.
 * @param b - the incoming node.
 * @returns true when op / inputs / outputs / provenance all match.
 */
function sameIdentity(a: LineageNode, b: LineageNode): boolean {
  return (
    a.op === b.op &&
    sameNames(a.inputs, b.inputs) &&
    sameNames(a.outputs, b.outputs) &&
    provenanceEquals(a.provenance, b.provenance)
  )
}

/**
 * 执行期共用的血缘图实例。
 *
 * 唯一性由约束 C1（禁止并发多 runtime）保证；测试请自建 `new LineageGraph()`。
 */
export const runtimeLineage = new LineageGraph()
