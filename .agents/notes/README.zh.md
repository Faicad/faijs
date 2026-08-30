# Agent Notes

[English](README.md) | 中文

Agent Notes 是决策记录：为什么做某项变更、放弃了什么、拒绝了哪些替代方案。它们存放在 `.agents/notes/` 下，按生命周期/类别树组织，与 `docs/` 中的常驻文档不同。

## Layout and naming

```
.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic-title.md
```

- **lifecycle**（闭合集合）：`proposed`、`implemented`、`rejected`
- **class**（闭合集合）：`feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`
- **filename**：`yyyy-mm-dd-topic-title.md`（日期后为 kebab-case 主题）

中文对应文件（`foo.zh.md`）及其 `.i18n.yaml` 记录与英文源文件并排放置。配对门禁负责它们的一致性。

## Lifecycle

- `proposed/` — 决策正在提案中，尚未采纳
- `implemented/` — 决策已采纳并交付；记录描述当前状态（现在时）
- `rejected/` — 提案未被采纳；原因写在 `Status:` 行上
- `archived/` — 冻结的历史 `implemented/` 记录，封存于 `manifest.json`；见 `archived/AGENTS.md`

## When to write one

每次非平凡变更必须包含至少一份 Agent Note。如果完整设计文档已存在于 `docs/plans/`，则 Agent Note 是链接到该文档的精简摘要。

## The file format

### Header block (first three lines, exactly)

```markdown
# Agent Note: <title>

Status: <status>
```

`Status:` 取值（必须与生命周期文件夹匹配）：
- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <原因，一行>`

### Body skeleton

#### `proposed/`

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

#### `implemented/`

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

#### `rejected/`

保留所有提案章节；结论写在 `Status:` 行上。

### `## Alternatives considered` — required

每份 Agent Note 必须包含此章节。列出每个替代方案及未被选择的原因。

## Relationship to `docs/plans/`

- `docs/plans/` 存放完整设计文档（需求、技术分析、实施计划）
- `.agents/notes/` 存放链接到完整设计文档的精简决策记录
- 当方案落地时，创建一份 `implemented/` Agent Note 摘要并链接到 `docs/plans/` 文档
