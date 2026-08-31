/**
 * TopoRef 命名层类型（§2.2 of docs/plans/2026-08-31-topology-naming-port-v2.md）
 *
 * 跨历史身份层：TopoRef 是纯数据、JSON 安全（写进 .faijs 的参数），
 * 在改参重放后仍能指认「同一个面/边/点」。序号（FaceId/EdgeId）是
 * 快照内地址层，不动；本层叠加在其上。
 *
 * 与 brepjs shapeRef 的分层同构：role 是稳定身份、hash 是会话内活句柄索引、
 * hint 是几何兜底。区别：faijs 的 origin 可限定（RoleQualifier），以支持
 * 布尔合流后来自不同链根来源的面。
 */

import type { PartName } from '../../identity'

// ── 几何提示（hint）──

/** 面几何快照：与 SelectorRuntime 的 FaceRow（surfaceType/area/center/normal）同源。 */
export interface FaceHint {
  readonly kind: 'face'
  readonly surfaceType?: string
  readonly normal?: [number, number, number]
  readonly center?: [number, number, number]
  readonly area?: number
}

/** 边几何快照：length/midpoint 作裁决 hint。 */
export interface EdgeHint {
  readonly kind: 'edge'
  readonly length?: number
  readonly midpoint?: [number, number, number]
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
 * role 的全局限定：origin = 该面血缘起点的 part 变量名（链根），
 * role = 该起点内的角色名（如 'box:top'）。
 */
export interface RoleQualifier {
  readonly origin: PartName
  readonly role: string
}

// ── TopoRef 四类 ──

/** 面引用：origin+role 为主键，hint 为兜底（对应 brepjs ShapeRef）。 */
export interface FaceTopoRef {
  readonly kind: 'face'
  readonly origin: PartName
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

// ── 运行期 role 表（不序列化、不进 .faijs）──

/**
 * origin（链根 PartName）→ role → 当前面 hash 列表。
 * 1→多分裂时一个 role 对应多个 hash；resolve 只在后继内裁决。
 */
export type RoleTable = ReadonlyMap<PartName, ReadonlyMap<string, readonly number[]>>

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

/** 解析失败错误码：面/边/顶点/生成面统一用 deleted/ambiguous/not-found 三码。 */
export type TopoErrorCode =
  | 'E_TOPO_DELETED'
  | 'E_TOPO_AMBIGUOUS'
  | 'E_TOPO_NOT_FOUND'

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
 * → 本行 → captureTopoRef 造 TopoRef。mesh 来源只填 hint、role 为空串。
 */
export interface FaceNaming {
  readonly origin: PartName
  readonly role: string
  readonly hint: FaceHint
}

/**
 * 边命名行：两邻面的 RoleQualifier（mesh 无邻接时为 null）+ 边 hint。
 * 宿主用它组 EdgeTopoRef（§6.1）。
 */
export interface EdgeNaming {
  readonly faces: readonly [RoleQualifier, RoleQualifier] | null
  readonly hint: EdgeHint
}

/** 每个 part 的命名数据（ExecutionResult.naming 的 value）。 */
export interface PartNaming {
  readonly source: 'brep' | 'primitive' | 'mesh'
  /** 面命名行；序号(1起) ↔ 数组下标。BREP/primitive 完整，mesh 只给 hint（role=''）。 */
  readonly faceNaming: ReadonlyArray<FaceNaming>
  /** 边命名行。mesh 无邻接 → faces=null，只给 hint。 */
  readonly edgeNaming: ReadonlyArray<EdgeNaming>
}
