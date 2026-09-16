# deepseek-harness 项目文档管理体系分析

> 日期：2026-08-30 ｜ 状态：分析文档（已完成分析）
> 分析对象：`C:\my\deepseek-harness` 项目（以下简称 DSH）

---

## 1. 三大文档目录的职责划分

DSH 的文档体系由三个顶层目录承载，职责边界由 `docs/AGENTS.md` 的 tier taxonomy（分层分类法）定义，并通过机器门禁强制执行。

### 1.1 `docs/` —— 人类面向文档

`docs/` 是**面向人类读者的文档**的唯一存放地。其内容受 `docs/AGENTS.md` 的完整文档标准约束，包括结构分层、教程/参考分类、字数预算和 slop 检查清单。

**子目录结构：**

| 子目录 | 职责 | 文档类型 |
|---|---|---|
| `docs/` 根 | 架构、开发指南、测试策略、配置目录等核心参考文档 | reference |
| `docs/i18n/` | 双语配对约定、翻译规则、术语表、翻译 prompt 模板 | reference |
| `docs/subsystems/` | 每个子系统的类型定义、语义和 Cordis API 参考页 | generated reference |
| `docs/cookbook/` | 逐步操作指南，含验证步骤 | tutorial |
| `docs/postmortem/` | 事故复盘——唯一允许叙事文体的层级 | reference (incident-scoped) |
| `docs/cordis-api/` | Cordis 核心 API 继承层级 | generated reference |
| `docs/cordis-tutorial/` | Cordis 入门教程 | tutorial |
| `docs/user/` | 面向产品的用户指南（发布到文档站） | tutorial/reference |

**判断规则：** 一篇文档属于 `docs/` 的充要条件是——它面向人类读者描述**当前系统的行为、架构或使用方式**。具体而言：

- 架构总览 → `docs/architecture.md`
- 贡献者指南 → `docs/development.md`
- 某子系统的类型/API → `docs/subsystems/<subsystem>.md`
- 逐步操作 → `docs/cookbook/`
- 事故分析 → `docs/postmortem/`

### 1.2 `.agents/notes/` —— 决策记录（Agent Notes）

`.agents/notes/` 是**设计决策记录**（Agent Notes）的存放地。Agent Notes 是"agent 写的 RFC"：记录**为什么**做了某个决策、**放弃了什么**、**否决了哪些替代方案**——这些内容代码和文档无法承载。

**目录结构：**

```
.agents/notes/
  README.md            ← Agent Notes 的规则文档
  AGENTS.md            ← 子树特定指令
  proposed/            ← 提案（未实施）
    {class}/
      yyyy-mm-dd-topic.md
      yyyy-mm-dd-topic.zh.md     ← 中文对侧
      yyyy-mm-dd-topic.i18n.yaml ← 一致性记录
  implemented/         ← 已实施决策
    AGENTS.md
    {class}/
      yyyy-mm-dd-topic.md
      ...
  rejected/            ← 被否决的提案
    {class}/
      ...
  archived/            ← 冻结归档
    AGENTS.md
    {class}/
      ...
```

**分类体系（路径编码的 class）：**

| Class | 覆盖范围 |
|---|---|
| `feature` | 面向用户或模型的新能力 |
| `bug-fix` | 修正缺陷 |
| `simplification` | 在不增加能力的前提下移除代码/行为 |
| `architecture` | 关于交付源码的结构性决策 |
| `process` | 代码周边的工具、策略或工作流 |
| `testing` | 测试基础设施与策略 |

**判断规则：** 一份文档属于 `.agents/notes/` 的充要条件是——它记录一个**影响代码库的决策或提案**的**理由和替代方案**。具体而言：

- "为什么选了方案 A 而不是 B" → Agent Note
- "某次事故的根因和修复决策" → Agent Note（bug-fix 类）
- "新增工具/门禁的策略" → Agent Note（process 类）
- "系统当前怎么工作" → `docs/`（不是 Agent Note）

