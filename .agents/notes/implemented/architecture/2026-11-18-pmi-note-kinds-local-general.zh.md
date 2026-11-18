# Agent Note：PMI 注记类型改名为 `localNote` / `generalNote`

Status: implemented

[English](2026-11-18-pmi-note-kinds-local-general.md) | 中文

## Problem

两个 PMI 注记类型按**形状**命名，而不是按**适用范围**命名：`note` 是「一行文字 +
可选 `target`」，`techNote` 是「编号条目块」。ASME Y14.100 §4.26 按适用范围三分：
**general notes** 适用于整张图或关联清单；**local notes** 放在应用处、只对该区域 /
点适用。旧 `note` 同时承载两种情况（有 `target` = local，无 `target` = 单条一般要求），
因此只要还是一个桶装两种适用范围，任何两格命名都对不齐标准。

## Decision

改名，让**落点成为唯一分轴**：

- `note` → `localNote` —— 只对被贴附处适用的注记；必须带 `target` 或 `anchor`。
  两者皆缺时构造抛
  `[localNote] a local note needs a target or an anchor; use generalNote for
  requirements that apply to the whole part`。
- `techNote` → `generalNote` —— 适用于整个零件或整张图；携带 `items[]`，条目有
  `index` 时渲染带序号、无 `index` 时只渲染文字（单条无编号要求）。

改名贯穿整个 API 面：kind 字面量、`PmiLocalNote` / `PmiGeneralNote` /
`PmiGeneralNoteLine` 类型、`PmiItem` 联合、工厂 `localNote()` / `generalNote()`、
Shape 方法 `addLocalNote()` / `addGeneralNote()`、查询 `pmiGeneralNotes()`、
排版 `generalNoteLines()` / `formatGeneralNote()`（`api/pmi/general-note.ts`，
替代 `tech-note.ts`）、视图助手 `generalNoteTexts()`（原 `globalNoteTexts`，
只收 `generalNote`）。

**不导出任何旧名 alias** —— `note` / `techNote` / `pmiTechNotes` /
`formatTechNote` / `globalNoteTexts` 全部消失，旧 `.fai.js` 用旧名会解析失败。
**读外部数据仍然宽容**：`api/pmi/kind-alias.ts` 导出 `normalizePmiKind` /
`migratePmiItem` / `migratePmiSet`，3MF 元数据读取处调用 `migratePmiSet`，旧字面量
按有无落点落成 `localNote` 或 `generalNote`。内部严格、外部宽容是刻意分开的：
因为一个旧字面量拒收真实 3MF 文件是更糟的失败。

## Alternatives considered

- **保留旧名、只改文档**：否决 —— 旧的一对按形状命名，`localNote` 的语义仍然无法
  表达，下游只能继续靠 `target` 有无来猜。
- **`partNote` / `globalNote`**：否决 —— 「global」不是区分轴，「part」正是 *general*
  的定义词，且这一对是假对称。
- **保留一个发布周期的 alias**：用户否决 —— 发布出去的 alias 会让新旧两个名字同时
  活在符号表里，脚本会漂回旧名，改名永远收不干净。
- **把 general notes 折进 `localNote`、让 target 可选**：否决 —— 正是要修的那个缺陷
  本身（一个桶装两种适用范围）。

## Consequences

- 旧脚本必须迁移；失败形态是解析层的「未知成员」，立刻可见，而不是悄悄把 local 注
  记写成 general。
- 只借用标签的消费方（drawing 项目把两类都逐字编译进 `warnings[]`）无需行为改动，
  只改字面量。
- `generalNote` 仍携带 `items[]` / `title` / `category`，目前没有新的消费方——那是
  另一件待定的事。
