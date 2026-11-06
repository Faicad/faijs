/**
 * api/pmi/tech-note — 技术要求块的显示文本（单一真源）
 *
 * `PmiTechNote` 是零件级编号条目块，与单条自由文本 `PmiNote` 互补：
 * 它没有 `target`，因此和「无目标的 note」一样属于图纸右下角的全局注释块，
 * 三视图里只画一次。本模块把结构化条目展开成渲染行，宿主（工程图图层 /
 * 看图 / 3D 编辑器）一律调用它，避免各端各写一套格式。
 *
 * 文本**不是数据**：`PmiTechNote.items` 的 `index` / `text` / `subItems` 才是真源，
 * `category` 是分类标签、不参与呈现，这里只做排版。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-thread-and-technotes-design.md §7
 */

import type { PmiTechNote } from './types'

/**
 * 把技术要求块展开成逐行渲染文本。
 *
 * 顺序：标题（有则第一行）→ 每条编号条目 → 该条的子项（缩进两格）。
 * 子项保持图纸原文，不自动补 `a)` 之类的序号——图上没印的序号不臆造。
 *
 * @param item - the technical-requirement block.
 * @returns string[] 渲染行，可直接 push 进全局注释块。
 */
export function techNoteLines(item: PmiTechNote): string[] {
  const lines: string[] = []
  if (item.title !== undefined && item.title.length > 0) lines.push(item.title)
  for (const clause of item.items) {
    lines.push(`${clause.index}. ${clause.text}`)
    for (const sub of clause.subItems ?? []) lines.push(`   ${sub}`)
  }
  return lines
}

/**
 * 技术要求块的完整显示文本（多行，以 `\n` 连接）。
 *
 * 例：`'技术要求\n1. 未注倒角 C0.3\n2. 未注公差按 GB/T 1804-m'`。
 *
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name formatTechNote
 * @returns string 多行显示文本。
 * @param item - the technical-requirement block. type:PmiTechNote required:true
 * @example
 * const text = cad.formatTechNote(cad.pmiTechNotes(part0)[0])
 */
export function formatTechNote(item: PmiTechNote): string {
  return techNoteLines(item).join('\n')
}