**生命周期流转：** `proposed/` → `implemented/` 或 `proposed/` → `rejected/`；`implemented/` 中未来价值低的记录可 → `archived/`（永久冻结）。

**与 `docs/` 的核心区别：** Agent Notes 记录**决策的 why 和 what-given-up**；`docs/` 记录**系统的 what-is**。Agent Notes 用现在时描述已交付现实（`implemented/`），不写变更历史；`docs/` 描述当前状态，也不写变更历史。变更历史只存在于 git 历史、commit message 和 PR 中。

### 1.3 `.agents/skills/` —— 可复用工作流

`.agents/skills/` 存放**可复用的 agent 工作流和决策标准**。每个 skill 是一个目录，包含一个 `SKILL.md` 文件，可选的 `agents/` 子目录和 `references/` 子目录。

**判断规则：** 一份文档属于 `.agents/skills/` 的充要条件是——它描述一个**可被不同 agent 在不同任务中重复使用的工作流或判断标准**。具体而言：

- "如何应用文档标准" → `dsh-doc-standards`
- "如何翻译文档" → `dsh-translate-docs`
- "如何审查文档/代码" → `dsh-code-review`
- "如何归档 Agent Notes" → `dsh-archive-agent-notes`

**与 `docs/` 的区别：** skills 是操作指南（告诉 agent "怎么做"），docs 是参考文档（告诉人/agent "系统是什么"）。
**与 `.agents/notes/` 的区别：** skills 是可复用的工作流模板，notes 是一次性的决策记录。

### 1.4 其他文档位置

| 位置 | 职责 |
|---|---|
| 根 `AGENTS.md` | 每次会话的常驻指令（1-3 行/条，链接到 home） |
| 子树 `AGENTS.md` | 子树特定指令（`packages/`、`docs/`、`.agents/notes/` 等） |
| `CLAUDE.md` | 指向 `AGENTS.md` 的符号链接 |
| Package README | 每个包的契约：配置、语义、限制、扩展点 |
| `scripts/` | 门禁脚本和生成器 |

### 1.5 放置决策流程图

```
拿到一个信息/决策/文档内容
    │
    ├─ 是"当前系统是什么/怎么用"的面向人类描述？
    │   └─ docs/（按 tier 选子目录：架构→root, 子系统→subsystems/, 操作指南→cookbook/, 事故→postmortem/）
    │
    ├─ 是"为什么做了这个决策、放弃了什么"？
    │   └─ .agents/notes/（选 lifecycle: proposed/implemented/rejected, 选 class: feature/bug-fix/...）
    │
    ├─ 是"怎么反复做某类工作"的可复用工作流？
    │   └─ .agents/skills/
    │
    ├─ 是"每次会话都要看到的简短指令"？
    │   └─ AGENTS.md（根或子树）
    │
    ├─ 是"某个包的契约和限制"？
    │   └─ packages/<pkg>/README.md
    │
    └─ 是"门禁脚本或生成器"？
        └─ scripts/
```

---

## 2. 代码开发完成后文档的打包、更新与保鲜

### 2.1 `doc-sync` 门禁聚合

DSH 将所有文档检查整合为一个 `doc-sync` 门禁聚合（通过 `scripts/run-gates.ts` 的 `docSyncLeafGates()` 函数定义）。运行 `pnpm run doc-sync` 时执行以下所有叶子门禁：

