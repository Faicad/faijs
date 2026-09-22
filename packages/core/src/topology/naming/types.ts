/**
 *
 * 跨历史身份层：TopoRef 是纯数据、JSON 安全（写进 .fai.js 的参数），
 * 在改参重放后仍能指认「同一个面/边/点」。序号（FaceId/EdgeId）是
 * 快照内地址层，不动；本层叠加在其上。
 *
 * 与 brepjs shapeRef 的分层同构：role 是稳定身份、hash 是会话内活句柄索引、
 * hint 是几何兜底。区别：faijs 的 origin 可限定（RoleQualifier），以支持
 * 布尔合流后来自不同链根来源的面。
 */

import type { PartName, StmtId } from '../../identity'
import type { RoleName } from './role-name'

// ── 几何提示（hint）──

/**
 * 轴几何快照（装配约束 P0 前置）：圆柱/圆锥面与直边/圆边的有向轴。
 * origin 是轴上一点（圆柱轴点 / 直边起点 / 圆边圆心），direction 是单位轴向。
 */
export interface AxisHint {
  readonly origin: [number, number, number]
  readonly direction: [number, number, number]
}

/** 面几何快照：与 SelectorRuntime 的 FaceRow（surfaceType/area/center/normal）同源。 */
export interface FaceHint {
  readonly kind: 'face'
  readonly surfaceType?: string
  readonly normal?: [number, number, number]
  readonly center?: [number, number, number]
  readonly area?: number
  /** 圆柱/回转面的轴（装配 concentric 等轴约束的实体来源；平面/球面缺省）。 */
  readonly axis?: AxisHint
}

/** 边几何快照：length/midpoint 作裁决 hint。 */
export interface EdgeHint {
  readonly kind: 'edge'
  readonly length?: number
  readonly midpoint?: [number, number, number]
  /** 直边（起点+切向）或圆边（圆心+所在平面法向）的轴（装配轴约束的实体来源）。 */
  readonly axis?: AxisHint
}

/** 顶点几何快照：position 作裁决 hint。 */
export interface VertexHint {
  readonly kind: 'vertex'
  readonly position?: [number, number, number]
}

/** 生成面（倒角/圆角过渡面）几何快照：被桥接两面的外法向 + 边中点。 */
export interface DerivedFaceHint {
  readonly kind: 'derived-face'
  readonly normalA: [number, number, number]
  readonly normalB: [number, number, number]
  readonly edgeMidpoint?: [number, number, number]
}

// ── role 限定 ──

/**
 * role 的全局限定：origin = 产生该面的那条语句（StmtId，全局唯一），
 * role = 那条语句内的局部名（RoleName 的**线格式串**，`formatRoleName` 输出——
 * 如 'top' / 'wall:3' / 'replica[2]/wall:3'；消费点用 `parseRoleName` 解回结构）。
 *
 * Phase 1.6/1.7 就地换型后的形态（计划 §4.1/§4.2）：origin 从 PartName 改 StmtId
 * （PartName 会因"同一资产导入两次共用 origin"而算出相同 ref，`import-brep.ts:77`）；
 * role 删掉 'box:'/'extrude:' 这类 op 前缀——origin 已由 StmtId 权威表达，
 * 前缀是把 origin 信息塞进 role 的历史残留（违反 R1 的精神）。
 */
export interface RoleQualifier {
  readonly origin: StmtId
  readonly role: string
}

// ── 身份（权威形态，计划 §4.1）──

/**
 * 面身份 = `(StmtId, RoleName)` 的因果坐标。
 *
 * - `origin` 一律 `StmtId`，**链根也用它自己那条语句**（不再有"资产名"这种 origin）。
 *   `StmtId` 天然唯一，且与变量重命名解耦——`PartName` 会被改名、也会被复用
 *   （同一资产导入两次曾共用 origin，导致两个不同实体的第 k 个面算出完全相同的 ref）。
 * - `role` 是**那条语句内的局部名**（`RoleName`，结构化），全局唯一性由二元组提供。
 * - `display` 仅用于 UI，**不参与身份判定、不参与解析**（UI 要显示"part3.top"是显示问题，
 *   不能反向变成身份的组成部分，否则改个变量名就改身份）。
 *
 * **为什么"链根也用它自己那条语句"**：曾经链根的 origin 是"资产名 / 变量名"——
 * 那是**命名**，不是**来源**。同一份 STEP 被 `cad.load` 两次，两次产出的面在语义上
 * 是不同实体的面，却会拿到同一个 origin；用 StmtId 后它们自然分属两条语句。
 *
 * **V1（`RoleQualifier` / `FaceTopoRef` 等）与 V2 的关系**：V2 不是一套并行的新类型族，
 * 而是把现有 `TopoRef` 族的 `origin`/`role` 字段**就地换成**上面两个字段（Phase 1.6/1.7）。
 * 刻意不先加一套 `TopoRefV2` 并行存在——那会立刻让同一个类型有了两个家（§4.1 明令禁止）。
 * 迁移器需要读旧形态时，旧形态由 `migrate.ts` 自带一份**冻结的** legacy 类型（唯一消费方，
 * 故唯一归属）。
 */
export interface FaceIdentity {
  /** 权威：产生这个面的那条语句（全局唯一）。 */
  readonly origin: StmtId
  /** 那条语句把它当作什么。 */
  readonly role: RoleName
  /** 显示名，仅 UI 用（不参与身份判定、不参与解析）。 */
  readonly display?: PartName
}

// ── TopoRef 四类 ──

/** 面引用：origin+role 为主键（origin=StmtId、role=RoleName 线格式串），hint 为兜底（对应 brepjs ShapeRef）。 */
export interface FaceTopoRef {
  readonly kind: 'face'
  readonly origin: StmtId
  readonly role: string
  readonly hint: FaceHint
}

