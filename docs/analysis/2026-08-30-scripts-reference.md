# scripts/ 脚本说明文档

> 日期：2026-08-30
> 状态：参考文档

本文档说明 `scripts/` 目录下每个脚本的用途、调用方、使用场合，以及能否主动调用。

---

## 分类总览

脚本分为四类：

| 类别 | 说明 | 能否主动调用 |
|---|---|---|
| **门禁脚本**（`verify-*.ts`、`doc-typecheck.ts`） | 文档规范检查，被 `doc-sync` 或 CI 调用 | ✅ 可主动调用（调试/修复时） |
| **共享模块**（`markdown.ts`、`repo-files.ts`、`jsdoc.ts` 等） | 被其他脚本 import 的纯函数库 | ❌ 不可独立运行（无入口） |
| **工具脚本**（`archive-plans.mjs`、`gen-translation-brief.ts`、`merge-translation-pairing.ts`） | 独立工具，解决特定工作流 | ✅ 可主动调用 |
| **配置文件**（`*.manifest.json`） | JSON 数据文件，被脚本读取 | ❌ 不是脚本，手动编辑 |

---

## 一、门禁脚本（12 个 verify-* + doc-typecheck）

### `scripts/verify-md-links.ts`

- **用途**：检查所有 Markdown 文件中的相对链接、图片、定义引用是否能正确解析。目标文件必须存在；`#fragment` 锚点必须指向真实标题或 `<a id>`。外部 URL（`https:`、`mailto:`）和根绝对路径（`/path`）不检查。
- **调用方**：`npm run verify-md-links`；被 `doc-sync` 第 1 步调用；CI `8/9 doc-sync` 步骤。
- **使用场合**：新增/修改文档中的链接后，或 CI 门禁。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-md-links.ts`
- **依赖**：`markdown.ts`、`repo-files.ts`

### `scripts/verify-md-wrap.ts`

- **用途**：拒绝跨多物理行的散文段落。GFM AST 区分段落（含列表和引用中的）与多行结构节点。一个散文段落必须写在一个物理行上（不硬换行）。代码块和表格豁免。
- **调用方**：`npm run verify-md-wrap`；被 `doc-sync` 第 2 步调用。
- **使用场合**：写完文档后检查是否有硬换行段落。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-md-wrap.ts`
- **依赖**：`markdown.ts`、`repo-files.ts`

### `scripts/verify-doc-budgets.ts`

- **用途**：从 `doc-budgets.manifest.json` 读取字数预算上限，检查每个列出的常驻文档的 `wc -w` 式单词数是否超限。`--list` 模式报告当前用量。超限即失败；提高上限需要 PR 中的理由说明。
- **调用方**：`npm run verify-doc-budgets`；被 `doc-sync` 第 3 步调用。
- **使用场合**：文档膨胀检查。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-doc-budgets.ts` 或 `--list` 查看用量。
- **依赖**：无（独立脚本，读取 JSON manifest）

### `scripts/verify-agent-note-format.ts`

- **用途**：检查 Agent Note 的头部格式（前三行严格为 `# Agent Note: <title>` / 空行 / `Status: <status>`）、lifecycle 特定章节（proposed 有 `## Proposal`、`## Acceptance criteria`、`## Risks`；implemented 有 `## Decision`、`## Consequences`）、`## Alternatives considered` 必需、banned headings 等。
- **调用方**：`npm run verify-agent-note-format`；被 `doc-sync` 第 4 步调用。
- **使用场合**：写完 Agent Note 后或 CI。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-agent-note-format.ts`
- **依赖**：`agent-note-tree.ts`

### `scripts/verify-agent-note-classification.ts`

- **用途**：检查 Agent Note 的 lifecycle/class 路径和日期文件名。结构规则共享自 `agent-note-tree.ts`；封闭分类规则在 `.agents/notes/README.md`。还检查 `docs/rfc`、`docs/rfcs` 等遗留目录不存在。
- **调用方**：`npm run verify-agent-note-classification`；被 `doc-sync` 第 5 步调用。
- **使用场合**：创建 Agent Note 后检查路径是否正确。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-agent-note-classification.ts`
- **依赖**：`agent-note-tree.ts`

### `scripts/verify-translation-pairing.ts`

