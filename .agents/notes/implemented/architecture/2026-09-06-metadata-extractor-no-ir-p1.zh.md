# Agent Note: MetadataExtractor 落地（P1，无 IR 双通道运行时的第一步）

Status: implemented

[English](2026-09-06-metadata-extractor-no-ir-p1.md) | 中文

## Problem

`.fai.js` 的 parser 语义层（parseScript → ScriptIR）同时服务执行通道与 UI 通道——这正是 "每次改功能就要改 parser"的根源。2026-09-06 无 IR 双通道方案要求：执行通道与 UI 通道 解耦、parser 退化为元数据提取器、中间层 IR 最终删除。删除 IR 之前必须先实现无 IR 的 `MetadataExtractor`，并用对拍测试（A-16/A-17/A-14）锁定新旧路径结果一致（R11 红线）。

## 决策

P1 落地内容（未删除任何 IR 代码，执行链原样）：

1. 新增 `lang/parse-error.ts`（`ParseError`/`ParseErrorCode` 的唯一归属）与 `lang/fnv-hash.ts`（`fnv1a32` 的唯一归属）；`lang/parser.ts` 改为从二者重导出， 新旧路径共用同一个类身份。
2. 新增 `lang/metadata-extractor.ts`：`extractMetadata(code)` → `UiMetadata` （lines/params/imports/functions/blocks/keep/meta/terminalShapes）。lines 面直接产出 `StatementSummary`（id = `'s'+lineNo`），语义与现状 parseScript 投影逐字段相等 （折叠、HostArg 引用形态、refs、packageName、容器/扁平行号语义全同构）。本文件 不 import parser.ts/compile.ts，不生成可执行代码、不求值、不参与执行。
3. `lang/statement-summary.ts` 的 `analyzeCode` 与 `lang/code-to-args.ts` 的 `codeToArgs` 换实现：内部改走 `extractMetadata`（函数名/签名/返回类型不变；analyzeCode 抛错契约 保留 ParseError 含行号）。`parseScript` 仍是执行链的解析入口，双路径共存。
4. 对拍与单测：
   - `packages/core/src/lang/metadata-extractor.test.ts`（19 用例，含 A-6/A-7/A-11 抽样）；
   - `packages/tests/faijs/no-ir/parity/a16-lines.test.ts`（61 用例）：全部 40 个 `.fai.js` fixture + 合成行上，extractor.lines 与 legacy（parseScript 投影）在 id 兼容 `'s'+lineNo` 规则下逐字段相等；keep 表与 parseUserKeep 归一化相等； params/imports 面相等。
   - 全量 core 单测绿（82 文件 / 1170 用例）；typecheck 与 lint 绿。

## Alternatives considered

- **让 MetadataExtractor 内部调用 parseScript 投影**：零成本，但对拍测试变成循环论证， P6 删除 parser 后 extractor 无法独立存活，违背"无 IR 提取器"目标。否决。
- **从零实现但折叠/引用语义与现状有细微出入**：否决——A-16 是删除门禁，任何出入都会 在 fixture 对拍语料上暴露；故按现状语义同构移植。

## 后果

- UI 通道（analyzeCode/codeToArgs/timeline 数据源）不再依赖 ScriptIR；statement-summary 不再构建任何 IR 中间物。
- `StatementSummary.id` 语义由 sN（语句序）变为 `'s'+行号`（append 场景稳定）；宿主把 id 当作不透明字符串使用，不破裂；对拍比较按该规则归一。
- parseScript/compileToModule/ModuleExecutor/terminal-dag 仍在执行链上；P2（DirectExecutor） 新增无 IR 执行路径，P6 才允许按 R11 门禁删除 IR 代码。