| 门禁 ID | 脚本 | 作用 |
|---|---|---|
| `doc-typecheck` | `scripts/doc-typecheck.ts` | 文档中的 `ts` 代码块必须可编译 |
| `docs-site-build` | VitePress 构建 | 文档站构建（兼做死链检查） |
| `doc-graphs` | `scripts/gen-doc-graphs.ts --check` | 文档依赖图新鲜度 |
| `markdown-links` | `scripts/verify-md-links.ts` | 相对 Markdown 链接必须可达 |
| `type-equivalence` | `scripts/verify-type-equiv.ts` | 粘贴的类型声明不能漂移 |
| `translation-pairing` | `scripts/verify-translation-pairing.ts` | 双语配对完整性、一致性和结构 |
| `markdown-wrap` | `scripts/verify-md-wrap.ts` | 一段一段地写，不硬换行 |
| `export-jsdoc` | `scripts/verify-export-jsdoc.ts` | 公开导出必须有 JSDoc |
| `agent-note-classification` | `scripts/verify-agent-note-classification.ts` | Agent Note 路径/分类合闭集 |
| `agent-note-format` | `scripts/verify-agent-note-format.ts` | Agent Note 文件格式（头部/骨架/替代方案） |
| `archived-agent-notes` | `scripts/verify-archived-agent-notes.ts` | 归档 Agent Note 冻结检查 |
| `doc-refs` | `scripts/verify-doc-refs.ts` | TS 源码注释中的文档引用可达 |
| `mermaid` | `scripts/verify-mermaid.ts` | Mermaid 图可渲染 |
| ... | | 共约 25 个叶子门禁 |

### 2.2 文档同步规则

**核心规则：** 代码改动和文档更新在同一个 PR 中完成。具体要求：

1. **Agent Note 规则：** 每个非平凡变更必须在同一个 PR 中新增或更新至少一份 Agent Note。只有纯机械性/局部编辑可豁免。
2. **README 和 JSDoc 规则：** 包 README 和 JSDoc 是变更的一部分——配置键、默认值、错误码、协议字段的变更在同一 commit 中更新它们。
3. **双语文档配对规则：** 编辑配对文档的任一侧时，同一 PR 中更新对侧并 `--write` 重新记录。
4. **类型定义规则：** 重塑已文档化的类型时，同一变更中更新所属的子系统页面。
5. **归档 Agent Note 冻结规则：** 归档后的 Agent Note 永久冻结，不再编辑、翻译、更新。

### 2.3 文档不过时的保证机制

DSH 通过以下机制确保文档不过时：

1. **机器门禁强制：** 所有文档约束通过脚本门禁执行，CI 每次运行 `doc-sync` 全量检查。
2. **implemented Agent Note 保持同步：** 当代码后续移动文件、重命名包或更改键名/默认值时，Agent Note 在同一个变更中同步更新（仅限事实——路径、名称、结构——而非决策本身）。
3. **生成文档新鲜度门禁：** 生成的参考文档（catalog、API、module graph 等）有对应的 `--check` 门禁，源码变更后不重新生成会失败。
4. **类型等价门禁：** `verify-type-equiv` 检查文档中粘贴的类型声明是否与源码漂移。
5. **Markdown 链接门禁：** `verify-md-links` 确保所有相对链接可达——移动或删除文档后断链会立即失败。
6. **文档引用门禁：** `verify-doc-refs` 确保 TS 源码注释中引用的文档路径可达。
7. **slop 检查清单：** `docs/AGENTS.md` 定义了手工审计清单，包括"同一规则多处重复""叙事历史""实现状态注释"等检查项，通过 `dsh-doc-standards` skill 执行。
8. **pre-commit hooks：** `lefthook.yml` 配置了 pre-commit 和 pre-push 阶段的文档检查。
9. **CLAUDE.md 符号链接：** 根、packages/、examples/ 的 CLAUDE.md 都指向 AGENTS.md，编辑时只能编辑真实文件。

### 2.4 文档"打包"

DSH 使用 VitePress 构建文档站（`website/` 目录）：

- `pnpm run docs:build` 构建 VitePress 站点并验证文档站片段
- `pnpm run docs:build:mpa` 用 MPA 模式构建（CI Windows 用）
- 文档站投影 `docs/` 中选定的双语文档源

---

## 3. 中英文同步机制

### 3.1 三文件配对模型

每篇在范围内的文档由**三个同目录文件**组成：

