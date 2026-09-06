# Agent Note: CadRuntime 增加 guarded DirectExecutor 模式（无 IR 双通道执行 P4）

Status: implemented

[English](2026-09-06-runtime-direct-mode-p4.md) | 中文

## Problem

P1–P3 已交付无 IR 的 MetadataExtractor / DirectExecutor / computeLiveShapes 及其对拍
门禁（A-16 / A-17 / A-14），但 `CadRuntime.execute/append/update` 仍然总是走 IR 链
（parseScript → compileToModule → ModuleExecutor），`collectResult` 的终端判定仍用
computeLeafTerminals 扫 ScriptIR DAG——runtime 自身没有无 IR 执行通道，两条执行链只
在测试里并存。

## Decision

CadRuntime 现在支持可选的无 IR 执行通道，缺省路径不动：

1. **`CadRuntimeOptions.executor: 'module' | 'direct'`**（第 4 个构造参数；缺省仍为
   `'module'`）。direct 模式构造 `DirectExecutor`，并在 `registerLib` 时同步其命名
   空间（与 ModuleExecutor 同一同步点）。
2. **公开入口分支**：`execute` → `executeDirectText`（全量）、`update` →
   `updateDirectText`（R3：清 ctx 全量重跑新文本）、`append` → `appendDirectText`
   （DirectExecutor.append 共享 ctx 只执行新行号）。module 分支逐字未动。
3. **direct 结果组装**（`collectDirectResult`）与 collectResult 同构、输入侧换源：
   outputs/compounds 来自 ctx 的 shape/compound 结构判定；statementCache 由 ctx 填
   content key（E8 getCachedOutput 继续可用）；terminals 来自 `computeLiveShapes`
   （行内 keep 查 metadata.keep 表、函数体 exec.keep 登记读
   `DirectExecutor.keepByLine`、显式 terminalShapes 优先）；有 kernel 时为终端与装配
   成员取 brepSolids；宿主注入的 topology 原样带出。
4. **failedAt 新增可选 lineNo**（加法字段：宿主按现状读 index/callee/message 不破）；
   direct 模式失败携带精确源码行。
5. **AppendPrefixError 语义保留**：append 元数据以 `looseVars: true` 提取（镜像 module
   append 的解析），新增 `DirectExecutor.missingPrefixVar()` 在执行前对新增单元校验
   持久 ctx——缺引用抛 AppendPrefixError，宿主升级为全量 execute。
6. **`DirectExecutor.reset()` 现在清空函数体 keep 登记表**——全量重跑不得泄漏上一场景
   的同行号 keep 登记（runtime 对拍套件捕捉到：后一个 fixture 继承了前一个 fixture
   在相同行号的 keepHidden 登记）。
7. **E4 执行选项已在 direct 路径接通**：`ExecuteOptions.beforeStatement` 对每个实际
   执行的单元触发一次（第一参数 = 单元 id `'s'+行号`——与新的 StatementSummary id
   同构，宿主按 id 定位 summaries 不破裂；第二参数 = 行号）；`executionTimeoutMs` 透传
   给 `DirectExecutor`，单元间逐单元检查整轮 deadline，超时抛 `ExecutionLimitError`
   （`E_EXEC_LIMIT`），不进 failedAt。错误类抽到叶子文件
   （`cad-runtime/execution-limit-error.ts`）供 module 路径（Promise.race）与 direct
   路径共用，避免 runtime↔direct-executor 循环依赖；runtime re-export 保持宿主 import
   面不变。keep sink 在 `finally` 中清理——中断执行（超时/ParseError）不得把 sink
   泄漏到下一次执行。

## Verification

`packages/tests/faijs/no-ir/parity/runtime-direct-mode.test.ts`（46 例）：direct 模式
CadRuntime 与 module 模式 CadRuntime 在全部 mesh 可跑 fixture 语料上 outputs（内容
key）、terminals（id + hidden）、compounds 逐条相等；并覆盖 runtime 面语义：append
增量、update 全量重跑、AppendPrefixError、failedAt lineNo/callee、direct execute 后
getCachedOutput、box→translate 链的 direct/module 一致性。core 套件（84 文件 /
1226）、tests 套件（73 文件 / 1520）、typecheck、lint 全绿。

## Alternatives considered

- **同一改动把 runtime 缺省翻到 direct**：拒绝——direct 结果组装尚未复刻 module 路径
  的 BREP topology/naming/changed/activeValues 面（solidCache 同步与逐 part role 表
  仍归 ModuleExecutor 所有），当前只锁 mesh 面等价；缺省保持 module，等这些面收敛
  后再整体翻转（完整 P4 翻转与 P6 删除分别门禁）。
- **prefix 校验放 DirectExecutor 内直接抛 AppendPrefixError**：拒绝——
  AppendPrefixError 属 runtime 对外面；执行器只上报首个缺失 {unitLine, varName}，
  由 runtime 抛宿主可见错误。
- **参数化复用 collectResult**：拒绝——collectResult 读 ModuleExecutor 内部
  （getMetas / getCachedKey / internalKeep / ctx）；独立组装让 direct 路径不耦合任何
  IR/执行器（P6 删 module 侧时不动 direct 侧）。

## Consequences

- CadRuntime 现在可以不经过 parseScript/compile/ModuleExecutor/terminal-dag 执行 mesh
  场景；R11 全部门禁（A-16/A-17/A-14 + 新 runtime 面对拍）绿，IR 删除仍不被允许
  （module 路径保持存活）。
- module 模式与其全部消费方零改动：构造参数加法、缺省 `'module'`、无测试/宿主改调用
  形态。
- 已知 direct 模式缺口（完整 P4/P6 翻转跟踪）：activeValues（keep-syntax §5.2 非几何
  叶子）、changed（装配记账）、BREP 真拓扑/naming 自动构建。