/**
 * 边引用：= 两邻面之交。faijs 扩展：两面可能来自布尔合流后的不同 origin，
 * 故用 RoleQualifier（带 origin 的稳定 role）而非 brepjs 的裸 role 串。
 */
export interface EdgeTopoRef {
  readonly kind: 'edge'
  readonly faces: readonly [RoleQualifier, RoleQualifier]
  readonly hint: EdgeHint
}

/** 顶点引用：≥3 邻面之交。 */
export interface VertexTopoRef {
  readonly kind: 'vertex'
  readonly faces: readonly RoleQualifier[]
  readonly hint: VertexHint
}

/** 生成面（倒角斜面/圆角面）：桥接两面，normal-blend 解析。 */
export interface DerivedFaceTopoRef {
  readonly kind: 'derived-face'
  readonly op: 'fillet' | 'chamfer'
  readonly between: readonly [RoleQualifier, RoleQualifier]
  readonly hint: DerivedFaceHint
}

/** 四类拓扑引用的并集。 */
export type TopoRef = FaceTopoRef | EdgeTopoRef | VertexTopoRef | DerivedFaceTopoRef

// ── 运行期 role 表（不序列化、不进 .fai.js）──

/**
 * 产生语句（StmtId）→ role → 当前面 hash 列表。1→多分裂时一个 role 对应
 * 多个 hash；resolve 只在后继内裁决。
 *
 * Phase 1.6 换型：外层键从 PartName 改 **StmtId**（§4.1：PartName 会被改名、
 * 会被复用——同一资产导入两次曾共用 origin）。Map 键用 StmtId 的**串形**
 * （`String(stmtId)`）；StmtId 是 branded string，串形即其运行期形态。
 * role 键是 RoleName 的线格式串（`formatRoleName` 输出）。
 */
export type RoleTable = ReadonlyMap<StmtId, ReadonlyMap<string, readonly number[]>>

// ── 解析结果：显式三态，禁止静默取错 ──

/** 解析成功：活实体 + 序号 + 置信度。 */
export type TopoResolution<T> =
  | {
      readonly ok: true
      readonly entity: T
      readonly ordinal: number
      readonly confidence: 'exact' | 'geometric-fallback'
    }
  | {
      readonly ok: false
      readonly reason: 'deleted' | 'ambiguous' | 'not-found'
      readonly candidatesOrdinal?: readonly number[]
    }

// ── 错误码（§3.6：解析失败按码抛错，纳入 args 校验）──

/** 解析失败错误码：面/边/顶点/生成面统一用 deleted/ambiguous/not-found 三码；mesh 路径引用拓扑用 mesh-unsupported。 */
export type TopoErrorCode =
  | 'E_TOPO_DELETED'
  | 'E_TOPO_AMBIGUOUS'
  | 'E_TOPO_NOT_FOUND'
  | 'E_TOPO_MESH_UNSUPPORTED'

/** 解析失败异常：带错误码与 ref 的 kind，禁止静默拿序号硬取。 */
export class TopoRefError extends Error {
  /** 错误码：E_TOPO_DELETED / E_TOPO_AMBIGUOUS / E_TOPO_NOT_FOUND。 */
  readonly code: TopoErrorCode
  /** 解析失败的 TopoRef kind（'face'|'edge'|'vertex'|'derived-face'）。 */
  readonly refKind: TopoRef['kind']
  /** ambiguous 时的并列候选序号（1 起）。 */
  readonly candidatesOrdinal?: readonly number[]

  constructor(code: TopoErrorCode, refKind: TopoRef['kind'], message: string, candidatesOrdinal?: readonly number[]) {
    super(message)
    this.name = 'TopoRefError'
    this.code = code
    this.refKind = refKind
    this.candidatesOrdinal = candidatesOrdinal
  }
}

// ── §3.7 向宿主暴露的命名行（ExecutionResult.naming 元素）──

/**
 * 面命名行：序号(1起) ↔ 数组下标。宿主 O(1) 反查：拾取到的 FaceId ordinal
 * → 本行 → captureTopoRef 造 TopoRef。
 *
 * Phase 1.6/1.7 换型（§4.1/§4.2）：
 * - `origin` 是产生该面的那条语句（StmtId）。
 * - `role` 是 RoleName 的**线格式串**（'top' / 'wall:3'，无 'box:' 这类 op 前缀）。
 * - **无身份面 → `role: null`**（G6：`''` 静默兜底已删）。mesh 来源只填 hint
 *   （`origin: null` / `role: null`）；BREP 链上解析不出血统也显式为 null，
 *   不再伪造空串。
 */
export interface FaceNaming {
  readonly origin: StmtId | null
  readonly role: string | null
  readonly hint: FaceHint
}

/**
 * 边命名行：两邻面的 RoleQualifier + 边 hint；任一邻面无血统（mesh 无邻接、
 * 或 BREP 链上未追踪）→ `faces: null`，只给 hint。宿主用它组 EdgeTopoRef（§6.1）。
 */
export interface EdgeNaming {
  readonly faces: readonly [RoleQualifier, RoleQualifier] | null
  readonly hint: EdgeHint
}

/** 每个 part 的命名数据（ExecutionResult.naming 的 value）。 */
export interface PartNaming {
  readonly source: 'brep' | 'primitive' | 'mesh'
  /** 面命名行；序号(1起) ↔ 数组下标。无身份的面 role=null（G6：无静默兜底）。 */
  readonly faceNaming: ReadonlyArray<FaceNaming>
  /** 边命名行。无邻接或邻面无血统 → faces=null，只给 hint。 */
  readonly edgeNaming: ReadonlyArray<EdgeNaming>
}