| 文件 | 角色 |
|---|---|
| `foo.md` | 英文文档 |
| `foo.zh.md` | 中文文档 |
| `foo.i18n.yaml` | 一致性记录（两侧 git blob hash） |

- 不设 locale 目录，不设独立翻译仓库，不写交叉双语文件
- 一个 PR 永远不落地一个语言而缺少另外两个文件

### 3.2 配对约定

1. **两种语言等权：** 文档可以先用任一语言撰写和评审，对侧从它翻译。两文件谁也不高于谁。
2. **结构镜像：** 标题层级和顺序、列表种类、有序列表起始值、表格行列数、语义链接目标、代码块逐字节相同。
3. **语言切换行：** 中文文件在 H1 之后立即链接回英文：`[English](foo.md) | 中文`；英文文件回应：`English | [中文](foo.zh.md)`。
4. **一致性记录：** `foo.i18n.yaml` 记录两侧在最后一次确认一致时的 git blob hash。编辑任一侧后不重新记录会触发门禁失败。

### 3.3 同步工作流

**常规更新路径（轻量路径）：**

1. 在任一语言中编辑文档
2. 在一个术语引导的单次翻译中直接更新对侧
3. `pnpm run verify-translation-pairing --write <pair>` 重新记录两侧 hash

**扩展工作流（仅用户显式调用 `dsh-translate-docs`）：**

1. **更新路径（briefing 驱动）：**
   - `pnpm run gen-translation-brief <file>` 生成变更简报（最窄安全对齐粒度的差异映射）
   - 纯代码块变更可用 `--apply` 机械插入
   - 正文差异委派给子 agent，传递简报
   - 最小化编辑覆盖差异，保留未变更部分的已评审措辞
2. **新配对路径（全文翻译）：**
   - 子 agent 先读源文档（i18n README、translation-rules、terminology、style-samples），再逐节翻译
   - Pass 1：以母语技术作者身份重写，不逐句转换
   - Pass 2：逐子句对照源文验证
   - 单独阅读完成的对侧，修改仅在孤立时才显现的别扭措辞

### 3.4 术语管理

- `docs/i18n/terminology.md` 是术语真源（双向约束）
- 分三类：缩写类（中英文均用缩写）、英文类（中文保留英文）、双语类（中英文各用中英文）
- 每个条目有"中文""首次出现""不要译作"列
- 翻译前必须加载术语表，不是"感觉不确定时"才查
- 未收录的术语需有可引用的中文 OSS/厂商来源先例，否则保留英文并列入「待定术语」

### 3.5 翻译质量保证

- `verify-translation-pairing` 门禁检查：配对完整性、hash 一致性、语言切换行、结构签名（标题层级、代码块、表格行列、列表种类等）
- **门禁的局限：** 通过只意味着两侧在当前内容上的一致性得到了确认，不代表确认本身可靠。翻译质量是评审人的职责。
- `translation-prompt.md` 是自动化翻译流水线的 prompt 模板，逐字进入模型请求

### 3.6 排版规范

中文侧的排版规则（基于 MDN、K8s、Vue.js 中文翻译社区共识和 W3C clreq）：

- 中英文/数字之间加半角空格
- 中文用全角标点
- 偏好冒号/句号/逗号/括号而非破折号
- 并列项用顿号
- 不用全角数字/字母
- 专有名词保持规范大小写
- 第二人称用"你"不用"您"

---

## 4. 子目录/子包的文档组织

### 4.1 分层分类法（tier taxonomy）

DSH 的 `docs/AGENTS.md` 定义了"一个事实一个家"的分层分类法：

