# Agent Note: Agent Note 两条硬性规则（实施前写 + 一 PR 一份）

Status: implemented

[English](2026-09-07-agent-note-two-hard-rules.md) | 中文

## Problem

仓库 Agent Note 大量是"垃圾"：9 天 59 份，多为 diff 摘要（删了哪些文件、改了哪些测试），与 commit message 重复；architecture 类 34 份里几乎没有纯架构决策。根因是时序——note 在实施完成后补写，决策信息已被上下文压缩冲掉，AI 只能从 diff 回写日志。

## Decision

在 `.agents/notes/README.md` 的 "When to write one" 章节加入两条硬性规则：

1. **实施前写 note。** 决策定稿（用户说"开始实施"）时先把 Agent Note 以 `proposed/` 写好，再动 plan 工作；验证通过后升 `implemented/`，只追加 `## Consequences`，`Problem`/`Decision`/`Alternatives considered` 提案时冻结。
2. **一个 PR/plan 只配一份 note，不按 commit 配。** 纯重构/测试迁移的 commit 不单独产 note。

## Alternatives considered

- **只靠 prompt 要求 AI 写好 note，不改流程。** 否决：事后补写时决策信息已不可恢复，prompt 措辞无法补回信息量，只能得到排版更好的日志。
- **加 CI 门禁检查 note 质量（禁止词表等）。** 否决：门禁是必要的补充，但本轮用户明确"只加两条规则"，禁止词表与脚本留作后续；先解决信息丢失的根因。

## Consequences

- README 的 "When to write one" 现含两条硬性规则（中英一致），配对记录（README.i18n.yaml）已更新。
- 规则 1 的首次实践：本 note 即在修改 README 之前以 `proposed/` 起草，`npm run doc-sync` 通过后升级为 `implemented/`。
- 本轮明确排除的范围：note 质量禁止词表与 CI 门禁脚本。
