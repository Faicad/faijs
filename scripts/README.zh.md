# 脚本布局

[English](README.md) | 中文

本仓库把两类脚本放在各自独立的目录：

| 类别 | 位置 | 用途 |
|---|---|---|
| 第三方入口 | `packages/core/scripts/faijs-cli.ts` | 唯一面向外部调用者的脚本（类 bin 入口）。`packages/core/src/node-host/cli.ts` 的 `cliMain` 薄外壳；运行方式 `npx tsx packages/core/scripts/faijs-cli.ts <check\|run\|view> <file.fai.js> [options]`。 |
| 仓库自用 | `scripts/` 与 `packages/core/scripts/gen-*` | CI、doc 门禁、翻译工具、生成器与开发工具。外部调用者不引用。 |

## 第三方入口

`packages/core/scripts/faijs-cli.ts` 是公开 CLI。CLI 逻辑本身位于 `packages/core/src/node-host/cli.ts`（可导入、可单元测试，与 `check`/`run` 同模式）；入口文件只负责接 `process.argv` 与 `cad` 命名空间。

## 仓库自用脚本

根 `scripts/` 存放仓库自用工具：CI 脚本（`ci.ps1`/`ci.sh`）、doc 门禁（`verify-*`、`doc-typecheck.ts`）、翻译配对与工具。`packages/core/scripts/gen-*` 存放 L3 API 面生成器。逐脚本细节见 [docs/analysis/2026-08-30-scripts-reference.md](../docs/analysis/2026-08-30-scripts-reference.md)。
