# Agent Note: 无 IR 双通道运行时 —— 删除中间层 IR

Status: proposed

[English](2026-09-06-no-ir-dual-channel-runtime.md) | 中文

## Problem

每次新需求都要改 parser：`parseScript` 是"语义提取 + 代码生成"二合一，`ScriptIR` 同时被执行通道（`compileToModule`）与 UI 通道（`analyzeCode` / 参数编辑 / timeline / DAG 终端判定）消费。语法限定发生在语义提取层，因为 IR 消费者要求"一行 = 一个 op 调用"的扁平形态。用户要求：取消 parser 语义层，`.fai.js` 源码直接交给 JS VM 执行，删除中间层 IR。

## Proposal

- 执行通道直通 JS VM：删除 `parseScript → ScriptIR → compileToModule → ModuleExecutor` 执行链；`DirectExecutor` 吃源码文本（共享 ctx + 可选标识符作用域提升 + import 轻 transform）。
- parser 退化为元数据提取器（不限定行级）：输出 `UiMetadata`（行级语句摘要、参数表、import 表、函数表、块结构、refs、keep），只服务 UI 通道；不生成可执行代码、不求值、不参与执行。
- UI 通道与执行通道解耦；唯一可选的共享点是标识符作用域提升（文本级，用元数据的 outputs/行边界信息）。
- 增量 append = 共享 ctx 执行新单元（行号即语句边界）；update = 全量重跑（用户接受）。
- 终端判定从静态 DAG 叶子（`terminal-dag`）切换为运行时存活判定 `computeLiveShapes`（keep 驱动消费判定 C0/C3/C5 原样 + keep）；`ExecutionResult.terminals` / `TerminalShape` 字段兼容，宿主零改动。
- 多文件 = `ProjectLoader` + 模块注册表 + 隐式导出（存活 shape ∪ 常量 ∪ 函数）；跨文件引用 ≠ 消费。
- timeline 保持每行一节点；循环/条件块 = 单个只读节点（源码文本，不分析语义、不 ×N 聚合）。

## Alternatives considered

- **保留 ScriptIR 但只做 UI 消费**：拒绝——每次新语法仍要扩展 IR 形态并改消费者，"改功能就要改 parser"的根源未除。
- **强制行级 LHS 重写**：拒绝——宿主自报 outputs 时可跳过；重写是可选优化不是契约。
- **保留 deps 闭包增量 update**：拒绝——用户接受全量重跑（R3）；v2 可用行级 refs 重建依赖图。
- **timeline 对循环显示 ×N 聚合**：拒绝——用户明确"循环有无限种可能性，完全不可行"；只读块节点即可。

## Acceptance criteria

- `execute` / `append` / `update` 文本入口签名不变；宿主零改动面（`result.terminals` 字段兼容；`failedAt` 保留 `index`/`callee`/`message` 并新增 `lineNo`）。
- 黄金数据对拍门禁（删除 IR 的前置条件）：在现有 `.fai.js` fixture 全集上，① `MetadataExtractor` 产出 == `parseScript` 派生摘要（逐字段相等）；② `DirectExecutor` 结果 == 现状 `executeIR` 结果（逐条相等）；③ `computeLiveShapes` == `computeLeafTerminals`（逐条相等，含 hidden/kind）。三组对拍在 CI 全绿后才准删除 IR 代码。
- `libLoader` / `registerLib` 契约不变，第三方库零改动；相对 import 走模块注册表。
- 全流程 stderr 零输出；doc-sync 全绿。

## Risks

- 参数编辑的引用形态保真（HostArg 引用 vs 值）——行级元数据保真 + 表达式行只读。
- 只读块节点的产品形态——按 R8 定为单只读节点显示源码文本，UI 细节与 3d_editor 确认。
- 测试套件迁移量（parser/compile/terminal-dag 测试重写）——P6 集中迁移，黄金数据对比锁定。
