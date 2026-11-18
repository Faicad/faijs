/**
 * api/pmi/general-note — 通用注释的显示文本（单一真源）
 *
 * `PmiGeneralNote` 是「整张图 / 整个零件适用」的注释（ASME Y14.100 §4.26(a)
 * general notes）：既可以是编号的技术要求块，也可以是单条无编号的要求。
 * 它没有 `target` / `anchor`，因此属于图纸的通用注释区，三视图里只画一次。
 * 本模块把结构化条目展开成渲染行，宿主（工程图图层 / 看图 / 3D 编辑器）一律
 * 调用它，避免各端各写一套格式。
 *
 * 文本**不是数据**：`PmiGeneralNote.items` 的 `index` / `text` / `subItems` 才是真源，
 * `category` 是分类标签、不参与呈现，这里只做排版。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-thread-and-technotes-design.md §7
 */

import type { PmiGeneralNote } from './types'

/**
 * 把通用注释展开成逐行渲染文本。
 *
 * 顺序：标题（有则第一行）→ 每条 → 该条的子项（缩进三格）。
 * 有 `index` 的条目渲染成 `n. 文本`；没有 `index` 的单条渲染成裸文本——
 * 图上没印的序号不臆造。
 *
 * @param item - the general note.
 * @returns string[] 渲染行，可直接 push 进通用注释区。
 */
export function generalNoteLines(item: PmiGeneralNote): string[] {
  const lines: string[] = []
  if (item.title !== undefined && item.title.length > 0) lines.push(item.title)
  for (const clause of item.items) {
    lines.push(clause.index === undefined ? clause.text : `${clause.index}. ${clause.text}`)
    for (const sub of clause.subItems ?? []) lines.push(`   ${sub}`)
  }
  return lines
}

/**
 * 通用注释的完整显示文本（多行，以 `\n` 连接）。
 *
 * 例：`'技术要求\n1. 未注倒角 C0.3\n2. 未注公差按 GB/T 1804-m'`。
 *
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name formatGeneralNote
 * @returns string 多行显示文本。
 * @param item - the general note. type:PmiGeneralNote required:true
 * @example
 * const text = cad.formatGeneralNote(cad.pmiGeneralNotes(part0)[0])
 */
export function formatGeneralNote(item: PmiGeneralNote): string {
  return generalNoteLines(item).join('\n')
}
