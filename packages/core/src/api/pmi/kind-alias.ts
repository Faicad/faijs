/**
 * api/pmi/kind-alias — 旧 kind 的读取归一（外部数据宽容兼容）
 *
 * `PmiItemKind` 的分轴是**适用范围**：`localNote`（贴在应用处）、`generalNote`
 * （整张图 / 整个零件适用，ASME Y14.100 §4.26）。早期数据用的是
 * `note` / `techNote` 两个旧名，其中 `note` 同时承载「有落点的局部注」与
 * 「无落点的通用注」两种情况——一个类型横跨两格。
 *
 * 本模块只做**读**：任何从外部进来的 `PmiSet`（3MF `<metadata name="faijs:pmi">`、
 * 历史 JSON 产物、导入的 STEP PMI）都先过这里。写出一律是新字面量，不存在旧名
 * 的写出路径。
 *
 * 归一是无损的：`kind` 是字符串枚举，缺 `schema` 版本位反而是少一份真源。
 */

import type { PmiItem, PmiItemKind, PmiLocalNote, PmiGeneralNote, PmiSet, PmiSetMeta } from './types'

/**
 * A PMI set exactly as it arrives from outside faijs (3MF metadata, historical JSON,
 * imported STEP PMI).
 *
 * `items` is deliberately `unknown[]`: legacy kinds (`note` / `techNote`) are not part of
 * `PmiItemKind` any more, so a foreign set genuinely cannot be typed as `PmiSet` before
 * this module has migrated it. Typing the input as `PmiSet` forced callers to cast away
 * exactly the legacy literals this function exists to handle.
 */
export interface PmiSetInput {
  readonly items: readonly unknown[]
  readonly meta?: PmiSetMeta
}

/** 旧 kind → 新 kind 的静态对照（`note` 的去向还需要「有无落点」才能定）。 */
const LEGACY_KINDS = { note: 'localNote', techNote: 'generalNote' } as const

/**
 * 这条数据是否使用旧 kind 字面量。
 *
 * @param kind - the raw kind literal from external data.
 * @returns `true` when `kind` is one of the legacy literals.
 */
export function isLegacyKind(kind: unknown): kind is keyof typeof LEGACY_KINDS {
  return typeof kind === 'string' && kind in LEGACY_KINDS
}

/** 对象是否带落点（`target` 或 `anchor`）——`localNote` 的判据。 */
function hasPlacement(o: Record<string, unknown>): boolean {
  return o.target !== undefined || o.anchor !== undefined
}

/**
 * 把一个 kind 字面量归一到当前枚举。
 *
 * `note` 的去向由 `hasPlacement` 决定：有落点 → `localNote`，无落点 → `generalNote`。
 * 新字面量原样返回；未知值也原样返回（由调用方的类型边界兜住，不在这里猜）。
 *
 * @param kind - the raw kind literal from external data.
 * @param hasPlacement - whether the item carries a `target` or an `anchor`.
 * @returns the normalized kind.
 */
export function normalizePmiKind(kind: unknown, hasPlacement: boolean): PmiItemKind {
  if (kind === 'note') return hasPlacement ? 'localNote' : 'generalNote'
  if (kind === 'techNote') return 'generalNote'
  return kind as PmiItemKind
}

/**
 * 把一条外部来的 PMI 条目归一到当前类型。
 *
 * 结构转换只有一处：旧 `note`（无落点）的 `text` 提到 `generalNote.items[0]`。
 * 其余条目只改 `kind`，字段原样保留。
 *
 * @param raw - one item parsed from external data.
 * @returns the migrated item, or `undefined` when the entry is not an object.
 */
export function migratePmiItem(raw: unknown): PmiItem | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const kind = normalizePmiKind(o.kind, hasPlacement(o))
  if (o.kind === 'note' && kind === 'generalNote') {
    const text = typeof o.text === 'string' ? o.text : ''
    const general: PmiGeneralNote = { kind: 'generalNote', items: [{ text }] }
    return general
  }
  if (o.kind === 'note' && kind === 'localNote') {
    const local: PmiLocalNote = { ...(o as unknown as Omit<PmiLocalNote, 'kind'>), kind: 'localNote' }
    return local
  }
  return { ...o, kind } as PmiItem
}

/**
 * 把一个外部来的 PMI 集归一到当前类型（逐条过 `migratePmiItem`）。
 *
 * @param raw - the parsed PMI set, as it arrived from outside faijs.
 * @returns a new set whose `kind` literals are all current; `meta` untouched.
 * @throws when `items` is not an array — a malformed foreign set is a caller bug, and
 *   returning it unmigrated would hand legacy `kind` literals to code that no longer
 *   accepts them.
 */
export function migratePmiSet(raw: PmiSetInput): PmiSet {
  if (!raw || !Array.isArray(raw.items)) {
    throw new Error('migratePmiSet: `items` must be an array (malformed foreign PMI set)')
  }
  const items: PmiItem[] = []
  for (const it of raw.items) {
    const migrated = migratePmiItem(it)
    if (migrated !== undefined) items.push(migrated)
  }
  return { items, meta: raw.meta }
}
