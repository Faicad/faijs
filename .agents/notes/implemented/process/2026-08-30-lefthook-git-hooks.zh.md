# Agent Note: lefthook git hooks for staged gates

Status: implemented

[English](2026-08-30-lefthook-git-hooks.md) | 中文

## Problem

仓库级的门禁只存在于 CI（`scripts/ci.ps1`）中：开发者可以先提交违反配对、归档冻结、lint 和空白规则的暂存文档或源码，直到下一次 CI 运行时才发现。提交时机缺少即时反馈。

## Decision

仓库通过根目录的 `postinstall` 脚本（`scripts/install-lefthook.mjs`）安装 [lefthook](https://lefthook.dev) git hooks。`lefthook.yml` 定义快速、面向暂存区的检查关卡；CI 仍然负责完整门禁矩阵：

- `pre-commit`：暂存的 `.i18n.yaml` 记录翻译配对检查（`verify-translation-pairing --cached`）、归档 Agent Note 冻结检查、暂存 ESLint（`eslint --fix`，然后重新暂存修复）、以及 `git diff --cached --check`。
- `pre-merge-commit`：再次运行上述两项文档检查。
- `pre-push`：`npm run typecheck`。

暂存 lint 使用 ESLint（仓库现有 linter）而非切换到 oxlint，因此没有规则重复或配置漂移。CI 通过 `CI`/`GITHUB_ACTIONS` 环境守卫跳过安装。

## Alternatives considered

- **为暂存 lint job 使用 oxlint。** 对全量 lint 更快，但对少量暂存文件其速度优势消失，且 oxlint 在 Windows 上有已知内存不足问题。它还会与 ESLint 已强制的规则重复并造成配置漂移。
- **完整移植 DSH 安装器。** deepseek-harness 的安装器增加了 worktree 所有权标记、安装锁和配对 merge driver。faijs 不使用 worktree 或配对 merge driver；一个普通的 `lefthook install` 就够了。
- **不设 commit hooks，只靠 CI。** 正确性压力仍在 CI 上且问题发现得晚；暂存检查耗时不到一秒，值得做。
- **第三方声明和 vendor manifest 守卫。** 是 DSH 针对 vendored Python SDK 的 hooks；faijs 没有对应输入。

## Consequences

- `npm install` 现在会安装 hooks（`.git/hooks/pre-commit`、`pre-merge-commit`、`pre-push`）；全新 checkout 上的 `npm ci` 也会安装。
- 提交包含损坏的暂存 `.i18n.yaml` 记录、改动冻结归档、lint 错误或尾随空白的 commit 会立即失败。
- ESLint 自动修复仍会应用到暂存文件；重新暂存的结果才是被提交的内容。
- 当某个环境无法运行原生 hook 时，`lefthook.yml` 仍可提供 `native:*` 覆盖。