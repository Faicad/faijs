# Bilingual Document Pairing

[English](README.md) | 中文

每个在范围内的文档是同一目录下的三文件组合：

| File | Role |
|---|---|
| `foo.md` | 英文源文件 |
| `foo.zh.md` | 中文翻译 |
| `foo.i18n.yaml` | 一致性记录（双方 git blob hash） |

## Scope

在范围内：
- 根目录 `README.md`
- `docs/**/*.md`（除 `docs/plans/`、`docs/analysis/`、`docs/AGENTS.md`）
- `.agents/notes/**/*.md`（除 `AGENTS.md` 文件）

不在范围内（在 `scripts/translation-pairing.manifest.json` 中排除）：
- `docs/plans/` — 设计文档，单语言（中文）
- `docs/analysis/` — 技术分析，单语言（中文）
- `AGENTS.md`、`docs/AGENTS.md`、`.agents/notes/AGENTS.md` — 指令文件，仅英文
- `docs/i18n/terminology.md`、`docs/i18n/style-samples.md`、`docs/i18n/translation-prompt.md` — 天然双语或机器消费

## Consistency record

`.i18n.yaml` 文件记录上次确认一致时双方的 git blob hash：

```yaml
foo.md: <40-hex git blob hash>
foo.zh.md: <40-hex git blob hash>
```

当任一方变更后，配对在记录更新前处于不同步状态，使用 `npx tsx scripts/verify-translation-pairing.ts --write` 更新。

## Language switcher

每个翻译文档必须链接到其对应文件。中文方链接到英文方，英文方链接到中文方（当英文方不是生成文档的规范源时）。

## Structural matching

双方必须具有相同的 Markdown 结构：相同的标题、代码块（生成区域在配对文档路径归一化后必须字节一致）、列表结构。门禁 `verify-translation-pairing` 负责检查。

翻译约定见 [translation-rules.md](translation-rules.zh.md)，术语表见 [terminology.md](terminology.md)。
