/**
 * identity.ts — 全仓唯一的 ID 品牌类型定义与信任点（f0，零依赖，可脱离 web 运行）
 *
 * See docs/api-contract.md §3 (naming contract: StmtId and PartName separation).
 *
 * ## 目标
 *
 * 为跨仓库（fai ↔ 3d_editor）传播的每一类 ID 建立唯一的 nominaal 品牌类型
 * （`string & { readonly [__x]: true }`），并集中"string → 品牌"的全部转换
 * （`as*` 信任点）。品牌类型不可互相赋值、不可由裸 string 赋值，错误在编译期暴露。
 *
 * ## 品牌清单（§0 术语表）
 *
 * | 品牌 | 语义 | 值域示例 |
 * |---|---|---|
 * | `FileId` | 文件身份（3d 场景树），无冒号 | UUID / `prim_1` |
 * | `InnerId` | part 在文件内编号，无冒号 | `o1` / `part-0` |
 * | `ScopedId` | `fileId:innerId`，恰好一个冒号（场景树 key） | `fileId:part-0` |
 * | `StmtId` | 每条语句的 id（`StatementIR.id`），无赋值语句也有 | `s1` / `s<N>` |
 * | `PartName` | 左值变量名（0/1/2 个，split 双值） | `part0` / `part<N>` |
 * | `GroupName` | 装配/组语句的变量名（⊆ PartName） | `grp_<N>` |
 * | `RefId` | 装配成员引用（scopedId 形态） | `fileId:part-0` |
 * | `ReferenceId` | 拓扑选取 key（`topology\|<selType>\|<display>`） | `topology\|face\|o1.f1` |
 * | `SelectorKey` | 用户可见 selector（剥前缀） | `o1.f1` / `f1` |
 * | `OccurrenceId` | 拓扑行 occurrence id | `o1` / `o0.o1` |
 * | `ShapeId` | 拓扑行 shape id | `o1.f0` |
 * | `FaceId` | 拓扑行 face id | `o1.f1` |
 * | `EdgeId` | 拓扑行 edge id | `o1.e1` |
 * | `NodeId` | 场景树节点 key（= ScopedId 或 fileId 根）（3d 侧语义） | — |
 *
 * ## 禁止
 * - `partId` 标识符（lint no-partid-identifier 唯一豁免 `lib/bambu-3mf/`）
 * - 任何 `string` 直接赋值给品牌类型（编译期拦截）
 * - 空串 / 回退兜底：`toScopedId`/`splitScopedId` 对非法输入抛错（CLAUDE.md 案例 2）
 */

// 品牌 symbol — 仅为类型标记，不在运行时存在
declare const __fileId:      unique symbol
declare const __innerId:     unique symbol
declare const __scopedId:    unique symbol
declare const __stmtId:      unique symbol
declare const __partName:    unique symbol
declare const __groupName:   unique symbol
declare const __refId:       unique symbol
declare const __referenceId: unique symbol
declare const __selectorKey: unique symbol
declare const __occurrenceId: unique symbol
declare const __shapeId:     unique symbol
declare const __faceId:      unique symbol
declare const __edgeId:      unique symbol
declare const __nodeId:      unique symbol