| Tier | 职责 | 不该放这里的内容 |
|---|---|---|
| 根 `AGENTS.md` | 常驻指令（1-3 行/条 + 链接） | 故事、示例、流程、从链接中复述的内容 |
| 子树 `AGENTS.md` | 子树特定指令 | 根文件已覆盖的全局规则 |
| `architecture.md` | 有序映射：组合、核心包、循环、seam、扩展点 | 类型定义、每包细节、决策理由 |
| `subsystems/` | 每子系统一页：类型定义、语义、API | 行为叙述（→ architecture.md） |
| Agent Notes | 决策记录：why、放弃什么、必需验证 | 迁移计划、验收清单 |
| `postmortem/` | 事故故事——唯一允许叙事文体的层级 | — |
| `cookbook/` | 逐步操作指南 + 验证步骤 | 设计理由（→ Agent Note） |
| Package README | 每包契约：配置、语义、限制、扩展点 | JSDoc 复述、生成的目录复述 |
| Generated reference | 从源码重新生成的穷举参考 | 手工编辑生成内容 |

### 4.2 子树 AGENTS.md

每个子树有自己的 `AGENTS.md`，只写该子树特定的指令：

- `docs/AGENTS.md` —— 文档标准（结构、tier、预算、slop 清单）
- `packages/AGENTS.md` —— 包特定规则（插件导出、可选服务、测试策略等）
- `examples/AGENTS.md` —— 示例特定指令
- `.agents/notes/AGENTS.md` —— Agent Notes 的子树指令
- `.agents/notes/implemented/AGENTS.md` —— implemented Agent Notes 的特定指令
- `.agents/notes/archived/AGENTS.md` —— 归档 Agent Notes 的冻结规则

**核心原则：** 子树 `AGENTS.md` 只写子树特定指令，不重复根 `AGENTS.md` 已覆盖的全局规则。

### 4.3 Package README

每个包的 README 是该包的契约文档，包含：

- 配置（config 字段及其语义）
- 语义（行为约定）
- 限制（`## Known Limitations and Deferred Work`）
- 扩展点
- Model Experience（模型可见效果）

Package README 不复述 JSDoc、不复述生成的目录、不写其他包的内容。

### 4.4 放置规则总结

- bug → `docs/postmortem/`
- 理由 → `.agents/notes/`
- 流程 → `docs/cookbook/`
- 类型定义 → `docs/subsystems/`
- 包契约 → Package README
- 常驻指令 → 根 `AGENTS.md` + 理由链接
- 子树特定规则 → 子树 `AGENTS.md`

---

## 5. 保证文档规范实施的脚本体系

### 5.1 脚本清单

| 脚本 | 门禁 ID | 作用 |
|---|---|---|
| `scripts/agent-note-tree.ts` | — | Agent Note 树结构共享真源（lifecycle/class 闭集） |
| `scripts/verify-agent-note-classification.ts` | `agent-note-classification` | 路径/分类闭集 + 旧路径禁止 |
| `scripts/verify-agent-note-format.ts` | `agent-note-format` | 文件格式（头部/骨架/替代方案/禁用标题） |
| `scripts/verify-archived-agent-notes.ts` | `archived-agent-notes` | 归档三文件完整性 + 内容冻结 |
| `scripts/verify-md-links.ts` | `markdown-links` | 相对链接可达 + 锚点可达 |
| `scripts/verify-md-wrap.ts` | `markdown-wrap` | 一段一行，不硬换行 |
| `scripts/verify-doc-refs.ts` | `doc-refs` | TS 注释中的文档引用可达 |
| `scripts/verify-translation-pairing.ts` | `translation-pairing` | 双语配对完整性 + hash + 结构签名 |
| `scripts/translation-pairing.ts` | — | 配对解析、结构签名、范围谓词 |
| `scripts/translation-links.ts` | — | 语言切换行检查 + 链接 locale |
| `scripts/translation-pairing-record.ts` | — | sidecar 记录解析/渲染 |
| `scripts/translation-pairing-git.ts` | — | git blob hash / index 读取 |
| `scripts/gen-translation-brief.ts` | — | 翻译变更简报生成器 |
| `scripts/markdown.ts` | — | 共享 Markdown 解析（mdast） |
| `scripts/repo-files.ts` | — | 仓库文件发现 + 符号链接去重 |
| `scripts/run-gates.ts` | — | 门禁聚合调度器（`doc-sync` 等模式） |
| `scripts/doc-typecheck.ts` | `doc-typecheck` | 文档中 `ts` 代码块编译检查 |
| `scripts/verify-type-equiv.ts` | `type-equivalence` | 粘贴类型声明漂移检查 |
| `scripts/verify-mermaid.ts` | `mermaid` | Mermaid 图可渲染 |
| `scripts/verify-export-jsdoc.ts` | `export-jsdoc` | 公开导出 JSDoc 检查 |

