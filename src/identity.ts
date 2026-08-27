/**
 * identity.ts — 全仓唯一的 ID 品牌类型定义与信任点（f0，零依赖，可脱离 web 运行）
 *
 * 设计文档：docs/plans/2026-08-24-id-branded-a1a2a3-implementation.md §0 / §2
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
 * | `StmtId` | 每条语句的 id（`CadStatement.id`），无赋值语句也有 | `s1` / `s<N>` |
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

export type FileId       = string & { readonly [__fileId]:      true }
export type InnerId      = string & { readonly [__innerId]:     true }
export type ScopedId     = string & { readonly [__scopedId]:    true }
export type StmtId       = string & { readonly [__stmtId]:      true }   // CadStatement.id（无赋值语句也有）
export type PartName     = string & { readonly [__partName]:    true }   // 左值；split outputs 双值
export type GroupName    = PartName & { readonly [__groupName]: true }   // grp_N ⊆ PartName
export type RefId        = string & { readonly [__refId]:       true }
export type ReferenceId  = string & { readonly [__referenceId]: true }
export type SelectorKey  = string & { readonly [__selectorKey]: true }
export type OccurrenceId = string & { readonly [__occurrenceId]: true }
export type ShapeId      = string & { readonly [__shapeId]:     true }
export type FaceId       = string & { readonly [__faceId]:      true }
export type EdgeId       = string & { readonly [__edgeId]:      true }
export type NodeId       = string & { readonly [__nodeId]:      true }

export type StatementId  = StmtId   // 别名（= CadStatement.id，≠ PartName 语义，见 §0）
export type FaceSelector = FaceId   // 别名（网格 FaceDescriptor 无 id，暂不用）

// ═════════════════════════════════════════════════════════════════════════
// 唯一信任点（string → ID 的唯一大门）
// ═════════════════════════════════════════════════════════════════════════

export function asFileId(raw: string): FileId {
  return raw as FileId
}

export function asInnerId(raw: string): InnerId {
  return raw as InnerId
}

export function asScopedId(raw: string): ScopedId {
  return raw as ScopedId
}

export function asStmtId(raw: string): StmtId {
  return raw as StmtId
}

export function asPartName(raw: string): PartName {
  return raw as PartName
}

export function asGroupName(raw: string): GroupName {
  return raw as GroupName
}

export function asRefId(raw: string): RefId {
  return raw as RefId
}

export function asReferenceId(raw: string): ReferenceId {
  return raw as ReferenceId
}

export function asSelectorKey(raw: string): SelectorKey {
  return raw as SelectorKey
}

export function asOccurrenceId(raw: string): OccurrenceId {
  return raw as OccurrenceId
}

export function asShapeId(raw: string): ShapeId {
  return raw as ShapeId
}

export function asFaceId(raw: string): FaceId {
  return raw as FaceId
}

export function asEdgeId(raw: string): EdgeId {
  return raw as EdgeId
}

export function asNodeId(raw: string): NodeId {
  return raw as NodeId
}

// ═════════════════════════════════════════════════════════════════════════
// ScopedId 构造 / 拆分（3d 场景树语义；fai 仅在此处实现，3d re-export）
// ═════════════════════════════════════════════════════════════════════

/**
 * 构造 scopedId = `${fileId}:${innerId}`。
 *
 * 断言 fileId / innerId 均无冒号（防双重前缀），空值抛错（CLAUDE.md 案例 2）。
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
 * 唯一拆分入口。断言恰好一个冒号，返回 { fileId, innerId }。
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
 * 格式判断：是否为 scopedId（含冒号）。
 *
 * 注意：file 根节点 nodeKey = fileId（无冒号），isScopedId 返回 false。
 */
export function isScopedId(s: string): s is ScopedId {
  return s.includes(':')
}

/**
 * 剥离 scopedId 的 `fileId:` 前缀得到 innerId。
 *
 * 输入无冒号（本身就是 innerId）时原样返回——收敛了 3d 端 ModelGroup 等
 * 历史 `toInnerId(incomingScopedId || src.name)` 的兜底逻辑：
 * 传入侧必须自行保证语义正确，本函数只负责"剥离前缀"这一件事。
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