/** Branded ID: the file identity (3d scene tree node root), with no colon. */
export type FileId       = string & { readonly [__fileId]:      true }
/** Branded ID: a part's in-file number, with no colon. */
export type InnerId      = string & { readonly [__innerId]:     true }
/** Branded ID: `fileId:innerId` with exactly one colon (scene tree key). */
export type ScopedId     = string & { readonly [__scopedId]:    true }
/** Branded ID: a statement's id (StatementIR.id); every statement has one. */
export type StmtId       = string & { readonly [__stmtId]:      true }
/** Branded ID: a left-hand-side variable name; split outputs yield two values. */
export type PartName     = string & { readonly [__partName]:    true }
/** Branded ID: an assembly/group statement's variable name (`grp_N` ⊆ PartName). */
export type GroupName    = PartName & { readonly [__groupName]: true }
/** Branded ID: an assembly member reference (scopedId shape). */
export type RefId        = string & { readonly [__refId]:       true }
/** Branded ID: a topology selection key (`topology|<selType>|<display>`). */
export type ReferenceId  = string & { readonly [__referenceId]: true }
/** Branded ID: a user-visible selector (prefix-stripped). */
export type SelectorKey  = string & { readonly [__selectorKey]: true }
/** Branded ID: a topology row occurrence id. */
export type OccurrenceId = string & { readonly [__occurrenceId]: true }
/** Branded ID: a topology row shape id. */
export type ShapeId      = string & { readonly [__shapeId]:     true }
/** Branded ID: a topology row face id. */
export type FaceId       = string & { readonly [__faceId]:      true }
/** Branded ID: a topology row edge id. */
export type EdgeId       = string & { readonly [__edgeId]:      true }
/** Branded ID: a scene tree node key (= ScopedId or a fileId root). */
export type NodeId       = string & { readonly [__nodeId]:      true }

/** Alias for StmtId (= StatementIR.id, distinct from PartName semantics). */
export type StatementId  = StmtId
/** Alias for FaceId (mesh FaceDescriptor carries no id; currently unused). */
export type FaceSelector = FaceId

// ═════════════════════════════════════════════════════════════════════════
// 唯一信任点（string → ID 的唯一大门）
// ═════════════════════════════════════════════════════════════════════════

/**
 * Trust point that converts a plain string to a branded FileId.
 * @param raw - the raw string value.
 * @returns the input typed as FileId.
 */
export function asFileId(raw: string): FileId {
  return raw as FileId
}

/**
 * Trust point that converts a plain string to a branded InnerId.
 * @param raw - the raw string value.
 * @returns the input typed as InnerId.
 */
export function asInnerId(raw: string): InnerId {
  return raw as InnerId
}

/**
 * Trust point that converts a plain string to a branded ScopedId.
 * @param raw - the raw string value.
 * @returns the input typed as ScopedId.
 */
export function asScopedId(raw: string): ScopedId {
  return raw as ScopedId
}

/**
 * Trust point that converts a plain string to a branded StmtId.
 * @param raw - the raw string value.
 * @returns the input typed as StmtId.
 */
export function asStmtId(raw: string): StmtId {
  return raw as StmtId
}

/**
 * Trust point that converts a plain string to a branded PartName.
 * @param raw - the raw string value.
 * @returns the input typed as PartName.
 */
export function asPartName(raw: string): PartName {
  return raw as PartName
}

/**
 * Trust point that converts a plain string to a branded GroupName.
 * @param raw - the raw string value.
 * @returns the input typed as GroupName.
 */
export function asGroupName(raw: string): GroupName {
  return raw as GroupName
}

/**
 * Trust point that converts a plain string to a branded RefId.
 * @param raw - the raw string value.
 * @returns the input typed as RefId.
 */
export function asRefId(raw: string): RefId {
  return raw as RefId
}

/**
 * Trust point that converts a plain string to a branded ReferenceId.
 * @param raw - the raw string value.
 * @returns the input typed as ReferenceId.
 */
export function asReferenceId(raw: string): ReferenceId {
  return raw as ReferenceId
}

/**
 * Trust point that converts a plain string to a branded SelectorKey.
 * @param raw - the raw string value.
 * @returns the input typed as SelectorKey.
 */
export function asSelectorKey(raw: string): SelectorKey {
  return raw as SelectorKey
}

/**
 * Trust point that converts a plain string to a branded OccurrenceId.
 * @param raw - the raw string value.
 * @returns the input typed as OccurrenceId.
 */
export function asOccurrenceId(raw: string): OccurrenceId {
  return raw as OccurrenceId
}

/**
 * Trust point that converts a plain string to a branded ShapeId.
 * @param raw - the raw string value.
 * @returns the input typed as ShapeId.
 */
export function asShapeId(raw: string): ShapeId {
  return raw as ShapeId
}

/**
 * Trust point that converts a plain string to a branded FaceId.
 * @param raw - the raw string value.
 * @returns the input typed as FaceId.
 */