- **用途**：强制执行完整的英文/中文双语配对、匹配的 Markdown 结构、以及每篇在范围内文档的 git blob hash 一致性记录。manifest 只包含显式排除项。`--list` 报告状态；`--write <pairs...>` 记录已确认一致的配对；`--cached <pairs...>` 检查 index 中的确切字节。
- **调用方**：`npm run verify-translation-pairing`；被 `doc-sync` 第 6 步调用。
- **使用场合**：新增/修改文档后检查双语配对是否完整且一致。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-translation-pairing.ts`（检查）；`npx tsx scripts/verify-translation-pairing.ts --write`（记录配对）；`npx tsx scripts/verify-translation-pairing.ts --list`（查看状态）。
- **依赖**：`translation-pairing-git.ts`、`translation-pairing-record.ts`、`translation-pairing.ts`、`translation-links.ts`

### `scripts/verify-type-equiv.ts`

- **用途**：检查文档中每个 `ts type-equiv` 和 `ts public-api` 代码块与 manifest 中声明的源代码符号是否一致。普通条目保留完整声明；`public-api` 条目保留类的 body-stripped 公开声明。比较忽略空白和非 JSDoc 注释，但保留声明结构和 JSDoc。
- **调用方**：`npm run verify-type-equiv`；被 `doc-sync` 第 7 步调用。
- **使用场合**：文档中粘贴的类型声明与源码是否同步。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-type-equiv.ts`
- **依赖**：`markdown.ts`、`paired-markdown-derivatives.ts`、`repo-files.ts`

### `scripts/verify-mermaid.ts`

- **用途**：用 Mermaid 库本身解析仓库中每个 Mermaid fence（` ```mermaid ` 代码块），捕获链接检查和 fence 检查无法发现的语法错误。范围与 Markdown 链接门禁一致。使用 jsdom 提供 DOM 环境。
- **调用方**：`npm run verify-mermaid`；被 `doc-sync` 第 8 步调用。
- **使用场合**：文档中有 Mermaid 图时检查语法。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-mermaid.ts`
- **依赖**：`repo-files.ts`、`jsdom`、`mermaid` npm 包

### `scripts/verify-export-jsdoc.ts`

