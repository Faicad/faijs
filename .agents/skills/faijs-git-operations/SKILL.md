# Skill: faijs Git Operations

faijs 仓库内执行 git 操作时，遵守以下约定。

## Workflow

1. 先 `git status --short` 看全局，分类未提交改动（已 commit / 新文件 / 修改）
2. 逐个 diff 审视，不盲目 `add -A`；按逻辑分组 `git add`，一次提交一个 coherent 变更
3. 提交前回顾**整个 diff**（不只最近几轮对话），按下方 Commit Message 规范写 message
4. `git commit` 会自动触发 lefthook（LF 规范化 / export-jsdoc / eslint / whitespace）；任一失败则提交中止，先修再提交

## Commit 规则

**未跑 ci 时不准主动 commit。** 提交代码前必须跑 ci，或者用户明确说"commit"、"提交"或类似指令后才能 `git commit`。修改代码以后，用户说跑 ci 的时候，需要分步骤跑。

**不准单独提交文档。** 文档（CLAUDE.md / docs/ / README 等）必须与它所描述 / 对应的代码改动放在同一次 commit 里，不要在没有相关代码改动时单独 `git commit` 文档。文档改动应随其实现一起入库。

## ⚡ 用户命令"提交代码"时的速度与范围铁律（2026-09-06 事故教训）

1. **快，以最简步骤完成。** 用户一开口要求提交，立即按 `git status --short` → 确认范围 → `git add` → `git commit` 执行，整体尽量一分钟内完成。禁止深度分析、反复核对 diff、逐文件推演归属、先跑 CI / 决策确认。用户明确说"提交"就是直接指令，不要再请示分析。
   - 例外：需要时只做一次快速 `git status` 判断范围，不展开。
2. **只提交本次任务的代码 + 本次任务相关的文档。** 工作区若混杂了其它任务的改动（别的计划的草稿 `docs/plans/*`、其他人的删除 / 修改），**只 add 本次任务涉及的文件，不要 `git add -A` 一把全提交**；只有确认整个工作区都属于本次任务时才可 `git add -A`。
3. **误提交无关文件时的纠正**（允许，且速度优先）：`git reset --soft HEAD~1` 回撤本次 commit（工作区与暂存内容不动），再 `git restore --staged -- <无关文件>` 把它们拆出暂存区（文件保留在工作区，不丢），最后重新 `git commit`。**严禁 `git reset --hard` / `git restore <目录>`**。

### 事故复盘（为什么必须记住）

- 用户要求"提交所有代码 + 我自己这次的文档"，因我当时贪图省事执行 `git add -A`，把工作区里别的计划的草稿文档和其它任务的删除（如 docs/plans/ 下未提交的其它主题、docs/analysis 删除）一起提交了，引发用户强烈不满。
- 教训：`git status` 先看工作区是否混杂多任务；只锁定本次任务的文件；提交前明确"哪些该进、哪些绝不进"。

## Commit Message 规范

**全部用英文写。** 包括 header 和 body。

### 第一行（header）—— 本次提交完成了什么功能

格式：`type(scope): 用户视角的一句话`

```
feat(movies): unloadModel / moveModelToScreenNdc 支持按文件 target
fix(viewer): 多文件场景下 findMeshInScene 找不到非末文件 part
```

- 回答「这是什么功能 / 修了什么」，不是"我改了哪些文件"
- 只看 header 就能知道这个提交是做什么的

### 正文（body）—— 必要时的补充说明

- 一行 header 说不清楚时加正文，说明**做了什么来达成这个功能**（不是逐文件列举）
- **禁止**：列 bug 根因分析、实现细节、踩坑过程。禁止列文件清单。
- 正例：`- unloadModel 和 moveModelToScreenNdc 增加 target 参数支持按文件操作`
- 反例：`- 修复: 匹配改为 f.filePath === path || f.filePath === fileName`

### 要点

- **只看最后几轮对话写 commit message 是严重错误。** 必须回头看整个 diff 和实际完成的全部工作，找到真正重要的内容
- header 是核心，正文是辅助。

## ⚠️ Git 操作警戒：永远不准无差别还原目录

**禁止 `git restore <目录>`、`git checkout -- <目录>`、`git reset --hard` 等批量还原操作。**

这些命令会**无差别销毁目录下所有未提交的修改**，包括用户尚未 staging 的代码、调试改动、配置文件调整等。定向回滚单个文件（如 `git checkout HEAD -- <file>`）允许，但必须说明原因。

## 相关文件

- `scripts/ci.ps1` / `scripts/ci.sh` —— Windows / Linux 全量 CI（此 skill 中"跑 ci"即指这两个入口）
- `AGENTS.md` —— 仓库根指令（CI、conventional commits 与该 Git 警戒的权威出处）