export function asFaceId(raw: string): FaceId {
  return raw as FaceId
}

/**
 * Trust point that converts a plain string to a branded EdgeId.
 * @param raw - the raw string value.
 * @returns the input typed as EdgeId.
 */
export function asEdgeId(raw: string): EdgeId {
  return raw as EdgeId
}

/**
 * Trust point that converts a plain string to a branded NodeId.
 * @param raw - the raw string value.
 * @returns the input typed as NodeId.
 */
export function asNodeId(raw: string): NodeId {
  return raw as NodeId
}

// ═════════════════════════════════════════════════════════════════════════
// ScopedId 构造 / 拆分（3d 场景树语义；fai 仅在此处实现，3d re-export）
// ═════════════════════════════════════════════════════════════════════

/**
 * Construct a scopedId = `${fileId}:${innerId}`. Asserts that neither fileId
 * nor innerId contains a colon (preventing double prefixing) and throws on
 * empty values.
 * @param fileId - the file identity, without a colon.
 * @param innerId - the part's in-file identity, without a colon.
 * @returns the combined scopedId string.
 */
export function toScopedId(fileId: FileId, innerId: InnerId): ScopedId {
  if (!fileId) throw new Error('[identity] toScopedId: fileId is empty')
  if (!innerId) throw new Error('[identity] toScopedId: innerId is empty')
  if (fileId.includes(':')) {
    throw new Error(`[identity] toScopedId: fileId "${fileId}" contains colon — did you pass a scopedId?`)
  }
  if (innerId.includes(':')) {
    throw new Error(`[identity] toScopedId: innerId "${innerId}" contains colon — did you pass a scopedId?`)
  }
  return `${fileId}:${innerId}` as ScopedId
}

/**
 * The single split entry point: asserts the input has exactly one colon and
 * returns the fileId and innerId components.
 * @param scopedId - the scopedId to split.
 * @returns an object with the fileId and innerId components.
 */
export function splitScopedId(scopedId: ScopedId): { fileId: FileId; innerId: InnerId } {
  if (!scopedId) throw new Error('[identity] splitScopedId: input is empty')
  const colonIdx = scopedId.indexOf(':')
  if (colonIdx === -1) {
    throw new Error(`[identity] splitScopedId: "${scopedId}" — no colon found, not a scopedId`)
  }
  const fileId = scopedId.slice(0, colonIdx)
  const innerId = scopedId.slice(colonIdx + 1)
  if (!fileId) throw new Error(`[identity] splitScopedId: "${scopedId}" — fileId is empty`)
  if (!innerId) throw new Error(`[identity] splitScopedId: "${scopedId}" — innerId is empty`)
  if (innerId.includes(':')) {
    throw new Error(`[identity] splitScopedId: "${scopedId}" — multiple colons, not a valid scopedId`)
  }
  return { fileId: fileId as FileId, innerId: innerId as InnerId }
}

/**
 * Format check: whether the string is a scopedId (contains a colon). Note that
 * a file root's nodeKey equals its fileId (no colon) and so returns false.
 * @param s - the string to test.
 * @returns true when the string is a scopedId, narrowing the type accordingly.
 */
export function isScopedId(s: string): s is ScopedId {
  return s.includes(':')
}

/**
 * Strip the `fileId:` prefix from a scopedId to obtain its innerId. Inputs
 * without a colon (already an innerId) are returned unchanged — the caller is
 * responsible for semantic correctness; this function only strips the prefix.
 * @param raw - a scopedId or a bare innerId string.
 * @returns the innerId portion of the input.
 */
export function toInnerId(raw: string): InnerId {
  if (!raw) throw new Error('[identity] toInnerId: input is empty')
  const colonIdx = raw.indexOf(':')
  if (colonIdx === -1) return raw as InnerId
  const stripped = raw.slice(colonIdx + 1)
  if (!stripped) throw new Error(`[identity] toInnerId: "${raw}" — innerId after colon is empty`)
  if (stripped.includes(':')) {
    throw new Error(`[identity] toInnerId: "${raw}" — multiple colons, cannot produce valid innerId`)
  }
  return stripped as InnerId
}