- **用途**：强制要求每个非 vendored 的包导出有 JSDoc。函数和公开类方法必须有 `@param` 和非 void `@returns`；导出声明必须有描述性散文。使用 TypeScript 编译器做语义分析（包括继承链查找、重载签名处理、插件协议槽豁免等）。与 eslint 的 JSDoc 规则不同——eslint 检查格式，此脚本检查公开导出的**完整性**。
- **调用方**：`npm run verify-export-jsdoc`；被 `doc-sync` 第 9 步调用。
- **使用场合**：修改公开导出面（`packages/*/src/index.ts`）后。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-export-jsdoc.ts`
- **依赖**：`jsdoc.ts`、`typescript` 包

### `scripts/doc-typecheck.ts`

- **用途**：对 Markdown 中的 `ts` fence 做 TypeScript 编译检查，确保文档中的示例代码不过时。`ignore-check` fence 报告为 opt-out；`type-equiv` 块跳过（由 `verify-type-equiv` 拥有）。byte-identical `.zh.md` 复用其英文 sibling 的检查。使用已有声明消费模式（无 emit）。
- **调用方**：`npm run doc-typecheck`；被 `doc-sync` 第 10 步调用。
- **使用场合**：文档中有 TypeScript 代码块时。
- **能否主动调用**：✅ 能。`npx tsx scripts/doc-typecheck.ts`
- **依赖**：`doc-typecheck-paths.ts`、`markdown.ts`、`paired-markdown-derivatives.ts`、`repo-files.ts`、`typescript` 包

### `scripts/verify-doc-refs.ts`

- **用途**：检查仓库 TypeScript 源码注释中引用的 `docs/*.md` 和 `.agents/notes/*.md` 路径是否真实存在。逐行正则扫描，检查字符串字面量，排除构建输出和 vendored 源码。
- **调用方**：`npm run verify-doc-refs`；被 `doc-sync` 第 11 步调用。
- **使用场合**：在代码注释中引用文档路径后。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-doc-refs.ts`
- **依赖**：`repo-files.ts`

### `scripts/verify-archived-agent-notes.ts`

- **用途**：验证并 append-seal 冻结的 Agent Note 归档。检查 manifest.json 中的每个 artifact 的 sha256 hash 与磁盘文件匹配；检查归档树包含所有必需的 class 目录；只允许 `AGENTS.md` 和 `manifest.json` 在根级。`--write` 模式密封新 artifact。
- **调用方**：`npm run verify-archived-agent-notes`；被 `doc-sync` 第 12 步调用。
- **使用场合**：归档 Agent Note 后。
- **能否主动调用**：✅ 能。`npx tsx scripts/verify-archived-agent-notes.ts`（检查）；`--write`（密封新 artifact）。
- **依赖**：`agent-note-tree.ts`、`archived-agent-notes.ts`

---

## 二、共享模块（不可独立运行）

### `scripts/markdown.ts`

- **用途**：共享的 Markdown 解析和深度优先遍历。使用 `mdast-util-from-markdown` + `micromark-extension-gfm` 解析 GFM。提供 `parseMarkdown()`、`visitMarkdown()`、`markdownFences()`（提取代码块）、`markdownHeadingLines()`（提取标题）、`markdownProseLines()`（提取非代码非注释的散文行）、`markdownDestination()`（定位链接目标）。
- **调用方**：被 `verify-md-links.ts`、`verify-md-wrap.ts`、`verify-type-equiv.ts`、`doc-typecheck.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/repo-files.ts`

- **用途**：共享的仓库文件发现和行级引用扫描。提供 `uniqueRepoFiles()`（glob 展开 + symlink 去重）、`isArchivedAgentNotePath()`（判断是否为归档路径）、`findReferenceViolations()`（逐行正则扫描引用违规）。
- **调用方**：被 `verify-md-links.ts`、`verify-md-wrap.ts`、`verify-mermaid.ts`、`verify-type-equiv.ts`、`doc-typecheck.ts`、`verify-doc-refs.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/agent-note-tree.ts`

- **用途**：Agent Note 树结构的共享真相源。定义封闭的 lifecycle 集合（`proposed`、`implemented`、`rejected`）和 class 集合（`feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`）。`walkAgentNoteTree()` 遍历树并返回所有有效 Agent Note + 结构违规错误列表。
- **调用方**：被 `verify-agent-note-format.ts`、`verify-agent-note-classification.ts`、`verify-archived-agent-notes.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/jsdoc.ts`

- **用途**：JSDoc 解析辅助。提供 `parseJsDoc()`（解析 JSDoc 注释）、`parseTags()`（解析 `@param`、`@returns` 等标签）、`checkParams()`（检查参数文档完整性）、`checkReturns()`（检查返回值文档完整性）、`rawJsDoc()`（从注释范围提取原始文本）、`pointer()`（定位违规位置）。
- **调用方**：被 `verify-export-jsdoc.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/slot-walk.ts`

- **用途**：AST 辅助，用于扫描客户端 slot 声明面（`SlotMap` 声明合并和 `slots.register` 调用点）。纯词法扫描（无类型检查器 program）。**DSH 特有**——faijs 当前不使用 slot 系统，此模块作为完整移植保留，预留给未来可能的插件协议。
- **调用方**：被 `verify-export-jsdoc.ts` 中的协议槽豁免逻辑引用。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/archived-agent-notes.ts`

- **用途**：归档格式、triplet 和不可变 manifest 的纯函数辅助。提供 `parseArchiveManifest()`（解析 `manifest.json`）、`renderArchiveManifest()`（渲染为 JSON）、`validateArchiveArtifacts()`（校验 sha256）、`extendArchiveManifest()`（追加新 artifact）。
- **调用方**：被 `verify-archived-agent-notes.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/doc-typecheck-paths.ts`

- **用途**：将 workspace 源码别名路径映射到构建声明路径（`/src` → `/lib/types`）。**DSH 特有路径映射**——faijs 使用 `dist/` 而非 `lib/`，此模块已移植但需要适配 faijs 的构建输出路径。
- **调用方**：被 `doc-typecheck.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/paired-markdown-derivatives.ts`

- **用途**：将 byte-identical 中文 Markdown 代码块与英文 sibling 的主要检查分离。双语配对门禁拥有跨语言一致性；面向源码的门禁消费一份副本。`partitionPairedMarkdownDerivatives()` 将块列表分为 primary（需检查）和 derivatives（中文副本，复用 primary 结果）。
- **调用方**：被 `verify-type-equiv.ts`、`doc-typecheck.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/translation-pairing.ts`

- **用途**：双语配对的核心逻辑。提供 scope 判定（`isTranslationScopeFile()`、`translationPairSourcePredicate()`）、manifest 解析（`parseTranslationPairingManifest()`）、结构签名比较（`translationStructureSignature()`、`translationStructureDiff()`）、生成区域分区（`partitionGeneratedRegions()`）等。
- **调用方**：被 `verify-translation-pairing.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/translation-pairing-git.ts`

- **用途**：git blob hash 操作辅助。提供 `gitBlobHash()`（计算 git blob hash）、`readGitIndexBlob()`（从 git index 读取 blob）、`storeGitBlob()`（写入 git object store）、`gitIndexPaths()`（列出 index 中的所有路径）。
- **调用方**：被 `verify-translation-pairing.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/translation-pairing-record.ts`

- **用途**：`.i18n.yaml` 一致性记录的解析和渲染。提供 `parseTranslationPairingRecord()`（从 YAML 解析 hash 对）、`renderTranslationPairingRecord()`（渲染为 YAML 文本）、`translationPairPaths()`（从锚点路径推导三个文件路径）。
- **调用方**：被 `verify-translation-pairing.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/translation-pairing-merge.ts`

- **用途**：git merge-driver 和显式冲突解决器。提供 `mergeTranslationPairingRecords()`（合并两侧 hash 记录）、`resolveTranslationPairingConflicts()`（解决配对冲突）、`repositoryTranslationPairSource()`（确定仓库的翻译源语言）。
- **调用方**：被 `merge-translation-pairing.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/translation-links.ts`

- **用途**：翻译文档中的链接 locale 检查。提供 `hasLanguageSwitcher()`（检查文档是否有指向对侧的语言切换链接）、`normalizeTranslationMarkdownLinks()`（将配对文档路径规范化到同一语义目标）、`translationLinkLocaleViolations()`（找出使用错误 locale 的链接）、`languageSwitcherTargets()`（返回语言切换链接可接受的相对和公开仓库路径）。
- **调用方**：被 `verify-translation-pairing.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/translation-brief.ts`

- **用途**：翻译简报的核心规则。为 out-of-sync 配对计算最小更新粒度（code-fence-only splice、changed Markdown units、heading sections、whole document）。追踪术语首次出现，遵循增量管道规划器机制。
- **调用方**：被 `gen-translation-brief.ts` import。
- **能否主动调用**：❌ 纯函数库，无 CLI 入口。

### `scripts/translation-prompt.ts`

- **用途**：翻译 prompt 合同（prompt-v4）的可执行渲染器和响应解析器。三个占位符（`source_lang`、`target_lang`、`terminology`）、整文档翻译、三段式响应（`<translation>`、`<review>`、`<final>`）。管道在模型请求外保留文件名上下文，并在解析后修正最终语言切换链接。
- **调用方**：被翻译工作流工具调用（当前未被 doc-sync 直接调用）。
- **能否主动调用**：❌ 纯函数库（被 gen-translation-brief 工作流消费）。

---

## 三、工具脚本

### `scripts/archive-plans.mjs`

- **用途**：每月 1 号归档 `docs/plans/` 上月的方案文档。创建 `yyyy-mm/` 文件夹，用 `git mv` 将上月文档移入。1 月 1 日时额外创建 `yyyy/` 文件夹，将上年的月份文件夹移入年份文件夹。
- **调用方**：`npm run archive-plans`。每月 1 号手动运行或 CI 触发。支持 `--dry-run` 预览。
- **使用场合**：每月 1 号归档。
- **能否主动调用**：✅ 能。`npm run archive-plans` 或 `node scripts/archive-plans.mjs --dry-run`。
- **依赖**：无（纯 Node.js fs/path/child_process）

### `scripts/gen-translation-brief.ts`

- **用途**：为 out-of-sync 翻译配对打印最小更新简报。无参数时发现所有 out-of-sync 配对；有参数（任一配对文件）时只简报指定配对。`--apply` 对 code-fence-only 变更自动写入计算出的对侧。
- **调用方**：手动调用。`npx tsx scripts/gen-translation-brief.ts [--apply] [pair paths...]`
- **使用场合**：翻译工作流——确定哪些文档需要翻译更新，以及更新的最小粒度。
- **能否主动调用**：✅ 能。
- **依赖**：`translation-brief.ts`、`translation-pairing.ts`、`translation-pairing-git.ts`、`translation-pairing-record.ts`

### `scripts/merge-translation-pairing.ts`

- **用途**：git merge-driver 和显式冲突解决入口。当两侧 `.i18n.yaml` 记录在合并时冲突，此脚本合并两侧的 hash 记录。
- **调用方**：手动调用或配置为 git merge driver。`npx tsx scripts/merge-translation-pairing.ts <ours> <base> <theirs> <result>`
- **使用场合**：git merge 时 `.i18n.yaml` 冲突。
- **能否主动调用**：✅ 能（但主要用于 git merge driver 场景）。
- **依赖**：`translation-pairing-merge.ts`

---

## 四、配置文件

### `scripts/doc-budgets.manifest.json`

- **用途**：常驻文档的字数预算清单。键为仓库相对路径，值为单词数上限。`verify-doc-budgets.ts` 读取此文件。超限即失败；提高上限需要 PR 中的理由说明。
- **编辑方式**：手动编辑。新增常驻文档时添加条目。
- **被读取方**：`verify-doc-budgets.ts`

### `scripts/type-equiv.manifest.json`

- **用途**：类型等价注册清单。将文档中每个 `ts type-equiv` 代码块映射到它必须匹配的源代码声明。`verify-type-equiv.ts` 读取此文件。初始为空（faijs 文档暂无 `ts type-equiv` 块）。
- **编辑方式**：手动编辑。在文档中添加 `ts type-equiv` 块后，在此注册对应的源文件和符号。
- **被读取方**：`verify-type-equiv.ts`

### `scripts/translation-pairing.manifest.json`

- **用途**：双语配对排除清单。列出不需要双语配对的文件和目录。以 `/` 结尾的条目排除整个目录。faijs 排除了 `docs/plans/`、`docs/analysis/`（用户规定不双语）、`AGENTS.md` 等指令文件、`docs/i18n/terminology.md` 等自构文档。
- **编辑方式**：手动编辑。新增不需要双语的文档/目录时添加排除条目。
- **被读取方**：`verify-translation-pairing.ts`

---

## 五、调用关系总览

### `npm run doc-sync`（12 步链式调用）

```
1.  verify-md-links
2.  verify-md-wrap
3.  verify-doc-budgets
4.  verify-agent-note-format
5.  verify-agent-note-classification
6.  verify-translation-pairing
7.  verify-type-equiv
8.  verify-mermaid
9.  verify-export-jsdoc
10. doc-typecheck
11. verify-doc-refs
12. verify-archived-agent-notes
```

### CI 中调用位置

`scripts/ci.ps1` / `scripts/ci.sh` 的 `8/9` 步骤运行 `npm run doc-sync`。

### 依赖图（import 关系）

```
verify-md-links ─→ markdown, repo-files
verify-md-wrap  ─→ markdown, repo-files
verify-doc-budgets ─→ (独立)
verify-agent-note-format ─→ agent-note-tree
verify-agent-note-classification ─→ agent-note-tree
verify-translation-pairing ─→ translation-pairing-git, translation-pairing-record,
│                                translation-pairing, translation-links
verify-type-equiv ─→ markdown, paired-markdown-derivatives, repo-files
verify-mermaid ─→ repo-files, jsdom, mermaid
verify-export-jsdoc ─→ jsdoc, slot-walk, typescript
doc-typecheck ─→ doc-typecheck-paths, markdown, paired-markdown-derivatives, repo-files, typescript
verify-doc-refs ─→ repo-files
verify-archived-agent-notes ─→ agent-note-tree, archived-agent-notes
gen-translation-brief ─→ translation-brief, translation-pairing, translation-pairing-git, translation-pairing-record
merge-translation-pairing ─→ translation-pairing-merge
```