### 5.2 配置文件

| 文件 | 作用 |
|---|---|
| `scripts/translation-pairing.manifest.json` | 双语配对排除清单（只含显式排除项） |
| `scripts/type-equiv.manifest.json` | 类型等价注册清单 |

### 5.3 Git hooks 自动化

`lefthook.yml` 配置：

- **pre-commit：**
  - 翻译配对（staged records）—— `verify-translation-pairing --cached {staged_files}`
  - 归档 Agent Notes —— `verify-archived-agent-notes`
  - lint（staged TS）
  - third-party notices 自动重新生成
  - whitespace 检查
  - vendor manifest 守卫
- **pre-merge-commit：** 同 pre-commit 的翻译配对和归档检查
- **pre-push：** typecheck

### 5.4 CI 门禁

`package.json` scripts 中的文档相关命令：

```sh
pnpm run doc-sync          # 全量文档门禁
pnpm run verify-md-wrap    # 单独运行
pnpm run verify-md-links
pnpm run verify-agent-note-format
pnpm run verify-agent-note-classification
pnpm run verify-archived-agent-notes
pnpm run verify-translation-pairing
pnpm run gen-translation-brief
pnpm run verify-doc-refs
pnpm run docs:build        # VitePress 构建 + 死链检查
```

CI 通过 `run-gates.ts` 的 `doc-sync` 模式并行运行所有文档叶子门禁。

### 5.5 Skills 体系

以下 skills 支撑文档规范的人工执行：

| Skill | 职责 |
|---|---|
| `dsh-doc-standards` | 文档放置、审计、预算、验证 |
| `dsh-prose-standard` | 散文标准、必需覆盖、编辑判断 |
| `dsh-translate-docs` | 扩展翻译工作流（仅用户显式调用） |
| `dsh-archive-agent-notes` | Agent Note 归档判断和工作流 |
| `dsh-pre-push-checks` | 推送前检查工作流 |
| `dsh-trim-cot-leakage` | 推理轨迹泄漏检查和修剪 |
| `dsh-find-simplifications` | 寻找简化机会 |
| `dsh-code-review` | 代码审查工作流 |
| `dsh-merging-stacked-prs` | 堆叠 PR 合并工作流 |

---

## 6. 总结：DSH 文档体系的核心设计原则

1. **一个事实一个家（one home per fact）：** 每条规则/事实只有一个权威归属层，其他地方只链接不重复。
2. **机器检查优先于人工检查：** 凡是可以机器检查的约束（链接可达、结构一致、格式合规、类型等价、字数预算），都通过脚本门禁执行。
3. **文档是变更的一部分：** 代码改动和文档更新在同一个 PR 中完成，`doc-sync` 门禁在 CI 中强制执行。
4. **决策记录与当前状态分离：** Agent Notes 记录决策的 why/what-given-up；docs 记录系统的 what-is；两者都不写变更历史。
5. **双语等权：** 任一语言都可以先写，对侧从它翻译；配对门禁确保结构一致性，翻译质量靠人工评审。
6. **生成文档不可手改：** 所有从源码生成的参考文档（catalog、API、graph）有新鲜度门禁，必须通过生成器更新。
7. **归档永久冻结：** 低价值 Agent Note 归档后永久冻结，不再编辑、翻译、更新，只作为历史快照。
8. **CLAUDE.md 符号链接 AGENTS.md：** 统一编辑入口，避免指令分叉。
