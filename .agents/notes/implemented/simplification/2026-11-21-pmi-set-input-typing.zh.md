# Agent Note: `migratePmiSet` 接受外部输入类型，而不是 `PmiSet`

Status: implemented

[English](2026-11-21-pmi-set-input-typing.md) | 中文

## Problem

`migratePmiSet` 的职责是把**来自 faijs 之外**的 PMI 集归一（3MF 的 `faijs:pmi`
元数据、历史 JSON、导入的 STEP AP242），其中包含 `normalizePmiKind` 会映射到
`localNote` / `generalNote` 的旧 kind 字面量 `note`、`techNote`。它的参数却声明为
`PmiSet`，其 `items` 是 `PmiItem[]`——而在适用范围分轴改名之后，`PmiItemKind` 已不再
包含 `note` 与 `techNote`。于是该函数唯一为之设计的输入形态，不用类型转换就传不进来，
迁移测试只能喂给声明类型明确拒绝的值（`TS2322: '"note"' 不能赋给 PmiItemKind`）。此外，
当 `items` 不是数组时，原守卫把 `raw` 原样返回而未经归一——等于把旧 kind 字面量静默交回
调用方。

## Decision

引入 `PmiSetInput { items: readonly unknown[]; meta?: PmiSetMeta }` 并以它作为参数类型。
`unknown[]` 是诚实的类型：归一之前，元素上的 kind 按定义就落在当前枚举之外。`items` 不是
数组时改为抛出携带上下文的错误，而不是原样返回——遵循仓库规则：未知/畸形输入要报错，
不得掩盖。唯一的生产调用方 `parsePmiFrom3mfMetadata` 本来就先校验 `items` 并把调用包在
`try` 里，其「畸形元数据 → `undefined`」的契约不变。

## Alternatives considered

- **保留 `PmiSet`，在测试里做类型转换。** 否决：转换会落在测试里而不是 API 上，今后每个
  外部数据调用方都要重复同一转换——签名会继续声称自己需要的是已归一化的输入。
- **接受 `PmiSet | unknown` 并在函数内分支。** 否决：`unknown` 本就覆盖 `PmiSet`，这个联合
  不增加任何表达能力，只会掩盖函数实际读取哪些字段。
- **`items` 非数组时继续返回 `raw`。** 否决：这正是仓库禁止的静默降级，而且它返回的值被
  标注为已归一的 `PmiSet`，实际并非如此。

## Consequences

- 旧 kind 的集合可以不转换直接传给 `migratePmiSet`，编译器现在能阻止调用方误传「已归一化」
  的假定。
- 传入结构损坏的集合（没有 `items` 数组）现在会得到带上下文的抛错，而不是一个透传值。
- `PmiSetInput` 从 `api/pmi/kind-alias` 导出；它是仅输入用的类型，刻意不作为公共 PMI 接口
  的一部分在该模块之外再导出。
