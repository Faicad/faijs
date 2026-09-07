# Agent Note: 删除 IR 代码并迁移门禁（T5，无 IR 双通道运行时的最终步骤）

Status: implemented

[English](2026-09-07-no-ir-t5-delete-ir-code.md) | 中文

## Problem

T1–T4（P1–P4 翻转）之后，runtime 缺省已是 direct，但 IR 代码路径（`lang/parser.ts` 语义层、`lang/compile.ts`、`cad-runtime/module-executor.ts`、`cad-runtime/terminal-dag.ts`）仍然存在，消费方仍可触及。R11 红线要求删除前 A-16/A-17/A-14 对拍门禁全绿；该前置条件已满足。

## 决策

T5 删除了 IR 代码并迁移了门禁：

1. 删除 `lang/parser.ts`（parseScript 语义层、importDeclToIR、折叠）、`lang/compile.ts`（compileToModule、CompiledStatementMeta）、`cad-runtime/module-executor.ts`（ModuleExecutor、ExecBookkeeping、Namespaces——后者迁入 `direct-executor.ts`）、`cad-runtime/terminal-dag.ts`（computeLeafTerminals、consumes、DagRuntimeView——由 `live-shapes.ts` 替代）。
2. `lang/types.ts` 删除 ScriptIR/StatementIR/ImportIR/FunctionDefIR/ArgIR 类型与工厂；保留 ParamDef/TerminalShape/ScriptMetaIR/VarKind。
3. `lang/codegen.ts` 的 StatementIR 依赖改为 HostArg 面输入。
4. `runtime.ts` 简化：`directFailedAtOrThrow` 保留所有执行错误在 `failedAt`（不对业务参数错误 re-throw）；移除仅用于旧 re-throw 分支的 `BrepUnsupportedError`/`MeshUnsupportedError`/`OpError` 导入。
5. 对拍测试（A-16/A-17/A-14）从 direct vs module 对比转为 direct-only 行为验证（快照固化）。
6. `api/load.ts` 错误路径从普通 `Error` 改为 `OpError`，使其经 direct catch 路径进入 `failedAt`。
7. 测试更新：chamfer、topology-naming、refactor-acceptance、gear-lib-demo 中期望 `.rejects.toThrow` 的参数校验错误测试改为检查 `result.failedAt`（direct-only 语义：所有语句级错误进入 failedAt）。
8. `runtime.test.ts` 从 `executeIR`/`makeStmt`/`makePartScript` 辅助迁移为直接 `execute(code)` 调用；`plan()` 测试删除（plan 是 IR-only API）。

## Alternatives considered

- **保留业务参数错误的 re-throw，只捕获引擎能力错误**：否决——在 direct-only 模式下，DirectExecutor catch 块的所有错误都是语句级失败；对部分错误 re-throw 破坏了统一的 `failedAt` 契约，迫使宿主对 `execute` 做 try/catch，而 module 路径从未要求过。
- **保留 module 路径作为死代码回退**：否决——方案明确要求删除（T5/P6），保留死代码会诱发意外的重新耦合。

## 后果

- runtime 是 direct-only：`extractMetadata → DirectExecutor → computeLiveShapes` 是唯一执行路径。`parseScript`/`compileToModule`/`ModuleExecutor`/`terminal-dag` 已不存在。
- `ExecutionResult.failedAt` 是唯一错误通道：所有执行错误（OpError、BrepUnsupportedError、MeshUnsupportedError、TypeError、业务参数错误）进入 `failedAt`，不 re-throw。`ParseError` 仍被抛出（语法级，执行前）。
- 3d_editor 契约（§4.10 U1–U12/R1–R4）不变：`failedAt` 面（index/callee/message/lineNo）是加法字段；宿主按前三字段读不破裂。
- `no-ir/parity/` 测试是 direct-only 行为快照；继续常绿，作为回归锚点。
